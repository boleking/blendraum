// Messlauf: lädt einen Build mit #messen, optional mit gedrosseltem Netz, und schreibt die Messergebnisse.
// Voraussetzung: ein Build (npm run build oder VITE_TWIN=… vite build --outDir …).
//
//   node scripts/measure.mjs [--dist dist] [--out <ordner>] [--netz fast4g|aus]
//                            [--ansicht mobil,desktop] [--gpu] [--bild]
//
// --out    Zielordner für messung-<ansicht>.json (+ .png mit --bild). Ohne: nur Ausgabe in der Konsole.
//          Messwerte und Bilder echter Pakete gehören ins private Daten-Repo, nie in dieses Repo.
// --netz   fast4g (Standard): 9 Mbit/s down, 1,5 Mbit/s up, 165 ms Latenz, ohne Cache –
//          wie das DevTools-Profil „Fast 4G“. Ergebnis ist SIMULIERT.
// --gpu    ohne SwiftShader-Schalter (für einen lokalen Browser mit echter GPU, CHROMIUM_PATH).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';

const { values: opt } = parseArgs({
  options: {
    dist: { type: 'string', default: 'dist' },
    out: { type: 'string' },
    netz: { type: 'string', default: 'fast4g' },
    ansicht: { type: 'string', default: 'mobil,desktop' },
    gpu: { type: 'boolean', default: false },
    bild: { type: 'boolean', default: false },
    port: { type: 'string', default: '4180' },
  },
});

export const NETZ = {
  fast4g: { latency: 165, downloadThroughput: (9e6 * 0.9) / 8, uploadThroughput: (1.5e6 * 0.9) / 8 },
  aus: null,
};
const VIEWPORTS = {
  mobil: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
};

if (!(opt.netz in NETZ)) throw new Error(`--netz: erlaubt ${Object.keys(NETZ).join(', ')}`);
const views = opt.ansicht.split(',').map((v) => v.trim());
for (const v of views) if (!VIEWPORTS[v]) throw new Error(`--ansicht: unbekannt "${v}"`);
const dist = resolve(opt.dist);
if (!existsSync(join(dist, 'index.html'))) throw new Error(`${dist}/index.html fehlt – zuerst bauen`);

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  const dir = existsSync(root) ? readdirSync(root).find((d) => /^chromium-\d+$/.test(d)) : undefined;
  const candidates = dir ? [join(root, dir, 'chrome-linux64/chrome'), join(root, dir, 'chrome-linux/chrome')] : [];
  return candidates.find(existsSync);
}

const ORIGIN = `http://127.0.0.1:${opt.port}`;
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--outDir', dist, '--host', '127.0.0.1', '--port', opt.port, '--strictPort'],
  { stdio: 'ignore' },
);
for (let i = 0; ; i++) {
  try {
    if ((await fetch(ORIGIN)).ok) break;
  } catch {}
  if (i > 100) throw new Error('vite preview startet nicht');
  await new Promise((r) => setTimeout(r, 200));
}

const args = ['--disable-background-networking', '--disable-component-update', '--no-first-run'];
if (!opt.gpu) args.push('--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist');
const browser = await chromium.launch({ executablePath: findChromium(), args });

const fmt = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d).replace('.', ',') : '–');
const foreign = [];
let failed = false;

try {
  if (opt.out) mkdirSync(opt.out, { recursive: true });
  for (const name of views) {
    const ctx = await browser.newContext(VIEWPORTS[name]);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('request', (r) => {
      const u = r.url();
      if (!u.startsWith(ORIGIN) && !u.startsWith('data:') && !u.startsWith('blob:')) foreign.push(u);
    });
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    if (NETZ[opt.netz]) await cdp.send('Network.emulateNetworkConditions', { offline: false, ...NETZ[opt.netz] });

    await page.goto(`${ORIGIN}/#messen`);
    await page.waitForFunction(() => Number.isFinite(window.twinMessung?.erstesBild().ms), null, { timeout: 180000 });
    const res = await page.evaluate(() => window.twinMessung.fahrt());
    res.netz = opt.netz === 'aus' ? 'ungedrosselt' : `${opt.netz} (simuliert)`;
    res.grafik = opt.gpu ? 'GPU' : 'SwiftShader (Software, nicht repräsentativ für Bildrate)';
    res.ansicht = name;
    res.fehler = errors;

    console.log(`\n## ${name} · Netz ${res.netz} · ${res.grafik}`);
    console.log(`Erstes Bild ${fmt(res.erstesBildMs / 1000, 2)} s (${res.bewertung.erstesBild}) · erster Download ${fmt(res.ersterDownloadMB, 2)} MB (${res.bewertung.ersterDownload})`);
    console.log(`Start: ${res.start.drawCalls} Draw Calls, ${res.start.triangles} Dreiecke, ${res.start.textures} Texturen`);
    for (const s of res.fahrt) {
      console.log(`${s.name}: ${fmt(s.ms / 1000, 2)} s, +${fmt(s.transferredMB, 2)} MB, ${fmt(s.frames.fpsMedian, 0)} fps (p95 ${fmt(s.frames.p95Ms, 0)} ms, ${s.frames.frames} Bilder), ${s.drawCalls} Draw Calls`);
    }
    if (res.dauerlauf) console.log(`Dauerlauf: ${fmt(res.dauerlauf.fpsMedian, 0)} fps (p95 ${fmt(res.dauerlauf.p95Ms, 0)} ms)`);
    console.log(`Bewertung: ${Object.entries(res.bewertung).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    if (errors.length) {
      failed = true;
      console.log(`Fehler: ${errors.join(' | ')}`);
    }

    if (opt.out) {
      writeFileSync(join(opt.out, `messung-${name}.json`), JSON.stringify(res, null, 2) + '\n');
      if (opt.bild) await page.screenshot({ path: join(opt.out, `messung-${name}.png`) });
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  server.kill();
}

console.log(`\nFremde Requests: ${foreign.length}${foreign.length ? ' – ' + foreign.join(', ') : ''}`);
if (foreign.length || failed) process.exitCode = 1;
