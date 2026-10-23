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

  it('lehnt falsche Schema-Version ab', () => rejects((t) => (t.schema = 3), /schema/));

  it('verlangt alle drei Ebenen', () =>
    rejects((t) => (t.levels = t.levels.filter((l: any) => l.id !== 'OG1')), /Ebene "OG1" fehlt/));

  it('lehnt unbekannte Ebene ab', () => rejects((t) => (t.levels[0].id = 'OG7'), /levels\[0\]\.id/));

  it('lehnt überlappende Ebenen ab', () => rejects((t) => (t.levels[0].height = 5), /UG überlappt EG/));

  it('lehnt doppelte ids ab', () => rejects((t) => (t.zones[1].id = t.zones[0].id), /doppelte id/));

  it('verlangt Bestand je Zone', () => rejects((t) => delete t.zones[2].variants.bestand, /variants\.bestand: fehlt/));

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
    rejects((t) => (t.zones[0].footprint[1] = [Number.NaN, 0]), /footprint/);
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

  describe('Schema 2', () => {
    const origin = { epsg: 32633, e: 500000, n: 5000000, h: 300 };
    const src = { file: 'quelle.obj', date: '2026-10-23', triangles: 1200 };
    /** Erfundenes "echtes" Paket: Platzhalter aus, Nullpunkt und Herkunft gesetzt. */
    const realLike = () => {
      const t = base();
      t.placeholder = false;
      t.origin = { ...origin };
      for (const z of t.zones) {
        z.variants.bestand.source = { ...src };
        z.variants.neu.source = { ...src };
      }
      return t;
    };

    it('berechnet center und size aus dem Grundriss', () => {
      const r = validateTwin(real);
      if (!r.ok) throw new Error(r.errors.join('\n'));
      expect(r.twin.zones[0].center).toEqual([-32, -18]);
      expect(r.twin.zones[0].size).toEqual([24, 24]);
      expect(r.twin.placeholder).toBe(true);
      expect(r.twin.origin).toBeNull();
    });

    it('akzeptiert unregelmäßige Grundrisse und prüft Orte gegen das Polygon', () => {
      const t = base();
      // L-Form: die obere rechte Ecke fehlt
      t.zones[0].footprint = [[-44, -30], [-20, -30], [-20, -18], [-32, -18], [-32, -6], [-44, -6]];
      t.places[0].position = [-5, 1.5, 3]; // relativ zur Mitte [-32, -18] → [-37, -15], im L
      t.places[1].position = [-6, 1.5, -6]; // → [-38, -24], im L
      const r = validateTwin(t);
      if (!r.ok) throw new Error(r.errors.join('\n'));
      expect(r.twin.zones[0].center).toEqual([-32, -18]);
      t.places[1].position = [6, 1.5, 6]; // → [-26, -12], in der fehlenden Ecke
      expect(validateTwin(t).ok).toBe(false);
    });

    it('lehnt Grundrisse ohne Fläche oder mit zu wenig Punkten ab', () => {
      rejects((t) => (t.zones[0].footprint = [[0, 0], [1, 1]]), /mindestens drei Punkte/);
      rejects((t) => (t.zones[0].footprint = [[0, 0], [1, 1], [2, 2]]), /keine Fläche/);
    });

    it('lehnt center/size neben footprint ab', () =>
      rejects((t) => (t.zones[0].center = [0, 0]), /werden aus footprint berechnet/));

    it('Neu ist optional', () => {
      const t = base();
      delete t.zones[2].variants.neu;
      const r = validateTwin(t);
      if (!r.ok) throw new Error(r.errors.join('\n'));
      expect(r.twin.zones[2].variants.neu).toBeUndefined();
      expect(r.twin.zones[1].variants.neu).toBeDefined();
    });

    it('akzeptiert echtes Paket mit Nullpunkt, Gelände und Geländeteil', () => {
      const t = realLike();
      t.terrain = { file: 'models/terrain.glb', source: { ...src, texture: 2048 } };
      t.zones[0].variants.neu.terrainPatch = { file: 'models/zone-a-grube.glb', source: { ...src } };
      const r = validateTwin(t);
      if (!r.ok) throw new Error(r.errors.join('\n'));
      expect(r.twin.origin).toEqual(origin);
      expect(r.twin.terrain?.file).toBe('models/terrain.glb');
    });

    it('verlangt bei echten Daten einen Nullpunkt', () => {
      const t = realLike();
      t.origin = null;
      const r = validateTwin(t);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.join('\n')).toMatch(/brauchen einen Nullpunkt/);
    });

    it('erlaubt echte Daten ohne Nullpunkt nur mit georeferenced: false, und dann ohne Nullpunkt', () => {
      const t = realLike();
      t.origin = null;
      t.georeferenced = false;
      const r = validateTwin(t);
      if (!r.ok) throw new Error(r.errors.join('\n'));
      expect(r.twin.georeferenced).toBe(false);
      const u = realLike();
      u.georeferenced = false;
      const r2 = validateTwin(u);
      expect(r2.ok).toBe(false);
      if (!r2.ok) expect(r2.errors.join('\n')).toMatch(/verträgt keinen Nullpunkt/);
      const w = realLike();
      w.georeferenced = 'nein';
      expect(validateTwin(w).ok).toBe(false);
    });

    it('verbietet einen Nullpunkt im Platzhalterpaket', () =>
      rejects((t) => (t.origin = { ...origin }), /Platzhalterpaket darf keinen echten Nullpunkt/));

    it('verlangt bei echten Daten eine Herkunft je Datei', () => {
      const t = realLike();
      delete t.zones[3].variants.neu.source;
      const r = validateTwin(t);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.join('\n')).toMatch(/zones\[3\]\.variants\.neu\.source: fehlt/);
    });

    it('prüft Herkunftsangaben', () => {
      const t = realLike();
      t.zones[0].variants.bestand.source = { file: '', date: '23.10.2026', triangles: -1, texture: 0 };
      const r = validateTwin(t);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        const all = r.errors.join('\n');
        for (const k of ['source.file', 'source.date', 'source.triangles', 'source.texture']) expect(all).toContain(k);
      }
    });

    it('lehnt unsichere Pfade auch für Gelände und Geländeteil ab', () => {
      const t = realLike();
      t.terrain = { file: 'https://example.com/t.glb', source: { ...src } };
      t.zones[0].variants.neu.terrainPatch = { file: '../x.glb', source: { ...src } };
      const r = validateTwin(t);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errors.join('\n')).toMatch(/terrain\.file/);
        expect(r.errors.join('\n')).toMatch(/terrainPatch\.file/);
      }
    });

    it('verlangt placeholder als Wahrheitswert', () => rejects((t) => delete t.placeholder, /placeholder/));

    it('akzeptiert Detailfassung, Kurzname und Zonen-±0', () => {
      const t = realLike();
      t.zones[0].variants.bestand.detail = { file: 'models/zone-a-detail.glb', source: { ...src } };
      t.zones[0].short = 'Kern';
      t.zones[0].base = 8.3;
      const r = validateTwin(t);
      if (!r.ok) throw new Error(r.errors.join('\n'));
      expect(r.twin.zones[0].variants.bestand.detail?.file).toBe('models/zone-a-detail.glb');
      expect(r.twin.zones[0].base).toBe(8.3);
    });

    it('prüft Detailfassung, Kurzname und Zonen-±0', () => {
      const t = realLike();
      t.zones[0].variants.bestand.detail = { file: 'https://x/y.glb' };
      t.zones[0].short = 'ein viel zu langer Kurzname';
      t.zones[0].base = 'hoch';
      const r = validateTwin(t);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        const all = r.errors.join('\n');
        for (const k of ['detail.file', 'detail.source', 'short', 'base']) expect(all).toContain(k);
      }
    });
  });

  it('wandelt Schema 1 (Teil A) in Schema 2 um', () => {
    const v1 = {
      schema: 1,
      title: 'Alt',
      levels: real.levels,
      zones: [{ id: 'zone-a', label: 'Zone A', center: [10, 20], size: [8, 6], variants: real.zones[0].variants }],
      places: [{ id: 'ort-a1', zoneId: 'zone-a', label: 'Ort A1', level: 'EG', position: [1, 1.5, 1] }],
      routeSteps: [{ id: 's1', placeId: 'ort-a1', label: 'S1', focus: [0, 0, 0] }],
    };
    const r = validateTwin(v1);
    if (!r.ok) throw new Error(r.errors.join('\n'));
    expect(r.twin.schema).toBe(2);
    expect(r.twin.placeholder).toBe(true);
    expect(r.twin.zones[0].footprint).toEqual([[6, 17], [14, 17], [14, 23], [6, 23]]);
    expect(r.twin.zones[0].center).toEqual([10, 20]);
    expect(r.twin.zones[0].size).toEqual([8, 6]);
  });

  it('sammelt mehrere Fehler auf einmal', () => {
    const t = base();
    t.title = '';
    t.zones[0].label = 42;
    const r = validateTwin(t);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThanOrEqual(2);
  });
});
