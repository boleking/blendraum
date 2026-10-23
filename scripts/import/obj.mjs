// Minimaler OBJ-Leser für Photogrammetrie-Meshes: Positionen, UVs, Dreiecke.
// Jede eindeutige Kombination aus Position und UV wird ein eigener Vertex (Textur-Nähte bleiben erhalten).
// Vertex-Farben und Normalen werden ignoriert; Normalen rechnet der Export neu.

/**
 * @param {string} text Inhalt der OBJ-Datei
 * @param {{ keepFace?: (cx: number, cy: number, cz: number) => boolean }} [opts]
 *   keepFace: Filter nach dem Mittelpunkt der ersten drei Ecken (Quelleinheiten); spart Speicher bei großen Dateien
 * @returns {{ positions: Float64Array, uvs: Float32Array | null, indices: Uint32Array, sourceVertices: number, sourceFaces: number }}
 *   positions in Quelleinheiten (x, y, z je Vertex), uvs mit glTF-Konvention (v nach unten)
 */
export function parseObj(text, opts = {}) {
  const v = [];
  const vt = [];
  const pos = [];
  const uv = [];
  const idx = [];
  const corners = new Map();
  let faces = 0;

  const corner = (token) => {
    const [a, b] = token.split('/');
    let vi = parseInt(a, 10);
    let ti = b ? parseInt(b, 10) : NaN;
    if (vi < 0) vi = v.length / 3 + vi + 1;
    if (ti < 0) ti = vt.length / 2 + ti + 1;
    const key = Number.isNaN(ti) ? `${vi}` : `${vi}/${ti}`;
    let id = corners.get(key);
    if (id === undefined) {
      if (!(vi >= 1 && vi <= v.length / 3)) throw new Error(`OBJ: Vertex-Index ${a} außerhalb`);
      id = pos.length / 3;
      pos.push(v[3 * vi - 3], v[3 * vi - 2], v[3 * vi - 1]);
      if (!Number.isNaN(ti)) {
        if (!(ti >= 1 && ti <= vt.length / 2)) throw new Error(`OBJ: UV-Index ${b} außerhalb`);
        uv.push(vt[2 * ti - 2], 1 - vt[2 * ti - 1]);
      } else uv.push(0, 0);
      corners.set(key, id);
    }
    return id;
  };

  let start = 0;
  let hasUv = false;
  while (start < text.length) {
    let end = text.indexOf('\n', start);
    if (end === -1) end = text.length;
    const line = text.slice(start, end).trim();
    start = end + 1;
    if (line.startsWith('v ')) {
      const p = line.split(/\s+/);
      v.push(+p[1], +p[2], +p[3]);
    } else if (line.startsWith('vt ')) {
      const p = line.split(/\s+/);
      vt.push(+p[1], +p[2]);
      hasUv = true;
    } else if (line.startsWith('f ')) {
      const p = line.split(/\s+/).slice(1);
      faces++;
      if (opts.keepFace) {
        const vi = p.slice(0, 3).map((t) => {
          const i = parseInt(t, 10);
          return i < 0 ? v.length / 3 + i : i - 1;
        });
        const c = [0, 1, 2].map((k) => (v[3 * vi[0] + k] + v[3 * vi[1] + k] + v[3 * vi[2] + k]) / 3);
        if (!opts.keepFace(c[0], c[1], c[2])) continue;
      }
      const ids = p.map(corner);
      for (let i = 1; i + 1 < ids.length; i++) idx.push(ids[0], ids[i], ids[i + 1]);
    }
  }
  return {
    positions: Float64Array.from(pos),
    uvs: hasUv ? Float32Array.from(uv) : null,
    indices: Uint32Array.from(idx),
    sourceVertices: v.length / 3,
    sourceFaces: faces,
  };
}
