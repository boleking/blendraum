// Prozedurale Platzhalter-Massen je Zone und Variante. Nur Boxen, keine echten Gebäudedaten.
// Koordinaten relativ zum Zonenmittelpunkt in Metern (x, y, z), y nach oben.

export const MATERIALS = {
  sockel: { color: [0.42, 0.4, 0.38, 1], roughness: 0.95 },
  'bestand-wand': { color: [0.78, 0.76, 0.72, 1], roughness: 0.9 },
  'bestand-og': { color: [0.7, 0.68, 0.64, 1], roughness: 0.9 },
  'neu-holz': { color: [0.62, 0.45, 0.3, 1], roughness: 0.8 },
  'neu-hell': { color: [0.9, 0.88, 0.84, 1], roughness: 0.85 },
  glas: { color: [0.55, 0.7, 0.75, 0.45], roughness: 0.1, blend: true },
  wasser: { color: [0.2, 0.48, 0.55, 1], roughness: 0.2 },
};

/** Kleiner deterministischer Zufall, damit jede Zone anders, aber reproduzierbar ist. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const box = (name, level, material, min, max) => ({ name, level, material, min, max });

/**
 * @param {number} zoneIndex 0-basiert
 * @param {'bestand'|'neu'} variant
 */
export function zoneBoxes(zoneIndex, variant) {
  const r = rng(1000 + zoneIndex * 17 + (variant === 'neu' ? 7 : 0));
  // Versätze bleiben auf der Rückseite, damit die Orte vorne frei bleiben.
  const j = (amp) => -r() * amp;
  const sockel = box('sockel', 'UG', 'sockel', [-11, -3.5, -11], [11, 0, 11]);

  if (variant === 'bestand') {
    const split = 2 + j(1);
    return [
      sockel,
      box('eg-haupt', 'EG', 'bestand-wand', [-10, 0, -10], [split, 4, 2 + j(1.5)]),
      box('eg-fluegel', 'EG', 'bestand-wand', [split, 0, -10], [10, 4, -3 + j(1.5)]),
      box('og1', 'OG1', 'bestand-og', [-8, 4, -8], [-1 + j(2), 7.5, 0 + j(2)]),
    ];
  }
  return [
    sockel,
    box('eg-haupt', 'EG', 'neu-holz', [-10, 0, -10], [0, 4, 0]),
    box('eg-fluegel', 'EG', 'neu-holz', [0, 0, -10], [10, 4, -4 + j(1)]),
    box('og1', 'OG1', 'neu-hell', [-10, 4, -10], [6 + j(3), 7.5, -3]),
    box('og1-glas', 'OG1', 'glas', [-10, 4, -3], [-4, 7.5, 0]),
    box('vordach', 'EG', 'neu-hell', [-10, 3.7, 1], [-2 + j(1), 4, 5]),
    box('becken', 'EG', 'wasser', [2, 0, 3], [9, 0.15, 9]),
  ];
}
