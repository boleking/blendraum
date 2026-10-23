// Bestand in Zonen aufteilen: jedes Dreieck gehört der Zone, in deren Grundriss sein Mittelpunkt liegt.
// Koordinaten hier: Web-Meter (x, y, z), Grundrisse als [x, z].

/** Punkt-in-Polygon (Strahlverfahren) – gleiche Regel wie insidePolygon() in src/model/validate.ts */
export function inside(x, z, poly) {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) r = !r;
  }
  return r;
}

/**
 * Teilt Dreiecke auf Zonen auf. Zonen mit `polygon` zuerst in Reihenfolge; die Zone mit `rest: true`
 * bekommt alles Übrige (höchstens eine).
 * @param {ArrayLike<number>} pos Web-Positionen (x, y, z je Vertex)
 * @param {ArrayLike<number>} indices
 * @param {{ id: string, polygon?: [number, number][], rest?: boolean }[]} zones
 * @returns {Map<string, number[]>} Zone → Dreiecks-Indizes (Vertex-Indizes, je 3)
 */
export function splitByZones(pos, indices, zones) {
  const rests = zones.filter((z) => z.rest);
  if (rests.length > 1) throw new Error('höchstens eine Rest-Zone');
  const out = new Map(zones.map((z) => [z.id, []]));
  const polys = zones.filter((z) => z.polygon);
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]];
    const x = (pos[3 * a] + pos[3 * b] + pos[3 * c]) / 3;
    const z = (pos[3 * a + 2] + pos[3 * b + 2] + pos[3 * c + 2]) / 3;
    const hit = polys.find((p) => inside(x, z, p.polygon)) ?? rests[0];
    if (hit) out.get(hit.id).push(a, b, c);
  }
  return out;
}

/**
 * Nimmt nur die benutzten Vertices und verschiebt sie relativ zu einer Zonenmitte (x, z).
 * @returns {{ positions: Float32Array, uvs: Float32Array | null, indices: Uint32Array }}
 */
export function compactMesh(pos, uvs, tri, [cx, cz]) {
  const map = new Map();
  const p = [];
  const u = [];
  const idx = new Uint32Array(tri.length);
  tri.forEach((v, k) => {
    let n = map.get(v);
    if (n === undefined) {
      n = p.length / 3;
      map.set(v, n);
      p.push(pos[3 * v] - cx, pos[3 * v + 1], pos[3 * v + 2] - cz);
      if (uvs) u.push(uvs[2 * v], uvs[2 * v + 1]);
    }
    idx[k] = n;
  });
  return { positions: Float32Array.from(p), uvs: uvs ? Float32Array.from(u) : null, indices: idx };
}

/** Bounding-Box (x, z) der benutzten Vertices als Rechteck-Grundriss, gegen den Uhrzeigersinn */
export function boundsFootprint(pos, tri) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const v of tri) {
    x0 = Math.min(x0, pos[3 * v]); x1 = Math.max(x1, pos[3 * v]);
    z0 = Math.min(z0, pos[3 * v + 2]); z1 = Math.max(z1, pos[3 * v + 2]);
  }
  return [[x0, z1], [x1, z1], [x1, z0], [x0, z0]];
}

/** Mitte der Bounding-Box eines Grundrisses – wie footprintBounds() in src/model/validate.ts */
export function footprintCenter(poly) {
  const xs = poly.map((p) => p[0]);
  const zs = poly.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2];
}
