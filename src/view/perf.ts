// Auswertung von Messwerten (rein, ohne DOM), damit sie testbar bleibt.

export interface FrameSummary {
  /** Anzahl gemessener Bilder */
  frames: number;
  /** Bildrate aus dem Median der Bildabstände */
  fpsMedian: number;
  /** 95. Perzentil der Bildabstände (ms) – die ruckligen 5 % */
  p95Ms: number;
  /** längster Bildabstand (ms) */
  worstMs: number;
  /** Anteil der Bilder über 33,3 ms (unter 30 fps) */
  slowShare: number;
}

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/** Fasst Bildabstände (ms) zusammen. Leere Liste ergibt frames 0 und NaN-Werte. */
export function summarizeFrames(intervals: number[]): FrameSummary {
  const ms = intervals.filter((d) => Number.isFinite(d) && d > 0).sort((a, b) => a - b);
  const median = quantile(ms, 0.5);
  return {
    frames: ms.length,
    fpsMedian: ms.length ? 1000 / median : NaN,
    p95Ms: quantile(ms, 0.95),
    worstMs: ms.length ? ms[ms.length - 1] : NaN,
    slowShare: ms.length ? ms.filter((d) => d > 1000 / 30).length / ms.length : NaN,
  };
}

/** Budgets aus der Strategie (Startwerte). */
export const BUDGET = {
  firstImageMs: 3000,
  initialMB: 5,
  zoneMB: 5,
  drawCalls: 150,
  fpsTarget: 60,
  fpsMin: 30,
} as const;

export type Verdict = 'ok' | 'knapp' | 'über' | 'offen';

/** Unter so vielen Bildern ist eine Bildrate nicht belastbar. */
export const MIN_FRAMES = 10;

/** Bewertet einen Wert gegen eine Obergrenze; „knapp“ ab 80 % der Grenze. */
export function judgeMax(value: number, limit: number): Verdict {
  if (!Number.isFinite(value)) return 'über';
  if (value > limit) return 'über';
  return value > limit * 0.8 ? 'knapp' : 'ok';
}

/**
 * Bewertet eine Bildrate: ab Ziel ok, ab Minimum knapp, darunter über (Budget verfehlt).
 * Mit weniger als MIN_FRAMES Bildern: offen.
 */
export function judgeFps(fps: number, frames = Infinity): Verdict {
  if (frames < MIN_FRAMES) return 'offen';
  if (!Number.isFinite(fps) || fps < BUDGET.fpsMin) return 'über';
  return fps >= BUDGET.fpsTarget * 0.95 ? 'ok' : 'knapp';
}

export const mb = (bytes: number) => bytes / (1024 * 1024);

/** Deutsche Zahl mit fester Nachkommazahl, z. B. 3,06 */
export const de = (n: number, digits = 1) =>
  Number.isFinite(n) ? n.toLocaleString('de-AT', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '–';
