import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildAll } from '../../scripts/build-models.mjs';
import { zoneBoxes } from '../../scripts/zone-specs.mjs';
import { validateTwin } from './validate';

type Box = { name: string; level: string; min: number[]; max: number[] };

const twinRaw = JSON.parse(readFileSync(new URL('../../public/twin.json', import.meta.url), 'utf8'));
const result = validateTwin(twinRaw);
if (!result.ok) throw new Error(result.errors.join('\n'));
const twin = result.twin;
const out = mkdtempSync(join(tmpdir(), 'twin-models-'));
afterAll(() => rmSync(out, { recursive: true, force: true }));

describe('build-models', () => {
  it('schreibt für jede Zone und Variante eine gültige GLB-Datei', async () => {
    const files: string[] = await buildAll(out);
    expect(files).toHaveLength(twin.zones.length * 2);
    for (const zone of twin.zones) {
      for (const v of ['bestand', 'neu'] as const) {
        const buf = readFileSync(join(out, zone.variants[v].file));
        expect(buf.toString('ascii', 0, 4)).toBe('glTF');
        expect(buf.readUInt32LE(4)).toBe(2);
        expect(buf.readUInt32LE(8)).toBe(buf.length);
        expect(buf.length).toBeLessThan(32 * 1024);
        // JSON-Chunk enthält keine externen URIs
        const json = JSON.parse(buf.toString('utf8', 20, 20 + buf.readUInt32LE(12)));
        expect(JSON.stringify(json)).not.toMatch(/"uri"/);
        expect(json.nodes.every((n: any) => ['UG', 'EG', 'OG1'].includes(n.extras?.level))).toBe(true);
      }
    }
  });

  it('Bestand und Neu unterscheiden sich', () => {
    expect(JSON.stringify(zoneBoxes(0, 'bestand'))).not.toBe(JSON.stringify(zoneBoxes(0, 'neu')));
  });

  it('Boxen bleiben in Zone und Ebene, Orte liegen frei', () => {
    const level = new Map(twin.levels.map((l) => [l.id, l]));
    twin.zones.forEach((zone, i) => {
      for (const v of ['bestand', 'neu'] as const) {
        for (const b of zoneBoxes(i, v) as Box[]) {
          const l = level.get(b.level as never)!;
          expect(b.min[1]).toBeGreaterThanOrEqual(l.elevation - 1e-6);
          expect(b.max[1]).toBeLessThanOrEqual(l.elevation + l.height + 1e-6);
          expect(Math.max(-b.min[0], b.max[0])).toBeLessThanOrEqual(zone.size[0] / 2);
          expect(Math.max(-b.min[2], b.max[2])).toBeLessThanOrEqual(zone.size[1] / 2);
          for (const p of twin.places.filter((p) => p.zoneId === zone.id)) {
            const [x, y, z] = p.position;
            const inside =
              x > b.min[0] && x < b.max[0] && y > b.min[1] && y < b.max[1] && z > b.min[2] && z < b.max[2];
            expect(inside, `${p.id} steckt in ${zone.id}/${v}/${b.name}`).toBe(false);
          }
        }
      }
    });
  });
});
