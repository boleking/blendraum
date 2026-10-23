// Einzelmodell als eigenes Paket (ohne Georeferenz) – erfundenes Modell, Ausgabe unter data/_test-*.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateTwin } from '../../src/model/validate';
import { main, uprightMatrix } from './standalone.mjs';
import { mat4Mul } from './kiri-model.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const tmp = mkdtempSync(join(tmpdir(), 'standalone-'));
const outRel = `data/_test-standalone-${process.pid}`;
const out = join(ROOT, outRel);
const model = join(tmp, 'scan.glb');
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
  rmSync(out, { recursive: true, force: true });
  rmSync(`${out}-b`, { recursive: true, force: true });
});

// Erfundener „Scan“: Gitter 40 × 30 m mit Höhenwelle, texturiert, unter einem verschobenen Knoten
beforeAll(async () => {
  const doc = new Document();
  const buf = doc.createBuffer();
  const n = 21;
  const pos = [];
  const uv = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      pos.push((i / (n - 1)) * 40, Math.sin(i) * 2 + 3, (j / (n - 1)) * 30);
      uv.push(i / (n - 1), j / (n - 1));
    }
  }
  const idx = [];
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i;
    idx.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
  }
  const px = Buffer.alloc(256 * 256 * 3);
  for (let i = 0; i < 256 * 256; i++) px.set([i % 256, (i >> 8) % 256, 120], 3 * i);
  const png = await sharp(px, { raw: { width: 256, height: 256, channels: 3 } }).png().toBuffer();
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setBuffer(buf).setArray(new Float32Array(pos)))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setBuffer(buf).setArray(new Float32Array(uv)))
    .setIndices(doc.createAccessor().setType('SCALAR').setBuffer(buf).setArray(new Uint32Array(idx)))
    .setMaterial(doc.createMaterial('m').setBaseColorTexture(doc.createTexture('t').setImage(new Uint8Array(png)).setMimeType('image/png')));
  doc.createScene().addChild(doc.createNode('n').setTranslation([100, 0, -50]).setMesh(doc.createMesh().addPrimitive(prim)));
  await new NodeIO().write(model, doc);
}, 60000);

const args = (outDir, extra = []) => [model, '--out', outDir, '--title', 'Testscan', '--zone', 'Große Halle', '--short', 'Halle',
  '--triangles', '200', '--texture', '64', '--detail-triangles', '600', '--detail-texture', '128', ...extra];

describe('Einzelmodell als Paket', () => {
  it('schreibt ein gültiges, nicht georeferenziertes Paket mit leichter und Detailfassung', async () => {
    expect(await main(args(outRel))).toBe(0);
    const twin = JSON.parse(readFileSync(join(out, 'twin.json'), 'utf8'));
    const v = validateTwin(twin);
    if (!v.ok) throw new Error(v.errors.join('\n'));
    expect(twin.georeferenced).toBe(false);
    expect(twin.origin).toBeNull();
    const z = twin.zones[0];
    expect(z.id).toBe('gro-e-halle');
    expect(z.short).toBe('Halle');
    // Grundriss zentriert, 40 × 30 m plus 0,5 m Rand
    expect(z.footprint).toEqual([[-20.5, 15.5], [20.5, 15.5], [20.5, -15.5], [-20.5, -15.5]]);
    expect(z.base).toBeGreaterThan(0.5);
    expect(z.base).toBeLessThan(2);
    for (const f of [z.variants.bestand.file, z.variants.bestand.detail.file]) expect(existsSync(join(out, f))).toBe(true);
    expect(z.variants.bestand.source.triangles).toBeLessThanOrEqual(z.variants.bestand.detail.source.triangles);
    const report = JSON.parse(readFileSync(join(out, 'import-report.json'), 'utf8'));
    expect(report.size).toMatchObject({ width: 40, depth: 30 });
  }, 60000);

  it('überschreibt nie ein vorhandenes Paket', async () => {
    const before = readFileSync(join(out, 'twin.json'), 'utf8');
    await expect(main(args(outRel))).rejects.toThrow(/existiert schon/);
    expect(readFileSync(join(out, 'twin.json'), 'utf8')).toBe(before);
  });

  it('meldet ein überschrittenes Budget mit Code 2', async () => {
    expect(await main(args(`${outRel}-b`, ['--budget', '0.0001']))).toBe(2);
  }, 60000);

  it('lehnt fehlende Angaben und Ziele außerhalb von data/ ab', async () => {
    await expect(main([model, '--out', outRel])).rejects.toThrow(/Aufruf/);
    await expect(main(args('dist/x'))).rejects.toThrow(/unter data/);
    await expect(main(args(`${outRel}-c`, ['--short', 'viel zu langer Kurzname']))).rejects.toThrow(/14 Zeichen/);
  });

  it('dreht ein Modell mit z oben auf y oben und skaliert', () => {
    const m = uprightMatrix(2, 'z');
    const p = mat4Mul(m, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 5, 1]).slice(12, 15);
    expect(p).toEqual([0, 10, 0]); // (0,0,5) mit z oben → 10 nach oben
    expect(() => uprightMatrix(1, 'x')).toThrow(/y oder z/);
    expect(() => uprightMatrix(0)).toThrow(/> 0/);
  });
});
