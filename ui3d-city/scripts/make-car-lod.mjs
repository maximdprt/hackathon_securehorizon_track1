import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, prune, dedup, normals } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { MeshoptSimplifier } from 'meshoptimizer';
import { mat4, vec3 } from 'gl-matrix';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() });
const src = await io.read('dl/ferrari.glb');
const CLASS = n => {
  n = n.toLowerCase();
  if (/yellow_trim|^blue$|steering_red/.test(n)) return null; // emblèmes retirés, l'habitacle reste en sombre
  if (n === 'body') return 'Paint';
  if (n === 'glass') return 'Glass';
  if (n === 'lights' || n === 'leds') return 'LightFront';
  if (n === 'lights_red') return 'LightRear';
  if (/^rim|chrome|centre|nuts/.test(n)) return 'Metal';
  return 'Dark';
};
const acc = {};
const seen = {};
for (const node of src.getRoot().listNodes()) {
  const mesh = node.getMesh(); if (!mesh) continue;
  // le nom utile peut être sur le noeud ou sur un parent
  let cls, p = node; const names = [];
  while (p) { names.push(p.getName()); p = p.getParentNode ? p.getParentNode() : null; }
  for (const nm of names) { const c = CLASS(nm); if (c === null) { cls = null; break; } if (c !== 'Dark' || cls === undefined) cls = cls && cls !== 'Dark' ? cls : c; }
  seen[names.join('<')] = cls;
  if (!cls) continue;
  const M = node.getWorldMatrix();
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION'); const idx = prim.getIndices();
    const a = acc[cls] ||= { p: [], i: [] }; const base = a.p.length / 3; const v = [0, 0, 0];
    for (let k = 0; k < pos.getCount(); k++) { pos.getElement(k, v); vec3.transformMat4(v, v, M); a.p.push(v[0], v[1], v[2]); }
    if (idx) for (let k = 0; k < idx.getCount(); k++) a.i.push(base + idx.getScalar(k)); else for (let k = 0; k < pos.getCount(); k++) a.i.push(base + k);
  }
}
console.log(Object.entries(seen).map(([k, v]) => `${k.split('<')[0]}:${v}`).join(' '));
// bornes globales -> normalisation : longueur 2.2 en x, largeur 1 en z, base au sol
let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
for (const a of Object.values(acc)) for (let k = 0; k < a.p.length; k += 3) for (let d = 0; d < 3; d++) { mn[d] = Math.min(mn[d], a.p[k + d]); mx[d] = Math.max(mx[d], a.p[k + d]); }
const ext = mx.map((x, d) => x - mn[d]); console.log('extent', ext.map(x => x.toFixed(2)));
const longAxis = ext[0] >= ext[2] ? 0 : 2; const sideAxis = longAxis === 0 ? 2 : 0;
const S = 2.2 / ext[longAxis]; const SW = 1.0 / ext[sideAxis];
const lf = acc.LightFront.p; let m = 0; for (let k = 0; k < lf.length; k += 3) m += lf[k + longAxis] - (mn[longAxis] + mx[longAxis]) / 2;
const FWD = m >= 0 ? 1 : -1; console.log('front sign', FWD);
const doc = new Document(); const buf = doc.createBuffer(); const scene = doc.createScene('Car');
const COLORS = { Paint: [1, 1, 1], Dark: [0.06, 0.07, 0.08], Glass: [0.05, 0.07, 0.1], Metal: [0.55, 0.57, 0.6], LightFront: [1, 0.95, 0.85], LightRear: [1, 0.1, 0.06] };
for (const [cls, a] of Object.entries(acc)) {
  const P = new Float32Array(a.p.length);
  for (let k = 0; k < a.p.length; k += 3) {
    const L = FWD * (a.p[k + longAxis] - (mn[longAxis] + mx[longAxis]) / 2) * S;
    const W = FWD * (a.p[k + sideAxis] - (mn[sideAxis] + mx[sideAxis]) / 2) * SW;
    const Y = (a.p[k + 1] - mn[1]) * S;           // hauteur à l'échelle de la longueur
    P[k] = L; P[k + 1] = Y; P[k + 2] = W;
  }
  const I = new Uint32Array(a.i);
  const mat = doc.createMaterial(cls).setBaseColorFactor([...COLORS[cls], 1]).setMetallicFactor(cls === 'Metal' ? 0.8 : 0).setRoughnessFactor(cls === 'Glass' ? 0.1 : 0.6);
  if (cls.startsWith('Light')) mat.setEmissiveFactor(COLORS[cls]);
  const prim = doc.createPrimitive().setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(P).setBuffer(buf)).setIndices(doc.createAccessor().setType('SCALAR').setArray(I).setBuffer(buf)).setMaterial(mat);
  scene.addChild(doc.createNode(cls).setMesh(doc.createMesh(cls).addPrimitive(prim)));
}
await MeshoptSimplifier.ready;
await doc.transform(weld({ tolerance: 0.002 }), simplify({ simplifier: MeshoptSimplifier, ratio: Number(process.env.RATIO || 0.02), error: Number(process.env.ERR || 0.02), lockBorder: false }), dedup(), prune());
await doc.transform(normals({ overwrite: true })); // normales par face : rendu net à petite taille
let tris = 0;
for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { const n = (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3; tris += n; console.log(m.getName(), Math.round(n)); }
console.log('triangles', Math.round(tris), 'longAxis', longAxis, 'S', S.toFixed(4));
await new NodeIO().write(process.env.OUT || 'out/car_lod.glb', doc);
