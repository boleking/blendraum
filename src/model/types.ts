// Datenmodell des Twins (Schema 2). Das Platzhalterpaket in public/ ist erfunden;
// echte Projektpakete kommen über VITE_TWIN aus data/ und werden nie eingecheckt.

export const LEVEL_IDS = ['UG', 'EG', 'OG1'] as const;
export type LevelId = (typeof LEVEL_IDS)[number];

export const VARIANT_KEYS = ['bestand', 'neu'] as const;
export type VariantKey = (typeof VARIANT_KEYS)[number];

export type Vec3 = [number, number, number];
/** Punkt im Grundriss (x, z) in Web-Metern */
export type Vec2 = [number, number];

/**
 * Projekt-Nullpunkt in UTM. Web-Koordinaten: x = E − e, y = H − h, z = −(N − n).
 * Im Platzhalterpaket `null`: dort gibt es keinen echten Ort.
 */
export interface Origin {
  epsg: number;
  e: number;
  n: number;
  h: number;
}

/** Herkunft einer Datei, damit jede Masse auf eine benannte Quelle zurückgeht. */
export interface Source {
  /** Quelldatei, aus der die Datei erzeugt wurde */
  file: string;
  /** Erzeugt am (YYYY-MM-DD) */
  date: string;
  triangles: number;
  /** Kantenlänge der größten Textur in px, falls vorhanden */
  texture?: number;
}

export interface ModelFile {
  /** GLB-Pfad relativ zum Paket, z. B. "models/zone-a-bestand.glb" */
  file: string;
  source?: Source;
}

export interface Level {
  id: LevelId;
  label: string;
  /** Unterkante in Metern über ±0 */
  elevation: number;
  height: number;
}

export interface Variant extends ModelFile {
  label: string;
  /** Ersetzt beim Umschalten den Geländeteil der Zone (z. B. Baugrube). Wird erst später dargestellt. */
  terrainPatch?: ModelFile;
  /** Dichtere Fassung derselben Variante; wird geladen, sobald man in die Zone zoomt. */
  detail?: ModelFile;
}

export interface Zone {
  id: string;
  label: string;
  /** Kurzname für den Zonen-Knopf (höchstens 14 Zeichen); sonst das Label ohne "Zone " */
  short?: string;
  /** ±0 der Zone in Web-Metern (Standard 0). Ebenen und Orte der Zone beziehen sich darauf – wichtig am Hang. */
  base?: number;
  /** Grundriss als Polygon (x, z), mindestens drei Punkte. Modelldateien der Zone liegen relativ zu `center`. */
  footprint: Vec2[];
  /** Aus dem Grundriss berechnet: Mitte der Bounding-Box (x, z) */
  center: Vec2;
  /** Aus dem Grundriss berechnet: Breite x, Tiefe z der Bounding-Box */
  size: Vec2;
  /** Bestand ist Pflicht, Neu nur, wenn es einen Entwurf gibt */
  variants: { bestand: Variant; neu?: Variant };
}

export interface Place {
  id: string;
  zoneId: string;
  label: string;
  level: LevelId;
  /** Position relativ zum Zonenmittelpunkt */
  position: Vec3;
}

/** Kamerafokus für die Zoomstufe "Route-Schritt". Die Route selbst folgt in Teil B. */
export interface RouteStep {
  id: string;
  placeId: string;
  label: string;
  /** Versatz zum Ort */
  focus: Vec3;
}

export interface Twin {
  schema: 2;
  title: string;
  /** true nur im erfundenen Platzhalterpaket */
  placeholder: boolean;
  origin: Origin | null;
  /** Gelände als eigene GLB, nicht Teil einer Zone */
  terrain?: ModelFile;
  levels: Level[];
  zones: Zone[];
  places: Place[];
  routeSteps: RouteStep[];
}

/** Alle Modelldateien eines Twins (Gelände, Varianten, Geländeteile), ohne Doppelte. */
export function modelFiles(twin: Twin): string[] {
  const files = new Set<string>();
  if (twin.terrain) files.add(twin.terrain.file);
  for (const z of twin.zones) {
    for (const v of [z.variants.bestand, z.variants.neu]) {
      if (!v) continue;
      files.add(v.file);
      if (v.terrainPatch) files.add(v.terrainPatch.file);
      if (v.detail) files.add(v.detail.file);
    }
  }
  return [...files];
}
