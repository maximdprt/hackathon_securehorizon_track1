import { BufferAttribute, type BufferGeometry, Group, type Material, Mesh, type Object3D } from "three";
import { CAR_PARTS, type CarPart } from "@/components/explorer-v2/network/city3d/carModel";
import { POD_W } from "./constants";
import { crushMap } from "./crush";

/* The car the crane and the baler handle: the city's car (city3d/carModel.ts, the hero car GuardCar draws), here in the
   yard's metres at a width of POD_W, its six parts baked into place so the crush moves real vertices; it wears the city
   car's very materials (its paint is the refusal's red), so the hand-over at PICK does not show, and the bale keeps
   its windows, tyres and lights. Each part keeps its base positions: the crush always starts from them, recomputed only
   when (kT, kS, kE) changes. */

export function buildYardCar(parent: Object3D, mats: Record<CarPart, Material>, geos: Record<CarPart, BufferGeometry>) {
  const group = new Group();
  parent.add(group);
  const parts: Mesh[] = [];
  for (const name of CAR_PARTS) {
    const src = geos[name].clone().scale(POD_W, POD_W, POD_W);
    const geo = src.index ? src.toNonIndexed() : src;
    if (geo !== src) src.dispose();
    const mesh = new Mesh(geo, mats[name]);
    // no self-shadow: on these thin, stacked parts it streaks the body (shadow acne) and the car looks broken before the press
    mesh.castShadow = name === "Paint";
    mesh.receiveShadow = false;
    mesh.userData.base = (geo.getAttribute("position") as BufferAttribute).array.slice();
    group.add(mesh);
    parts.push(mesh);
  }

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
