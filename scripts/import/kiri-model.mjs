// Fremdmodell (z. B. KIRI-Export, GLB oder OBJ) für eine Zone aufbereiten:
// lesen → Knoten-Transformationen und Einpassung einbacken → auf den Grundriss schneiden →
// relativ zur Zonenmitte → ungeleuchtet (Licht steckt in der Fototextur) → Textur verkleinern.
// Die Optimierung (Reduktion, Quantisierung, Meshopt) macht danach optimizeToGlb() aus glb.mjs.
import { readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRMaterialsUnlit } from '@gltf-transform/extensions';
import { compactPrimitive, prune, textureCompress, transformPrimitive } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { meshDocument } from './glb.mjs';
import { parseObj } from './obj.mjs';
import { inside } from './zones.mjs';

/** 4×4 spaltenweise: a · b */
export function mat4Mul(a, b) {
  const r = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let row = 0; row < 4; row++) for (let k = 0; k < 4; k++) r[c * 4 + row] += a[k * 4 + row] * b[c * 4 + k];
  return r;
}

const translation = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];

/** Liest GLB/glTF (auch Meshopt-komprimiert) oder OBJ mit Textur aus der MTL-Datei. */
export async function readModel(file) {
  const ext = extname(file).toLowerCase();
  if (ext === '.obj') return readObjModel(file);
  if (ext !== '.glb' && ext !== '.gltf') throw new Error(`Modell: nur .glb, .gltf oder .obj (ist ${ext || 'ohne Endung'})`);
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  try {
    return await io.read(file);
  } catch (e) {
    if (/draco/i.test(String(e?.message))) throw new Error('Modell ist Draco-komprimiert: bitte ohne Draco oder als OBJ exportieren');
    throw e;
  }
}

function readObjModel(file) {
  const text = readFileSync(file, 'utf8');
  const obj = parseObj(text);
  let texture;
  const lib = text.match(/^mtllib\s+(.+)$/m)?.[1]?.trim();
  if (lib) {
    const mtl = readFileSync(join(dirname(file), lib), 'utf8');
    const map = mtl.match(/^\s*map_Kd\s+(.+)$/m)?.[1]?.trim();
    if (map) {
      const data = readFileSync(join(dirname(file), map));
      texture = { data: new Uint8Array(data), mimeType: /\.png$/i.test(map) ? 'image/png' : 'image/jpeg' };
    }
  }
  return meshDocument({
    name: 'modell', positions: Float32Array.from(obj.positions), uvs: obj.uvs, indices: obj.indices,
    color: [1, 1, 1, 1], texture,
  });
}

/**
 * Backt Knoten-Transformationen und die Einpassung `place` (4×4, spaltenweise) in die Vertices.
 * Danach hängen alle Mesh-Knoten ohne Transformation direkt an der Szene.
 */
export function bakeTransforms(doc, place) {
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  if (!scene) throw new Error('Modell ohne Szene');
  const meshNodes = [];
  scene.traverse((n) => n.getMesh() && meshNodes.push(n));
  if (!meshNodes.length) throw new Error('Modell ohne Geometrie');
  const uses = new Map();
  for (const n of meshNodes) uses.set(n.getMesh(), (uses.get(n.getMesh()) ?? 0) + 1);
  if ([...uses.values()].some((c) => c > 1)) throw new Error('Modell nutzt Instanzen (ein Mesh an mehreren Knoten) – nicht unterstützt');
  const worlds = meshNodes.map((n) => n.getWorldMatrix());
  meshNodes.forEach((n, i) => {
    const m = mat4Mul(place, worlds[i]);
    for (const p of n.getMesh().listPrimitives()) transformPrimitive(p, m);
  });
  for (const n of meshNodes) {
    n.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
    const parent = n.getParentNode();
    if (parent) parent.removeChild(n);
    if (!scene.listChildren().includes(n)) scene.addChild(n);
  }
  for (const n of root.listNodes()) if (!n.getMesh()) n.dispose();
}

/**
 * Behält nur Dreiecke, deren Mittelpunkt im Grundriss (x, z) liegt, und verschiebt alles relativ
 * zur Zonenmitte. Erwartet bereits eingebackene Web-Koordinaten.
 * @returns {{ trianglesIn: number, trianglesKept: number }}
 */
export async function clipToFootprint(doc, polygon, [cx, cz]) {
  let trianglesIn = 0;
  let trianglesKept = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4) throw new Error('Modell: nur Dreiecke (TRIANGLES) unterstützt');
      const pos = prim.getAttribute('POSITION').getArray();
      const n = pos.length / 3;
      const idx = prim.getIndices()?.getArray() ?? Uint32Array.from({ length: n }, (_, i) => i);
      const keep = [];
      for (let t = 0; t < idx.length; t += 3) {
        const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
        const x = (pos[3 * a] + pos[3 * b] + pos[3 * c]) / 3;
        const z = (pos[3 * a + 2] + pos[3 * b + 2] + pos[3 * c + 2]) / 3;
        if (inside(x, z, polygon)) keep.push(a, b, c);
      }
      trianglesIn += idx.length / 3;
      trianglesKept += keep.length / 3;
      if (!keep.length) {
        prim.dispose();
        continue;
      }
      const acc = prim.getIndices() ?? doc.createAccessor().setType('SCALAR').setBuffer(doc.getRoot().listBuffers()[0] ?? doc.createBuffer());
      prim.setIndices(acc.setArray(Uint32Array.from(keep)));
      compactPrimitive(prim);
      transformPrimitive(prim, translation(-cx, 0, -cz));
    }
    if (!mesh.listPrimitives().length) mesh.dispose();
  }
  await doc.transform(prune());
  if (!trianglesKept) throw new Error('Modell: nach dem Zuschnitt auf den Grundriss bleibt nichts – Passpunkte oder Zone prüfen');
  return { trianglesIn, trianglesKept };
}

/** Photogrammetrie trägt ihr Licht in der Textur: ungeleuchtet, nur Grundfarbe behalten. */
export function makeUnlit(doc) {
  const unlit = doc.createExtension(KHRMaterialsUnlit);
  for (const m of doc.getRoot().listMaterials()) {
    m.setExtension('KHR_materials_unlit', unlit.createUnlit())
      .setNormalTexture(null)
      .setOcclusionTexture(null)
      .setMetallicRoughnessTexture(null)
      .setEmissiveTexture(null);
  }
}

/** Texturen auf höchstens size × size verkleinern und als JPEG speichern. */
export async function shrinkTextures(doc, size, quality = 80) {
  await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [size, size], quality }), prune());
}
