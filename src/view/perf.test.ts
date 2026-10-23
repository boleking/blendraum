import { describe, expect, it } from 'vitest';
import { BUDGET, de, judgeFps, judgeMax, mb, quantile, summarizeFrames } from './perf';

describe('summarizeFrames', () => {
  it('rechnet Median-fps, p95 und Ausreißer', () => {
    const intervals = [...Array(95).fill(16.7), ...Array(5).fill(50)];
    const s = summarizeFrames(intervals);
    expect(s.frames).toBe(100);
    expect(s.fpsMedian).toBeCloseTo(59.9, 1);
    expect(s.worstMs).toBe(50);
    expect(s.slowShare).toBeCloseTo(0.05);
    expect(s.p95Ms).toBeGreaterThan(16.7);
  });

  it('ignoriert ungültige Abstände', () => {
    const s = summarizeFrames([16, NaN, -1, 0, Infinity, 16]);
    expect(s.frames).toBe(2);
    expect(s.fpsMedian).toBeCloseTo(62.5);
  });

  it('liefert für leere Messungen keine Scheinwerte', () => {
    const s = summarizeFrames([]);
    expect(s.frames).toBe(0);
    expect(Number.isNaN(s.fpsMedian)).toBe(true);
  });
});

describe('quantile', () => {
  it('interpoliert linear', () => {
    expect(quantile([0, 10], 0.5)).toBe(5);
    expect(quantile([1, 2, 3, 4], 1)).toBe(4);
  });
});

describe('Bewertung', () => {
  it('Obergrenzen mit Vorwarnung ab 80 %', () => {
    expect(judgeMax(2000, BUDGET.firstImageMs)).toBe('ok');
    expect(judgeMax(2900, BUDGET.firstImageMs)).toBe('knapp');
    expect(judgeMax(3100, BUDGET.firstImageMs)).toBe('über');
    expect(judgeMax(NaN, 1)).toBe('über');
  });

  it('Bildrate gegen Ziel 60 und Minimum 30', () => {
    expect(judgeFps(60)).toBe('ok');
    expect(judgeFps(45)).toBe('knapp');
    expect(judgeFps(29)).toBe('über');
    expect(judgeFps(NaN)).toBe('über');
  });

  it('Bildrate aus zu wenigen Bildern bleibt offen', () => {
    expect(judgeFps(60, 3)).toBe('offen');
    expect(judgeFps(60, 10)).toBe('ok');
  });

  it('formatiert deutsch', () => {
    expect(de(mb(3.06 * 1024 * 1024), 2)).toBe('3,06');
    expect(de(NaN)).toBe('–');
  });
});
