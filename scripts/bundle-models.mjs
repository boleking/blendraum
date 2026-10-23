// Packt alle GLBs eines Builds als Base64 in <build>/models.json und entfernt den models-Ordner.
// Für Hosts, die keine .glb-Dateien ausliefern.
// Aufruf: node scripts/bundle-models.mjs <build-ordner> [--ohne-gelaende]
// --ohne-gelaende: Gelände nicht einpacken (der Viewer zeigt es ohnehin nur mit ?gelaende).
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dir = resolve(process.argv[2] ?? 'dist-bundle');
const withTerrain = !process.argv.includes('--ohne-gelaende');
const twin = JSON.parse(readFileSync(join(dir, 'twin.json'), 'utf8'));
// Gelände, Varianten, Geländeteile und Detailfassungen – wie modelFiles() in src/model/types.ts
const files = new Set();
if (twin.terrain && withTerrain) files.add(twin.terrain.file);
for (const zone of twin.zones) {
  for (const v of Object.values(zone.variants)) {
    files.add(v.file);
    if (v.terrainPatch) files.add(v.terrainPatch.file);
    if (v.detail) files.add(v.detail.file);
  }
}
const bundle = {};
for (const file of files) bundle[file] = readFileSync(join(dir, file)).toString('base64');
writeFileSync(join(dir, 'models.json'), JSON.stringify(bundle));
rmSync(join(dir, 'models'), { recursive: true, force: true });
console.log(`${Object.keys(bundle).length} Modelle in ${join(dir, 'models.json')}`);
