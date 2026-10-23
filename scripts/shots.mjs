// Screenshots aller Zoomstufen in Bestand und Neu, mobil und Desktop, plus Netzwerkprotokoll.
// Voraussetzung: `npm run build`. Startet selbst `vite preview` auf 127.0.0.1:4173.
// Chromium: PLAYWRIGHT_BROWSERS_PATH oder CHROMIUM_PATH.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const OUT = 'docs/shots';
const PORT = 4173;
const ORIGIN = `http://127.0.0.1:${PORT}`;

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  const dir = readdirSync(root).find((d) => /^chromium-\d+$/.test(d));
  const candidates = dir ? [join(root, dir, 'chrome-linux64/chrome'), join(root, dir, 'chrome-linux/chrome')] : [];
  return candidates.find(existsSync);
}

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
});
for (let i = 0; ; i++) {
  try {
    if ((await fetch(ORIGIN)).ok) break;
  } catch {}
  if (i > 100) throw new Error('vite preview startet nicht');
  await new Promise((r) => setTimeout(r, 200));
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: findChromium(),
  // Software-WebGL; Hintergrunddienste des Browsers aus, damit nur die Seite selbst Requests macht.
  args: [
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--disable-background-networking',
    '--disable-component-update',
    '--no-first-run',
  ],
});

const VIEWPORTS = [
  { name: 'mobil', width: 390, height: 844, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
  { name: 'desktop', width: 1440, height: 900, deviceScaleFactor: 1 },
];
const STAGES = ['resort', 'zone', 'ort', 'schritt'];
const requests = [];
const consoleErrors = [];
const checks = [];

try {
  for (const vp of VIEWPORTS) {
    const { name, ...opts } = vp;
    const ctx = await browser.newContext({ viewport: { width: opts.width, height: opts.height }, ...opts });
    const page = await ctx.newPage();
    page.on('request', (r) => requests.push(`${name}\t${r.method()}\t${r.url()}`));
    page.on('console', (m) => m.type() === 'error' && consoleErrors.push(`${name}: ${m.text()}`));
    page.on('pageerror', (e) => consoleErrors.push(`${name}: ${e.message}`));
    await page.goto(`${ORIGIN}/`);
    await page.waitForSelector('#notice[hidden]', { state: 'attached', timeout: 30000 });
    const idle = () => page.waitForFunction(() => document.body.dataset.busy === 'false', null, { timeout: 30000 });

    // Zone B wählen, damit Zone/Ort/Schritt nicht immer die Ecke zeigen
    for (const variant of ['bestand', 'neu']) {
      await page.click('[data-stage="resort"]');
      await idle();
      await page.click(`[data-variant="${variant}"]`); // im Resort: alle Zonen
      await idle();
      await page.waitForTimeout(600); // Wachs-Animation der Varianten
      for (const stage of STAGES) {
        await page.click(`[data-stage="${stage}"]`);
        if (stage === 'zone') await page.click('#zones button:nth-child(2)');
        await idle();
        await page.waitForTimeout(150);
        const file = join(OUT, `${name}-${STAGES.indexOf(stage) + 1}-${stage}-${variant}.png`);
        await page.screenshot({ path: file });
        console.log(file);
      }
    }
    await ctx.close();
  }

  // Bedienung ohne Klicks: Tastatur, Wischen (Zeigerereignisse), Mausrad, reduzierte Bewegung
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  page.on('request', (r) => requests.push(`interaktion\t${r.method()}\t${r.url()}`));
  await page.goto(`${ORIGIN}/`);
  await page.waitForSelector('#notice[hidden]', { state: 'attached', timeout: 30000 });
  const where = () => page.textContent('#where');
  const check = async (name, fn, expected) => {
    await fn();
    // Ohne Bewegung muss die Szene sofort ruhen; eine Kamerafahrt dauert mindestens 1,3 s.
    await page.waitForFunction(() => document.body.dataset.busy === 'false', null, { timeout: 800 }).catch(() => {});
    const got = await where();
    const busy = await page.evaluate(() => document.body.dataset.busy);
    const ok = got === expected && busy === 'false';
    checks.push(`${ok ? 'OK ' : 'FEHLER'}\t${name}\t→ "${got}" (busy=${busy})`);
  };
  await check('Taste ↑ zoomt hinein', () => page.keyboard.press('ArrowUp'), 'Zone A');
  await check('Taste → nächste Zone', () => page.keyboard.press('ArrowRight'), 'Zone B');
  await check('Taste 3 springt zu Ort', () => page.keyboard.press('3'), 'Zone B · Ort B1');
  await check('Wischen nach links: nächster Ort', async () => {
    await page.mouse.move(900, 400);
    await page.mouse.down();
    await page.mouse.move(700, 410, { steps: 5 });
    await page.mouse.up();
  }, 'Zone B · Ort B2');
  await check('Mausrad hinein: Route-Schritt', () => page.mouse.wheel(0, -120), 'Ort B2 · Schritt B2.1 (3/3)');
  await check('Taste Escape zoomt hinaus', () => page.keyboard.press('Escape'), 'Zone B · Ort B2');
  await check('Taste N: Zone B auf Neu', () => page.keyboard.press('n'), 'Zone B · Ort B2');
  const pressed = await page.getAttribute('[data-variant="neu"]', 'aria-pressed');
  checks.push(`${pressed === 'true' ? 'OK ' : 'FEHLER'}\tSchalter zeigt Neu (aria-pressed=${pressed})`);
  await ctx.close();
} finally {
  await browser.close();
  server.kill();
}

const foreign = requests.filter((r) => !r.split('\t')[2].startsWith(ORIGIN) && !r.split('\t')[2].startsWith('data:'));
writeFileSync(
  join(OUT, 'network.txt'),
  [
    `# Requests beim Laden und Bedienen (${new Date().toISOString()})`,
    `# fremde Ursprünge: ${foreign.length}`,
    ...requests,
    '',
    `# Konsolenfehler: ${consoleErrors.length}`,
    ...consoleErrors,
    '',
    '# Bedienprüfung (prefers-reduced-motion: reduce, daher ohne Wartezeit)',
    ...checks,
    '',
  ].join('\n'),
);
console.log(`Requests: ${requests.length}, fremd: ${foreign.length}, Konsolenfehler: ${consoleErrors.length}`);
console.log(checks.join('\n'));
if (foreign.length || consoleErrors.length || checks.some((c) => c.startsWith('FEHLER'))) process.exitCode = 1;
