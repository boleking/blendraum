// Prüft, dass im (öffentlichen) Repo keine echten Projektdaten liegen. Bricht mit Exit 1 ab.
// Aufruf: node scripts/check-public.mjs   (läuft vor jedem Build)
//
// Geprüft wird der Git-Index (also auch bereits gestagte Dateien):
//  1. nichts unter data/ – dort liegen die lokal erzeugten echten Pakete
//  2. keine 3D-, Scan- oder Geodaten-Dateien (.glb, .obj, .tif, .c4d …)
//  3. .gitignore ignoriert data/ und die Marker-Datei
//  4. public/twin.json ist das Platzhalterpaket: placeholder true, kein Nullpunkt
//  5. optional: Suchbegriffe aus einer lokalen, nie eingecheckten Marker-Datei
//     (.real-data-markers oder Pfad in TWIN_MARKERS, ein Begriff je Zeile, # = Kommentar).
//     Die Begriffe selbst stehen bewusst nicht im Repo.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MARKER_FILE = '.real-data-markers';

const HEAVY = /\.(glb|gltf|bin|obj|mtl|fbx|c4d|blend|3dm|dwg|dxf|pln|ifc|tif|tiff|ktx2|spz|splat|ply|las|laz|e57|xyz|pts)$/i;
const BINARY = /\.(png|jpe?g|webp|gif|ico|woff2?|ttf|zip|gz)$/i;

/** Liest Marker (ein Begriff je Zeile, leere Zeilen und # ignoriert, mind. 3 Zeichen). */
export function parseMarkers(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 3 && !l.startsWith('#'));
}

const ignores = (gitignore, entry) =>
  gitignore.split(/\r?\n/).map((l) => l.trim()).some((l) => l === entry || l === `/${entry}`);

/**
 * Reine Prüflogik, damit sie testbar ist.
 * @param {{ tracked: string[], readText: (f: string) => string | null, gitignore: string, markers: string[] }} input
 * @returns {string[]} Verstöße (leer = in Ordnung)
 */
export function findViolations({ tracked, readText, gitignore, markers }) {
  const out = [];
  for (const f of tracked) {
    if (f === 'data' || f.startsWith('data/')) out.push(`${f}: liegt unter data/ – echte Pakete nie einchecken`);
    else if (HEAVY.test(f)) out.push(`${f}: 3D-/Geodaten gehören nicht ins Repo (werden erzeugt)`);
    if (f === MARKER_FILE) out.push(`${f}: Marker-Datei darf nicht eingecheckt sein`);
  }
  if (!ignores(gitignore, 'data/')) out.push('.gitignore: data/ fehlt');
  if (!ignores(gitignore, MARKER_FILE)) out.push(`.gitignore: ${MARKER_FILE} fehlt`);

  const twinText = readText('public/twin.json');
  if (twinText === null) out.push('public/twin.json: fehlt');
  else {
    let twin;
    try {
      twin = JSON.parse(twinText);
    } catch {
      out.push('public/twin.json: kein gültiges JSON');
    }
    if (twin) {
      if (twin.placeholder !== true) out.push('public/twin.json: muss das Platzhalterpaket sein (placeholder: true)');
      if (twin.origin !== null && twin.origin !== undefined) out.push('public/twin.json: darf keinen Nullpunkt (origin) haben');
    }
  }

  if (markers.length) {
    const lower = markers.map((m) => m.toLowerCase());
    for (const f of tracked) {
      if (BINARY.test(f) || HEAVY.test(f) || f === 'package-lock.json') continue;
      const text = readText(f);
      if (text === null) continue;
      text.split(/\r?\n/).forEach((line, i) => {
        const l = line.toLowerCase();
        lower.forEach((m, k) => {
          if (l.includes(m)) out.push(`${f}:${i + 1}: enthält Marker „${markers[k]}“`);
        });
      });
    }
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  const readText = (f) => {
    const p = join(root, f);
    return existsSync(p) ? readFileSync(p, 'utf8') : null;
  };
  const markerPath = process.env.TWIN_MARKERS ? resolve(process.env.TWIN_MARKERS) : join(root, MARKER_FILE);
  const markers = existsSync(markerPath) ? parseMarkers(readFileSync(markerPath, 'utf8')) : [];
  const violations = findViolations({ tracked, readText, gitignore: readText('.gitignore') ?? '', markers });
  if (!markers.length) console.log(`check-public: keine Marker-Datei (${MARKER_FILE}) – Begriffsprüfung übersprungen`);
  if (violations.length) {
    console.error(`check-public: ${violations.length} Verstoß/Verstöße – echte Daten im öffentlichen Repo?`);
    for (const v of violations) console.error(`  ${v}`);
    process.exit(1);
  }
  console.log(`check-public: ${tracked.length} Dateien geprüft${markers.length ? `, ${markers.length} Marker` : ''} – in Ordnung`);
}
