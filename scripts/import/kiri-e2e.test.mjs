// Gesamtlauf des Imports mit einem eingepassten Fremdmodell – alles erfunden, Ausgabe unter data/_test-*.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import { writeArrayBuffer } from 'geotiff';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateTwin } from '../../src/model/validate';
import { passPointsFromConfig } from './run.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const tmp = mkdtempSync(join(tmpdir(), 'kiri-e2e-'));
const outRel = `data/_test-kiri-${process.pid}`;
const out = join(ROOT, outRel);
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
  rmSync(out, { recursive: true, force: true });
});

async function gradientPng(n) {
  const px = Buffer.alloc(n * n * 3);
  for (let i = 0; i < n * n; i++) px.set([(i * 7) % 256, (i * 3) % 256, 90], 3 * i);
  return sharp(px, { raw: { width: n, height: n, channels: 3 } }).png().toBuffer();
}

// Erfundene Welt: Gelände 100 m hoch, Bestand eine Fläche 100 × 100 m auf 100 m (lokale cm)
async function world() {
  const dem = await writeArrayBuffer(new Array(50 * 50).fill(100), {
    width: 50, height: 50, ModelPixelScale: [4, 4, 0], ModelTiepoint: [0, 0, 0, 499900, 5000200, 0],
    GTModelTypeGeoKey: 1, GTRasterTypeGeoKey: 1, ProjectedCSTypeGeoKey: 32633,
  });
  writeFileSync(join(tmp, 'dem.tif'), Buffer.from(dem));
  const lines = [];
  for (let j = 0; j <= 10; j++) for (let i = 0; i <= 10; i++) lines.push(`v ${i * 1000} ${j * 1000} 10000`, `vt ${i / 10} ${j / 10}`);
  for (let j = 0; j < 10; j++) {
    for (let i = 0; i < 10; i++) {
      const a = j * 11 + i + 1;
      lines.push(`f ${a}/${a} ${a + 1}/${a + 1} ${a + 12}/${a + 12} ${a + 11}/${a + 11}`);
    }
  }
  writeFileSync(join(tmp, 'bestand.obj'), lines.join('\n'));
  writeFileSync(join(tmp, 'bestand.png'), await gradientPng(64));

  // „KIRI-Modell“: Quadrat a (x 5…25, z 0…20 nach Knoten ×2 +5) und weit entferntes Quadrat b
  const doc = new Document();
  const buf = doc.createBuffer();
  const tex = doc.createTexture('t').setImage(new Uint8Array(await gradientPng(128))).setMimeType('image/png');
  const mat = doc.createMaterial('m').setBaseColorTexture(tex);
  const quad = (x0) =>
    doc.createMesh().addPrimitive(
      doc.createPrimitive()
        .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setBuffer(buf).setArray(new Float32Array([x0, 0, 0, x0 + 10, 0, 0, x0 + 10, 0, 10, x0, 0, 10])))
        .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setBuffer(buf).setArray(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1])))
        .setIndices(doc.createAccessor().setType('SCALAR').setBuffer(buf).setArray(new Uint32Array([0, 2, 1, 0, 3, 2])))
        .setMaterial(mat),
    );
  const root = doc.createNode('root').setScale([2, 2, 2]).setTranslation([5, 0, 0]);
  root.addChild(doc.createNode('a').setMesh(quad(0)));
  root.addChild(doc.createNode('b').setMesh(quad(100)));
  doc.createScene().addChild(root);
  await new NodeIO().write(join(tmp, 'kiri.glb'), doc);
}

// Wahre Lage des Fremdmodells: um (−15, 1, −10) verschoben, sonst unverändert
const T = [-15, 1, -10];
const pt = (id, src) => ({ id, src, web: src.map((v, k) => v + T[k]) });
function config(checkOffset = 0) {
  return {
    out: outRel,
    title: 'Testwelt',
    epsg: 32633,
    sourceOrigin: { e: 499950, n: 5000050 },
    webOrigin: { epsg: 32633, e: 500000, n: 5000100, h: 100 },
    terrain: { file: join(tmp, 'dem.tif'), cell: 4, margin: 20, sink: 2.5, dilate: 0 },
    bestand: { obj: join(tmp, 'bestand.obj'), texture: join(tmp, 'bestand.png'), triangles: 1000, textureSize: 64 },
    levels: [
      { id: 'UG', label: 'UG', elevation: -4, height: 4 },
      { id: 'EG', label: 'EG', elevation: 0, height: 4.5 },
      { id: 'OG1', label: 'OG1', elevation: 4.5, height: 4 },
    ],
    zones: [
      {
        id: 'kern', label: 'Kern', polygon: [[-20, -20], [20, -20], [20, 20], [-20, 20]],
        kiri: {
          file: join(tmp, 'kiri.glb'), triangles: 1000, textureSize: 64,
          passpoints: [pt('P1', [5, 0, 0]), pt('P2', [25, 0, 0]), pt('P3', [5, 0, 20]), pt('P4', [25, 6, 20])],
          // Prüfpunkt als UTM: Web (0, 1, 0) → E 500000, N 5000100, H 101
          checkpoints: [{ id: 'C1', src: [15, 0, 10], utm: [500000 + checkOffset, 5000100, 101] }],
        },
      },
      { id: 'umgebung', label: 'Umgebung', rest: true },
    ],
    budget: { initialMB: 5, zoneMB: 5 },
  };
}

function runImport(cfg) {
  const file = join(tmp, `cfg-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, JSON.stringify(cfg));
  try {
    return { code: 0, out: execFileSync(process.execPath, ['scripts/import/run.mjs', file], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' }) };
  } catch (e) {
    return { code: e.status, out: `${e.stdout}${e.stderr}` };
  }
}

describe('Import mit eingepasstem Fremdmodell', () => {
  beforeAll(world, 60000);

  it('bricht bei schlechtem Prüfpunkt ab, bevor etwas geschrieben wird', () => {
    const r = runImport(config(5));
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/über der Grenze von 2 m/);
    expect(existsSync(out)).toBe(false);
  }, 60000);

  it('schreibt ein gültiges Paket mit dem Fremdmodell als Detail der Zone', () => {
    const r = runImport(config(0));
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/Prüfpunkt C1: 0\.00 m/);
    const twin = JSON.parse(readFileSync(join(out, 'twin.json'), 'utf8'));
    const v = validateTwin(twin);
    if (!v.ok) throw new Error(v.errors.join('\n'));
    const kern = twin.zones.find((z) => z.id === 'kern');
    expect(kern.variants.bestand.detail.file).toBe('models/kern-detail-kiri.glb');
    expect(kern.variants.bestand.detail.source.file).toBe('kiri.glb');
    expect(existsSync(join(out, 'models/kern-detail-kiri.glb'))).toBe(true);
    const report = JSON.parse(readFileSync(join(out, 'import-report.json'), 'utf8'));
    expect(report.zones.kern.kiri).toMatchObject({ use: 'detail', trianglesIn: 4, trianglesInZone: 2, scale: expect.closeTo(1, 6) });
  }, 60000);

  it('rechnet Blender-Koordinaten (z oben) in glTF um', () => {
    const [p] = passPointsFromConfig(config().webOrigin && config(), [{ src: [1, 2, 3], web: [0, 0, 0] }], 'blender');
    expect(p.src).toEqual([1, 3, -2]);
    expect(() => passPointsFromConfig(config(), [], 'c4d')).toThrow(/srcFrame/);
  });
});
