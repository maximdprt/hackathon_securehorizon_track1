import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PMREMGenerator,
  PlaneGeometry,
  Scene,
  SpotLight,
  type Material,
  type WebGLRenderer,
} from "three";
import { MASTS } from "./constants";
import { raw, type Kit } from "./materials";

/* The night yard: background and fog, reflections from a generated environment (four emissive boxes, no HDRI), the
   moon, three sodium lighting masts with soft shadows, the asphalt and its lane marks.
   three r155+ lights are physical (legacy lights are gone since r165): the reference's intensities (spot 2.4 with
   decay 1.4, hemisphere and moon .35) are recalibrated against its captures, the colours, places and cones kept. */

/* r128 (legacy lights) multiplied direct irradiance by pi and faded a spot linearly to its distance; physical lights
   divide by d^decay. Kept: decay 1.4, so the falloff keeps its shape; 2.4 * pi * (1 - d/40)^1.4 over 9 to 15 m is about
   130 / d^1.4. Hemisphere and moon: x pi. Then checked against the reference's captures (scripts/guard-yard-shots.ts). */
export const LIGHT = {
  hemi: 0.35 * Math.PI,
  moon: 0.35 * Math.PI,
  spot: 130,
  spotDecay: 1.4,
  scan: 2.5,
};

export function buildEnvironment(scene: Scene, kit: Kit, gl: WebGLRenderer) {
  scene.background = raw("#070a10");
  scene.fog = new FogExp2(raw("#070a10"), 0.026);

  // reflections
  const pmrem = new PMREMGenerator(gl);
  const envScene = new Scene();
  envScene.background = raw("#0b0e14");
  const envMats: Material[] = [];
  (
    [
      [0, 9, 0, 10, 0.3, 10, "#2a3142"],
      [-6, 3, -6, 5, 3, 0.3, "#ffd9a0"],
      [6, 4, 5, 3, 2, 0.3, "#ffe7c4"],
      [0, 2, 8, 10, 1, 0.3, "#33415c"],
    ] as [number, number, number, number, number, number, string][]
  ).forEach(([x, y, z, w, h, d, c]) => {
    const mat = new MeshBasicMaterial({ color: raw(c) });
    envMats.push(mat);
    const m = new Mesh(new BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.lookAt(0, 1, 0);
    envScene.add(m);
  });
  const envRT = pmrem.fromScene(envScene, 0.04);
  pmrem.dispose();
  scene.environment = envRT.texture;
  envScene.traverse((o) => (o as Mesh).geometry?.dispose());
  envMats.forEach((m) => m.dispose());

  // moon and sodium masts
  scene.add(new HemisphereLight(raw("#5a6b8f"), raw("#0a0c10"), LIGHT.hemi));
  const moon = new DirectionalLight(raw("#b9c8ff"), LIGHT.moon);
  moon.position.set(-10, 18, 12);
  scene.add(moon);
  const poleMat = kit.track(new MeshStandardMaterial({ color: raw("#3a3f48"), metalness: 0.7, roughness: 0.5 }));
  const lampMat = kit.track(new MeshStandardMaterial({ color: raw("#222"), emissive: raw("#ffcf8a"), emissiveIntensity: 2.2 }));
  for (const [x, z, tx, tz] of MASTS) {
    const pole = new Mesh(new CylinderGeometry(0.09, 0.14, 9, 10), poleMat);
    pole.position.set(x, 4.5, z);
    pole.castShadow = true;
    scene.add(pole);
    const lamp = new Mesh(new BoxGeometry(0.7, 0.18, 0.45), lampMat);
    lamp.position.set(x, 9.05, z);
    scene.add(lamp);
    const s = new SpotLight(raw("#ffcf8a"), LIGHT.spot, 40, 0.62, 0.55, LIGHT.spotDecay);
    s.position.set(x, 9, z);
    s.target.position.set(tx, 0, tz);
    s.castShadow = true;
    s.shadow.mapSize.set(1024, 1024);
    s.shadow.bias = -0.0004;
    s.shadow.camera.near = 2;
    s.shadow.camera.far = 30;
    scene.add(s);
    scene.add(s.target);
  }

  // the ground and its marks
  const ground = new Mesh(new PlaneGeometry(90, 50), kit.mats.asphalt);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const flat = (w: number, d: number, mat: Material, x: number, z: number, y = 0.012) => {
    const m = new Mesh(new PlaneGeometry(w, d), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  const mark = kit.paint("#c9ccd2");
  for (let x = -26; x < 30; x += 3) {
    flat(1.4, 0.12, mark, x, 2.05);
    flat(1.4, 0.12, mark, x, -2.05);
  }
  flat(0.35, 3.9, kit.paint("#e8e8e8"), -8.6, 0);

  return { dispose: () => envRT.dispose() };
}
