import { existsSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// Im Build verbietet eine CSP alle fremden Ursprünge: keine CDNs, Webfonts oder Tracker.
// 'wasm-unsafe-eval' erlaubt nur das Übersetzen von WebAssembly (Meshopt-Decoder im Bundle), kein JS-eval.
const csp: Plugin = {
  name: 'twin-csp',
  apply: 'build',
  transformIndexHtml: () => [
    {
      tag: 'meta',
      attrs: {
        'http-equiv': 'Content-Security-Policy',
        content:
          "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self' data: blob:; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'",
      },
      injectTo: 'head-prepend',
    },
  ],
};

/**
 * Datenpaket: ohne VITE_TWIN das Platzhalterpaket in public/, sonst ein Ordner unter data/
 * (twin.json + models/). data/ ist ignoriert – echte Pakete landen nie im Repo.
 */
export function twinDir(env: string | undefined, root = process.cwd()): string {
  if (!env) return resolve(root, 'public');
  const dataRoot = resolve(root, 'data');
  const dir = resolve(root, env);
  const rel = relative(dataRoot, dir);
  if (!rel || rel.split(sep)[0] === '..' || isAbsolute(rel)) {
    throw new Error(`VITE_TWIN muss auf einen Ordner unter data/ zeigen (ist: ${env})`);
  }
  if (!existsSync(resolve(dir, 'twin.json'))) throw new Error(`VITE_TWIN: ${env}/twin.json fehlt`);
  return dir;
}

export default defineConfig(() => ({
  base: './',
  publicDir: twinDir(process.env.VITE_TWIN),
  plugins: [csp],
  // three.js allein macht ~600 KB aus; Aufteilen lohnt sich erst mit Teil B.
  build: { target: 'es2022', reportCompressedSize: true, chunkSizeWarningLimit: 700 },
  test: { include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'] },
}));
