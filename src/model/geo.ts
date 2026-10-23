// Umrechnung zwischen UTM (E, N, H in Metern) und Web-Koordinaten (Meter, Y oben).

import type { Origin, Vec2, Vec3 } from './types';

/** UTM → Web: x = E − e, y = H − h, z = −(N − n). Gitter-Nord zeigt im Web nach −z. */
export function utmToWeb(o: Origin, [e, n, h]: Vec3): Vec3 {
  return [e - o.e, h - o.h, -(n - o.n)];
}

/** Web → UTM, exakte Umkehrung von utmToWeb. */
export function webToUtm(o: Origin, [x, y, z]: Vec3): Vec3 {
  return [x + o.e, -z + o.n, y + o.h];
}

/**
 * Quellmodelle in lokalen UTM-Zentimetern (x = Ost, y = Nord, z = Höhe) relativ zu einem
 * Quell-Nullpunkt (E, N) → UTM in Metern. Die Höhe ist dort bereits absolut.
 */
export function localCmToUtm([se, sn]: Vec2, [x, y, z]: Vec3): Vec3 {
  return [x / 100 + se, y / 100 + sn, z / 100];
}

/** Rundet einen Punkt auf einen festen Nullpunkt: E/N auf volle 10 m, H auf volle Meter. */
export function roundOrigin(epsg: number, [e, n, h]: Vec3): Origin {
  return { epsg, e: Math.round(e / 10) * 10, n: Math.round(n / 10) * 10, h: Math.round(h) };
}
