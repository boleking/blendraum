// Kamera als reine Daten: Zielpunkt, FOV, Drehung, Neigung und Bildausschnitt.
// Schmales FOV + große Distanz täuscht Isometrie vor; beim Hineinzoomen weiten sich FOV,
// Drehung und Neigung, während der Bildausschnitt kleiner wird.

import type { Vec3 } from '../model/types';

export const STAGES = ['resort', 'zone', 'ort', 'schritt'] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  resort: 'Übersicht',
  zone: 'Bereich',
  ort: 'Ort',
  schritt: 'Schritt',
};

export interface CamState {
  target: Vec3;
  /** vertikales FOV in Grad */
  fov: number;
  /** Drehung um die Hochachse in Grad, 0 = Blick nach -z */
  azimuth: number;
  /** Neigung über dem Horizont in Grad */
  elevation: number;
  /** Kantenlänge des Quadrats (m), das am Zielpunkt sicher ins Bild passen soll */
  frame: number;
}

/** Wahre Isometrie: atan(1/√2) ≈ 35,26° */
export const ISO_ELEVATION = (Math.atan(1 / Math.SQRT2) * 180) / Math.PI;

export const STAGE_LENS: Record<Stage, Pick<CamState, 'fov' | 'azimuth' | 'elevation'>> = {
  resort: { fov: 18, azimuth: 45, elevation: ISO_ELEVATION },
  zone: { fov: 28, azimuth: 38, elevation: 32 },
  ort: { fov: 42, azimuth: 26, elevation: 24 },
  schritt: { fov: 58, azimuth: 14, elevation: 14 },
};

export const easeInOutCubic = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Kürzester Weg zwischen zwei Winkeln in Grad. */
export function lerpAngle(a: number, b: number, t: number) {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return a + d * t;
}

/** Zwischenstand zweier Kamerazustände; t ist bereits ge-eased. Bildausschnitt logarithmisch. */
export function mixState(a: CamState, b: CamState, t: number): CamState {
  return {
    target: [lerp(a.target[0], b.target[0], t), lerp(a.target[1], b.target[1], t), lerp(a.target[2], b.target[2], t)],
    fov: lerp(a.fov, b.fov, t),
    azimuth: lerpAngle(a.azimuth, b.azimuth, t),
    elevation: lerp(a.elevation, b.elevation, t),
    frame: Math.exp(lerp(Math.log(a.frame), Math.log(b.frame), t)),
  };
}

/** Abstand, bei dem der Bildausschnitt bei gegebenem Seitenverhältnis (b/h) ganz sichtbar ist. */
export function distanceFor(s: CamState, aspect: number) {
  const visibleHeight = s.frame / Math.min(1, aspect);
  return visibleHeight / 2 / Math.tan((s.fov * Math.PI) / 360);
}

export function cameraPosition(s: CamState, aspect: number): Vec3 {
  const d = distanceFor(s, aspect);
  const az = (s.azimuth * Math.PI) / 180;
  const el = (s.elevation * Math.PI) / 180;
  return [
    s.target[0] + d * Math.sin(az) * Math.cos(el),
    s.target[1] + d * Math.sin(el),
    s.target[2] + d * Math.cos(az) * Math.cos(el),
  ];
}

/**
 * Umkehrung von cameraPosition()/distanceFor(): Kamerastand aus Position und Zielpunkt.
 * Das Seitenverhältnis und der sichtbare Anteil (h / freeH) müssen dieselben sein wie beim Hinweg.
 */
export function stateFromPose(pos: Vec3, target: Vec3, fov: number, aspect: number, visibleShare = 1): CamState {
  const dx = pos[0] - target[0], dy = pos[1] - target[1], dz = pos[2] - target[2];
  const d = Math.hypot(dx, dy, dz) || 1;
  const visibleHeight = 2 * d * Math.tan((fov * Math.PI) / 360);
  return {
    target: [...target] as Vec3,
    fov,
    azimuth: (Math.atan2(dx, dz) * 180) / Math.PI,
    elevation: (Math.asin(Math.min(1, Math.max(-1, dy / d))) * 180) / Math.PI,
    frame: visibleHeight * Math.min(1, aspect) * visibleShare,
  };
}

/** Clipping-Ebenen passend zum Abstand Kamera–Ziel: nah genug zum Heranzoomen, weit genug für das Resort. */
export function clipPlanes(distance: number, sceneSize: number) {
  return { near: Math.max(0.05, Math.min(distance * 0.05, 0.5)), far: Math.max(distance * 4, sceneSize * 3) + 200 };
}
