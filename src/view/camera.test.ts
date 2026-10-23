import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateTwin } from '../model/validate';
import {
  cameraPosition,
  distanceFor,
  easeInOutCubic,
  lerpAngle,
  mixState,
  STAGE_LENS,
  STAGES,
  type CamState,
} from './camera-rig';
import { cameraFor, cycle, describe as label, initialSelection, selectZone, setStage, zoom } from './nav';

const r = validateTwin(JSON.parse(readFileSync(new URL('../../public/twin.json', import.meta.url), 'utf8')));
if (!r.ok) throw new Error(r.errors.join('\n'));
const twin = r.twin;

describe('Kamera-Rig', () => {
  it('startet mit schmalem FOV um 18°, nahe Isometrie', () => {
    expect(STAGE_LENS.resort.fov).toBe(18);
    expect(STAGE_LENS.resort.azimuth).toBe(45);
    expect(STAGE_LENS.resort.elevation).toBeCloseTo(35.264, 2);
  });

  it('weitet beim Hineinzoomen FOV, Drehung und Neigung monoton', () => {
    for (let i = 1; i < STAGES.length; i++) {
      const a = STAGE_LENS[STAGES[i - 1]];
      const b = STAGE_LENS[STAGES[i]];
      expect(b.fov).toBeGreaterThan(a.fov);
      expect(b.azimuth).toBeLessThan(a.azimuth);
      expect(b.elevation).toBeLessThan(a.elevation);
    }
  });

  it('Easing ist sanft an den Enden und symmetrisch', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5);
    expect(easeInOutCubic(0.02)).toBeLessThan(0.001);
    expect(easeInOutCubic(-1)).toBe(0);
    expect(easeInOutCubic(2)).toBe(1);
  });

  it('dreht Winkel über den kürzesten Weg', () => {
    expect(lerpAngle(350, 10, 0.5)).toBeCloseTo(360);
    expect(lerpAngle(10, 350, 0.5)).toBeCloseTo(0);
  });

  it('mischt Zustände an den Enden exakt und den Ausschnitt logarithmisch', () => {
    const a = cameraFor(twin, initialSelection(twin));
    const b = cameraFor(twin, setStage(twin, initialSelection(twin), 'schritt'));
    const start = mixState(a, b, 0);
    expect({ ...start, frame: 0 }).toEqual({ ...a, frame: 0 });
    expect(start.frame).toBeCloseTo(a.frame, 9);
    const end = mixState(a, b, 1);
    expect(end.fov).toBeCloseTo(b.fov);
    expect(end.frame).toBeCloseTo(b.frame);
    expect(mixState(a, b, 0.5).frame).toBeCloseTo(Math.sqrt(a.frame * b.frame));
  });

  it('hält den Ausschnitt bei jedem FOV im Bild (Hochformat braucht mehr Abstand)', () => {
    const s: CamState = { target: [0, 0, 0], fov: 18, azimuth: 45, elevation: 30, frame: 20 };
    const d = distanceFor(s, 1.6);
    expect(2 * d * Math.tan((9 * Math.PI) / 180)).toBeCloseTo(20);
    expect(distanceFor(s, 390 / 844)).toBeGreaterThan(d);
    const p = cameraPosition(s, 1.6);
    expect(Math.hypot(...p)).toBeCloseTo(d);
    expect(p[1]).toBeGreaterThan(0);
  });
});

describe('Navigation', () => {
  const start = initialSelection(twin);

  it('beginnt im Resort bei Zone A', () => {
    expect(start).toMatchObject({ stage: 'resort', zoneId: 'zone-a', placeId: 'ort-a1', stepId: 'schritt-a1-1' });
  });

  it('zoomt durch alle vier Stufen und wieder hinaus', () => {
    let s = start;
    const seen = [s.stage];
    for (let i = 0; i < 5; i++) seen.push((s = zoom(twin, s, 1)).stage);
    expect(seen).toEqual(['resort', 'zone', 'ort', 'schritt', 'schritt', 'schritt']);
    for (let i = 0; i < 4; i++) s = zoom(twin, s, -1);
    expect(s.stage).toBe('resort');
  });

  it('wechselt Zonen zyklisch und setzt Ort/Schritt passend', () => {
    const s = cycle(twin, start, -1);
    expect(s).toMatchObject({ zoneId: 'zone-f', placeId: 'ort-f1', stepId: 'schritt-f1-1' });
  });

  it('wechselt Orte innerhalb der Zone', () => {
    const s = cycle(twin, setStage(twin, start, 'ort'), 1);
    expect(s).toMatchObject({ zoneId: 'zone-a', placeId: 'ort-a2', stepId: 'schritt-a2-1' });
  });

  it('geht Route-Schritte über Orte hinweg durch', () => {
    let s = setStage(twin, start, 'schritt');
    const ids = [s.stepId];
    for (let i = 0; i < 3; i++) ids.push((s = cycle(twin, s, 1)).stepId);
    expect(ids).toEqual(['schritt-a1-1', 'schritt-a1-2', 'schritt-a2-1', 'schritt-a1-1']);
    expect(label(twin, s)).toBe('Ort A1 · Schritt A1.1 (1/3)');
  });

  it('Kameraziele werden von Stufe zu Stufe enger', () => {
    let s = selectZone(twin, start, 'zone-e');
    let prev = cameraFor(twin, s).frame;
    for (let i = 0; i < 3; i++) {
      s = zoom(twin, s, 1);
      const f = cameraFor(twin, s).frame;
      expect(f).toBeLessThan(prev);
      prev = f;
    }
  });
});

describe('Große Zonen und Zonen-±0', () => {
  const big = structuredClone(twin);
  big.zones[0] = { ...big.zones[0], center: [0, 0], size: [140, 110], base: 8 };

  it('Zonen-Ausschnitt wächst mit der Zone, kleine Zonen bleiben bei 34 m', () => {
    const s = setStage(big, initialSelection(big), 'zone');
    expect(cameraFor(big, s).frame).toBeCloseTo(Math.hypot(140, 110) * 0.9);
    expect(cameraFor(twin, setStage(twin, initialSelection(twin), 'zone')).frame).toBe(34);
  });

  it('Ort und Zonen-Ziel liegen auf dem ±0 der Zone', () => {
    const z = cameraFor(big, setStage(big, initialSelection(big), 'zone'));
    expect(z.target[1]).toBe(10);
    const o = cameraFor(big, setStage(big, initialSelection(big), 'ort'));
    expect(o.target[1]).toBeCloseTo(8 + twin.places[0].position[1]);
  });
});
