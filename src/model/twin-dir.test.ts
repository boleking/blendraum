import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { twinDir } from '../../vite.config';

const root = mkdtempSync(join(tmpdir(), 'twin-dir-'));
mkdirSync(join(root, 'data', 'paket'), { recursive: true });
writeFileSync(join(root, 'data', 'paket', 'twin.json'), '{}');
mkdirSync(join(root, 'data', 'leer'), { recursive: true });
mkdirSync(join(root, 'anderswo'), { recursive: true });
writeFileSync(join(root, 'anderswo', 'twin.json'), '{}');
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('VITE_TWIN (Datenpfad)', () => {
  it('ohne Variable: Platzhalterpaket in public/', () => {
    expect(twinDir(undefined, root)).toBe(join(root, 'public'));
    expect(twinDir('', root)).toBe(join(root, 'public'));
  });

  it('Ordner unter data/ wird verwendet', () => {
    expect(twinDir('data/paket', root)).toBe(join(root, 'data', 'paket'));
  });

  it.each(['anderswo', 'data', 'data/../anderswo', '../x', 'public'])('lehnt Pfad außerhalb von data/ ab: %s', (p) => {
    expect(() => twinDir(p, root)).toThrow(/unter data\//);
  });

  it('lehnt absoluten Pfad außerhalb von data/ ab', () => {
    expect(() => twinDir(join(root, 'anderswo'), root)).toThrow(/unter data\//);
  });

  it('verlangt twin.json im Paket', () => {
    expect(() => twinDir('data/leer', root)).toThrow(/twin\.json fehlt/);
  });
});
