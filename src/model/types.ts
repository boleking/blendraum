// Datenmodell des Twins. Alles hier ist Platzhalter: erfundene Zonen, Orte und Maße.

export const LEVEL_IDS = ['UG', 'EG', 'OG1'] as const;
export type LevelId = (typeof LEVEL_IDS)[number];

export const VARIANT_KEYS = ['bestand', 'neu'] as const;
export type VariantKey = (typeof VARIANT_KEYS)[number];

export type Vec3 = [number, number, number];

export interface Level {
  id: LevelId;
  label: string;
  /** Unterkante in Metern über ±0 */
  elevation: number;
  height: number;
}

export interface Variant {
  label: string;
  /** GLB-Pfad relativ zur Seite, z. B. "models/zone-a-bestand.glb" */
  file: string;
}

export interface Zone {
  id: string;
  label: string;
  /** Mittelpunkt im Resort (x, z) */
  center: [number, number];
  /** Grundfläche (Breite x, Tiefe z) */
  size: [number, number];
  variants: Record<VariantKey, Variant>;
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
  schema: 1;
  title: string;
  levels: Level[];
  zones: Zone[];
  places: Place[];
  routeSteps: RouteStep[];
}
