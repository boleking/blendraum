// Tests für den Import – nur mit erfundenen Daten (das Repo ist öffentlich).
import { describe, expect, it } from 'vitest';
import { meshDocument, optimizeToGlb, smoothNormals } from './glb.mjs';
import { parseObj } from './obj.mjs';
import { modeOf, quantile } from './run.mjs';
import { coverageMask, gridIndices, sampleRaster, sinkCovered, terrainExtent, terrainGrid } from './terrain.mjs';

/** Kleines Raster: 4 × 3 Zellen à 2 m, Höhe = 10 + Spalte (Ost-Gefälle), linke Kante E 1000, obere Kante N 2006 */
const raster = {
  width: 4,
  height: 3,
  left: 1000,
  top: 2006,
  res: 2,
  data: Float32Array.from({ length: 12 }, (_, k) => 10 + (k % 4)),
};

describe('OBJ', () => {
  const text = [
    'v 0 0 0', 'v 100 0 0', 'v 100 100 0', 'v 0 100 50',
    'vt 0 0', 'vt 1 0', 'vt 1 1', 'vt 0 1',
    'vn 0 0 1',
    'f 1/1/1 2/2/1 3/3/1 4/4/1',
    'f -4/1 -2/3 -1/4',
  ].join('\n');

  it('zerlegt Vielecke in Dreiecke und teilt gleiche Ecken', () => {
    const m = parseObj(text);
    expect(m.sourceVertices).toBe(4);
    expect(m.sourceFaces).toBe(2);
    expect(m.indices.length).toBe(9); // Viereck → 2, Dreieck → 1
    expect(m.positions.length / 3).toBe(4); // Ecke 1/1, 3/3, 4/4 kommen doppelt vor
  });

  it('dreht v der UVs in die glTF-Richtung', () => {
    const m = parseObj(text);
    expect(Array.from(m.uvs.slice(0, 8))).toEqual([0, 1, 1, 1, 1, 0, 0, 0]);
  });

  it('löst negative Indizes auf', () => {
    const m = parseObj(text);
    expect(Array.from(m.indices.slice(6))).toEqual([0, 2, 3]);
  });

  it('meldet Indizes außerhalb', () => expect(() => parseObj('v 0 0 0\nf 1 2 3')).toThrow(/außerhalb/));
});

describe('Gelände', () => {
  it('liest das Raster bilinear zwischen Zellmitten', () => {
    expect(sampleRaster(raster, 1001, 2005)).toBeCloseTo(10); // Mitte der ersten Zelle
    expect(sampleRaster(raster, 1002, 2005)).toBeCloseTo(10.5); // halb zur nächsten
    expect(sampleRaster(raster, 990, 2005)).toBeCloseTo(10); // geklemmt
  });

  it('rastet den Ausschnitt ein und begrenzt ihn auf das Raster', () => {
    const ext = terrainExtent(raster, { e0: 1003, e1: 1005, n0: 2001, n1: 2003 }, 100, 1);
    expect(ext).toEqual({ e0: 1001, e1: 1007, n0: 2001, n1: 2005, cell: 1 });
    expect(() => terrainExtent(raster, { e0: 5000, e1: 5001, n0: 0, n1: 1 }, 0, 1)).toThrow(/außerhalb/);
  });

  it('baut ein Gitter mit Höhen aus dem Raster und Dreiecken nach oben', () => {
    const grid = terrainGrid(raster, { e0: 1001, e1: 1005, n0: 2001, n1: 2005, cell: 2 });
    expect([grid.cols, grid.rows]).toEqual([3, 3]);
    expect(grid.utm[2]).toBeCloseTo(10);
    expect(grid.utm[3 * 2 + 2]).toBeCloseTo(12);
    const idx = gridIndices(grid.cols, grid.rows);
    expect(idx.length).toBe(2 * 2 * 6);
    // In Web-Koordinaten (x = E, y = H, z = −N) zeigt jede Dreiecksnormale nach oben
    const web = (k) => [grid.utm[3 * k], grid.utm[3 * k + 2], -grid.utm[3 * k + 1]];
    for (let t = 0; t < idx.length; t += 3) {
      const [a, b, c] = [web(idx[t]), web(idx[t + 1]), web(idx[t + 2])];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      expect(u[2] * v[0] - u[0] * v[2]).toBeGreaterThan(0);
    }
  });

  it('markiert Gitterpunkte unter einem Mesh, erweitert um einen Ring und senkt sie ab', () => {
    const grid = terrainGrid(raster, { e0: 1001, e1: 1007, n0: 2001, n1: 2005, cell: 1 }); // 7 × 5
    const en = [1002.5, 2002.5, 1003.5, 2002.5, 1002.5, 2003.5]; // kleines Dreieck
    const only = coverageMask(grid, en, [0, 1, 2], 0);
    expect(only.reduce((s, v) => s + v, 0)).toBe(1); // nur (1003, 2003)
    const ring = coverageMask(grid, en, [0, 1, 2], 1);
    expect(ring.reduce((s, v) => s + v, 0)).toBe(5);
    const k = 2 * grid.cols + 2;
    const before = grid.utm[3 * k + 2];
    sinkCovered(grid, ring, 2.5);
    expect(grid.utm[3 * k + 2]).toBeCloseTo(before - 2.5);
  });
});

describe('GLB', () => {
  const quad = () => ({
    positions: Float32Array.from([0, 0, 0, 1, 0, 0, 1, 0, -1, 0, 0, -1]),
    indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
  });

  it('glatte Normalen einer Ebene zeigen nach oben', () => {
    const { positions, indices } = quad();
    const n = smoothNormals(positions, indices);
    for (let k = 0; k < n.length; k += 3) expect([n[k], n[k + 1], n[k + 2]].map((v) => +v.toFixed(6))).toEqual([0, 1, 0]);
  });

  it('schreibt eine komprimierte, indizierte GLB ohne externe URIs', async () => {
    const { positions, indices } = quad();
    const doc = meshDocument({ name: 't', positions, indices, color: [1, 1, 1, 1], normals: true });
    const { glb, triangles } = await optimizeToGlb(doc);
    const buf = Buffer.from(glb);
    expect(buf.toString('ascii', 0, 4)).toBe('glTF');
    const json = JSON.parse(buf.toString('utf8', 20, 20 + buf.readUInt32LE(12)));
    expect(json.extensionsUsed).toContain('EXT_meshopt_compression');
    // Regression: Indizes bleiben erhalten (normals() aus gltf-transform hatte sie aufgelöst)
    expect(json.meshes[0].primitives[0].indices).toBeDefined();
    expect(triangles).toBe(2);
    expect(JSON.stringify(json)).not.toMatch(/"uri"/);
  });

  it('reduziert auf die Zieldreieckszahl', async () => {
    // 20 × 20 Gitter = 722 Dreiecke, flach → stark reduzierbar
    const n = 20;
    const pos = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) pos.push(i, 0, -j);
    const doc = meshDocument({ name: 'g', positions: Float32Array.from(pos), indices: gridIndices(n, n), color: [1, 1, 1, 1] });
    const r = await optimizeToGlb(doc, { targetTriangles: 100 });
    expect(r.trianglesBefore).toBe(722);
    expect(r.triangles).toBeLessThanOrEqual(100);
  });
});

describe('Statistik', () => {
  it('Modalwert und Quantil', () => {
    expect(modeOf([0.1, 0.2, 0.15, 3, 4], 0.25)).toBeCloseTo(0.125);
    expect(quantile([5, 1, 3], 0.5)).toBe(3);
    expect(Number.isNaN(quantile([], 0.5))).toBe(true);
  });
});
