// Gelände aus einem Höhenraster (DGM): Gitter, Abdeckung durch ein anderes Mesh, Absenken.
// Alle Koordinaten hier in UTM-Metern (E, N, H).

/**
 * @typedef {{ data: Float32Array | number[], width: number, height: number, left: number, top: number, res: number }} Raster
 * left/top = UTM-Kante der Rasterzellen (nicht Zellmitte), res = Zellgröße in m
 */

/** Höhe an (E, N), bilinear zwischen Zellmitten, am Rand geklemmt. */
export function sampleRaster(r, e, n) {
  const fx = Math.min(Math.max((e - r.left) / r.res - 0.5, 0), r.width - 1);
  const fy = Math.min(Math.max((r.top - n) / r.res - 0.5, 0), r.height - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, r.width - 1);
  const y1 = Math.min(y0 + 1, r.height - 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const at = (x, y) => r.data[y * r.width + x];
  const top = at(x0, y0) * (1 - tx) + at(x1, y0) * tx;
  const bottom = at(x0, y1) * (1 - tx) + at(x1, y1) * tx;
  return top * (1 - ty) + bottom * ty;
}

/** Ausschnitt um eine Bounding-Box mit Rand, an das Gitter gerastet und auf das Raster begrenzt. */
export function terrainExtent(r, box, margin, cell) {
  const snapDown = (v) => Math.floor(v / cell) * cell;
  const snapUp = (v) => Math.ceil(v / cell) * cell;
  const minE = r.left + r.res / 2;
  const maxE = r.left + (r.width - 0.5) * r.res;
  const minN = r.top - (r.height - 0.5) * r.res;
  const maxN = r.top - r.res / 2;
  const e0 = Math.max(snapUp(minE), snapDown(box.e0 - margin));
  const e1 = Math.min(snapDown(maxE), snapUp(box.e1 + margin));
  const n0 = Math.max(snapUp(minN), snapDown(box.n0 - margin));
  const n1 = Math.min(snapDown(maxN), snapUp(box.n1 + margin));
  if (e1 <= e0 || n1 <= n0) throw new Error('Gelände: Ausschnitt liegt außerhalb des Rasters');
  return { e0, e1, n0, n1, cell };
}

/** Regelmäßiges Gitter: Vertex (i, j) liegt bei (e0 + i·cell, n0 + j·cell). */
export function terrainGrid(r, ext) {
  const cols = Math.round((ext.e1 - ext.e0) / ext.cell) + 1;
  const rows = Math.round((ext.n1 - ext.n0) / ext.cell) + 1;
  const utm = new Float64Array(cols * rows * 3);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const e = ext.e0 + i * ext.cell;
      const n = ext.n0 + j * ext.cell;
      const k = (j * cols + i) * 3;
      utm[k] = e;
      utm[k + 1] = n;
      utm[k + 2] = sampleRaster(r, e, n);
    }
  }
  return { cols, rows, utm, ext };
}

/** Zwei Dreiecke je Gitterzelle, gegen den Uhrzeigersinn von oben gesehen (Web: y oben, Nord = −z). */
export function gridIndices(cols, rows) {
  const idx = new Uint32Array((cols - 1) * (rows - 1) * 6);
  let k = 0;
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      // a(SW) b(SO) c(NW) d(NO); in Web-Koordinaten zeigt Nord nach −z
      idx.set([a, b, d, a, d, c], k);
      k += 6;
    }
  }
  return idx;
}

/**
 * Markiert Gitterpunkte, die unter einem anderen Mesh liegen (2D-Projektion), plus `dilate` Ringe.
 * @param {{ cols: number, rows: number, ext: { e0: number, n0: number, cell: number } }} grid
 * @param {ArrayLike<number>} en E, N je Vertex (2 Werte) des anderen Meshes
 * @param {ArrayLike<number>} indices Dreiecke des anderen Meshes
 */
export function coverageMask(grid, en, indices, dilate = 1) {
  const { cols, rows, ext } = grid;
  const mask = new Uint8Array(cols * rows);
  const gi = (e) => (e - ext.e0) / ext.cell;
  const gj = (n) => (n - ext.n0) / ext.cell;
  for (let t = 0; t < indices.length; t += 3) {
    const ax = gi(en[2 * indices[t]]), ay = gj(en[2 * indices[t] + 1]);
    const bx = gi(en[2 * indices[t + 1]]), by = gj(en[2 * indices[t + 1] + 1]);
    const cx = gi(en[2 * indices[t + 2]]), cy = gj(en[2 * indices[t + 2] + 1]);
    const i0 = Math.max(0, Math.ceil(Math.min(ax, bx, cx)));
    const i1 = Math.min(cols - 1, Math.floor(Math.max(ax, bx, cx)));
    const j0 = Math.max(0, Math.ceil(Math.min(ay, by, cy)));
    const j1 = Math.min(rows - 1, Math.floor(Math.max(ay, by, cy)));
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (area === 0) continue;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const w0 = ((bx - i) * (cy - j) - (cx - i) * (by - j)) / area;
        const w1 = ((cx - i) * (ay - j) - (ax - i) * (cy - j)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 >= -1e-9 && w1 >= -1e-9 && w2 >= -1e-9) mask[j * cols + i] = 1;
      }
    }
  }
  for (let r = 0; r < dilate; r++) {
    const prev = mask.slice();
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        if (prev[j * cols + i]) continue;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = i + di, jj = j + dj;
          if (ii >= 0 && ii < cols && jj >= 0 && jj < rows && prev[jj * cols + ii]) {
            mask[j * cols + i] = 1;
            break;
          }
        }
      }
    }
  }
  return mask;
}

/** Senkt markierte Gitterpunkte um `sink` m ab, damit das Gelände nicht durch das Bestandsmesh sticht. */
export function sinkCovered(grid, mask, sink) {
  for (let k = 0; k < mask.length; k++) if (mask[k]) grid.utm[k * 3 + 2] -= sink;
}
