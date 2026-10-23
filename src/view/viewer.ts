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
  WebGLRenderer,
  type Object3D,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Twin, VariantKey } from '../model/types';
import { cameraPosition, easeInOutCubic, mixState, STAGES, type CamState, type Stage } from './camera-rig';
import { kelvinToRgb, WARM_KELVIN } from './light';
import { cameraFor, placeWorld, resortBounds, type Selection } from './nav';

const BACKGROUND = 0xeee5d6;
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
  private outline: LineLoop;
  private sun: DirectionalLight;
  private state: CamState;
  private stage: Stage = 'resort';
  private tween: Tween | null = null;
  private insets = { left: 0, bottom: 0 };
  private frameQueued = false;
  reducedMotion = false;
  onBusyChange: (busy: boolean) => void = () => {};
  onError: (e: unknown) => void = () => {};

  constructor(
    private canvas: HTMLCanvasElement,
    private twin: Twin,
    private baseUrl: string,
    /** Optional: Modelldaten aus einer anderen Quelle als einzelnen GLB-Dateien (z. B. Bündel). */
    private source?: (file: string) => Promise<ArrayBuffer>,
  ) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.scene.background = new Color(BACKGROUND);

    // Warmes Licht: 2700 K Sonne plus weicher Himmel/Boden-Ausgleich statt harter Schwärzen.
    const warm = new Color().setRGB(...kelvinToRgb(WARM_KELVIN), SRGBColorSpace);
    this.scene.add(new HemisphereLight(new Color(0xfff1dc), new Color(0x8a6f55), 1.6));
    this.sun = new DirectionalLight(warm, 3.2);
    const b = resortBounds(twin);
    this.sun.position.set(b.center[0] - 45, 70, b.center[2] + 30);
    this.sun.target.position.set(b.center[0], 0, b.center[2]);
    this.sun.castShadow = true;
    const half = b.size / 2 + 6;
    Object.assign(this.sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 10, far: 220 });
    const small = Math.min(window.innerWidth, window.innerHeight) < 600;
    this.sun.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
    this.sun.shadow.radius = 5;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);

    // Boden fängt nur Schatten, damit das UG als geschnittener Sockel sichtbar bleibt.
    const ground = new Mesh(new PlaneGeometry(600, 600), new ShadowMaterial({ color: 0x5a3a1c, opacity: 0.28 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(b.center[0], -0.01, b.center[2]);
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Gelände (nur in Paketen, die eines mitbringen) liegt unter allen Zonen.
    if (twin.terrain) {
      const file = twin.terrain.file;
      this.busy(+1);
      this.load(file)
        .then((model) => {
          const terrain = model.clone();
          terrain.name = 'terrain';
          this.scene.add(terrain);
          this.requestFrame();
        })
        .catch((e) => this.onError(e))
        .finally(() => this.busy(-1));
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

    const pts = [-1, -1, 1, -1, 1, 1, -1, 1].map((v) => v * 0.5);
    const lineGeo = new BufferGeometry();
    lineGeo.setAttribute('position', new Float32BufferAttribute([0, 1, 2, 3].flatMap((i) => [pts[i * 2], 0, pts[i * 2 + 1]]), 3));
    this.outline = new LineLoop(lineGeo, new LineBasicMaterial({ color: ACCENT }));
    this.outline.position.y = 0.03;
    this.scene.add(this.outline);

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

  /** Fährt die Kamera zur Auswahl; ohne Animation bei reduzierter Bewegung. */
  select(sel: Selection) {
    const to = cameraFor(this.twin, sel);
    const stageJump = Math.abs(STAGES.indexOf(sel.stage) - STAGES.indexOf(this.stage));
    this.stage = sel.stage;
    const duration = this.reducedMotion ? 0 : 900 + 450 * Math.min(stageJump, 3);
    if (!this.tween) this.busy(+1);
    this.tween = { from: { ...this.state }, to, start: performance.now(), duration };

    const zone = this.twin.zones.find((z) => z.id === sel.zoneId)!;
    this.outline.scale.set(zone.size[0] + 1, 1, zone.size[1] + 1);
    this.outline.position.x = zone.center[0];
    this.outline.position.z = zone.center[1];
    this.outline.visible = sel.stage === 'resort' || sel.stage === 'zone';
    for (const [id, m] of this.markers) {
      const active = sel.stage !== 'resort' && sel.stage !== 'zone' && id === sel.placeId;
      m.scale.setScalar(active ? (sel.stage === 'schritt' ? 0.6 : 1.4) : 1);
      m.visible = sel.stage === 'resort' ? false : this.twin.places.find((p) => p.id === id)!.zoneId === sel.zoneId;
    }
    this.requestFrame();
  }

  /** Lädt (einmalig) und zeigt eine Variante. Spätere Aufrufe gewinnen gegen langsamere frühere. */
  async showVariant(zoneId: string, variant: VariantKey): Promise<void> {
    const zone = this.twin.zones.find((z) => z.id === zoneId)!;
    const v = zone.variants[variant];
    if (!v) return; // Zone ohne Entwurf: Bestand bleibt stehen
    this.requested.set(zoneId, variant);
    this.busy(+1);
    try {
      const model = await this.load(v.file);
      if (this.requested.get(zoneId) !== variant) return;
      const holder = this.holders.get(zoneId)!;
      holder.clear();
      holder.add(model.clone());
      if (!this.reducedMotion && holder.userData.shown) this.grows.set(holder, performance.now());
      holder.userData.shown = true;
      this.requestFrame();
    } finally {
      this.busy(-1);
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

    this.applyCamera();
    this.renderer.render(this.scene, this.camera);
    if (again) this.requestFrame();
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
