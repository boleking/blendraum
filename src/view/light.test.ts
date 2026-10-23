import { describe, expect, it } from 'vitest';
import { kelvinToRgb, WARM_KELVIN } from './light';

describe('kelvinToRgb', () => {
  it('2700 K ist warm: Rot voll, Blau deutlich unter Grün', () => {
    const [r, g, b] = kelvinToRgb(WARM_KELVIN);
    expect(r).toBe(1);
    expect(g).toBeCloseTo(0.654, 2);
    expect(b).toBeCloseTo(0.343, 2);
  });

  it('6600 K ist etwa neutral', () => {
    const [r, g, b] = kelvinToRgb(6600);
    expect(Math.min(r, g, b)).toBeGreaterThan(0.95);
  });

  it('bleibt bei Extremwerten im Bereich 0..1', () => {
    for (const k of [0, 500, 1000, 100000]) for (const v of kelvinToRgb(k)) expect(v).toBeGreaterThanOrEqual(0);
  });
});
