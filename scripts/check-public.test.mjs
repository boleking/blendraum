import { describe, expect, it } from 'vitest';
import { findViolations, parseMarkers } from './check-public.mjs';

const okTwin = JSON.stringify({ schema: 2, placeholder: true, origin: null });
const GITIGNORE = 'node_modules/\ndata/\n.real-data-markers\n';

/** Repo-Zustand als Objekt: Pfad → Text */
function check(files, { gitignore = GITIGNORE, markers = [] } = {}) {
  const all = { 'public/twin.json': okTwin, ...files };
  return findViolations({
    tracked: Object.keys(all),
    readText: (f) => (f in all ? all[f] : null),
    gitignore,
    markers,
  });
}

describe('check-public', () => {
  it('lässt ein sauberes Platzhalter-Repo durch', () => {
    expect(check({ 'src/main.ts': 'const a = 1;', 'docs/shots/a.png': '' })).toEqual([]);
  });

  it('meldet Dateien unter data/', () => {
    expect(check({ 'data/paket/twin.json': '{}' }).join('\n')).toMatch(/unter data\//);
  });

  it.each(['models/a.glb', 'scan/x.obj', 'gelaende.tif', 'szene.c4d', 'raum.spz', 'wolke.laz'])(
    'meldet 3D-/Geodaten: %s',
    (f) => expect(check({ [f]: '' }).join('\n')).toMatch(/3D-\/Geodaten/),
  );

  it('verlangt data/ und die Marker-Datei in .gitignore', () => {
    const v = check({}, { gitignore: 'node_modules/\n' }).join('\n');
    expect(v).toMatch(/data\/ fehlt/);
    expect(v).toMatch(/\.real-data-markers fehlt/);
  });

  it('meldet eine eingecheckte Marker-Datei', () =>
    expect(check({ '.real-data-markers': 'x' }).join('\n')).toMatch(/Marker-Datei darf nicht/));

  it('verlangt das Platzhalterpaket in public/twin.json', () => {
    expect(check({ 'public/twin.json': JSON.stringify({ placeholder: false, origin: null }) }).join('\n')).toMatch(/placeholder: true/);
    expect(
      check({ 'public/twin.json': JSON.stringify({ placeholder: true, origin: { epsg: 1, e: 1, n: 1, h: 1 } }) }).join('\n'),
    ).toMatch(/keinen Nullpunkt/);
    expect(check({ 'public/twin.json': '{kaputt' }).join('\n')).toMatch(/kein gültiges JSON/);
  });

  it('findet Marker ohne Rücksicht auf Groß-/Kleinschreibung, mit Datei und Zeile', () => {
    const v = check({ 'docs/notiz.md': 'Zeile eins\nHier steht GEHEIMORT drin\n' }, { markers: ['geheimort'] });
    expect(v).toEqual(['docs/notiz.md:2: enthält Marker „geheimort“']);
  });

  it('überspringt Binärdateien und package-lock.json bei der Markersuche', () => {
    const v = check({ 'docs/shots/a.png': 'geheimort', 'package-lock.json': 'geheimort' }, { markers: ['geheimort'] });
    expect(v).toEqual([]);
  });

  it('liest Marker zeilenweise, ohne Kommentare und zu kurze Begriffe', () => {
    expect(parseMarkers('# Kommentar\n\ngeheimort\r\n  123456  \nab\n')).toEqual(['geheimort', '123456']);
  });
});
