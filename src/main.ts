import './style.css';
import type { Twin, VariantKey } from './model/types';
import { validateTwin } from './model/validate';
import { STAGE_LABELS, type Stage } from './view/camera-rig';
import { cycle, describe, initialSelection, selectZone, setStage, zoom, type Selection } from './view/nav';
import { Viewer } from './view/viewer';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const base = import.meta.env.BASE_URL;
const notice = $('notice');

async function loadTwin(): Promise<Twin> {
  const res = await fetch(`${base}twin.json`);
  if (!res.ok) throw new Error(`twin.json nicht erreichbar (HTTP ${res.status})`);
  const result = validateTwin(await res.json());
  if (!result.ok) {
    const err = new Error('twin.json ist ungültig');
    (err as Error & { details?: string[] }).details = result.errors;
    throw err;
  }
  return result.twin;
}

/**
 * Vorschau-Build: alle GLBs stecken Base64-kodiert in models.json, weil manche Hosts keine
 * .glb-Dateien ausliefern. Die Pfade aus twin.json bleiben die Schlüssel.
 */
function bundledModels(): (file: string) => Promise<ArrayBuffer> {
  let bundle: Promise<Record<string, string>> | undefined;
  return async (file) => {
    bundle ??= fetch(`${base}models.json`).then((r) => {
      if (!r.ok) throw new Error(`models.json nicht erreichbar (HTTP ${r.status})`);
      return r.json();
    });
    const b64 = (await bundle)[file];
    if (!b64) throw new Error(`Modell fehlt im Bündel: ${file}`);
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
  };
}

function showError(e: unknown) {
  const err = e as Error & { details?: string[] };
  notice.textContent = err.message || 'Unbekannter Fehler';
  if (err.details) {
    const ul = document.createElement('ul');
    for (const d of err.details.slice(0, 8)) ul.append(Object.assign(document.createElement('li'), { textContent: d }));
    notice.append(ul);
  }
  notice.hidden = false;
}

function start(twin: Twin) {
  const canvas = $<HTMLCanvasElement>('view');
  const panel = $('panel');
  // Gelände nur auf Wunsch (?gelaende): ohne steht das Modell frei auf Schwarz und lädt schneller.
  const showTerrain = new URLSearchParams(location.search).has('gelaende');
  const viewer = new Viewer(canvas, twin, base, import.meta.env.VITE_MODEL_BUNDLE ? bundledModels() : undefined, showTerrain);
  viewer.onError = showError;

  // Kopfzeile folgt dem Paket: Platzhalter oder interner Arbeitsstand.
  $('brand-title').textContent = twin.title;
  document.title = twin.title;
  $('brand-sub').textContent = twin.placeholder
    ? 'Platzhalter · keine echten Daten'
    : twin.georeferenced === false
      ? 'Interner Arbeitsstand · Lage nicht georeferenziert · nicht weitergeben'
      : 'Interner Arbeitsstand · nicht weitergeben';
  canvas.setAttribute('aria-label', `3D-Ansicht: ${twin.title}`);
  const hasNeu = (z: Twin['zones'][number]) => !!z.variants.neu;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const syncMotion = () => (viewer.reducedMotion = motion.matches);
  syncMotion();
  motion.addEventListener('change', syncMotion);

  let sel: Selection = initialSelection(twin);
  const variants: Record<string, VariantKey> = Object.fromEntries(twin.zones.map((z) => [z.id, 'bestand']));

  viewer.onBusyChange = (busy) => (document.body.dataset.busy = String(busy));

  // Zonen-Chips
  const zonesEl = $('zones');
  const chips = twin.zones.map((z) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = z.short ?? z.label.replace(/^Zone\s+/, '');
    b.title = z.label;
    b.addEventListener('click', () => go(selectZone(twin, sel.stage === 'resort' ? { ...sel, stage: 'zone' } : sel, z.id)));
    zonesEl.append(b);
    return b;
  });
  const stageButtons = [...panel.querySelectorAll<HTMLButtonElement>('[data-stage]')];
  const variantButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-variant]')];

  function render() {
    const zone = twin.zones.find((z) => z.id === sel.zoneId)!;
    $('where').textContent = describe(twin, sel);
    for (const b of stageButtons) b.setAttribute('aria-pressed', String(b.dataset.stage === sel.stage));
    twin.zones.forEach((z, i) => {
      chips[i].setAttribute('aria-pressed', String(z.id === sel.zoneId));
      chips[i].dataset.neu = String(variants[z.id] === 'neu');
      chips[i].setAttribute('aria-label', `${z.label}, ${z.variants[variants[z.id]]!.label}`);
    });
    const all = sel.stage === 'resort';
    $('scope').textContent = all ? 'Alle Bereiche' : (zone.short ?? zone.label);
    const shown = all ? new Set(Object.values(variants)) : new Set([variants[zone.id]]);
    for (const b of variantButtons) b.setAttribute('aria-pressed', String(shown.size === 1 && shown.has(b.dataset.variant as VariantKey)));
    // Ohne Entwurf gibt es nichts umzuschalten.
    const neuButton = variantButtons.find((b) => b.dataset.variant === 'neu')!;
    neuButton.disabled = all ? !twin.zones.some(hasNeu) : !hasNeu(zone);
    neuButton.title = neuButton.disabled ? 'Für diese Zone gibt es keinen Entwurf' : '';
    $<HTMLButtonElement>('zoom-in').disabled = sel.stage === 'schritt';
    $<HTMLButtonElement>('zoom-out').disabled = sel.stage === 'resort';
    const what = { resort: 'Bereich', zone: 'Bereich', ort: 'Ort', schritt: 'Schritt' }[sel.stage];
    $('prev').setAttribute('aria-label', `Vorheriger ${what}`);
    $('next').setAttribute('aria-label', `Nächster ${what}`);
  }

  function announce(text: string) {
    $('live').textContent = text;
  }

  // Freier Modus (Arbeitsmodus): Orbit statt geführter Fahrt; geführte Gesten pausieren.
  const HINT = $('hint').textContent ?? '';
  const freeBtn = $<HTMLButtonElement>('free');
  function setFree(on: boolean) {
    if (on) {
      // laufende geführte Geste abbrechen, Zeiger-Tabelle leeren
      pointers.clear();
      pinch0 = 0;
      gestureDone = true;
    }
    viewer.setFree(on);
    freeBtn.setAttribute('aria-pressed', String(on));
    document.body.dataset.free = String(on);
    $('hint').textContent = on
      ? 'Frei: Ziehen dreht, rechte Taste/zwei Finger schwenken, Rad/zwei Finger zoomen · F zurück'
      : HINT;
    announce(on ? 'Freie Bewegung an' : 'Freie Bewegung aus, zurück zur geführten Ansicht');
  }
  freeBtn.addEventListener('click', () => setFree(!viewer.free));

  function go(next: Selection) {
    if (viewer.free) setFree(false); // ein geführter Sprung beendet den freien Modus
    const stageChanged = next.stage !== sel.stage;
    sel = next;
    viewer.select(sel);
    render();
    announce(`${stageChanged ? STAGE_LABELS[sel.stage] + ': ' : ''}${describe(twin, sel)}`);
  }

  function setVariant(v: VariantKey) {
    const scope = sel.stage === 'resort' ? twin.zones : twin.zones.filter((z) => z.id === sel.zoneId);
    const targets = scope.filter((z) => z.variants[v]);
    if (targets.length === 0) return;
    for (const z of targets) {
      if (variants[z.id] === v) continue;
      variants[z.id] = v;
      viewer.showVariant(z.id, v).catch(showError);
    }
    render();
    announce(`${sel.stage === 'resort' ? 'Alle Bereiche' : twin.zones.find((z) => z.id === sel.zoneId)!.label}: ${v === 'neu' ? 'Neu' : 'Bestand'}`);
  }

  for (const b of stageButtons) b.addEventListener('click', () => go(setStage(twin, sel, b.dataset.stage as Stage)));
  for (const b of variantButtons) b.addEventListener('click', () => setVariant(b.dataset.variant as VariantKey));
  $('prev').addEventListener('click', () => go(cycle(twin, sel, -1)));
  $('next').addEventListener('click', () => go(cycle(twin, sel, 1)));
  $('zoom-in').addEventListener('click', () => go(zoom(twin, sel, 1)));
  $('zoom-out').addEventListener('click', () => go(zoom(twin, sel, -1)));

  // Tastatur
  window.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const k = e.key;
    let handled = true;
    if (k === 'f' || k === 'F') setFree(!viewer.free);
    else if (viewer.free && k !== 'Escape') handled = false; // im freien Modus gehören die Tasten dem Orbit
    else if (viewer.free && k === 'Escape') setFree(false);
    else if (k === 'ArrowUp' || k === '+' || k === '=') go(zoom(twin, sel, 1));
    else if (k === 'ArrowDown' || k === '-' || k === 'Escape') go(zoom(twin, sel, -1));
    else if (k === 'ArrowLeft') go(cycle(twin, sel, -1));
    else if (k === 'ArrowRight') go(cycle(twin, sel, 1));
    else if (k >= '1' && k <= '4') go(setStage(twin, sel, (['resort', 'zone', 'ort', 'schritt'] as const)[+k - 1]));
    else if (k === 'b' || k === 'B') setVariant('bestand');
    else if (k === 'n' || k === 'N') setVariant('neu');
    else handled = false;
    if (handled) e.preventDefault();
  });

  // Mausrad: Stufenweise, mit Sperre gegen Durchrauschen
  let wheelSum = 0;
  let wheelLock = 0;
  canvas.addEventListener(
    'wheel',
    (e) => {
      if (viewer.free) return; // Orbit zoomt selbst
      e.preventDefault();
      const now = performance.now();
      if (now < wheelLock) return;
      wheelSum += e.deltaY;
      if (Math.abs(wheelSum) > 60) {
        go(zoom(twin, sel, wheelSum < 0 ? 1 : -1));
        wheelSum = 0;
        wheelLock = now + 600;
      }
    },
    { passive: false },
  );

  // Touch: Wischen wechselt, Zwei-Finger-Zoom wechselt die Stufe
  const pointers = new Map<number, { x: number; y: number; x0: number; y0: number }>();
  let pinch0 = 0;
  let gestureDone = false;
  const spread = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (viewer.free) return; // Orbit nimmt die Zeiger
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });
    if (pointers.size === 1) gestureDone = false;
    if (pointers.size === 2) pinch0 = spread();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (viewer.free) return; // Orbit nimmt die Zeiger
    const p = pointers.get(e.pointerId);
    if (!p || gestureDone) return;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pointers.size === 2 && pinch0 > 0) {
      const ratio = spread() / pinch0;
      if (ratio > 1.3 || ratio < 0.75) {
        go(zoom(twin, sel, ratio > 1 ? 1 : -1));
        gestureDone = true;
      }
    }
  });
  const up = (e: PointerEvent) => {
    // Erst austragen, dann prüfen: ein Finger, der im freien Modus losgelassen wird, darf nicht liegen bleiben.
    const p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (viewer.free) return;
    if (!p || gestureDone || pointers.size > 0 || e.type === 'pointercancel') return;
    const dx = p.x - p.x0;
    const dy = p.y - p.y0;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(cycle(twin, sel, dx < 0 ? 1 : -1));
    else if (Math.abs(dy) > 50 && Math.abs(dy) > Math.abs(dx) * 1.5) go(zoom(twin, sel, dy < 0 ? 1 : -1));
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  // Layout: Szene über dem Blatt zentrieren; die Zoom-Leiste sitzt (mobil) knapp darüber.
  const layout = () => {
    const covered = Math.max(0, window.innerHeight - panel.getBoundingClientRect().top);
    document.documentElement.style.setProperty('--sheet-h', `${covered}px`);
    viewer.setInsets(0, covered);
  };
  new ResizeObserver(layout).observe(document.body);
  new ResizeObserver(layout).observe(panel);

  panel.hidden = false;
  $('zoom').hidden = false;
  layout();
  render();
  viewer.select(sel);

  // Messanzeige nur mit #messen; eigener Chunk, sonst nicht geladen.
  const messung = location.hash === '#messen' ? import('./messen').then((m) => m.mountMessung(messHost())) : null;
  function messHost() {
    // Zone mit Detailfassung bevorzugen, sonst die erste – dort zeigt sich das Nachladen.
    const zone = twin.zones.find((z) => z.variants.bestand.detail) ?? twin.zones[0];
    const at = (stage: Stage) => () => go(setStage(twin, selectZone(twin, sel, zone.id), stage));
    return {
      viewer,
      title: twin.title,
      isBusy: () => document.body.dataset.busy === 'true',
      steps: [
        { name: `Fahrt: ${zone.short ?? zone.label}`, run: at('zone') },
        { name: 'Fahrt: Ort', run: at('ort') },
        { name: 'Fahrt: zurück zur Zone', run: at('zone') },
        { name: 'Fahrt: Resort', run: at('resort') },
      ],
    };
  }

  // Bestand sofort, Neu danach im Hintergrund
  Promise.all(twin.zones.map((z) => viewer.showVariant(z.id, 'bestand')))
    .then(() => {
      notice.hidden = true;
      viewer.drapeOnZones();
      void Promise.all([messung, viewer.terrainReady]).then(([m]) => m?.ready());
      announce(`${twin.title} geladen. ${describe(twin, sel)}`);
      for (const z of twin.zones) if (z.variants.neu) viewer.prefetch(z.variants.neu.file);
    })
    .catch(showError);
  notice.textContent = 'Lade Modelle …';
}

loadTwin().then(start, showError);
