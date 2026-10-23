import {
  ACESFilmicToneMapping,
  BufferGeometry,
  Color,
  ConeGeometry,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineLoop,
  Mesh,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShadowMaterial,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { Twin, VariantKey } from '../model/types';
import { cameraPosition, easeInOutCubic, mixState, STAGES, type CamState, type Stage } from './camera-rig';
import { kelvinToRgb, WARM_KELVIN } from './light';
import { cameraFor, placeWorld, resortBounds, type Selection } from './nav';

const BACKGROUND = 0x000000;
const ACCENT = 0xc8752e;

interface Tween {
  from: CamState;
  to: CamState;
  start: number;
  duration: number;
}

/** Szene, Licht, Zonenmodelle und geführte Kamera. Rendert nur, wenn sich etwas bewegt. */
export class Viewer {
  readonly renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(18, 1, 0.3, 2000);
  private loader = new GLTFLoader();
  private cache = new Map<string, Promise<Object3D>>();
  private holders = new Map<string, Group>();
  private requested = new Map<string, VariantKey>();
  private grows = new Map<Group, number>();
  private markers = new Map<string, Mesh>();
  private outlines = new Map<string, LineLoop>();
  /** Zonen, für die die Detailfassung angefordert ist */
  private detailed = new Set<string>();
  private sun: DirectionalLight;
  private state: CamState;
  private stage: Stage = 'resort';
  private tween: Tween | null = null;
  private insets = { left: 0, bottom: 0 };
  private frameQueued = false;
  reducedMotion = false;
  onBusyChange: (busy: boolean) => void = () => {};
  onError: (e: unknown) => void = () => {};
  /** Für die Messanzeige: nach jedem gerenderten Bild, mit Zeitstempel und ob die Kamera fährt. */
  onFrame: ((now: number, moving: boolean) => void) | null = null;
  /** Für Dauermessungen: rendert jedes Bild, auch ohne Bewegung. */
  continuous = false;
  /** Freier Modus (Arbeitsmodus): Orbit statt geführter Fahrt. */
  private orbit: OrbitControls | null = null;
  /** Erfüllt, sobald das Gelände in der Szene ist (sofort, wenn das Paket keines hat). */
  readonly terrainReady: Promise<void>;

  constructor(
    private canvas: HTMLCanvasElement,
    private twin: Twin,
    private baseUrl: string,
    /** Optional: Modelldaten aus einer anderen Quelle als einzelnen GLB-Dateien (z. B. Bündel). */
    private source?: (file: string) => Promise<ArrayBuffer>,
    /** Gelände anzeigen, falls das Paket eines hat. Standard aus: Das Modell steht frei auf Schwarz. */
    private showTerrain = false,
  ) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.scene.background = new Color(BACKGROUND);
    // Echte Pakete sind Meshopt-komprimiert; der Decoder steckt im Bundle (kein Fremd-Request).
    this.loader.setMeshoptDecoder(MeshoptDecoder);

    // Warmes Licht: 2700 K Sonne plus weicher Himmel/Boden-Ausgleich statt harter Schwärzen.
    const warm = new Color().setRGB(...kelvinToRgb(WARM_KELVIN), SRGBColorSpace);
    this.scene.add(new HemisphereLight(new Color(0xfff1dc), new Color(0x8a6f55), 1.6));
    this.sun = new DirectionalLight(warm, 3.2);
    const b = resortBounds(twin);
    // Sonne und Schattenbereich wachsen mit dem Resort (Platzhalter ~100 m, echte Pakete mehrere 100 m).
    const s = Math.max(1, b.size / 150); // Platzhalter: 1, also unverändert
    this.sun.position.set(b.center[0] - 45 * s, 70 * s, b.center[2] + 30 * s);
    this.sun.target.position.set(b.center[0], 0, b.center[2]);
    this.sun.castShadow = true;
    const half = b.size / 2 + 6 * s;
    Object.assign(this.sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 10 * s, far: 220 * s });
    const small = Math.min(window.innerWidth, window.innerHeight) < 600;
    this.sun.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
    this.sun.shadow.radius = 5;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);

    // Boden fängt nur Schatten, damit das UG als geschnittener Sockel sichtbar bleibt.
    // Mit echtem Gelände fängt dieses die Schatten selbst.
    if (!twin.terrain) {
      const ground = new Mesh(new PlaneGeometry(600, 600), new ShadowMaterial({ color: 0x5a3a1c, opacity: 0.28 }));
      ground.rotation.x = -Math.PI / 2;
      ground.position.set(b.center[0], -0.01, b.center[2]);
      ground.receiveShadow = true;
      this.scene.add(ground);
    }

    // Gelände (nur in Paketen, die eines mitbringen) liegt unter allen Zonen.
    let terrainDone = () => {};
    this.terrainReady = new Promise((r) => (terrainDone = r));
    if (!twin.terrain || !showTerrain) terrainDone();
    if (twin.terrain && showTerrain) {
      const file = twin.terrain.file;
      this.busy(+1);
      this.load(file)
        .then((model) => {
          const terrain = model.clone();
          terrain.name = 'terrain';
          this.scene.add(terrain);
          this.drapeOutlines([terrain], 'max');
          this.requestFrame();
        })
        .catch((e) => this.onError(e))
        .finally(() => {
          this.busy(-1);
          terrainDone();
        });
    }

    for (const zone of twin.zones) {
      const holder = new Group();
      holder.name = zone.id;
      holder.position.set(zone.center[0], 0, zone.center[1]);
      this.scene.add(holder);
      this.holders.set(zone.id, holder);
    }

    const markerGeo = new ConeGeometry(0.35, 0.9, 20);
    markerGeo.rotateX(Math.PI);
    const markerMat = new MeshStandardMaterial({ color: ACCENT, emissive: ACCENT, emissiveIntensity: 0.35 });
    for (const place of twin.places) {
      const m = new Mesh(markerGeo, markerMat);
      const p = placeWorld(twin, place.id);
      m.position.set(p[0], p[1] + 0.2, p[2]);
      m.castShadow = true;
      this.markers.set(place.id, m);
      this.scene.add(m);
    }

    // Umriss je Zone entlang des Grundrisses; mit Gelände wird er später auf die Oberfläche gelegt.
    // Immer sichtbar über dem Modell: ohne Gelände läge der Umriss sonst meist im Bestand verborgen.
    const outlineMat = new LineBasicMaterial({ color: ACCENT, depthTest: false, transparent: true, opacity: 0.9 });
    for (const zone of twin.zones) {
      const geo = new BufferGeometry();
      const y = (zone.base ?? 0) + 0.03;
      geo.setAttribute('position', new Float32BufferAttribute(zone.footprint.flatMap(([x, z]) => [x, y, z]), 3));
      const line = new LineLoop(geo, outlineMat);
      line.renderOrder = 10;
      line.visible = false;
      this.outlines.set(zone.id, line);
      this.scene.add(line);
    }

    this.state = cameraFor(twin, { stage: 'resort', zoneId: twin.zones[0].id, placeId: '', stepId: '' });
  }

  /** Bereiche, die von der Steuerung verdeckt sind (px); die Szene zentriert sich im Rest. */
  setInsets(left: number, bottom: number) {
    this.insets = { left, bottom };
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.setViewOffset(w, h, -this.insets.left / 2, this.insets.bottom / 2, w, h);
    this.requestFrame();
  }

  get free() {
    return this.orbit !== null;
  }

  /**
   * Freien Modus ein- oder ausschalten. Ein: Orbit übernimmt die aktuelle Kamera (Drehen, Schwenken,
   * Zoomen mit Maus und Touch), die geführten Gesten pausieren. Aus: Kamera fährt zur zuletzt gewählten
   * geführten Ansicht zurück.
   */
  setFree(on: boolean) {
    if (on === this.free) return;
    if (on) {
      if (this.tween) {
        this.state = this.tween.to;
        this.tween = null;
        this.busy(-1);
      }
      this.applyCamera();
      const c = new OrbitControls(this.camera, this.canvas);
      c.target.set(...this.state.target);
      c.enableDamping = !this.reducedMotion;
      c.dampingFactor = 0.1;
      c.screenSpacePanning = false;
      c.maxPolarAngle = Math.PI / 2 - 0.02; // nicht unter den Boden
      c.minDistance = 2;
      c.maxDistance = Math.max(50, this.state.frame * 6);
      c.addEventListener('change', () => this.requestFrame());
      c.update();
      this.orbit = c;
    } else {
      this.orbit!.dispose();
      this.orbit = null;
      // Rückweg: vom freien Standpunkt sanft zurück in die geführte Ansicht
      const from = this.stateFromCamera();
      const to = this.state;
      this.state = from;
      const duration = this.reducedMotion ? 0 : 900;
      if (!this.tween) this.busy(+1);
      this.tween = { from, to, start: performance.now(), duration };
    }
    this.requestFrame();
  }

  /** Kamerastand als CamState (für den Rückweg aus dem freien Modus). */
  private stateFromCamera(): CamState {
    const t = this.orbit?.target ?? new Vector3(...this.state.target);
    const p = this.camera.position;
    const dx = p.x - t.x, dy = p.y - t.y, dz = p.z - t.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    const h = this.canvas.clientHeight || 1;
    const freeH = Math.max(1, h - this.insets.bottom);
    const freeW = Math.max(1, (this.canvas.clientWidth || 1) - this.insets.left);
    // frame so, dass applyCamera() denselben Abstand ergibt
    const visible = 2 * d * Math.tan((this.camera.fov * Math.PI) / 360);
    const frame = ((visible * Math.min(1, freeW / freeH)) * freeH) / h;
    return {
      target: [t.x, t.y, t.z],
      fov: this.camera.fov,
      azimuth: (Math.atan2(dx, dz) * 180) / Math.PI,
      elevation: (Math.asin(Math.min(1, Math.max(-1, dy / d))) * 180) / Math.PI,
      frame,
    };
  }

  /** Fährt die Kamera zur Auswahl; ohne Animation bei reduzierter Bewegung. */
  select(sel: Selection) {
    const to = cameraFor(this.twin, sel);
    const stageJump = Math.abs(STAGES.indexOf(sel.stage) - STAGES.indexOf(this.stage));
    this.stage = sel.stage;
    const duration = this.reducedMotion ? 0 : 900 + 450 * Math.min(stageJump, 3);
    if (!this.tween) this.busy(+1);
    this.tween = { from: { ...this.state }, to, start: performance.now(), duration };

    const zone = this.twin.zones.find((z) => z.id === sel.zoneId)!;
    for (const [id, line] of this.outlines) line.visible = id === zone.id && (sel.stage === 'resort' || sel.stage === 'zone');
    // Beim ersten Hineinzoomen die dichtere Fassung der Zone nachladen (falls vorhanden).
    const hasDetail = Object.values(zone.variants).some((v) => v?.detail);
    if (sel.stage !== 'resort' && hasDetail && !this.detailed.has(zone.id)) {
      this.detailed.add(zone.id);
      this.showVariant(zone.id, this.requested.get(zone.id) ?? 'bestand', true).catch((e) => this.onError(e));
    }
    for (const [id, m] of this.markers) {
      const active = sel.stage !== 'resort' && sel.stage !== 'zone' && id === sel.placeId;
      m.scale.setScalar(active ? (sel.stage === 'schritt' ? 0.6 : 1.4) : 1);
      m.visible = sel.stage === 'resort' ? false : this.twin.places.find((p) => p.id === id)!.zoneId === sel.zoneId;
    }
    this.requestFrame();
  }

  /**
   * Lädt (einmalig) und zeigt eine Variante – die Detailfassung, sobald die Zone einmal angezoomt war.
   * Spätere Aufrufe gewinnen gegen langsamere frühere. `quiet`: ohne Wachsen (Detailtausch).
   */
  async showVariant(zoneId: string, variant: VariantKey, quiet = false): Promise<void> {
    const zone = this.twin.zones.find((z) => z.id === zoneId)!;
    const v = zone.variants[variant];
    if (!v) return; // Zone ohne Entwurf: Bestand bleibt stehen
    const file = this.detailed.has(zoneId) && v.detail ? v.detail.file : v.file;
    this.requested.set(zoneId, variant);
    this.busy(+1);
    try {
      const model = await this.load(file);
      if (this.requested.get(zoneId) !== variant) return;
      const holder = this.holders.get(zoneId)!;
      // Eine leichte Fassung darf eine bereits gezeigte Detailfassung nicht überschreiben.
      if (holder.userData.file === file) return;
      if (this.detailed.has(zoneId) && v.detail && file !== v.detail.file) return;
      holder.clear();
      holder.add(model.clone());
      holder.userData.file = file;
      if (!quiet && !this.reducedMotion && holder.userData.shown) this.grows.set(holder, performance.now());
      holder.userData.shown = true;
      this.requestFrame();
    } finally {
      this.busy(-1);
    }
  }

  /**
   * Ohne Gelände: Umrisse auf die geladenen Zonenmodelle legen, mit dem tiefsten Punkt je Feld
   * (Boden statt Dächer und Bäume).
   */
  drapeOnZones() {
    if (this.twin.terrain && this.showTerrain) return;
    this.drapeOutlines([...this.holders.values()], 'min');
    this.requestFrame();
  }

  /**
   * Legt die Zonenumrisse auf eine Oberfläche (alle 4 m ein Punkt, 1 m darüber).
   * Höhen aus einem Raster der Vertices – höchster (Gelände) oder tiefster (Bestand) Punkt
   * je 4-m-Feld und Nachbarn. Raycasts gegen das ganze Gelände blockierten den Browser mehrere Sekunden.
   */
  private drapeOutlines(surfaces: Object3D[], mode: 'max' | 'min') {
    const pick = mode === 'max' ? Math.max : Math.min;
    const none = mode === 'max' ? -Infinity : Infinity;
    const CELL = 4;
    const heights = new Map<string, number>();
    const v = new Vector3();
    for (const surface of surfaces) {
      surface.updateMatrixWorld(true);
      surface.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        const pos = o.geometry.getAttribute('position');
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
          const key = `${Math.round(v.x / CELL)},${Math.round(v.z / CELL)}`;
          heights.set(key, pick(heights.get(key) ?? none, v.y));
        }
      });
    }
    const heightAt = (x: number, z: number) => {
      const i = Math.round(x / CELL);
      const j = Math.round(z / CELL);
      let h = none;
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) h = pick(h, heights.get(`${i + di},${j + dj}`) ?? none);
      return Number.isFinite(h) ? h : null;
    };
    for (const zone of this.twin.zones) {
      const pts: number[] = [];
      const fp = zone.footprint;
      // Löcher im Modell (keine Punkte im Feld): letzte bekannte Höhe halten statt auf ±0 zu fallen.
      let lastH = zone.base ?? 0;
      fp.forEach(([x0, z0], i) => {
        const [x1, z1] = fp[(i + 1) % fp.length];
        const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 4));
        for (let k = 0; k < n; k++) {
          const x = x0 + ((x1 - x0) * k) / n;
          const z = z0 + ((z1 - z0) * k) / n;
          lastH = heightAt(x, z) ?? lastH;
          pts.push(x, lastH + 1, z);
        }
      });
      this.outlines.get(zone.id)!.geometry.setAttribute('position', new Float32BufferAttribute(pts, 3));
    }
  }

  /** Lädt eine Datei im Hintergrund vor, ohne sie zu zeigen. */
  prefetch(file: string) {
    void this.load(file).catch(() => {});
  }

  private load(file: string): Promise<Object3D> {
    let p = this.cache.get(file);
    if (!p) {
      const gltfPromise = this.source
        ? this.source(file).then((buf) => this.loader.parseAsync(buf, this.baseUrl))
        : this.loader.loadAsync(this.baseUrl + file);
      p = gltfPromise.then((gltf) => {
        gltf.scene.traverse((o) => {
          if (o instanceof Mesh) {
            const transparent = (o.material as MeshStandardMaterial).transparent;
            o.castShadow = !transparent;
            o.receiveShadow = true;
          }
        });
        return gltf.scene;
      });
      p.catch(() => this.cache.delete(file));
      this.cache.set(file, p);
    }
    return p;
  }

  private busyCount = 0;
  private busy(delta: number) {
    const was = this.busyCount > 0;
    this.busyCount += delta;
    if (was !== this.busyCount > 0) this.onBusyChange(this.busyCount > 0);
  }

  requestFrame() {
    if (this.frameQueued) return;
    this.frameQueued = true;
    requestAnimationFrame((t) => this.frame(t));
  }

  private frame(now: number) {
    this.frameQueued = false;
    let again = false;

    if (this.tween) {
      const { from, to, start, duration } = this.tween;
      const t = duration <= 0 ? 1 : (now - start) / duration;
      this.state = mixState(from, to, easeInOutCubic(t));
      if (t >= 1) {
        this.state = to;
        this.tween = null;
        this.busy(-1);
      } else again = true;
    }

    for (const [holder, start] of this.grows) {
      const t = Math.min(1, (now - start) / 450);
      holder.scale.y = Math.max(0.001, easeInOutCubic(t));
      if (t >= 1) this.grows.delete(holder);
      else again = true;
    }

    if (this.orbit) {
      // Im freien Modus steuert Orbit die Kamera; Dämpfung braucht weitere Bilder.
      if (this.orbit.update()) again = true;
    } else {
      this.applyCamera();
    }
    this.renderer.render(this.scene, this.camera);
    this.onFrame?.(now, again);
    if (again || this.continuous) this.requestFrame();
  }

  /** Kennzahlen des zuletzt gerenderten Bildes. */
  stats() {
    const { render, memory } = this.renderer.info;
    return {
      drawCalls: render.calls,
      triangles: render.triangles,
      geometries: memory.geometries,
      textures: memory.textures,
      pixelRatio: this.renderer.getPixelRatio(),
    };
  }

  private applyCamera() {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    const freeW = Math.max(1, w - this.insets.left);
    const freeH = Math.max(1, h - this.insets.bottom);
    // Der Ausschnitt muss in den freien Bereich passen, der Kegel deckt aber die ganze Fläche ab.
    const s = { ...this.state, frame: (this.state.frame * h) / freeH };
    const [x, y, z] = cameraPosition(s, freeW / freeH);
    const d = Math.hypot(x - s.target[0], y - s.target[1], z - s.target[2]);
    this.camera.fov = s.fov;
    this.camera.near = Math.max(0.1, d * 0.05);
    this.camera.far = d * 4 + 200;
    this.camera.position.set(x, y, z);
    this.camera.lookAt(...s.target);
    this.camera.updateProjectionMatrix();
  }
}
