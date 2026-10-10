import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  EdgesGeometry,
  ExtrudeGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  type Material,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Plane,
  Shape,
  ShaderMaterial,
  Vector3,
  type Scene,
} from "three";
import { GLASS_PROFILE, PROFILE } from "./constants";
import { crushMap } from "./crush";
import { raw, type Kit } from "./materials";

/* The car: a side profile extruded across its width (steps 6, so the crush has vertices in the width), its glazing,
   bumpers, four wheels, head and tail lights; no mirrors (they went through the jaws). Each part keeps its base
   positions: the crush always starts from them, never from the last state. Its hologram shares the geometry: a fresnel
   shader and its edges, kept where x >= v while the solid keeps x <= v (setScan). No scanlines, no noise. */

const HOLO_VERT = /* glsl */ `#include <clipping_planes_pars_vertex>
varying vec3 vN;
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mvPosition;
  #include <clipping_planes_vertex>
}`;
const HOLO_FRAG = /* glsl */ `#include <clipping_planes_pars_fragment>
uniform vec3 uColor;
varying vec3 vN;
void main() {
  #include <clipping_planes_fragment>
  float f = pow(1.0 - abs(vN.z), 2.0);
  gl_FragColor = vec4(uColor * (0.18 + f), 0.45 * (0.25 + f));
}`;

function extrudeProfile(pts: [number, number][], depth: number, bevel: number) {
  const s = new Shape();
  pts.forEach((p, i) => (i ? s.lineTo(p[0], p[1]) : s.moveTo(p[0], p[1])));
  s.closePath();
  const g = new ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 6, steps: 6 });
  g.translate(0, 0, -depth / 2);
  return g;
}

export function buildCar(scene: Scene, kit: Kit) {
  const car = new Group();
  scene.add(car);
  const parts: Mesh[] = [];
  const part = (geo: BufferGeometry, mat: Material, x = 0, y = 0, z = 0) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    const m = new Mesh(g, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    car.add(m);
    parts.push(m);
    m.userData.base = (g.getAttribute("position") as BufferAttribute).array.slice();
    return m;
  };
  const paintMat = kit.track(new MeshPhysicalMaterial({ color: raw("#d7dde6"), metalness: 0.55, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08 }));
  const glassMat = kit.track(new MeshPhysicalMaterial({ color: raw("#0d1520"), metalness: 0.2, roughness: 0.05, clearcoat: 1 }));
  const trimMat = kit.track(new MeshStandardMaterial({ color: raw("#14171c"), roughness: 0.6 }));
  const rimMat = kit.track(new MeshStandardMaterial({ color: raw("#b8bec8"), metalness: 1, roughness: 0.25 }));
  const tireMat = kit.track(new MeshStandardMaterial({ color: raw("#101215"), roughness: 0.85 }));

  part(extrudeProfile(PROFILE, 1.62, 0.1), paintMat);
  part(extrudeProfile(GLASS_PROFILE, 1.64, 0.06), glassMat);
  part(new BoxGeometry(0.06, 0.3, 1.72, 1, 1, 4), trimMat, 2.27, 0.45, 0);
  part(new BoxGeometry(0.06, 0.28, 1.72, 1, 1, 4), trimMat, -2.27, 0.45, 0);
  (
    [
      [1.32, 0.86],
      [-1.32, 0.86],
      [1.32, -0.86],
      [-1.32, -0.86],
    ] as [number, number][]
  ).forEach(([x, z]) => {
    const t = new CylinderGeometry(0.36, 0.36, 0.26, 24);
    t.rotateX(Math.PI / 2);
    part(t, tireMat, x, 0.36, z);
    const r = new CylinderGeometry(0.22, 0.22, 0.27, 12);
    r.rotateX(Math.PI / 2);
    part(r, rimMat, x, 0.36, z);
  });
  [-0.58, 0.58].forEach((z) => {
    part(new BoxGeometry(0.06, 0.12, 0.36), kit.glow("#fff2d6", 2.5), 2.26, 0.72, z);
    part(new BoxGeometry(0.06, 0.12, 0.4), kit.glow("#ff2a1f", 1.6), -2.27, 0.76, z);
  });
  parts.forEach((p) => {
    p.userData.home = p.position.clone();
  });

  // the hologram: same geometries, fresnel and edges, clipped the other way
  const solidClip = new Plane(new Vector3(-1, 0, 0), 99);
  const holoClip = new Plane(new Vector3(1, 0, 0), -99);
  const holoMat = kit.track(
    new ShaderMaterial({
      uniforms: { uColor: { value: raw("#8fb8ff") } },
      vertexShader: HOLO_VERT,
      fragmentShader: HOLO_FRAG,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      clipping: true,
    }),
  );
  const wireMat = kit.track(new LineBasicMaterial({ color: raw("#bcd6ff"), transparent: true, opacity: 0.55 }));
  holoMat.clippingPlanes = [holoClip];
  wireMat.clippingPlanes = [holoClip];
  const holo = new Group();
  car.add(holo);
  const edges: BufferGeometry[] = [];
  parts.forEach((p) => {
    (p.material as Material).clippingPlanes = [solidClip];
    const h = new Mesh(p.geometry, holoMat);
    h.position.copy(p.position);
    holo.add(h);
    const eg = new EdgesGeometry(p.geometry, 28);
    edges.push(eg);
    const w = new LineSegments(eg, wireMat);
    w.position.copy(p.position);
    holo.add(w);
  });
  const setScan = (v: number) => {
    solidClip.constant = v;
    holoClip.constant = -v;
  };

  // the red frame that blinks after the verdict
  const flagMat = kit.track(new LineBasicMaterial({ color: raw("#FF5D57"), transparent: true, opacity: 0 }));
  const flagGeo = new EdgesGeometry(new BoxGeometry(4.7, 1.7, 2.0));
  const flag = new LineSegments(flagGeo, flagMat);
  flag.position.y = 0.85;
  car.add(flag);

  // the crush, recomputed only when (kT, kS, kE) changes
  let last = "";
  const crush = (kT: number, kS = kT, kE = kT) => {
    const key = `${kT.toFixed(5)}|${kS.toFixed(5)}|${kE.toFixed(5)}`;
    if (key === last) return;
    last = key;
    for (const p of parts) {
      const pos = p.geometry.getAttribute("position") as BufferAttribute;
      const base = p.userData.base as Float32Array;
      const h = p.userData.home as Vector3;
      for (let i = 0; i < pos.count; i++) {
        const r = crushMap(base[i * 3] + h.x, base[i * 3 + 1] + h.y, base[i * 3 + 2] + h.z, kT, kS, kE);
        pos.setXYZ(i, r[0] - h.x, r[1] - h.y, r[2] - h.z);
      }
      pos.needsUpdate = true;
      p.geometry.computeVertexNormals();
      p.geometry.computeBoundingSphere();
    }
  };

  return {
    car,
    setScan,
    crush,
    flagMat,
    dispose() {
      parts.forEach((p) => p.geometry.dispose());
      edges.forEach((g) => g.dispose());
      flagGeo.dispose();
    },
  };
}
