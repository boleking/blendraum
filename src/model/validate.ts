import { LEVEL_IDS, VARIANT_KEYS, type Twin } from './types';

export type ValidationResult = { ok: true; twin: Twin } | { ok: false; errors: string[] };

const ID = /^[a-z0-9][a-z0-9-]*$/;
// Nur relative Pfade auf eigene .glb-Dateien: kein Schema, kein "//", kein "..", kein führendes "/".
const SAFE_GLB = /^(?![a-z][a-z0-9+.-]*:)(?!\/)(?!.*\/\/)(?!.*\.\.)[A-Za-z0-9_\-./]+\.glb$/i;

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const isVec = (v: unknown, n: number): v is number[] =>
  Array.isArray(v) && v.length === n && v.every(isNum);

/** Prüft unbekannte Daten und liefert entweder einen typisierten Twin oder alle Fehler. */
export function validateTwin(data: unknown): ValidationResult {
  const errors: string[] = [];
  const err = (path: string, msg: string) => errors.push(`${path}: ${msg}`);

  if (!isObj(data)) return { ok: false, errors: ['twin: muss ein Objekt sein'] };
  if (data.schema !== 1) err('schema', 'unbekannte Version (erwartet 1)');
  if (!isText(data.title)) err('title', 'fehlt');

  const ids = new Set<string>();
  const uniqueId = (path: string, id: unknown): id is string => {
    if (typeof id !== 'string' || !ID.test(id)) {
      err(path, 'ungültige id');
      return false;
    }
    if (ids.has(id)) {
      err(path, `doppelte id "${id}"`);
      return false;
    }
    ids.add(id);
    return true;
  };

  // Ebenen
  const levels = new Map<string, { elevation: number; height: number }>();
  if (!Array.isArray(data.levels)) err('levels', 'muss eine Liste sein');
  else {
    data.levels.forEach((l, i) => {
      const p = `levels[${i}]`;
      if (!isObj(l)) return err(p, 'muss ein Objekt sein');
      if (!(LEVEL_IDS as readonly unknown[]).includes(l.id)) err(`${p}.id`, `erlaubt: ${LEVEL_IDS.join(', ')}`);
      else if (levels.has(l.id as string)) err(`${p}.id`, `doppelte Ebene "${l.id}"`);
      if (!isText(l.label)) err(`${p}.label`, 'fehlt');
      if (!isNum(l.elevation)) err(`${p}.elevation`, 'muss eine Zahl sein');
      if (!isNum(l.height) || l.height <= 0) err(`${p}.height`, 'muss > 0 sein');
      if (typeof l.id === 'string' && isNum(l.elevation) && isNum(l.height)) {
        levels.set(l.id, { elevation: l.elevation, height: l.height });
      }
    });
    for (const id of LEVEL_IDS) if (!levels.has(id)) err('levels', `Ebene "${id}" fehlt`);
    // Reihenfolge UG < EG < OG1 ohne Überlappung
    for (let i = 1; i < LEVEL_IDS.length; i++) {
      const lo = levels.get(LEVEL_IDS[i - 1]);
      const hi = levels.get(LEVEL_IDS[i]);
      if (lo && hi && lo.elevation + lo.height > hi.elevation + 1e-6) {
        err('levels', `${LEVEL_IDS[i - 1]} überlappt ${LEVEL_IDS[i]}`);
      }
    }
  }

  // Zonen
  const zones = new Map<string, { size: number[] }>();
  if (!Array.isArray(data.zones) || data.zones.length === 0) err('zones', 'mindestens eine Zone nötig');
  else {
    data.zones.forEach((z, i) => {
      const p = `zones[${i}]`;
      if (!isObj(z)) return err(p, 'muss ein Objekt sein');
      const idOk = uniqueId(`${p}.id`, z.id);
      if (!isText(z.label)) err(`${p}.label`, 'fehlt');
      if (!isVec(z.center, 2)) err(`${p}.center`, 'erwartet [x, z]');
      const sizeOk = isVec(z.size, 2) && z.size.every((s) => s > 0);
      if (!sizeOk) err(`${p}.size`, 'erwartet [breite, tiefe] > 0');
      if (!isObj(z.variants)) err(`${p}.variants`, 'fehlt');
      else {
        for (const key of VARIANT_KEYS) {
          const v = z.variants[key];
          if (!isObj(v)) {
            err(`${p}.variants.${key}`, 'fehlt');
            continue;
          }
          if (!isText(v.label)) err(`${p}.variants.${key}.label`, 'fehlt');
          if (typeof v.file !== 'string' || !SAFE_GLB.test(v.file)) {
            err(`${p}.variants.${key}.file`, 'muss ein relativer .glb-Pfad ohne externe Adresse sein');
          }
        }
        for (const key of Object.keys(z.variants)) {
          if (!(VARIANT_KEYS as readonly string[]).includes(key)) err(`${p}.variants.${key}`, 'unbekannte Variante');
        }
      }
      if (idOk && sizeOk) zones.set(z.id as string, { size: z.size as number[] });
    });
  }

  // Orte
  const places = new Map<string, true>();
  if (!Array.isArray(data.places)) err('places', 'muss eine Liste sein');
  else {
    data.places.forEach((pl, i) => {
      const p = `places[${i}]`;
      if (!isObj(pl)) return err(p, 'muss ein Objekt sein');
      const idOk = uniqueId(`${p}.id`, pl.id);
      if (!isText(pl.label)) err(`${p}.label`, 'fehlt');
      const zone = typeof pl.zoneId === 'string' ? zones.get(pl.zoneId) : undefined;
      if (!zone) err(`${p}.zoneId`, `unbekannte Zone "${String(pl.zoneId)}"`);
      const level = typeof pl.level === 'string' ? levels.get(pl.level) : undefined;
      if (!level) err(`${p}.level`, `unbekannte Ebene "${String(pl.level)}"`);
      if (!isVec(pl.position, 3)) err(`${p}.position`, 'erwartet [x, y, z]');
      else {
        const [x, y, z] = pl.position;
        if (zone && (Math.abs(x) > zone.size[0] / 2 || Math.abs(z) > zone.size[1] / 2)) {
          err(`${p}.position`, 'liegt außerhalb der Zone');
        }
        if (level && (y < level.elevation || y > level.elevation + level.height)) {
          err(`${p}.position`, `Höhe passt nicht zur Ebene ${String(pl.level)}`);
        }
      }
      if (idOk) places.set(pl.id as string, true);
    });
  }

  // Route-Schritte (nur Kamerafokus)
  const stepPlaces = new Set<string>();
  if (!Array.isArray(data.routeSteps)) err('routeSteps', 'muss eine Liste sein');
  else {
    data.routeSteps.forEach((s, i) => {
      const p = `routeSteps[${i}]`;
      if (!isObj(s)) return err(p, 'muss ein Objekt sein');
      uniqueId(`${p}.id`, s.id);
      if (!isText(s.label)) err(`${p}.label`, 'fehlt');
      if (typeof s.placeId !== 'string' || !places.has(s.placeId)) {
        err(`${p}.placeId`, `unbekannter Ort "${String(s.placeId)}"`);
      } else stepPlaces.add(s.placeId);
      if (!isVec(s.focus, 3)) err(`${p}.focus`, 'erwartet [x, y, z]');
    });
  }
  for (const id of places.keys()) {
    if (!stepPlaces.has(id)) err('routeSteps', `Ort "${id}" hat keinen Route-Schritt`);
  }
  for (const id of zones.keys()) {
    const has = Array.isArray(data.places) && data.places.some((pl) => isObj(pl) && pl.zoneId === id);
    if (!has) err('places', `Zone "${id}" hat keinen Ort`);
  }

  return errors.length ? { ok: false, errors } : { ok: true, twin: data as unknown as Twin };
}
