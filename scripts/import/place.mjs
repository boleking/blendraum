// Einpassen eines nicht georeferenzierten Modells (z. B. KIRI-Export) über Passpunkte:
// Ähnlichkeitstransformation (Maßstab, Drehung, Verschiebung, keine Spiegelung) nach Horn (1987),
// geschlossene Lösung über Quaternionen. Koordinaten hier: Web-Meter (x, y, z), y oben.

/** Eigenwerte/-vektoren einer symmetrischen n×n-Matrix (Jacobi). Liefert { values, vectors[spalte] }. */
export function symmetricEigen(a) {
  const n = a.length;
  const m = a.map((r) => [...r]);
  const v = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += m[p][q] ** 2;
    if (off < 1e-30) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(m[p][q]) < 1e-300) continue;
        const theta = (m[q][q] - m[p][p]) / (2 * m[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const mkp = m[k][p];
          const mkq = m[k][q];
          m[k][p] = c * mkp - s * mkq;
          m[k][q] = s * mkp + c * mkq;
        }
        for (let k = 0; k < n; k++) {
          const mpk = m[p][k];
          const mqk = m[q][k];
          m[p][k] = c * mpk - s * mqk;
          m[q][k] = s * mpk + c * mqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  return { values: m.map((r, i) => r[i]), vectors: Array.from({ length: n }, (_, j) => v.map((r) => r[j])) };
}

const mean = (pts) => [0, 1, 2].map((k) => pts.reduce((s, p) => s + p[k], 0) / pts.length);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/**
 * Bestimmt dst ≈ s·R·src + t.
 * @param {number[][]} src Punkte im Quellsystem (mind. 3, nicht auf einer Linie)
 * @param {number[][]} dst dieselben Punkte im Zielsystem
 * @returns {{ scale: number, rotation: number[][], translation: number[] }}
 */
export function fitSimilarity(src, dst) {
  if (src.length !== dst.length) throw new Error('Passpunkte: Quelle und Ziel ungleich viele');
  if (src.length < 3) throw new Error('Passpunkte: mindestens drei nötig');
  for (const p of [...src, ...dst]) {
    if (!Array.isArray(p) || p.length !== 3 || !p.every(Number.isFinite)) throw new Error('Passpunkte: je drei Zahlen');
  }
  const ca = mean(src);
  const cb = mean(dst);
  const a = src.map((p) => sub(p, ca));
  const b = dst.map((p) => sub(p, cb));
  // Auf einer Linie (oder ein Punkt) → Drehung um diese Linie unbestimmt
  const cov = [0, 1, 2].map((i) => [0, 1, 2].map((j) => a.reduce((s, p) => s + p[i] * p[j], 0)));
  const ev = symmetricEigen(cov).values.sort((x, y) => y - x);
  if (!(ev[0] > 0) || ev[1] < ev[0] * 1e-8) throw new Error('Passpunkte liegen (fast) auf einer Linie');

  const S = [0, 1, 2].map((i) => [0, 1, 2].map((j) => a.reduce((s, p, k) => s + p[i] * b[k][j], 0)));
  const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = S;
  const N = [
    [xx + yy + zz, yz - zy, zx - xz, xy - yx],
    [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
    [xy - yx, zx + xz, yz + zy, -xx - yy + zz],
  ];
  const { values, vectors } = symmetricEigen(N);
  const [w, x, y, z] = vectors[values.indexOf(Math.max(...values))];
  const R = [
    [w * w + x * x - y * y - z * z, 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (y * x + w * z), w * w - x * x + y * y - z * z, 2 * (y * z - w * x)],
    [2 * (z * x - w * y), 2 * (z * y + w * x), w * w - x * x - y * y + z * z],
  ];
  const rot = (p) => [0, 1, 2].map((i) => R[i][0] * p[0] + R[i][1] * p[1] + R[i][2] * p[2]);
  const scale = b.reduce((s, q, k) => {
    const r = rot(a[k]);
    return s + q[0] * r[0] + q[1] * r[1] + q[2] * r[2];
  }, 0) / a.reduce((s, p) => s + p[0] ** 2 + p[1] ** 2 + p[2] ** 2, 0);
  const rc = rot(ca);
  return { scale, rotation: R, translation: [0, 1, 2].map((k) => cb[k] - scale * rc[k]) };
}

export function applySimilarity({ scale, rotation: R, translation: t }, p) {
  return [0, 1, 2].map((i) => scale * (R[i][0] * p[0] + R[i][1] * p[1] + R[i][2] * p[2]) + t[i]);
}

/** Spaltenweise 4×4-Matrix (glTF/three.js-Reihenfolge) */
export function similarityMatrix({ scale, rotation: R, translation: t }) {
  return [
    scale * R[0][0], scale * R[1][0], scale * R[2][0], 0,
    scale * R[0][1], scale * R[1][1], scale * R[2][1], 0,
    scale * R[0][2], scale * R[1][2], scale * R[2][2], 0,
    t[0], t[1], t[2], 1,
  ];
}

const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
const rms = (xs) => Math.sqrt(xs.reduce((s, v) => s + v * v, 0) / xs.length);

/**
 * Passt ein und bewertet: Restfehler an den Passpunkten und – unabhängig – an Prüfpunkten.
 * @param {{ id: string, src: number[], dst: number[] }[]} pass
 * @param {{ id: string, src: number[], dst: number[] }[]} [check]
 */
export function placeReport(pass, check = []) {
  const fit = fitSimilarity(pass.map((p) => p.src), pass.map((p) => p.dst));
  const res = (pts) =>
    pts.map((p) => {
      const q = applySimilarity(fit, p.src);
      return { id: p.id, error: dist(q, p.dst), dy: q[1] - p.dst[1] };
    });
  const passRes = res(pass);
  const checkRes = res(check);
  const yaw = (Math.atan2(fit.rotation[0][2], fit.rotation[2][2]) * 180) / Math.PI;
  // Neigung der Hochachse nach dem Einpassen; groß heißt: Modell gekippt
  const tilt = (Math.acos(Math.min(1, Math.max(-1, fit.rotation[1][1]))) * 180) / Math.PI;
  return {
    fit,
    scale: fit.scale,
    yawDeg: yaw,
    tiltDeg: tilt,
    pass: passRes,
    passRms: rms(passRes.map((r) => r.error)),
    check: checkRes,
    checkRms: checkRes.length ? rms(checkRes.map((r) => r.error)) : null,
    checkMax: checkRes.length ? Math.max(...checkRes.map((r) => r.error)) : null,
  };
}
