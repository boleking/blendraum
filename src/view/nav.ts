// Geführte Navigation: Auswahl je Zoomstufe, kein freies Orbit.

import type { Twin, Vec3 } from '../model/types';
import { STAGE_LENS, STAGES, type CamState, type Stage } from './camera-rig';

export interface Selection {
  stage: Stage;
  zoneId: string;
  placeId: string;
  stepId: string;
}

const placesOf = (twin: Twin, zoneId: string) => twin.places.filter((p) => p.zoneId === zoneId);
const stepsOfZone = (twin: Twin, zoneId: string) => {
  const ids = new Set(placesOf(twin, zoneId).map((p) => p.id));
  return twin.routeSteps.filter((s) => ids.has(s.placeId));
};

/** Bringt Ort und Schritt in Einklang mit der Zone (und den Schritt mit dem Ort). */
function normalize(twin: Twin, sel: Selection): Selection {
  const places = placesOf(twin, sel.zoneId);
  const place = places.find((p) => p.id === sel.placeId) ?? places[0];
  const steps = twin.routeSteps.filter((s) => s.placeId === place.id);
  const step = steps.find((s) => s.id === sel.stepId) ?? steps[0];
  return { ...sel, placeId: place.id, stepId: step.id };
}

export function initialSelection(twin: Twin): Selection {
  return normalize(twin, { stage: 'resort', zoneId: twin.zones[0].id, placeId: '', stepId: '' });
}

export function setStage(twin: Twin, sel: Selection, stage: Stage): Selection {
  return normalize(twin, { ...sel, stage });
}

export function zoom(twin: Twin, sel: Selection, dir: 1 | -1): Selection {
  const i = STAGES.indexOf(sel.stage) + dir;
  return i < 0 || i >= STAGES.length ? sel : setStage(twin, sel, STAGES[i]);
}

const wrap = (i: number, n: number) => ((i % n) + n) % n;

/** Nächstes/vorheriges Element der aktuellen Stufe (Zone, Ort oder Schritt). */
export function cycle(twin: Twin, sel: Selection, dir: 1 | -1): Selection {
  if (sel.stage === 'resort' || sel.stage === 'zone') {
    const i = twin.zones.findIndex((z) => z.id === sel.zoneId);
    return normalize(twin, { ...sel, zoneId: twin.zones[wrap(i + dir, twin.zones.length)].id, placeId: '', stepId: '' });
  }
  if (sel.stage === 'ort') {
    const places = placesOf(twin, sel.zoneId);
    const i = places.findIndex((p) => p.id === sel.placeId);
    return normalize(twin, { ...sel, placeId: places[wrap(i + dir, places.length)].id, stepId: '' });
  }
  const steps = stepsOfZone(twin, sel.zoneId);
  const step = steps[wrap(steps.findIndex((s) => s.id === sel.stepId) + dir, steps.length)];
  return { ...sel, placeId: step.placeId, stepId: step.id };
}

export function selectZone(twin: Twin, sel: Selection, zoneId: string): Selection {
  return normalize(twin, { ...sel, zoneId, placeId: '', stepId: '' });
}

// Bildausschnitt je Stufe (m)
const FRAME = { zone: 34, ort: 13, schritt: 6 };

/** Ausdehnung des Resorts als Mittelpunkt und Kantenlänge. */
export function resortBounds(twin: Twin) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const z of twin.zones) {
    minX = Math.min(minX, z.center[0] - z.size[0] / 2);
    maxX = Math.max(maxX, z.center[0] + z.size[0] / 2);
    minZ = Math.min(minZ, z.center[1] - z.size[1] / 2);
    maxZ = Math.max(maxZ, z.center[1] + z.size[1] / 2);
  }
  return { center: [(minX + maxX) / 2, 0, (minZ + maxZ) / 2] as Vec3, size: Math.hypot(maxX - minX, maxZ - minZ) };
}

export function placeWorld(twin: Twin, placeId: string): Vec3 {
  const p = twin.places.find((x) => x.id === placeId)!;
  const z = twin.zones.find((x) => x.id === p.zoneId)!;
  return [z.center[0] + p.position[0], (z.base ?? 0) + p.position[1], z.center[1] + p.position[2]];
}

/** Zielzustand der Kamera für eine Auswahl. */
export function cameraFor(twin: Twin, sel: Selection): CamState {
  const lens = STAGE_LENS[sel.stage];
  if (sel.stage === 'resort') {
    const b = resortBounds(twin);
    return { ...lens, target: [b.center[0], 2, b.center[2]], frame: b.size * 1.05 };
  }
  if (sel.stage === 'zone') {
    const z = twin.zones.find((x) => x.id === sel.zoneId)!;
    // Große Zonen (echte Pakete) ganz zeigen, kleine wie bisher mit festem Ausschnitt.
    return { ...lens, target: [z.center[0], (z.base ?? 0) + 2, z.center[1]], frame: Math.max(FRAME.zone, Math.hypot(z.size[0], z.size[1]) * 0.9) };
  }
  const p = placeWorld(twin, sel.placeId);
  if (sel.stage === 'ort') return { ...lens, target: p, frame: FRAME.ort };
  const s = twin.routeSteps.find((x) => x.id === sel.stepId)!;
  return { ...lens, target: [p[0] + s.focus[0], p[1] + s.focus[1], p[2] + s.focus[2]], frame: FRAME.schritt };
}

/** Kurzer deutscher Text für die aktuelle Auswahl. */
export function describe(twin: Twin, sel: Selection): string {
  const zone = twin.zones.find((z) => z.id === sel.zoneId)!;
  if (sel.stage === 'resort') return `${twin.title} – Übersicht`;
  if (sel.stage === 'zone') return zone.label;
  const place = twin.places.find((p) => p.id === sel.placeId)!;
  if (sel.stage === 'ort') return `${zone.label} · ${place.label}`;
  const steps = stepsOfZone(twin, zone.id);
  const i = steps.findIndex((s) => s.id === sel.stepId);
  return `${place.label} · ${steps[i].label} (${i + 1}/${steps.length})`;
}
