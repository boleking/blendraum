// Import echter Daten in ein lokales Paket unter data/ (S1: Gelände + Bestand).
// Aufruf: node scripts/import/run.mjs <import.json>
// Die Konfiguration (Pfade, Nullpunkte) liegt im privaten Daten-Repo, nie hier.
// Ausgabe: <out>/twin.json, <out>/models/terrain.glb, <out>/models/<zone>-bestand.glb, <out>/import-report.json
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromArrayBuffer } from 'geotiff';
import sharp from 'sharp';
import { meshDocument, optimizeToGlb } from './glb.mjs';
import { parseObj } from './obj.mjs';
import { coverageMask, gridIndices, sampleRaster, sinkCovered, terrainExtent, terrainGrid } from './terrain.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TERRAIN_COLOR = [0.78, 0.71, 0.6, 1];
const CODE_MB = 0.17; // three.js + Viewer, gzip (Bericht S0)
const today = () => new Date().toISOString().slice(0, 10);
const mb = (bytes) => bytes / 1024 / 1024;
const log = (...a) => console.log('import:', ...a);

export function quantile(values, q) {
  const s = Float64Array.from(values).sort();
  if (s.length === 0) return NaN;
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
}

/** Häufigster Wert (Mitte des vollsten Intervalls der Breite `bin`) */
export function modeOf(values, bin) {
  const counts = new Map();
  for (const v of values) {
    const k = Math.floor(v / bin);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let best = NaN;
  let max = 0;
  for (const [k, c] of counts) if (c > max) [best, max] = [k, c];
  return (best + 0.5) * bin;
}

async function readRaster(file) {
  const buf = readFileSync(file);
  const tiff = await fromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const img = await tiff.getImage();
  const [left, top] = img.getOrigin();
  const [rx, ry] = img.getResolution();
  if (Math.abs(rx + ry) > 1e-9 || rx <= 0) throw new Error('Gelände: nur quadratische, nordorientierte Raster');
  const [data] = await img.readRasters();
  return { data, width: img.getWidth(), height: img.getHeight(), left, top, res: rx };
}

async function main() {
  const cfgPath = resolve(process.argv[2] ?? '');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  const out = resolve(ROOT, cfg.out);
  if (relative(join(ROOT, 'data'), out).startsWith('..')) throw new Error('out muss unter data/ liegen');
  mkdirSync(join(out, 'models'), { recursive: true });
  const report = { date: today() };

  // 1. Bestand lesen und nach UTM (m) bringen
  log('lese Bestand', basename(cfg.bestand.obj));
  const obj = parseObj(readFileSync(cfg.bestand.obj, 'utf8'));
  const nv = obj.positions.length / 3;
  // Optionaler senkrechter Versatz (Arbeitswert aus der Konfiguration, dort begründet)
  const dz = cfg.bestand.offset?.dz ?? 0;
  if (dz) log(`Bestand: senkrechter Versatz ${dz} m laut Konfiguration`);
  report.bestandOffset = { dz, note: cfg.bestand.offset?.note ?? null };
  const utm = new Float64Array(nv * 3);
  const en = new Float64Array(nv * 2);
  const box = { e0: Infinity, e1: -Infinity, n0: Infinity, n1: -Infinity };
  for (let i = 0; i < nv; i++) {
    const e = obj.positions[3 * i] / 100 + cfg.sourceOrigin.e;
    const n = obj.positions[3 * i + 1] / 100 + cfg.sourceOrigin.n;
    const h = obj.positions[3 * i + 2] / 100 + dz;
    utm.set([e, n, h], 3 * i);
    en.set([e, n], 2 * i);
    box.e0 = Math.min(box.e0, e); box.e1 = Math.max(box.e1, e);
    box.n0 = Math.min(box.n0, n); box.n1 = Math.max(box.n1, n);
  }
  log(`Bestand: ${obj.sourceVertices} Punkte, ${obj.sourceFaces} Flächen, ${(box.e1 - box.e0).toFixed(0)} × ${(box.n1 - box.n0).toFixed(0)} m`);

  // 2. Raster lesen, Nullpunkt festlegen (einmalig, danach fest in der Konfiguration)
  const raster = await readRaster(cfg.terrain.file);
  const cE = (box.e0 + box.e1) / 2;
  const cN = (box.n0 + box.n1) / 2;
  if (!cfg.webOrigin) {
    const h = sampleRaster(raster, cE, cN);
    cfg.webOrigin = { epsg: cfg.epsg, e: Math.round(cE / 10) * 10, n: Math.round(cN / 10) * 10, h: Math.round(h) };
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
    log('Nullpunkt neu festgelegt und in die Konfiguration geschrieben:', JSON.stringify(cfg.webOrigin));
  }
  const o = cfg.webOrigin;
  const toWeb = (e, n, h) => [e - o.e, h - o.h, -(n - o.n)];

  // 3. Gelände: Gitter, unter dem Bestand absenken, GLB
  const ext = terrainExtent(raster, box, cfg.terrain.margin, cfg.terrain.cell);
  const grid = terrainGrid(raster, ext);
  const mask = coverageMask(grid, en, obj.indices, 1);
  sinkCovered(grid, mask, cfg.terrain.sink);
  const tPos = new Float32Array(grid.cols * grid.rows * 3);
  for (let k = 0; k < grid.cols * grid.rows; k++) {
    tPos.set(toWeb(grid.utm[3 * k], grid.utm[3 * k + 1], grid.utm[3 * k + 2]), 3 * k);
  }
  const terrainDoc = meshDocument({ name: 'terrain', positions: tPos, indices: gridIndices(grid.cols, grid.rows), color: TERRAIN_COLOR, normals: true });
  const terrain = await optimizeToGlb(terrainDoc);
  writeFileSync(join(out, 'models/terrain.glb'), terrain.glb);
  const covered = mask.reduce((s, v) => s + v, 0);
  log(`Gelände: ${grid.cols} × ${grid.rows} Punkte à ${ext.cell} m, ${terrain.triangles} Dreiecke, ${covered} Punkte um ${cfg.terrain.sink} m abgesenkt, ${mb(terrain.glb.length).toFixed(2)} MB`);

  // 4. Bestand: Web-Koordinaten, Textur verkleinern, reduzieren, GLB
  const bPos = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) bPos.set(toWeb(utm[3 * i], utm[3 * i + 1], utm[3 * i + 2]), 3 * i);
  const texMeta = await sharp(cfg.bestand.texture, { limitInputPixels: false }).metadata();
  const tex = await sharp(cfg.bestand.texture, { limitInputPixels: false })
    .resize(cfg.bestand.textureSize, cfg.bestand.textureSize)
    .removeAlpha()
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  const zoneId = cfg.zone.id;
  const bestandDoc = meshDocument({
    name: `${zoneId}-bestand`,
    positions: bPos,
    uvs: obj.uvs,
    indices: obj.indices,
    color: [1, 1, 1, 1],
    unlit: true, // Photogrammetrie trägt ihr Licht in der Textur
    texture: { data: new Uint8Array(tex), mimeType: 'image/jpeg' },
  });
  const bestand = await optimizeToGlb(bestandDoc, { targetTriangles: cfg.bestand.triangles });
  const bestandFile = `models/${zoneId}-bestand.glb`;
  writeFileSync(join(out, bestandFile), bestand.glb);
  log(`Bestand: ${bestand.trianglesBefore} → ${bestand.triangles} Dreiecke, Textur ${texMeta.width} → ${cfg.bestand.textureSize} px, ${mb(bestand.glb.length).toFixed(2)} MB`);

  // 5. Budget
  const initial = mb(terrain.glb.length + bestand.glb.length) + CODE_MB;
  report.budget = { initialMB: +initial.toFixed(2), limitMB: cfg.budget.initialMB, terrainMB: +mb(terrain.glb.length).toFixed(2), bestandMB: +mb(bestand.glb.length).toFixed(2), codeMB: CODE_MB };
  log(`Erster Download: ${initial.toFixed(2)} MB (Grenze ${cfg.budget.initialMB} MB)`);

  // 6. Höhenabgleich Bestand ↔ DGM in drei Streifen (West, Mitte, Ost): häufigste Differenz.
  //    Bodenpunkte sind die Mehrheit; Dächer, Bäume und Becken verschieben den Modalwert kaum.
  report.alignment = [];
  const strips = [[], [], []];
  for (let i = 0; i < nv; i++) {
    const s = Math.min(2, Math.floor(((utm[3 * i] - box.e0) / (box.e1 - box.e0)) * 3));
    strips[s].push(utm[3 * i + 2] - sampleRaster(raster, utm[3 * i], utm[3 * i + 1]));
  }
  ['West', 'Mitte', 'Ost'].forEach((name, s) => {
    const d = strips[s];
    report.alignment.push({ streifen: name, punkte: d.length, modalwert: +modeOf(d, 0.25).toFixed(2), median: +quantile(d, 0.5).toFixed(2), anteilBis1m: +(d.filter((v) => Math.abs(v) <= 1).length / d.length).toFixed(2) });
  });
  for (const a of report.alignment) {
    log(`Höhenabgleich ${a.streifen}: häufigste Δ ${a.modalwert} m, Median ${a.median} m, ${Math.round(a.anteilBis1m * 100)} % der Punkte innerhalb ±1 m (${a.punkte} Punkte)`);
  }

  // 7. twin.json
  const [x0, , zA] = toWeb(box.e0, box.n0, 0);
  const [x1, , zB] = toWeb(box.e1, box.n1, 0);
  const footprint = [[x0, zA], [x1, zA], [x1, zB], [x0, zB]].map(([x, z]) => [+x.toFixed(2), +z.toFixed(2)]);
  const eg = cfg.levels.find((l) => l.id === 'EG');
  const groundY = sampleRaster(raster, cE, cN) - o.h;
  const placeY = groundY + 1.5;
  if (placeY < eg.elevation || placeY > eg.elevation + eg.height) {
    throw new Error(`Blickpunkt-Höhe ${placeY.toFixed(2)} m liegt nicht im EG (${eg.elevation}–${eg.elevation + eg.height} m)`);
  }
  const center = [(x0 + x1) / 2, (zA + zB) / 2];
  const [vx, , vz] = toWeb(cE, cN, 0);
  const src = (file, triangles, texture) => ({ file: basename(file), date: today(), triangles, ...(texture ? { texture } : {}) });
  const twin = {
    schema: 2,
    title: cfg.title,
    placeholder: false,
    origin: o,
    terrain: { file: 'models/terrain.glb', source: src(cfg.terrain.file, terrain.triangles) },
    levels: cfg.levels,
    zones: [
      {
        id: zoneId,
        label: cfg.zone.label,
        footprint,
        variants: { bestand: { label: 'Bestand', file: bestandFile, source: src(cfg.bestand.obj, bestand.triangles, cfg.bestand.textureSize) } },
      },
    ],
    places: [{ id: cfg.viewpoint.id, zoneId, label: cfg.viewpoint.label, level: 'EG', position: [+(vx - center[0]).toFixed(2), +placeY.toFixed(2), +(vz - center[1]).toFixed(2)] }],
    routeSteps: [{ id: `${cfg.viewpoint.id}-1`, placeId: cfg.viewpoint.id, label: cfg.viewpoint.label, focus: [0, 0, 0] }],
  };
  writeFileSync(join(out, 'twin.json'), JSON.stringify(twin, null, 2) + '\n');
  report.files = Object.fromEntries(['twin.json', 'models/terrain.glb', bestandFile].map((f) => [f, statSync(join(out, f)).size]));
  writeFileSync(join(out, 'import-report.json'), JSON.stringify(report, null, 2) + '\n');
  log(`Paket geschrieben: ${relative(ROOT, out)}`);
  if (initial > cfg.budget.initialMB) {
    console.error(`import: Budget überschritten (${initial.toFixed(2)} > ${cfg.budget.initialMB} MB)`);
    process.exit(2);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error('import:', e.message);
    process.exit(1);
  });
}
