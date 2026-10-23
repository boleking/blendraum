import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateTwin } from './validate';

const real = JSON.parse(readFileSync(new URL('../../public/twin.json', import.meta.url), 'utf8'));
const base = () => structuredClone(real);

function rejects(mutate: (t: any) => void, expected: RegExp) {
  const t = base();
  mutate(t);
  const r = validateTwin(t);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.errors.join('\n')).toMatch(expected);
}

describe('validateTwin', () => {
  it('akzeptiert public/twin.json', () => {
    const r = validateTwin(real);
    if (!r.ok) throw new Error(r.errors.join('\n'));
    expect(r.twin.zones.map((z) => z.label)).toEqual(['Zone A', 'Zone B', 'Zone C', 'Zone D', 'Zone E', 'Zone F']);
  });

  it('lehnt Nicht-Objekte ab', () => {
    for (const v of [null, 42, 'twin', [], undefined]) expect(validateTwin(v).ok).toBe(false);
  });

  it('lehnt falsche Schema-Version ab', () => rejects((t) => (t.schema = 2), /schema/));

  it('verlangt alle drei Ebenen', () =>
    rejects((t) => (t.levels = t.levels.filter((l: any) => l.id !== 'OG1')), /Ebene "OG1" fehlt/));

  it('lehnt unbekannte Ebene ab', () => rejects((t) => (t.levels[0].id = 'OG7'), /levels\[0\]\.id/));

  it('lehnt überlappende Ebenen ab', () => rejects((t) => (t.levels[0].height = 5), /UG überlappt EG/));

  it('lehnt doppelte ids ab', () => rejects((t) => (t.zones[1].id = t.zones[0].id), /doppelte id/));

  it('verlangt beide Varianten je Zone', () => rejects((t) => delete t.zones[2].variants.neu, /variants\.neu: fehlt/));

  it('lehnt unbekannte Variante ab', () =>
    rejects((t) => (t.zones[0].variants.abriss = { label: 'x', file: 'models/x.glb' }), /unbekannte Variante/));

  it.each([
    'https://example.com/a.glb',
    '//example.com/a.glb',
    '/models/a.glb',
    '../geheim/a.glb',
    'models/a.gltf',
    'data:model/gltf-binary;base64,AAAA',
  ])('lehnt externen oder unsicheren Pfad ab: %s', (file) =>
    rejects((t) => (t.zones[0].variants.bestand.file = file), /relativer \.glb-Pfad/));

  it('lehnt NaN und Strings als Koordinaten ab', () => {
    rejects((t) => (t.zones[0].center = [Number.NaN, 0]), /center/);
    rejects((t) => (t.places[0].position = ['1', 2, 3]), /position/);
  });

  it('lehnt Ort mit unbekannter Zone ab', () => rejects((t) => (t.places[0].zoneId = 'zone-z'), /unbekannte Zone/));

  it('lehnt Ort außerhalb der Zone ab', () => rejects((t) => (t.places[0].position[0] = 99), /außerhalb/));

  it('lehnt Ort mit unpassender Höhe ab', () => rejects((t) => (t.places[0].position[1] = 6), /Höhe passt nicht/));

  it('lehnt Route-Schritt mit unbekanntem Ort ab', () =>
    rejects((t) => (t.routeSteps[0].placeId = 'ort-zz'), /unbekannter Ort/));

  it('verlangt mindestens einen Route-Schritt je Ort', () =>
    rejects((t) => (t.routeSteps = t.routeSteps.filter((s: any) => s.placeId !== 'ort-a2')), /"ort-a2" hat keinen/));

  it('verlangt mindestens einen Ort je Zone', () =>
    rejects((t) => (t.places = t.places.filter((p: any) => p.zoneId !== 'zone-f')), /"zone-f" hat keinen Ort/));

  it('sammelt mehrere Fehler auf einmal', () => {
    const t = base();
    t.title = '';
    t.zones[0].label = 42;
    const r = validateTwin(t);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThanOrEqual(2);
  });
});
