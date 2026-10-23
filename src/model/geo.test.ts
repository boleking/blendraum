import { describe, expect, it } from 'vitest';
import type { Origin, Vec3 } from './types';
import { localCmToUtm, roundOrigin, utmToWeb, webToUtm } from './geo';

// Erfundene Werte – keine echten Orte.
const o: Origin = { epsg: 32633, e: 512340, n: 5123450, h: 280 };

describe('Nullpunkt', () => {
  it('UTM → Web: Ost = +x, Höhe = +y, Nord = −z', () => {
    expect(utmToWeb(o, [512350, 5123460, 283])).toEqual([10, 3, -10]);
  });

  it('Hin- und Rückrechnung ist verlustfrei (auf 1 mm)', () => {
    const pts: Vec3[] = [
      [512340, 5123450, 280],
      [512987.654, 5122876.321, 311.25],
      [511001.001, 5124999.999, 245.5],
    ];
    for (const p of pts) {
      const back = webToUtm(o, utmToWeb(o, p));
      back.forEach((v, i) => expect(Math.abs(v - p[i])).toBeLessThan(1e-3));
    }
  });

  it('Web-Koordinaten bleiben klein genug für float32 (Resortmaßstab, mm-genau)', () => {
    const p: Vec3 = [513340.123, 5122450.456, 330.789]; // 1 km vom Nullpunkt
    const w = utmToWeb(o, p);
    const f32 = Float32Array.from(w);
    w.forEach((v, i) => expect(Math.abs(f32[i] - v)).toBeLessThan(1e-3));
  });

  it('lokale Zentimeter-Koordinaten → UTM in Metern', () => {
    // Quell-Nullpunkt (E, N); z ist bereits absolute Höhe in cm
    expect(localCmToUtm([500000, 5000000], [12345, 67890, 31234])).toEqual([500123.45, 5000678.9, 312.34]);
  });

  it('rundet den Nullpunkt auf 10 m (E/N) und 1 m (H)', () => {
    expect(roundOrigin(32633, [512344.9, 5123456.2, 280.6])).toEqual({ epsg: 32633, e: 512340, n: 5123460, h: 281 });
  });
});
