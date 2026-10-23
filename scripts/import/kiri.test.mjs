// Tests für das Einpassen fremder Modelle (Passpunkte) und ihre Aufbereitung je Zone.
// Alle Daten erfunden.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { optimizeToGlb, triangleCount } from './glb.mjs';
import { bakeTransforms, clipToFootprint, makeUnlit, mat4Mul, readModel, shrinkTextures } from './kiri-model.mjs';
import { applySimilarity, fitSimilarity, placeReport, similarityMatrix, symmetricEigen } from './place.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'kiri-test-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

// Erfundene „wahre“ Einpassung: Maßstab 0,37, gedreht um alle drei Achsen, verschoben
function rotation(ax, ay, az) {
  const [ca, sa, cb, sb, cc, sc] = [Math.cos(ax), Math.sin(ax), Math.cos(ay), Math.sin(ay), Math.cos(az), Math.sin(az)];
  const X = [[1, 0, 0], [0, ca, -sa], [0, sa, ca]];
  const Y = [[cb, 0, sb], [0, 1, 0], [-sb, 0, cb]];
  const Z = [[cc, -sc, 0], [sc, cc, 0], [0, 0, 1]];
  const mul = (a, b) => a.map((r) => [0, 1, 2].map((j) => r[0] * b[0][j] + r[1] * b[1][j] + r[2] * b[2][j]));
  return mul(Z, mul(Y, X));
}
const TRUE = { scale: 0.37, rotation: rotation(0.3, 1.1, -0.2), translation: [-120.5, 14.2, 38.9] };
const SRC = [[0, 0, 0], [100, 0, 0], [0, 50, 0], [0, 0, 80], [60, 30, 20], [-40, 10, 70]];
const dst = (pts) => pts.map((p) => applySimilarity(TRUE, p));
// Deterministisches Rauschen (±amp)
const noise = (i, k, amp) => amp * Math.sin(12.9898 * (i + 1) + 78.233 * (k + 1));

describe('Einpassen über Passpunkte', () => {
  it('findet eine bekannte Ähnlichkeitstransformation exakt wieder', () => {
    const fit = fitSimilarity(SRC.slice(0, 4), dst(SRC.slice(0, 4)));
    expect(fit.scale).toBeCloseTo(TRUE.scale, 10);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) expect(fit.rotation[i][j]).toBeCloseTo(TRUE.rotation[i][j], 9);
    for (const p of SRC) {
      const [a, b] = [applySimilarity(fit, p), applySimilarity(TRUE, p)];
      for (let k = 0; k < 3; k++) expect(a[k]).toBeCloseTo(b[k], 8);
    }
  });

  it('kommt mit genau drei Punkten aus', () => {
    const r = placeReport(SRC.slice(0, 3).map((p, i) => ({ id: `P${i}`, src: p, dst: dst([p])[0] })));
    expect(r.passRms).toBeLessThan(1e-8);
    expect(r.checkRms).toBeNull();
  });

  it('meldet Restfehler an Passpunkten und unabhängig an Prüfpunkten', () => {
    const pts = SRC.map((p, i) => ({ id: `P${i}`, src: p, dst: dst([p])[0].map((v, k) => v + noise(i, k, 0.5)) }));
    const r = placeReport(pts.slice(0, 4), pts.slice(4));
    expect(r.passRms).toBeGreaterThan(0.01);
    expect(r.passRms).toBeLessThan(1);
    expect(r.check).toHaveLength(2);
    expect(r.checkMax).toBeGreaterThan(0);
    expect(r.checkMax).toBeLessThan(2);
    expect(r.scale).toBeCloseTo(0.37, 1);
  });

  it('spiegelt nie: gespiegelte Zielpunkte passen schlecht statt gespiegelt', () => {
    const mirrored = dst(SRC).map(([x, y, z]) => [-x, y, z]);
    const r = placeReport(SRC.map((p, i) => ({ id: `P${i}`, src: p, dst: mirrored[i] })));
    const R = r.fit.rotation;
    const det =
      R[0][0] * (R[1][1] * R[2][2] - R[1][2] * R[2][1]) -
      R[0][1] * (R[1][0] * R[2][2] - R[1][2] * R[2][0]) +
      R[0][2] * (R[1][0] * R[2][1] - R[1][1] * R[2][0]);
    expect(det).toBeCloseTo(1, 9);
    expect(r.passRms).toBeGreaterThan(1);
  });

  it('lehnt zu wenige, ungleich viele, ungültige und kollineare Punkte ab', () => {
    expect(() => fitSimilarity(SRC.slice(0, 2), dst(SRC.slice(0, 2)))).toThrow(/mindestens drei/);
    expect(() => fitSimilarity(SRC.slice(0, 3), dst(SRC.slice(0, 4)))).toThrow(/ungleich/);
    expect(() => fitSimilarity([[0, 0, 0], [1, 1, NaN], [2, 0, 0]], dst(SRC.slice(0, 3)))).toThrow(/drei Zahlen/);
    const line = [[0, 0, 0], [1, 1, 1], [2, 2, 2], [5, 5, 5]];
    expect(() => fitSimilarity(line, dst(line))).toThrow(/Linie/);
  });

  it('meldet Drehung um die Hochachse und Neigung', () => {
    const upright = { scale: 2, rotation: rotation(0, Math.PI / 6, 0), translation: [0, 0, 0] };
    const r = placeReport(SRC.slice(0, 4).map((p, i) => ({ id: `P${i}`, src: p, dst: applySimilarity(upright, p) })));
    expect(r.yawDeg).toBeCloseTo(30, 6);
    expect(r.tiltDeg).toBeCloseTo(0, 6);
  });

  it('Eigenwerte einer bekannten Matrix', () => {
    const { values } = symmetricEigen([[2, 1], [1, 2]]);
    expect(values.sort()).toEqual([expect.closeTo(1, 12), expect.closeTo(3, 12)]);
  });
});

// Künstliches „KIRI-Modell“: zwei texturierte Quadrate in verschachtelten, skalierten Knoten
async function fakeKiriGlb(file) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  // Verlauf statt Einfarbe: prune() ersetzt einfarbige Texturen bewusst durch eine Farbe
  const px = Buffer.alloc(512 * 512 * 3);
  for (let i = 0; i < 512 * 512; i++) px.set([i % 256, (i >> 9) % 256, 90], 3 * i);
  const png = await sharp(px, { raw: { width: 512, height: 512, channels: 3 } }).png().toBuffer();
  const tex = doc.createTexture('farbe').setImage(new Uint8Array(png)).setMimeType('image/png');
  const mat = doc.createMaterial('m').setBaseColorTexture(tex).setNormalTexture(tex);
  const quad = (name, x0) => {
    const prim = doc
      .createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setBuffer(buffer).setArray(new Float32Array([x0, 0, 0, x0 + 10, 0, 0, x0 + 10, 0, 10, x0, 0, 10])))
      .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setBuffer(buffer).setArray(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1])))
      .setIndices(doc.createAccessor().setType('SCALAR').setBuffer(buffer).setArray(new Uint32Array([0, 2, 1, 0, 3, 2])))
      .setMaterial(mat);
    return doc.createMesh(name).addPrimitive(prim);
  };
  const parent = doc.createNode('kiri-root').setScale([2, 2, 2]).setTranslation([5, 0, 0]);
  parent.addChild(doc.createNode('a').setMesh(quad('a', 0)));
  parent.addChild(doc.createNode('b').setMesh(quad('b', 100)).setTranslation([0, 3, 0]));
  doc.createScene('s').addChild(parent);
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  await io.write(file, doc);
}

const positions = (doc) =>
  doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives().flatMap((p) => Array.from(p.getAttribute('POSITION').getArray())));

describe('Fremdmodell aufbereiten', () => {
  it('backt Knoten-Transformationen und Einpassung in die Vertices', async () => {
    const file = join(tmp, 'kiri.glb');
    await fakeKiriGlb(file);
    const doc = await readModel(file);
    const place = similarityMatrix({ scale: 0.5, rotation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], translation: [-10, 0, 0] });
    bakeTransforms(doc, place);
    const nodes = doc.getRoot().listNodes();
    expect(nodes).toHaveLength(2);
    for (const n of nodes) expect(n.getMatrix()).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    // Quad a, erste Ecke (0,0,0): Knoten ×2 +5 → (5,0,0); Einpassung ×0,5 −10 → (−7,5, 0, 0)
    const p = positions(doc);
    expect(p.slice(0, 3)).toEqual([-7.5, 0, 0]);
    // Quad b, erste Ecke (100,0,0) mit eigenem +3 in y: (100,3,0)×2+5 = (205,6,0) → (92,5, 3, 0)
    expect(p.slice(12, 15)).toEqual([92.5, 3, 0]);
  });

  it('schneidet auf den Grundriss, zentriert und entfernt leere Teile', async () => {
    const file = join(tmp, 'kiri2.glb');
    await fakeKiriGlb(file);
    const doc = await readModel(file);
    bakeTransforms(doc, similarityMatrix({ scale: 1, rotation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], translation: [0, 0, 0] }));
    // Grundriss umfasst nur Quad a (x 5…25, z 0…20)
    const poly = [[0, -1], [30, -1], [30, 25], [0, 25]];
    const r = await clipToFootprint(doc, poly, [15, 12]);
    expect(r).toEqual({ trianglesIn: 4, trianglesKept: 2 });
    expect(doc.getRoot().listMeshes()).toHaveLength(1);
    const p = positions(doc);
    expect(Math.min(...p.filter((_, i) => i % 3 === 0))).toBe(-10);
    expect(Math.max(...p.filter((_, i) => i % 3 === 2))).toBe(8);
  });

  it('bricht ab, wenn nach dem Zuschnitt nichts bleibt', async () => {
    const file = join(tmp, 'kiri3.glb');
    await fakeKiriGlb(file);
    const doc = await readModel(file);
    bakeTransforms(doc, similarityMatrix({ scale: 1, rotation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], translation: [0, 0, 0] }));
    await expect(clipToFootprint(doc, [[1000, 1000], [1001, 1000], [1001, 1001]], [0, 0])).rejects.toThrow(/bleibt nichts/);
  });

  it('ungeleuchtet, Textur verkleinert, optimiert und wieder lesbar', async () => {
    const file = join(tmp, 'kiri4.glb');
    await fakeKiriGlb(file);
    const doc = await readModel(file);
    makeUnlit(doc);
    await shrinkTextures(doc, 256, 75);
    const tex = doc.getRoot().listTextures();
    expect(tex).toHaveLength(1);
    expect(tex[0].getMimeType()).toBe('image/jpeg');
    expect(tex[0].getSize()).toEqual([256, 256]);
    expect(doc.getRoot().listMaterials()[0].getNormalTexture()).toBeNull();
    const { glb, triangles } = await optimizeToGlb(doc, { targetTriangles: 100 });
    expect(triangles).toBe(4);
    const back = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder }).readBinary(glb);
    expect(triangleCount(back)).toBe(4);
  });

  it('liest OBJ mit Textur aus der MTL-Datei und lehnt fremde Formate ab', async () => {
    writeFileSync(join(tmp, 'm.obj'), 'mtllib m.mtl\nv 0 0 0\nv 1 0 0\nv 0 0 1\nvt 0 0\nvt 1 0\nvt 0 1\nf 1/1 2/2 3/3\n');
    writeFileSync(join(tmp, 'm.mtl'), 'newmtl a\nmap_Kd t.png\n');
    writeFileSync(join(tmp, 't.png'), await sharp({ create: { width: 8, height: 8, channels: 3, background: '#888' } }).png().toBuffer());
    const doc = await readModel(join(tmp, 'm.obj'));
    expect(triangleCount(doc)).toBe(1);
    expect(doc.getRoot().listTextures()[0].getMimeType()).toBe('image/png');
    await expect(readModel(join(tmp, 'm.fbx'))).rejects.toThrow(/nur \.glb/);
  });

  it('Matrixprodukt spaltenweise', () => {
    const t = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 4, 5, 1];
    const s = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1];
    expect(mat4Mul(t, s).slice(12, 15)).toEqual([3, 4, 5]);
    expect(mat4Mul(s, t).slice(12, 15)).toEqual([6, 8, 10]);
  });
});

describe('Passpunkte aus der Konfiguration', async () => {
  const { passPointsFromConfig, checkPlacement } = await import('./run.mjs');
  // Erfundener Nullpunkt und Quell-Nullpunkt
  const cfg = {
    webOrigin: { epsg: 32633, e: 500000, n: 5000000, h: 300 },
    sourceOrigin: { e: 499000, n: 4999000 },
    bestand: { offset: { dz: 1.5 } },
  };

  it('rechnet UTM und Bestands-OBJ (cm, mit Versatz) gleich in Web-Meter um', () => {
    const [a, b] = passPointsFromConfig(cfg, [
      { id: 'A', src: [0, 0, 0], utm: [500010, 5000020, 305] },
      { id: 'B', src: [0, 0, 0], bestandObj: [101000, 102000, 30350] },
    ]);
    expect(a.dst).toEqual([10, 5, -20]);
    expect(b.dst.map((v) => +v.toFixed(9))).toEqual([10, 5, -20]);
  });

  it('verlangt genau ein Ziel je Punkt und einen festen Nullpunkt', () => {
    expect(() => passPointsFromConfig(cfg, [{ src: [0, 0, 0], utm: [1, 2, 3], web: [1, 2, 3] }])).toThrow(/genau eines/);
    expect(() => passPointsFromConfig(cfg, [{ src: [0, 0, 0] }])).toThrow(/genau eines/);
    expect(() => passPointsFromConfig({}, [])).toThrow(/webOrigin/);
  });

  const zoneCfg = (checkNoise) => {
    const pts = SRC.map((p, i) => ({ id: `P${i}`, src: p, web: dst([p])[0].map((v, k) => v + (i >= 4 ? checkNoise : 0) * (k === 1)) }));
    return { passpoints: pts.slice(0, 4), checkpoints: pts.slice(4) };
  };

  it('nimmt eine gute Einpassung an', () => {
    const r = checkPlacement(cfg, 'z', zoneCfg(0.5));
    expect(r.checkMax).toBeCloseTo(0.5, 6);
  });

  it('bricht ohne Prüfpunkt und über der Fehlergrenze ab', () => {
    expect(() => checkPlacement(cfg, 'z', { ...zoneCfg(0), checkpoints: [] })).toThrow(/Prüfpunkt/);
    expect(() => checkPlacement(cfg, 'z', zoneCfg(3))).toThrow(/über der Grenze von 2 m/);
    expect(() => checkPlacement(cfg, 'z', { ...zoneCfg(3), maxError: 5 })).not.toThrow();
  });
});
