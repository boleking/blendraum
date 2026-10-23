// Messanzeige: wird nur mit #messen in der Adresse geladen (eigener Chunk).
// Misst erstes Bild, übertragene Daten, Bildrate in Kamerafahrten und im Dauerlauf, Draw Calls, Dreiecke.

import { BUDGET, de, judgeFps, judgeMax, mb, summarizeFrames, type FrameSummary, type Verdict } from './view/perf';
import type { Viewer } from './view/viewer';

export interface MessHost {
  viewer: Viewer;
  title: string;
  /** Schritte der Messfahrt, z. B. Resort → Zone → Ort → zurück */
  steps: { name: string; run: () => void }[];
  isBusy: () => boolean;
}

interface StepResult {
  name: string;
  /** vom Auslösen bis die Szene ruht (Fahrt + Nachladen) */
  ms: number;
  transferredMB: number;
  frames: FrameSummary;
  drawCalls: number;
  triangles: number;
}

export interface MessErgebnis {
  zeitpunkt: string;
  titel: string;
  geraet: { userAgent: string; viewport: string; pixelRatio: number; renderer: string };
  erstesBildMs: number;
  ersterDownloadMB: number;
  start: { drawCalls: number; triangles: number; geometries: number; textures: number };
  fahrt: StepResult[];
  dauerlauf: FrameSummary | null;
  bewertung: Record<string, Verdict>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function transferred(): number {
  const nav = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
  const res = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
  return [...nav, ...res].reduce((sum, e) => sum + (e.transferSize || 0), 0);
}

function gpuName(viewer: Viewer): string {
  const gl = viewer.renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
}

export function mountMessung(host: MessHost) {
  performance.setResourceTimingBufferSize(2000);
  const { viewer } = host;
  let intervals: number[] | null = null;
  let last = 0;
  let firstImage = NaN;
  let firstBytes = NaN;
  let waitingFirst = false;
  let result: MessErgebnis | null = null;

  viewer.onFrame = (now) => {
    if (intervals && last) intervals.push(now - last);
    last = now;
    if (waitingFirst) {
      waitingFirst = false;
      firstImage = performance.now();
      firstBytes = transferred();
      render();
    }
  };

  // Anzeige
  // Einklappbar, damit die Anzeige auf dem Handy die Szene nicht dauerhaft verdeckt.
  const box = document.createElement('details');
  box.className = 'messen';
  box.open = true;
  box.innerHTML = `
    <summary>Messung</summary>
    <dl id="mess-werte"></dl>
    <div class="messen-knopf">
      <button type="button" id="mess-start">Messfahrt starten</button>
      <button type="button" id="mess-kopieren" disabled>Ergebnis kopieren</button>
    </div>
    <p id="mess-status" role="status"></p>`;
  document.body.append(box);
  const status = box.querySelector<HTMLParagraphElement>('#mess-status')!;
  const startBtn = box.querySelector<HTMLButtonElement>('#mess-start')!;
  const copyBtn = box.querySelector<HTMLButtonElement>('#mess-kopieren')!;

  const row = (k: string, v: string, verdict?: Verdict) =>
    `<div><dt>${k}</dt><dd${verdict ? ` data-urteil="${verdict}"` : ''}>${v}${verdict ? ` · ${verdict}` : ''}</dd></div>`;

  function render() {
    const s = viewer.stats();
    const rows = [
      row('Erstes Bild', `${de(firstImage / 1000, 2)} s`, Number.isFinite(firstImage) ? judgeMax(firstImage, BUDGET.firstImageMs) : undefined),
      row('Erster Download', `${de(mb(firstBytes), 2)} MB`, Number.isFinite(firstBytes) ? judgeMax(mb(firstBytes), BUDGET.initialMB) : undefined),
      row('Draw Calls', String(s.drawCalls), judgeMax(s.drawCalls, BUDGET.drawCalls)),
      row('Dreiecke', s.triangles.toLocaleString('de-AT')),
    ];
    if (result) {
      for (const st of result.fahrt) {
        rows.push(row(st.name, `${de(st.frames.fpsMedian, 0)} fps · p95 ${de(st.frames.p95Ms, 0)} ms · +${de(st.transferredMB, 2)} MB`, judgeFps(st.frames.fpsMedian, st.frames.frames)));
      }
      if (result.dauerlauf) rows.push(row('Dauerlauf 5 s', `${de(result.dauerlauf.fpsMedian, 0)} fps · p95 ${de(result.dauerlauf.p95Ms, 0)} ms`, judgeFps(result.dauerlauf.fpsMedian, result.dauerlauf.frames)));
    }
    box.querySelector('#mess-werte')!.innerHTML = rows.join('');
  }

  async function idle(timeout = 120000) {
    const t0 = performance.now();
    await sleep(60);
    while (host.isBusy()) {
      if (performance.now() - t0 > timeout) throw new Error('Szene kommt nicht zur Ruhe');
      await sleep(50);
    }
  }

  async function fahrt(): Promise<MessErgebnis> {
    startBtn.disabled = true;
    copyBtn.disabled = true;
    try {
      await idle();
      const s0 = viewer.stats();
      const steps: StepResult[] = [];
      const fahrtIntervals: number[] = [];
      for (const step of host.steps) {
        status.textContent = `Messe: ${step.name} …`;
        const bytes0 = transferred();
        const t0 = performance.now();
        intervals = [];
        last = 0;
        step.run();
        await idle();
        const s = viewer.stats();
        steps.push({
          name: step.name,
          ms: performance.now() - t0,
          transferredMB: mb(transferred() - bytes0),
          frames: summarizeFrames(intervals),
          drawCalls: s.drawCalls,
          triangles: s.triangles,
        });
        fahrtIntervals.push(...intervals);
        intervals = null;
      }
      status.textContent = 'Messe: Dauerlauf 5 s …';
      intervals = [];
      last = 0;
      viewer.continuous = true;
      viewer.requestFrame();
      await sleep(5000);
      viewer.continuous = false;
      const dauer = summarizeFrames(intervals);
      intervals = null;

      const zoneSteps = steps.slice(1);
      result = {
        zeitpunkt: new Date().toISOString(),
        titel: host.title,
        geraet: {
          userAgent: navigator.userAgent,
          viewport: `${innerWidth}×${innerHeight}`,
          pixelRatio: s0.pixelRatio,
          renderer: gpuName(viewer),
        },
        erstesBildMs: firstImage,
        ersterDownloadMB: mb(firstBytes),
        start: { drawCalls: s0.drawCalls, triangles: s0.triangles, geometries: s0.geometries, textures: s0.textures },
        fahrt: steps,
        dauerlauf: dauer,
        bewertung: {
          erstesBild: judgeMax(firstImage, BUDGET.firstImageMs),
          ersterDownload: judgeMax(mb(firstBytes), BUDGET.initialMB),
          zoneNachladen: judgeMax(Math.max(0, ...zoneSteps.map((s) => s.transferredMB)), BUDGET.zoneMB),
          drawCalls: judgeMax(Math.max(s0.drawCalls, ...steps.map((s) => s.drawCalls)), BUDGET.drawCalls),
          // Alle Fahrten zusammen, damit kurze Fahrten genug Bilder ergeben
          bildrateFahrt: (() => {
            const all = summarizeFrames(fahrtIntervals);
            return judgeFps(all.fpsMedian, all.frames);
          })(),
          bildrateDauer: judgeFps(dauer.fpsMedian, dauer.frames),
        },
      };
      status.textContent = 'Messfahrt fertig.';
      render();
      return result;
    } catch (e) {
      status.textContent = `Messung abgebrochen: ${(e as Error).message}`;
      throw e;
    } finally {
      viewer.continuous = false;
      intervals = null;
      startBtn.disabled = false;
      copyBtn.disabled = !result;
    }
  }

  startBtn.addEventListener('click', () => void fahrt().catch(() => {}));
  copyBtn.addEventListener('click', async () => {
    const text = JSON.stringify(result, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = 'Ergebnis kopiert.';
    } catch {
      status.textContent = 'Kopieren nicht erlaubt – Ergebnis steht in der Konsole.';
      console.log(text);
    }
  });

  // Für das Messskript
  (window as unknown as { twinMessung: unknown }).twinMessung = {
    fahrt,
    ergebnis: () => result,
    erstesBild: () => ({ ms: firstImage, mb: mb(firstBytes) }),
  };

  render();
  return {
    /** Aufrufen, wenn die Startmodelle geladen sind; das nächste Bild gilt als erstes Bild. */
    ready() {
      waitingFirst = true;
      viewer.requestFrame();
    },
  };
}
