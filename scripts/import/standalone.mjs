// Ein einzelnes Modell (z. B. KIRI-Export, GLB/glTF/OBJ) als eigenes Viewer-Paket – ohne Georeferenz.
// Für den schnellen Blick und die Diskussion, bevor das Modell über Passpunkte eingepasst ist.
//
//   node scripts/import/standalone.mjs <modell> --out data/<paket> --title "<Titel>" --zone "<Zonenname>"
//        [--short <Kurzname>] [--up y|z] [--scale 1]
//        [--triangles 120000] [--texture 2048] [--detail-triangles 400000] [--detail-texture 4096]
//        [--budget 5] [--zone-budget 5]
//
// Schreibt <out>/twin.json (georeferenced: false, ohne Nullpunkt), models/<zone>-bestand.glb (leicht, Übersicht),
// models/<zone>-bestand-detail.glb (beim Hineinzoomen) und import-report.json. Überschreibt nie: <out> darf nicht existieren.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { optimizeToGlb } from './glb.mjs';
import { bakeTransforms, clipToFootprint, makeUnlit, readModel, shrinkTextures } from './kiri-model.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CODE_MB = 0.17; // three.js + Viewer, gzip (Bericht S0)
const LEVELS = [
  { id: 'UG', label: 'Untergeschoss', elevation: -4, height: 4 },
  { id: 'EG', label: 'Erdgeschoss', elevation: 0, height: 4.5 },
  { id: 'OG1', label: '1. Obergeschoss', elevation: 4.5, height: 4 },
];
const mb = (b) => b / 1024 / 1024;
const r2 = (v) => +v.toFixed(2);
const log = (...a) => console.log('standalone:', ...a);

/** Maßstab und Hochachse als 4×4 (spaltenweise). up "z": Modell mit z oben → y oben. */
export function uprightMatrix(scale = 1, up = 'y') {
  if (!(scale > 0)) throw new Error('--scale muss > 0 sein');
  if (up === 'y') return [scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, 1];
  if (up === 'z') return [scale, 0, 0, 0, 0, 0, -scale, 0, 0, scale, 0, 0, 0, 0, 0, 1];
  throw new Error('--up ist y oder z');
}

/** Bounding-Box und Bodenhöhe (5-%-Quantil der Höhen) über alle Vertices. */
export function measure(doc) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  let ys = [];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const p of mesh.listPrimitives()) {
      const a = p.getAttribute('POSITION').getArray();
      for (let i = 0; i < a.length; i += 3) {
        x0 = Math.min(x0, a[i]); x1 = Math.max(x1, a[i]);
        z0 = Math.min(z0, a[i + 2]); z1 = Math.max(z1, a[i + 2]);
        ys.push(a[i + 1]); // alle Punkte: eine feste Schrittweite läuft bei Gittern im Gleichtakt
      }
    }
  }
  if (!Number.isFinite(x0)) throw new Error('Modell ohne Vertices');
  ys = Float32Array.from(ys).sort();
  return { x0, x1, z0, z1, ground: ys[Math.floor(ys.length * 0.05)] };
}

async function version(file, m, box, { triangles, texture, quality }) {
  const doc = await readModel(file);
  bakeTransforms(doc, m);
  const pad = 0.5;
  const footprint = [[box.x0 - pad, box.z1 + pad], [box.x1 + pad, box.z1 + pad], [box.x1 + pad, box.z0 - pad], [box.x0 - pad, box.z0 - pad]];
  const center = [(box.x0 + box.x1) / 2, (box.z0 + box.z1) / 2];
  await clipToFootprint(doc, footprint, center);
  makeUnlit(doc);
  await shrinkTextures(doc, texture, quality);
  const res = await optimizeToGlb(doc, { targetTriangles: triangles });
  return { ...res, footprint: footprint.map(([x, z]) => [r2(x - center[0]), r2(z - center[1])]) };
}

export async function main(argv) {
  const { values: o, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: 'string' }, title: { type: 'string' }, zone: { type: 'string' }, short: { type: 'string' },
      up: { type: 'string', default: 'y' }, scale: { type: 'string', default: '1' },
      triangles: { type: 'string', default: '120000' }, texture: { type: 'string', default: '2048' },
      'detail-triangles': { type: 'string', default: '400000' }, 'detail-texture': { type: 'string', default: '4096' },
      budget: { type: 'string', default: '5' }, 'zone-budget': { type: 'string', default: '5' },
    },
  });
  const file = positionals[0];
  if (!file || !o.out || !o.title || !o.zone) throw new Error('Aufruf: standalone.mjs <modell> --out data/<paket> --title "…" --zone "…"');
  if (!existsSync(file)) throw new Error(`Modell nicht gefunden: ${file}`);
  const out = resolve(ROOT, o.out);
  if (relative(join(ROOT, 'data'), out).startsWith('..') || out === join(ROOT, 'data')) throw new Error('--out muss ein Ordner unter data/ sein');
  if (existsSync(out)) throw new Error(`${o.out} existiert schon – nichts überschrieben`);
  if (o.short && o.short.length > 14) throw new Error('--short höchstens 14 Zeichen');
  const zoneId = o.zone.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'zone';
  const m = uprightMatrix(+o.scale, o.up);

  // Maße einmal bestimmen, damit leichte und Detailfassung genau übereinanderliegen
  const probe = await readModel(file);
  bakeTransforms(probe, m);
  const box = measure(probe);
  const w = box.x1 - box.x0;
  const d = box.z1 - box.z0;
  log(`Modell ${basename(file)}: ${w.toFixed(1)} × ${d.toFixed(1)} Einheiten, Boden ≈ ${box.ground.toFixed(2)}`);
  if (w < 5 || d < 5) log('Achtung: kleiner als 5 m – stimmt der Maßstab (--scale)?');

  const light = await version(file, m, box, { triangles: +o.triangles, texture: +o.texture, quality: 80 });
  const detail = await version(file, m, box, { triangles: +o['detail-triangles'], texture: +o['detail-texture'], quality: 80 });

  mkdirSync(join(out, 'models'), { recursive: true });
  const lightFile = `models/${zoneId}-bestand.glb`;
  const detailFile = `models/${zoneId}-bestand-detail.glb`;
  writeFileSync(join(out, lightFile), light.glb, { flag: 'wx' });
  writeFileSync(join(out, detailFile), detail.glb, { flag: 'wx' });
  const today = new Date().toISOString().slice(0, 10);
  const src = (triangles, texture) => ({ file: basename(file), date: today, triangles, texture });
  const base = r2(box.ground);
  const pid = `${zoneId}-blick`;
  const twin = {
    schema: 2,
    title: o.title,
    placeholder: false,
    georeferenced: false,
    origin: null,
    levels: LEVELS,
    zones: [{
      id: zoneId, label: o.zone, ...(o.short ? { short: o.short } : {}), base,
      // Grundriss in Web-Metern; die Zone liegt mit ihrer Mitte im Ursprung
      footprint: light.footprint,
      variants: {
        bestand: {
          label: 'Bestand', file: lightFile, source: src(light.triangles, +o.texture),
          detail: { file: detailFile, source: src(detail.triangles, +o['detail-texture']) },
        },
      },
    }],
    places: [{ id: pid, zoneId, label: 'Blickpunkt (technisch)', level: 'EG', position: [0, 1.5, 0] }],
    routeSteps: [{ id: `${pid}-1`, placeId: pid, label: 'Blickpunkt (technisch)', focus: [0, 0, 0] }],
  };
  writeFileSync(join(out, 'twin.json'), JSON.stringify(twin, null, 2) + '\n', { flag: 'wx' });
  const initial = mb(light.glb.length) + CODE_MB;
  const zoneMB = mb(detail.glb.length);
  const report = {
    date: today, source: basename(file), up: o.up, scale: +o.scale, georeferenced: false,
    size: { width: r2(w), depth: r2(d), ground: base },
    light: { triangles: light.triangles, trianglesBefore: light.trianglesBefore, MB: r2(mb(light.glb.length)) },
    detail: { triangles: detail.triangles, MB: r2(zoneMB) },
    budget: { initialMB: r2(initial), limitMB: +o.budget, zoneMB: r2(zoneMB), zoneLimitMB: +o['zone-budget'], codeMB: CODE_MB },
  };
  writeFileSync(join(out, 'import-report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  log(`leicht: ${light.trianglesBefore} → ${light.triangles} Dreiecke, ${mb(light.glb.length).toFixed(2)} MB`);
  log(`Detail: ${detail.triangles} Dreiecke, ${zoneMB.toFixed(2)} MB`);
  log(`Erster Download ${initial.toFixed(2)} MB (Grenze ${o.budget}), Nachladen ${zoneMB.toFixed(2)} MB (Grenze ${o['zone-budget']})`);
  log(`Paket geschrieben: ${relative(ROOT, out)} – Lage NICHT georeferenziert`);
  return initial > +o.budget || zoneMB > +o['zone-budget'] ? 2 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      if (code) console.error('standalone: Budget überschritten (Paket trotzdem geschrieben)');
      process.exit(code);
    },
    (e) => {
      console.error('standalone:', e.message);
      process.exit(1);
    },
  );
}
