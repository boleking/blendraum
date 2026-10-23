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
  const viewer = new Viewer(canvas, twin, base);
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
    b.textContent = z.label.replace(/^Zone\s+/, '');
    b.addEventListener('click', () => go(selectZone(twin, sel.stage === 'resort' ? { ...sel, stage: 'zone' } : sel, z.id)));
    zonesEl.append(b);
    return b;
  });
  const stageButtons = [...panel.querySelectorAll<HTMLButtonElement>('[data-stage]')];
  const variantButtons = [...panel.querySelectorAll<HTMLButtonElement>('[data-variant]')];

  function render() {
    const zone = twin.zones.find((z) => z.id === sel.zoneId)!;
    $('where').textContent = describe(twin, sel);
    for (const b of stageButtons) b.setAttribute('aria-pressed', String(b.dataset.stage === sel.stage));
    twin.zones.forEach((z, i) => {
      chips[i].setAttribute('aria-pressed', String(z.id === sel.zoneId));
      chips[i].dataset.neu = String(variants[z.id] === 'neu');
      chips[i].setAttribute('aria-label', `${z.label}, ${z.variants[variants[z.id]].label}`);
    });
    const all = sel.stage === 'resort';
    $('scope').textContent = all ? 'Alle Zonen' : zone.label;
    const shown = all ? new Set(Object.values(variants)) : new Set([variants[zone.id]]);
    for (const b of variantButtons) b.setAttribute('aria-pressed', String(shown.size === 1 && shown.has(b.dataset.variant as VariantKey)));
    $<HTMLButtonElement>('zoom-in').disabled = sel.stage === 'schritt';
    $<HTMLButtonElement>('zoom-out').disabled = sel.stage === 'resort';
    const what = { resort: 'Zone', zone: 'Zone', ort: 'Ort', schritt: 'Schritt' }[sel.stage];
    $('prev').setAttribute('aria-label', `Vorherige ${what}`);
    $('next').setAttribute('aria-label', `Nächste${what === 'Zone' ? '' : 'r'} ${what}`);
  }

  function announce(text: string) {
    $('live').textContent = text;
  }

  function go(next: Selection) {
    const stageChanged = next.stage !== sel.stage;
    sel = next;
    viewer.select(sel);
    render();
    announce(`${stageChanged ? STAGE_LABELS[sel.stage] + ': ' : ''}${describe(twin, sel)}`);
  }

  function setVariant(v: VariantKey) {
    const targets = sel.stage === 'resort' ? twin.zones : twin.zones.filter((z) => z.id === sel.zoneId);
    for (const z of targets) {
      if (variants[z.id] === v) continue;
      variants[z.id] = v;
      viewer.showVariant(z.id, v).catch(showError);
    }
    render();
    announce(`${sel.stage === 'resort' ? 'Alle Zonen' : twin.zones.find((z) => z.id === sel.zoneId)!.label}: ${v === 'neu' ? 'Neu' : 'Bestand'}`);
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
    if (k === 'ArrowUp' || k === '+' || k === '=') go(zoom(twin, sel, 1));
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
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });
    if (pointers.size === 1) gestureDone = false;
    if (pointers.size === 2) pinch0 = spread();
  });
  canvas.addEventListener('pointermove', (e) => {
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
    const p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (!p || gestureDone || pointers.size > 0 || e.type === 'pointercancel') return;
    const dx = p.x - p.x0;
    const dy = p.y - p.y0;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(cycle(twin, sel, dx < 0 ? 1 : -1));
    else if (Math.abs(dy) > 50 && Math.abs(dy) > Math.abs(dx) * 1.5) go(zoom(twin, sel, dy < 0 ? 1 : -1));
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  // Layout: Szene in den Bereich neben/über der Steuerung zentrieren
  const layout = () => {
    const r = panel.getBoundingClientRect();
    const side = matchMedia('(min-width: 900px)').matches;
    viewer.setInsets(side ? r.right : 0, side ? 0 : window.innerHeight - r.top);
  };
  new ResizeObserver(layout).observe(document.body);

  panel.hidden = false;
  layout();
  render();
  viewer.select(sel);

  // Bestand sofort, Neu danach im Hintergrund
  Promise.all(twin.zones.map((z) => viewer.showVariant(z.id, 'bestand')))
    .then(() => {
      notice.hidden = true;
      announce(`${twin.title} geladen. ${describe(twin, sel)}`);
      for (const z of twin.zones) viewer.prefetch(z.variants.neu.file);
    })
    .catch(showError);
  notice.textContent = 'Lade Modelle …';
}

loadTwin().then(start, showError);
