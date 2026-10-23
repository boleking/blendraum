// Import echter Daten in ein lokales Paket unter data/ (Gelände, Bestand je Zone, Detailfassungen).
// Aufruf: node scripts/import/run.mjs <import.json> [--nur-passpunkte]
//   --nur-passpunkte: nur die Einpassung fremder Modelle (zones[].kiri) prüfen, nichts lesen oder schreiben
// Die Konfiguration (Pfade, Nullpunkte, Zonen) liegt im privaten Daten-Repo, nie hier.
// Ausgabe: <out>/twin.json, <out>/models/*.glb, <out>/import-report.json
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromArrayBuffer } from 'geotiff';
import sharp from 'sharp';
import { meshDocument, optimizeToGlb } from './glb.mjs';
import { bakeTransforms, clipToFootprint, makeUnlit, readModel, shrinkTextures } from './kiri-model.mjs';
import { parseObj } from './obj.mjs';
import { coverageMask, gridIndices, sampleRaster, sinkCovered, terrainExtent, terrainGrid } from './terrain.mjs';
import { placeReport, similarityMatrix } from './place.mjs';
import { boundsFootprint, compactMesh, footprintCenter, inside, splitByZones } from './zones.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TERRAIN_COLOR = [0.78, 0.71, 0.6, 1];
const CODE_MB = 0.17; // three.js + Viewer, gzip (Bericht S0)
const today = () => new Date().toISOString().slice(0, 10);
const mb = (bytes) => bytes / 1024 / 1024;
const r2 = (v) => +v.toFixed(2);
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

/**
 * Passpunkte eines fremden Modells aus der Konfiguration in Web-Meter.
 * Je Punkt: `src` (Koordinaten im fremden Modell, so wie es exportiert wurde) und genau ein Ziel:
 * `utm` [E, N, H], `bestandObj` [x, y, z] in cm wie in der Bestands-OBJ (inkl. senkrechtem Versatz)
 * oder `web` [x, y, z].
 * `srcFrame`: "gltf" (Standard: wie in der Datei, y oben) oder "blender" (Blender zeigt glTF mit z oben:
 * Blender (x, y, z) = glTF (x, −z, y)).
 */
export function passPointsFromConfig(cfg, list = [], srcFrame = 'gltf') {
  if (!['gltf', 'blender'].includes(srcFrame)) throw new Error(`srcFrame ist gltf oder blender (ist ${srcFrame})`);
  const toGltf = srcFrame === 'blender' ? ([x, y, z]) => [x, z, -y] : (p) => p;
  const o = cfg.webOrigin;
  if (!o) throw new Error('Passpunkte brauchen einen festen webOrigin in der Konfiguration');
  const dz = cfg.bestand?.offset?.dz ?? 0;
  return list.map((p, i) => {
    const id = p.id ?? `P${i + 1}`;
    const targets = ['utm', 'bestandObj', 'web'].filter((k) => p[k]);
    if (targets.length !== 1) throw new Error(`Passpunkt ${id}: genau eines von utm, bestandObj, web angeben`);
    let dst;
    if (p.utm) dst = [p.utm[0] - o.e, p.utm[2] - o.h, -(p.utm[1] - o.n)];
    else if (p.bestandObj) {
      const [x, y, z] = p.bestandObj;
      dst = [x / 100 + cfg.sourceOrigin.e - o.e, z / 100 + dz - o.h, -(y / 100 + cfg.sourceOrigin.n - o.n)];
    } else dst = p.web;
    if (!Array.isArray(p.src) || p.src.length !== 3) throw new Error(`Passpunkt ${id}: src fehlt`);
    return { id, src: toGltf(p.src), dst };
  });
}

/** Einpassung prüfen; bricht ab ohne Prüfpunkt oder über der Fehlergrenze (Standard 2 m wie S1). */
export function checkPlacement(cfg, zoneId, k) {
  const pass = passPointsFromConfig(cfg, k.passpoints, k.srcFrame);
  const check = passPointsFromConfig(cfg, k.checkpoints, k.srcFrame);
  if (!check.length) throw new Error(`Zone ${zoneId}: mindestens ein Prüfpunkt (checkpoints) nötig – unabhängiger Nachweis der Lage`);
  const r = placeReport(pass, check);
  const limit = k.maxError ?? 2;
  const f = (v) => v.toFixed(2);
  log(`Zone ${zoneId}: Einpassung Maßstab ${r.scale.toFixed(5)}, Drehung ${r.yawDeg.toFixed(1)}°, Neigung ${r.tiltDeg.toFixed(1)}°`);
  for (const p of r.pass) log(`  Passpunkt ${p.id}: ${f(p.error)} m (Höhe ${f(p.dy)} m)`);
  for (const p of r.check) log(`  Prüfpunkt ${p.id}: ${f(p.error)} m (Höhe ${f(p.dy)} m)`);
  log(`  RMS Passpunkte ${f(r.passRms)} m, Prüfpunkte max. ${f(r.checkMax)} m (Grenze ${limit} m)`);
  if (r.passRms > limit || r.checkMax > limit) throw new Error(`Zone ${zoneId}: Einpassung über der Grenze von ${limit} m – Passpunkte prüfen`);
  return r;
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

/** Textur verkleinern und als JPEG liefern */
async function textureJpeg(file, size, quality) {
  const img = sharp(file, { limitInputPixels: false });
  const meta = await img.metadata();
  const data = await img.resize(size, size).removeAlpha().jpeg({ quality, mozjpeg: true }).toBuffer();
  return { data: new Uint8Array(data), mimeType: 'image/jpeg', sourceSize: meta.width };
}

async function main() {
  const cfgPath = resolve(process.argv[2] ?? '');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  if (process.argv.includes('--nur-passpunkte')) {
    const zs = (cfg.zones ?? []).filter((z) => z.kiri);
    if (!zs.length) throw new Error('keine Zone mit kiri in der Konfiguration');
    for (const z of zs) checkPlacement(cfg, z.id, z.kiri);
    log('Passpunkte in Ordnung – nichts gelesen, nichts geschrieben');
    return;
  }
  const out = resolve(ROOT, cfg.out);
  if (relative(join(ROOT, 'data'), out).startsWith('..')) throw new Error('out muss unter data/ liegen');
  if (!Array.isArray(cfg.zones) || !cfg.zones.length) throw new Error('zones fehlt in der Konfiguration');
  // Fremdmodelle zuerst einpassen: schlechte Passpunkte brechen ab, bevor etwas geschrieben wird
  const placements = new Map();
  for (const z of cfg.zones.filter((zz) => zz.kiri)) {
    if (!cfg.webOrigin) throw new Error('Fremdmodelle brauchen einen festen webOrigin – zuerst einmal ohne kiri importieren');
    placements.set(z.id, checkPlacement(cfg, z.id, z.kiri));
  }
  mkdirSync(join(out, 'models'), { recursive: true });
  const report = { date: today(), zones: {} };
  const sizes = {};
  const write = (file, glb) => {
    writeFileSync(join(out, file), glb);
    sizes[file] = glb.length;
  };

  // 1. Bestand (leicht) lesen und nach UTM bringen; optionaler senkrechter Versatz aus der Konfiguration
  const dz = cfg.bestand.offset?.dz ?? 0;
  report.bestandOffset = { dz, note: cfg.bestand.offset?.note ?? null };
  if (dz) log(`Bestand: senkrechter Versatz ${dz} m laut Konfiguration`);
  log('lese Bestand', basename(cfg.bestand.obj));
  const obj = parseObj(readFileSync(cfg.bestand.obj, 'utf8'));
  const nv = obj.positions.length / 3;
  const utm = new Float64Array(nv * 3);
  const en = new Float64Array(nv * 2);
  const box = { e0: Infinity, e1: -Infinity, n0: Infinity, n1: -Infinity };
  for (let i = 0; i < nv; i++) {
    const e = obj.positions[3 * i] / 100 + cfg.sourceOrigin.e;
    const n = obj.positions[3 * i + 1] / 100 + cfg.sourceOrigin.n;
    utm.set([e, n, obj.positions[3 * i + 2] / 100 + dz], 3 * i);
    en.set([e, n], 2 * i);
    box.e0 = Math.min(box.e0, e); box.e1 = Math.max(box.e1, e);
    box.n0 = Math.min(box.n0, n); box.n1 = Math.max(box.n1, n);
  }
  log(`Bestand: ${obj.sourceVertices} Punkte, ${obj.sourceFaces} Flächen, ${(box.e1 - box.e0).toFixed(0)} × ${(box.n1 - box.n0).toFixed(0)} m`);

  // 2. Raster lesen, Nullpunkt festlegen (einmalig, danach fest in der Konfiguration)
  const raster = await readRaster(cfg.terrain.file);
  if (!cfg.webOrigin) {
    const cE = (box.e0 + box.e1) / 2;
    const cN = (box.n0 + box.n1) / 2;
    cfg.webOrigin = { epsg: cfg.epsg, e: Math.round(cE / 10) * 10, n: Math.round(cN / 10) * 10, h: Math.round(sampleRaster(raster, cE, cN)) };
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
    log('Nullpunkt neu festgelegt und in die Konfiguration geschrieben:', JSON.stringify(cfg.webOrigin));
  }
  const o = cfg.webOrigin;
  const toWeb = (e, n, h) => [e - o.e, h - o.h, -(n - o.n)];
  const groundWeb = (x, z) => sampleRaster(raster, x + o.e, o.n - z) - o.h;

  // 3. Gelände: Gitter, unter dem Bestand absenken, GLB (absolut, gehört keiner Zone)
  const ext = terrainExtent(raster, box, cfg.terrain.margin, cfg.terrain.cell);
  const grid = terrainGrid(raster, ext);
  const mask = coverageMask(grid, en, obj.indices, cfg.terrain.dilate ?? 1);
  sinkCovered(grid, mask, cfg.terrain.sink);
  const tPos = new Float32Array(grid.cols * grid.rows * 3);
  for (let k = 0; k < grid.cols * grid.rows; k++) tPos.set(toWeb(grid.utm[3 * k], grid.utm[3 * k + 1], grid.utm[3 * k + 2]), 3 * k);
  const terrain = await optimizeToGlb(
    meshDocument({ name: 'terrain', positions: tPos, indices: gridIndices(grid.cols, grid.rows), color: TERRAIN_COLOR, normals: true }),
  );
  write('models/terrain.glb', terrain.glb);
  log(`Gelände: ${grid.cols} × ${grid.rows} Punkte à ${ext.cell} m, ${terrain.triangles} Dreiecke, ${mask.reduce((s, v) => s + v, 0)} Punkte um ${cfg.terrain.sink} m abgesenkt, ${mb(terrain.glb.length).toFixed(2)} MB`);

  // 4. Bestand in Zonen teilen, je Zone relativ zur Zonenmitte, auf das Budget reduziert
  const web = new Float64Array(nv * 3);
  for (let i = 0; i < nv; i++) web.set(toWeb(utm[3 * i], utm[3 * i + 1], utm[3 * i + 2]), 3 * i);
  const parts = splitByZones(web, obj.indices, cfg.zones);
  const tex = await textureJpeg(cfg.bestand.texture, cfg.bestand.textureSize, 82);
  const ratio = cfg.bestand.triangles / (obj.indices.length / 3);
  const zones = [];
  const places = [];
  const routeSteps = [];
  const src = (file, triangles, texture) => ({ file: basename(file), date: today(), triangles, ...(texture ? { texture } : {}) });
  const eg = cfg.levels.find((l) => l.id === 'EG');

  for (const zc of cfg.zones) {
    const tri = parts.get(zc.id);
    if (!tri.length) throw new Error(`Zone ${zc.id}: kein Bestand im Grundriss`);
    const footprint = (zc.polygon ?? boundsFootprint(web, tri)).map(([x, z]) => [r2(x), r2(z)]);
    const center = footprintCenter(footprint);
    const base = r2(groundWeb(center[0], center[1]));
    const m = compactMesh(web, obj.uvs, tri, center);
    const low = await optimizeToGlb(
      meshDocument({ name: `${zc.id}-bestand`, positions: m.positions, uvs: m.uvs, indices: m.indices, color: [1, 1, 1, 1], unlit: true, texture: tex }),
      { targetTriangles: Math.round((tri.length / 3) * ratio), lockBorder: true },
    );
    const file = `models/${zc.id}-bestand.glb`;
    write(file, low.glb);
    const variant = { label: 'Bestand', file, source: src(cfg.bestand.obj, low.triangles, cfg.bestand.textureSize) };
    report.zones[zc.id] = { triangles: low.triangles, MB: r2(mb(low.glb.length)), base };
    log(`Zone ${zc.id}: ${tri.length / 3} → ${low.triangles} Dreiecke, ${mb(low.glb.length).toFixed(2)} MB, ±0 der Zone ${base} m`);

    // 4b. Detailfassung aus einem dichteren Modell, nur Dreiecke im Grundriss
    if (zc.detail) {
      if (!zc.polygon) throw new Error(`Zone ${zc.id}: Detail nur mit Grundriss-Polygon`);
      log(`Zone ${zc.id}: lese Detail ${basename(zc.detail.obj)}`);
      const sx = cfg.sourceOrigin.e - o.e;
      const sz = cfg.sourceOrigin.n - o.n;
      // Filter in Quelleinheiten (cm, x = Ost, y = Nord) → Web (x, z)
      const d = parseObj(readFileSync(zc.detail.obj, 'utf8'), { keepFace: (cx, cy) => inside(cx / 100 + sx, -(cy / 100 + sz), zc.polygon) });
      const dn = d.positions.length / 3;
      const dWeb = new Float64Array(dn * 3);
      for (let i = 0; i < dn; i++) {
        dWeb.set([d.positions[3 * i] / 100 + sx, d.positions[3 * i + 2] / 100 + dz - o.h, -(d.positions[3 * i + 1] / 100 + sz)], 3 * i);
      }
      const dm = compactMesh(dWeb, d.uvs, Array.from(d.indices), center);
      const dtex = await textureJpeg(cfg.bestand.texture, zc.detail.textureSize, zc.detail.quality ?? 72);
      const det = await optimizeToGlb(
        meshDocument({ name: `${zc.id}-bestand-detail`, positions: dm.positions, uvs: dm.uvs, indices: dm.indices, color: [1, 1, 1, 1], unlit: true, texture: dtex }),
        { targetTriangles: zc.detail.triangles, lockBorder: true },
      );
      const dfile = `models/${zc.id}-bestand-detail.glb`;
      write(dfile, det.glb);
      variant.detail = { file: dfile, source: src(zc.detail.obj, det.triangles, zc.detail.textureSize) };
      report.zones[zc.id].detail = { triangles: det.triangles, trianglesInZone: d.indices.length / 3, MB: r2(mb(det.glb.length)) };
      log(`Zone ${zc.id}: Detail ${d.indices.length / 3} → ${det.triangles} Dreiecke, Textur ${zc.detail.textureSize} px, ${mb(det.glb.length).toFixed(2)} MB`);
    }

    // 4c. Fremdmodell (z. B. KIRI): einpassen, zuschneiden, als Detail oder als Bestand der Zone
    if (zc.kiri) {
      const k = zc.kiri;
      const use = k.use ?? 'detail';
      if (!['detail', 'bestand'].includes(use)) throw new Error(`Zone ${zc.id}: kiri.use ist detail oder bestand`);
      if (!zc.polygon) throw new Error(`Zone ${zc.id}: Fremdmodell nur mit Grundriss-Polygon`);
      if (use === 'detail' && zc.detail) throw new Error(`Zone ${zc.id}: entweder detail oder kiri mit use "detail"`);
      const placed = placements.get(zc.id);
      log(`Zone ${zc.id}: lese Fremdmodell ${basename(k.file)}`);
      const doc = await readModel(k.file);
      bakeTransforms(doc, similarityMatrix(placed.fit));
      const clip = await clipToFootprint(doc, footprint, center);
      makeUnlit(doc);
      const size = k.textureSize ?? 4096;
      await shrinkTextures(doc, size, k.quality ?? 80);
      const res = await optimizeToGlb(doc, { targetTriangles: k.triangles ?? 250000 });
      const kfile = `models/${zc.id}-${use === 'detail' ? 'detail' : 'bestand'}-kiri.glb`;
      write(kfile, res.glb);
      const ksrc = src(k.file, res.triangles, size);
      if (use === 'detail') variant.detail = { file: kfile, source: ksrc };
      else Object.assign(variant, { file: kfile, source: ksrc });
      report.zones[zc.id].kiri = {
        use, file: basename(k.file), trianglesIn: clip.trianglesIn, trianglesInZone: clip.trianglesKept, triangles: res.triangles,
        MB: r2(mb(res.glb.length)), scale: placed.scale, yawDeg: r2(placed.yawDeg), tiltDeg: r2(placed.tiltDeg),
        passRms: r2(placed.passRms), check: placed.check.map((c) => ({ id: c.id, error: r2(c.error), dy: r2(c.dy) })),
      };
      log(`Zone ${zc.id}: Fremdmodell ${clip.trianglesKept} von ${clip.trianglesIn} Dreiecken im Grundriss → ${res.triangles}, ${mb(res.glb.length).toFixed(2)} MB (${use})`);
    }

    // Technischer Blickpunkt in der Zonenmitte, 1,5 m über dem Gelände (relativ zum ±0 der Zone)
    const placeY = r2(groundWeb(center[0], center[1]) - base + 1.5);
    if (placeY < eg.elevation || placeY > eg.elevation + eg.height) throw new Error(`Zone ${zc.id}: Blickpunkt liegt nicht im EG`);
    const pid = `${zc.id}-blick`;
    zones.push({ id: zc.id, label: zc.label, ...(zc.short ? { short: zc.short } : {}), base, footprint, variants: { bestand: variant } });
    places.push({ id: pid, zoneId: zc.id, label: 'Blickpunkt (technisch)', level: 'EG', position: [0, placeY, 0] });
    routeSteps.push({ id: `${pid}-1`, placeId: pid, label: 'Blickpunkt (technisch)', focus: [0, 0, 0] });
  }

  // 5. Budgets: erster Download (Gelände + leichte Zonen + Code), je Detailfassung
  const initial = mb(sizes['models/terrain.glb'] + zones.reduce((s, z) => s + sizes[z.variants.bestand.file], 0)) + CODE_MB;
  const details = zones.filter((z) => z.variants.bestand.detail).map((z) => [z.id, mb(sizes[z.variants.bestand.detail.file])]);
  report.budget = { initialMB: r2(initial), limitMB: cfg.budget.initialMB, zoneLimitMB: cfg.budget.zoneMB, details: Object.fromEntries(details.map(([k, v]) => [k, r2(v)])), codeMB: CODE_MB };
  log(`Erster Download: ${initial.toFixed(2)} MB (Grenze ${cfg.budget.initialMB} MB)`);
  for (const [id, v] of details) log(`Nachladen ${id}: ${v.toFixed(2)} MB (Grenze ${cfg.budget.zoneMB} MB)`);

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
    report.alignment.push({ streifen: name, punkte: d.length, modalwert: r2(modeOf(d, 0.25)), median: r2(quantile(d, 0.5)), anteilBis1m: r2(d.filter((v) => Math.abs(v) <= 1).length / d.length) });
  });
  for (const a of report.alignment) log(`Höhenabgleich ${a.streifen}: häufigste Δ ${a.modalwert} m, ${Math.round(a.anteilBis1m * 100)} % innerhalb ±1 m`);

  // 7. twin.json
  const twin = {
    schema: 2,
    title: cfg.title,
    placeholder: false,
    origin: o,
    terrain: { file: 'models/terrain.glb', source: src(cfg.terrain.file, terrain.triangles) },
    levels: cfg.levels,
    zones,
    places,
    routeSteps,
  };
  writeFileSync(join(out, 'twin.json'), JSON.stringify(twin, null, 2) + '\n');
  report.files = sizes;
  writeFileSync(join(out, 'import-report.json'), JSON.stringify(report, null, 2) + '\n');
  log(`Paket geschrieben: ${relative(ROOT, out)}`);
  const over = initial > cfg.budget.initialMB || details.some(([, v]) => v > cfg.budget.zoneMB);
  if (over) {
    console.error('import: Budget überschritten');
    process.exit(2);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error('import:', e.message);
    process.exit(1);
  });
}
