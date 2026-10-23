import { LEVEL_IDS, VARIANT_KEYS, type ModelFile, type Origin, type Twin, type Vec2, type Zone } from './types';

export type ValidationResult = { ok: true; twin: Twin } | { ok: false; errors: string[] };

const ID = /^[a-z0-9][a-z0-9-]*$/;
// Nur relative Pfade auf eigene .glb-Dateien: kein Schema, kein "//", kein "..", kein führendes "/".
const SAFE_GLB = /^(?![a-z][a-z0-9+.-]*:)(?!\/)(?!.*\/\/)(?!.*\.\.)[A-Za-z0-9_\-./]+\.glb$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const isVec = (v: unknown, n: number): v is number[] =>
  Array.isArray(v) && v.length === n && v.every(isNum);

/** Doppelte Fläche (vorzeichenbehaftet) eines Polygons */
const area2 = (pts: Vec2[]) =>
  pts.reduce((s, [x, z], i) => {
    const [x2, z2] = pts[(i + 1) % pts.length];
    return s + x * z2 - x2 * z;
  }, 0);

/** Punkt-in-Polygon (Strahlverfahren); Punkte auf der Kante zählen als innen. */
export function insidePolygon([px, pz]: Vec2, pts: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i];
    const [xj, zj] = pts[j];
    const cross = (xj - xi) * (pz - zi) - (zj - zi) * (px - xi);
    const onSeg =
      Math.abs(cross) < 1e-9 && px >= Math.min(xi, xj) - 1e-9 && px <= Math.max(xi, xj) + 1e-9 &&
      pz >= Math.min(zi, zj) - 1e-9 && pz <= Math.max(zi, zj) + 1e-9;
    if (onSeg) return true;
    if (zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Mitte und Größe der Bounding-Box eines Grundrisses */
export function footprintBounds(pts: Vec2[]): { center: Vec2; size: Vec2 } {
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  return { center: [(x0 + x1) / 2, (z0 + z1) / 2], size: [x1 - x0, z1 - z0] };
}

/** Schema 1 (Twin Test Teil A) → Schema 2: Rechteck als Grundriss, Platzhalter ohne Nullpunkt. */
function upgradeV1(d: Obj): Obj {
  const zones = Array.isArray(d.zones)
    ? d.zones.map((z) => {
        if (!isObj(z) || !isVec(z.center, 2) || !isVec(z.size, 2)) return z;
        const [cx, cz] = z.center;
        const [w, t] = [z.size[0] / 2, z.size[1] / 2];
        const { center: _c, size: _s, ...rest } = z;
        return { ...rest, footprint: [[cx - w, cz - t], [cx + w, cz - t], [cx + w, cz + t], [cx - w, cz + t]] };
      })
    : d.zones;
  return { ...d, schema: 2, placeholder: true, origin: null, zones };
}

/** Prüft unbekannte Daten (Schema 1 oder 2) und liefert entweder einen typisierten Twin oder alle Fehler. */
export function validateTwin(input: unknown): ValidationResult {
  const errors: string[] = [];
  const err = (path: string, msg: string) => errors.push(`${path}: ${msg}`);

  if (!isObj(input)) return { ok: false, errors: ['twin: muss ein Objekt sein'] };
  if (input.schema !== 1 && input.schema !== 2) return { ok: false, errors: ['schema: unbekannte Version (erwartet 1 oder 2)'] };
  const data = input.schema === 1 ? upgradeV1(input) : input;

  if (!isText(data.title)) err('title', 'fehlt');

  // Platzhalter und Nullpunkt
  const placeholder = data.placeholder;
  if (typeof placeholder !== 'boolean') err('placeholder', 'muss true oder false sein');
  let origin: Origin | null = null;
  const georef = data.georeferenced;
  if (georef !== undefined && typeof georef !== 'boolean') err('georeferenced', 'muss true oder false sein');
  if (data.origin === null) {
    if (placeholder === false && georef !== false) err('origin', 'echte Daten brauchen einen Nullpunkt (oder georeferenced: false)');
  } else if (!isObj(data.origin)) err('origin', 'muss ein Objekt oder null sein');
  else {
    const o = data.origin;
    if (placeholder === true) err('origin', 'das Platzhalterpaket darf keinen echten Nullpunkt haben');
    if (georef === false) err('origin', 'georeferenced: false verträgt keinen Nullpunkt');
    if (!Number.isInteger(o.epsg) || (o.epsg as number) <= 0) err('origin.epsg', 'muss ein EPSG-Code sein');
    for (const k of ['e', 'n', 'h'] as const) if (!isNum(o[k])) err(`origin.${k}`, 'muss eine Zahl sein');
    if (!errors.some((e) => e.startsWith('origin'))) origin = { epsg: o.epsg as number, e: o.e as number, n: o.n as number, h: o.h as number };
  }
  // Echte Daten: jede Masse braucht eine Herkunft.
  const needSource = placeholder === false;

  const modelFile = (path: string, v: unknown): ModelFile | null => {
    if (!isObj(v)) {
      err(path, 'fehlt');
      return null;
    }
    if (typeof v.file !== 'string' || !SAFE_GLB.test(v.file)) {
      err(`${path}.file`, 'muss ein relativer .glb-Pfad ohne externe Adresse sein');
    }
    if (v.source === undefined) {
      if (needSource) err(`${path}.source`, 'fehlt (echte Daten brauchen eine Herkunft)');
    } else if (!isObj(v.source)) err(`${path}.source`, 'muss ein Objekt sein');
    else {
      const s = v.source;
      if (!isText(s.file)) err(`${path}.source.file`, 'fehlt');
      if (typeof s.date !== 'string' || !DATE.test(s.date)) err(`${path}.source.date`, 'erwartet YYYY-MM-DD');
      if (!Number.isInteger(s.triangles) || (s.triangles as number) < 0) err(`${path}.source.triangles`, 'muss eine ganze Zahl ≥ 0 sein');
      if (s.texture !== undefined && (!Number.isInteger(s.texture) || (s.texture as number) <= 0)) {
        err(`${path}.source.texture`, 'muss eine ganze Zahl > 0 sein');
      }
    }
    return v as unknown as ModelFile;
  };

  const terrain = data.terrain === undefined ? undefined : modelFile('terrain', data.terrain);

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
  const zones = new Map<string, Zone>();
  const zoneList: Zone[] = [];
  if (!Array.isArray(data.zones) || data.zones.length === 0) err('zones', 'mindestens eine Zone nötig');
  else {
    data.zones.forEach((z, i) => {
      const p = `zones[${i}]`;
      if (!isObj(z)) return err(p, 'muss ein Objekt sein');
      const idOk = uniqueId(`${p}.id`, z.id);
      if (!isText(z.label)) err(`${p}.label`, 'fehlt');
      if (z.short !== undefined && (!isText(z.short) || z.short.length > 14)) err(`${p}.short`, 'höchstens 14 Zeichen');
      if (z.base !== undefined && !isNum(z.base)) err(`${p}.base`, 'muss eine Zahl sein');
      if ('center' in z || 'size' in z) err(p, 'center/size werden aus footprint berechnet – nicht angeben');
      const fp = z.footprint;
      const fpOk = Array.isArray(fp) && fp.length >= 3 && fp.every((pt) => isVec(pt, 2));
      if (!fpOk) err(`${p}.footprint`, 'erwartet mindestens drei Punkte [x, z]');
      else if (Math.abs(area2(fp as Vec2[])) < 1e-6) err(`${p}.footprint`, 'hat keine Fläche');
      let bestand: ModelFile | null = null;
      let neu: ModelFile | null = null;
      if (!isObj(z.variants)) err(`${p}.variants`, 'fehlt');
      else {
        const variant = (key: string, v: unknown) => {
          const vp = `${p}.variants.${key}`;
          const mf = modelFile(vp, v);
          if (mf && isObj(v)) {
            if (!isText(v.label)) err(`${vp}.label`, 'fehlt');
            if (v.terrainPatch !== undefined) modelFile(`${vp}.terrainPatch`, v.terrainPatch);
            if (v.detail !== undefined) modelFile(`${vp}.detail`, v.detail);
          }
          return mf;
        };
        bestand = variant('bestand', z.variants.bestand);
        if (z.variants.neu !== undefined) neu = variant('neu', z.variants.neu);
        for (const key of Object.keys(z.variants)) {
          if (!(VARIANT_KEYS as readonly string[]).includes(key)) err(`${p}.variants.${key}`, 'unbekannte Variante');
        }
      }
      if (idOk && fpOk && bestand) {
        const footprint = (fp as number[][]).map(([x, zz]) => [x, zz] as Vec2);
        const zone = { ...(z as object), footprint, ...footprintBounds(footprint) } as Zone;
        if (!neu) delete zone.variants.neu;
        zones.set(zone.id, zone);
        zoneList.push(zone);
      }
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
        if (zone && !insidePolygon([zone.center[0] + x, zone.center[1] + z], zone.footprint)) {
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

  if (errors.length) return { ok: false, errors };
  const twin = {
    ...(data as object),
    schema: 2,
    placeholder: placeholder as boolean,
    origin,
    zones: zoneList,
  } as Twin;
  if (terrain) twin.terrain = terrain;
  return { ok: true, twin };
}
