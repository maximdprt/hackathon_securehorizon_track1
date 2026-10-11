import { BufferAttribute, type BufferGeometry, Group, type Material, Matrix4, Mesh, type Object3D } from "three";
import { CANOPY_H, EQUATOR, PODS, ROOF } from "@/components/explorer-v2/network/city3d/Traffic";
import { stretched } from "@/components/explorer-v2/network/city3d/GuardCar";
import { POD_W } from "./constants";
import { crushMap } from "./crush";

/* The car the crane and the baler handle: the city's own pod (a van of the fleet, city3d/Traffic.tsx), drawn here in
   the yard's metres at a width of POD_W, its parts baked into their place so the crush moves real vertices; it wears
   the city car's very materials, so the swap at the baler is seamless. Each part keeps its base positions: the crush
   always starts from them, recomputed only when (kT, kS, kE) changes. */

export function buildPodCar(parent: Object3D, mats: { body: Material; canopy: Material }) {
  const pod = PODS.van;
  const w = POD_W;
  const cw = pod.canopy.width;
  const group = new Group();
  parent.add(group);
  const parts: Mesh[] = [];
  const add = (g: BufferGeometry, m: Material, at: Matrix4) => {
    g.applyMatrix4(at);
    const geo = g.index ? g.toNonIndexed() : g;
    if (geo !== g) g.dispose();
    const mesh = new Mesh(geo, m);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.base = (geo.getAttribute("position") as BufferAttribute).array.slice();
    group.add(mesh);
    parts.push(mesh);
  };
  add(stretched(pod.length), mats.body, new Matrix4().makeTranslation(0, EQUATOR * w, 0).multiply(new Matrix4().makeScale(w, w, w)));
  add(stretched(pod.canopy.length / cw), mats.canopy, new Matrix4().makeTranslation(pod.canopy.x * w, (ROOF - 0.055) * w, 0).multiply(new Matrix4().makeScale(cw * w, CANOPY_H * cw * w, cw * w)));

  let last = "";
  const crush = (kT: number, kS: number, kE: number) => {
    const key = `${kT.toFixed(5)}|${kS.toFixed(5)}|${kE.toFixed(5)}`;
    if (key === last) return;
    last = key;
    for (const p of parts) {
      const pos = p.geometry.getAttribute("position") as BufferAttribute;
      const base = p.userData.base as Float32Array;
      for (let i = 0; i < pos.count; i++) {
        const r = crushMap(base[i * 3], base[i * 3 + 1], base[i * 3 + 2], kT, kS, kE);
        pos.setXYZ(i, r[0], r[1], r[2]);
      }
      pos.needsUpdate = true;
      p.geometry.computeVertexNormals();
      p.geometry.computeBoundingSphere();
    }
  };
  return { group, crush, dispose: () => parts.forEach((p) => p.geometry.dispose()) };
}
