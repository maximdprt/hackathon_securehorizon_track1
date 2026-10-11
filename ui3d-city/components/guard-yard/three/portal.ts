import {
  AdditiveBlending,
  BoxGeometry,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  type Object3D,
} from "three";
import { BX, CZ, SX } from "./constants";
import { raw, type Kit } from "./materials";

/* The X-ray gantry, after the fixed customs portals (Rapiscan Eagle P60 type): concrete shielding walls either side of
   the lane, the source tower, an L detector arm over the lane with its blue strip, traffic lights, a barrier, plate
   cameras, the sign, amber beacons and the operator's booth. The beam is fixed at x = SX: the car drives through it. */

/** the scan's blue point light, in physical units (the reference: .45 with r128's legacy lights) */
const SCAN_LIGHT = 2.5;

export function buildPortal(scene: Object3D, kit: Kit) {
  const { B, C, mats, glow } = kit;
  const portal = new Group();
  scene.add(portal);
  [-1, 1].forEach((sg) => {
    B(6.5, 3.6, 0.7, mats.concrete, SX, 1.8, sg * 2.95, portal);
    for (let i = 0; i < 4; i++) B(0.08, 3.6, 0.72, mats.steelDark, SX - 2.4 + i * 1.6, 1.8, sg * 2.95, portal, false);
    B(6.6, 0.12, 0.8, mats.steelDark, SX, 3.66, sg * 2.95, portal);
  });
  B(1.4, 5.2, 1.2, mats.panelW, SX, 2.6, -3.95, portal);
  B(1.2, 0.5, 1.0, mats.steelDark, SX, 5.45, -3.95, portal);
  for (let i = 0; i < 7; i++) B(0.9, 0.05, 0.02, mats.steelDark, SX, 3.6 + i * 0.12, -3.34, portal, false);
  const trefoil = kit.canvasTex(256, 256, (g) => {
    g.fillStyle = "#E0A82E";
    g.beginPath();
    g.moveTo(128, 10);
    g.lineTo(246, 230);
    g.lineTo(10, 230);
    g.closePath();
    g.fill();
    g.fillStyle = "#15171c";
    g.beginPath();
    g.arc(128, 160, 18, 0, 6.3);
    g.fill();
    for (let k = 0; k < 3; k++) {
      g.beginPath();
      g.moveTo(128, 160);
      g.arc(128, 160, 58, -Math.PI / 2 + k * 2.094 - 0.52, -Math.PI / 2 + k * 2.094 + 0.52);
      g.fill();
    }
  }, null);
  const tri = new Mesh(new PlaneGeometry(0.7, 0.7), kit.track(new MeshStandardMaterial({ map: trefoil, transparent: true, roughness: 0.6 })));
  tri.position.set(SX, 2.3, -3.34);
  portal.add(tri);
  B(0.5, 5.6, 0.5, mats.panelW, SX, 2.8, 3.55, portal);
  B(0.55, 0.55, 7.6, mats.panelW, SX, 5.35, -0.15, portal);
  B(0.12, 0.12, 7.2, mats.steelDark, SX + 0.3, 5.05, -0.15, portal, false);
  const detStrip = B(0.06, 0.35, 6.8, glow("#6FA8FF", 0.6), SX - 0.29, 5.15, -0.15, portal, false);

  function trafficLight(x: number, z: number) {
    const g = new Group();
    g.position.set(x, 0, z);
    scene.add(g);
    C(0.06, 0.06, 2.4, mats.steelDark, 0, 1.2, 0, g);
    B(0.32, 0.8, 0.28, mats.steelDark, 0, 2.6, 0, g);
    const red = new Mesh(new CircleGeometry(0.1, 16), glow("#ff3b30", 0));
    red.position.set(-0.17, 2.82, 0);
    red.rotation.y = -Math.PI / 2;
    g.add(red);
    const green = new Mesh(new CircleGeometry(0.1, 16), glow("#2bd96b", 0));
    green.position.set(-0.17, 2.38, 0);
    green.rotation.y = -Math.PI / 2;
    g.add(green);
    return { red, green };
  }
  const lightsIn = trafficLight(-9.3, 2.35);
  const lightsOut = trafficLight(SX + 3.6, 2.35);
  const barPivot = new Group();
  barPivot.position.set(SX + 5.4, 1.0, -2.35); // AVAGUARD: a car length and a margin past the beam, so the city car stops short of it
  scene.add(barPivot);
  B(0.35, 1.0, 0.35, mats.yellow, SX + 4.2, 0.5, -2.35, scene);
  const barRed = kit.track(new MeshStandardMaterial({ color: raw("#d02a24"), roughness: 0.5 }));
  const barWhite = kit.track(new MeshStandardMaterial({ color: raw("#f2f2f2"), roughness: 0.5 }));
  for (let i = 0; i < 8; i++) B(0.1, 0.1, 0.5, i % 2 ? barWhite : barRed, 0, 0, 0.25 + i * 0.5, barPivot);
  const camPole = (x: number, z: number) => {
    C(0.05, 0.05, 3.2, mats.steelDark, x, 1.6, z, scene);
    B(0.32, 0.18, 0.18, mats.steelDark, x + 0.15, 3.2, z, scene);
  };
  camPole(-10.2, -2.6);
  camPole(SX + 3.8, 3.1);
  const sign = new Mesh(new PlaneGeometry(2.0, 1.0), kit.track(new MeshStandardMaterial({ map: kit.signTex(["ZONE CONTRÔLÉE", "SCAN EN COURS"]), roughness: 0.6 })));
  sign.position.set(SX - 3.4, 4.35, -2.7);
  sign.rotation.y = -Math.PI / 2 + 0.35;
  scene.add(sign);
  C(0.05, 0.05, 4, mats.steelDark, SX - 3.4, 2, -2.75, scene);
  const beacons = (
    [
      [SX - 3.2, 3.9, 2.95],
      [SX - 3.2, 3.9, -2.95],
      [BX + 3.3, 4.4, CZ - 1.5],
    ] as [number, number, number][]
  ).map(([x, y, z]) => {
    const m = new Mesh(new CylinderGeometry(0.12, 0.12, 0.2, 12), glow("#F2B33D", 0.3));
    m.position.set(x, y, z);
    scene.add(m);
    return m;
  });
  const beam = new Mesh(new PlaneGeometry(5.4, 5.0), kit.track(new MeshBasicMaterial({ color: raw("#8fb8ff"), transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide })));
  beam.rotation.y = Math.PI / 2;
  beam.position.set(SX, 2.5, -0.15);
  scene.add(beam);
  const beamLine = new Mesh(new BoxGeometry(0.03, 4.9, 5.4), kit.track(new MeshBasicMaterial({ color: raw("#bcd4ff"), transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false })));
  beamLine.position.copy(beam.position);
  scene.add(beamLine);
  const scanLight = new PointLight(raw("#7fa8ff"), 0, 6, 2);
  scanLight.position.set(SX, 2.5, 0);
  scene.add(scanLight);
  B(2.2, 2.4, 1.8, mats.panelW, SX - 4.6, 1.2, -4.6, scene);
  B(2.4, 0.15, 2.0, mats.steelDark, SX - 4.6, 2.48, -4.6, scene);
  B(1.4, 0.7, 0.02, glow("#9fc4ff", 0.5), SX - 4.6, 1.6, -3.69, scene, false);

  const detMat = detStrip.material as MeshStandardMaterial;
  const beamMat = beam.material as MeshBasicMaterial;
  const lineMat = beamLine.material as MeshBasicMaterial;
  const setTraffic = (l: typeof lightsIn, state: "red" | "green") => {
    (l.red.material as MeshStandardMaterial).emissiveIntensity = state === "red" ? 3 : 0;
    (l.green.material as MeshStandardMaterial).emissiveIntensity = state === "green" ? 3 : 0;
  };
  return {
    setBeam(on: boolean) {
      beamMat.opacity = on ? 0.035 : 0;
      lineMat.opacity = on ? 0.55 : 0;
      scanLight.intensity = on ? SCAN_LIGHT : 0;
      detMat.emissiveIntensity = on ? 2.2 : 0.6;
    },
    setTraffic,
    lightsIn,
    lightsOut,
    barPivot,
    beacons: beacons.map((b) => b.material as MeshStandardMaterial),
    /** the third beacon stands on the baler (yard coordinates): a city yard re-parents it there */
    balerBeacon: beacons[2],
  };
}
