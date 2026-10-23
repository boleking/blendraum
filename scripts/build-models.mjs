// Erzeugt je Zone und Variante eine kleine GLB-Datei aus Boxen.
// Aufruf: node scripts/build-models.mjs <public-ordner> [twin.json]
// Die Dateien landen unter <public-ordner>/<variants.*.file>.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import { MATERIALS, zoneBoxes } from './zone-specs.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// 6 Seiten × 4 Ecken, damit jede Seite eigene Normalen hat (harte Kanten).
const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];

function boxArrays(min, max) {
  const pos = [];
  const nor = [];
  const idx = [];
  for (const f of FACES) {
    const base = pos.length / 3;
    for (const c of f.c) {
      for (let k = 0; k < 3; k++) pos.push(c[k] ? max[k] : min[k]);
      nor.push(...f.n);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { pos: new Float32Array(pos), nor: new Float32Array(nor), idx: new Uint16Array(idx) };
}

/** Baut ein glTF-Dokument für eine Zone/Variante. */
export function buildZoneDocument(zoneId, zoneIndex, variant) {
  const doc = new Document();
  doc.createScene(`${zoneId}-${variant}`);
  const buffer = doc.createBuffer();
  const scene = doc.getRoot().listScenes()[0];
  const mats = new Map();
  const material = (key) => {
    if (!mats.has(key)) {
      const m = MATERIALS[key];
      const mat = doc.createMaterial(key).setBaseColorFactor(m.color).setRoughnessFactor(m.roughness).setMetallicFactor(0);
      if (m.blend) mat.setAlphaMode('BLEND');
      mats.set(key, mat);
    }
    return mats.get(key);
  };

  for (const b of zoneBoxes(zoneIndex, variant)) {
    const { pos, nor, idx } = boxArrays(b.min, b.max);
    const prim = doc
      .createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(nor).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(buffer))
      .setMaterial(material(b.material));
    const mesh = doc.createMesh(b.name).addPrimitive(prim);
    const node = doc.createNode(b.name).setMesh(mesh).setExtras({ level: b.level, material: b.material });
    scene.addChild(node);
  }
  return doc;
}

/** Schreibt alle GLBs laut twin.json und gibt die geschriebenen Pfade zurück. */
export async function buildAll(outDir, twinPath = join(ROOT, 'public/twin.json')) {
  const twin = JSON.parse(readFileSync(twinPath, 'utf8'));
  const io = new NodeIO();
  const written = [];
  for (const [i, zone] of twin.zones.entries()) {
    for (const variant of ['bestand', 'neu']) {
      const file = zone.variants[variant].file;
      const target = join(outDir, file);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, await io.writeBinary(buildZoneDocument(zone.id, i, variant)));
      written.push(target);
    }
  }
  return written;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = resolve(process.argv[2] ?? join(ROOT, 'public'));
  const files = await buildAll(out, process.argv[3] ? resolve(process.argv[3]) : undefined);
  console.log(`${files.length} GLB-Dateien in ${out}`);
}
