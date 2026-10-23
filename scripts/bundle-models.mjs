// Packt alle GLBs eines Builds als Base64 in <build>/models.json und entfernt den models-Ordner.
// Für Hosts, die keine .glb-Dateien ausliefern. Aufruf: node scripts/bundle-models.mjs <build-ordner>
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dir = resolve(process.argv[2] ?? 'dist-bundle');
const twin = JSON.parse(readFileSync(join(dir, 'twin.json'), 'utf8'));
const bundle = {};
for (const zone of twin.zones) {
  for (const v of Object.values(zone.variants)) bundle[v.file] = readFileSync(join(dir, v.file)).toString('base64');
}
writeFileSync(join(dir, 'models.json'), JSON.stringify(bundle));
rmSync(join(dir, 'models'), { recursive: true, force: true });
console.log(`${Object.keys(bundle).length} Modelle in ${join(dir, 'models.json')}`);
