// Schreibt ein Mesh als kompakte GLB: verschweißen, optional reduzieren, quantisieren,
// Meshopt-Kompression (der Viewer bringt den Decoder selbst mit, keine Fremd-Requests).
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression, KHRMaterialsUnlit } from '@gltf-transform/extensions';
import { quantize, reorder, simplify, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

/**
 * Glatte Vertex-Normalen (flächengewichtet) für ein indiziertes Mesh.
 * Bewusst nicht normals() aus gltf-transform: das löst den Index auf und vervielfacht die Datei.
 */
export function smoothNormals(positions, indices) {
  const n = new Float32Array(positions.length);
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t] * 3, indices[t + 1] * 3, indices[t + 2] * 3];
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) {
      n[k] += nx;
      n[k + 1] += ny;
      n[k + 2] += nz;
    }
  }
  for (let k = 0; k < n.length; k += 3) {
    const l = Math.hypot(n[k], n[k + 1], n[k + 2]) || 1;
    n[k] /= l;
    n[k + 1] /= l;
    n[k + 2] /= l;
  }
  return n;
}

/**
 * @param {{ name: string, positions: Float32Array, uvs?: Float32Array | null, indices: Uint32Array,
 *   color: [number, number, number, number], unlit?: boolean, normals?: boolean,
 *   texture?: { data: Uint8Array, mimeType: string } }} m
 */
export function meshDocument(m) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene(m.name);
  const material = doc.createMaterial(m.name).setBaseColorFactor(m.color).setRoughnessFactor(1).setMetallicFactor(0);
  if (m.texture) {
    material.setBaseColorTexture(doc.createTexture(`${m.name}-farbe`).setImage(m.texture.data).setMimeType(m.texture.mimeType));
  }
  if (m.unlit) material.setExtension('KHR_materials_unlit', doc.createExtension(KHRMaterialsUnlit).createUnlit());
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(m.positions).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(m.indices).setBuffer(buffer))
    .setMaterial(material);
  if (m.uvs) prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(m.uvs).setBuffer(buffer));
  if (m.normals) {
    prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(smoothNormals(m.positions, m.indices)).setBuffer(buffer));
  }
  scene.addChild(doc.createNode(m.name).setMesh(doc.createMesh(m.name).addPrimitive(prim)));
  return doc;
}

/** Anzahl Dreiecke aller Primitive */
export function triangleCount(doc) {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const p of mesh.listPrimitives()) n += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
  }
  return n;
}

/**
 * Optimiert und liefert die GLB-Bytes.
 * @param {Document} doc
 * @param {{ targetTriangles?: number }} [opts]
 */
export async function optimizeToGlb(doc, opts = {}) {
  await MeshoptEncoder.ready;
  await MeshoptSimplifier.ready;
  await doc.transform(weld());
  const before = triangleCount(doc);
  if (opts.targetTriangles && before > opts.targetTriangles) {
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: opts.targetTriangles / before, error: 0.02 }));
  }
  await doc.transform(reorder({ encoder: MeshoptEncoder }), quantize());
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  const glb = await io.writeBinary(doc);
  return { glb, triangles: triangleCount(doc), trianglesBefore: before };
}
