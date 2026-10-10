import type { PerspectiveCamera } from "three";
import type { Hud } from "../hud/controller";
import type { GuardVerdict } from "../types";
import type { buildBaler } from "./baler";
import type { buildCar } from "./car";
import { BALE_GRIP, CAR_GRIP, CHX, CHZ, CZ, FLOOR, LID_OPEN, PICK, RAM_OPEN, SIDE_OPEN, SKIP_LAND, SX } from "./constants";
import type { buildCrane } from "./crane";
import type { buildPortal } from "./portal";
import type { buildSkip } from "./skip";
import { E, baleOut, camAt, craneAt, doorAngle, lidAngle, phaseAt, pressState, ramX, seg, sideZ, swingAt } from "./timeline";

/* The scene at instant t, whole: every piece is set from t alone (defaults first, then the phase's own), so frame(15.5)
   gives the same image as playing up to 15.5 (seek, captures, tests). Only the camera's shake, an impulse the loop
   passes in, is not a function of t. As the reference's frame(). */

export type Yard = {
  camera: PerspectiveCamera;
  portal: ReturnType<typeof buildPortal>;
  car: ReturnType<typeof buildCar>;
  baler: ReturnType<typeof buildBaler>;
  crane: ReturnType<typeof buildCrane>;
  skip: ReturnType<typeof buildSkip>;
  hud: Hud | null;
  verdict: GuardVerdict;
};

/** the impacts that shake the camera: the end of each stroke, and the bale landing in the skip */
export const IMPACTS: [number, number][] = [
  [14.6, 0.18],
  [15.8, 0.18],
  [16.65, 0.18],
  [21.2, 0.1],
];

export function frame(t: number, y: Yard, shake = 0, rnd: () => number = Math.random) {
  const { camera, portal, baler, crane, skip, hud, verdict } = y;
  const car = y.car.car;
  const [cp, cl] = camAt(t);
  camera.position.copy(cp);
  if (shake > 0) {
    camera.position.x += (rnd() - 0.5) * shake;
    camera.position.y += (rnd() - 0.5) * shake;
  }
  camera.lookAt(cl);
  const blink = Math.floor(t * 3) % 2;

  // ---- defaults, so any t stands on its own
  car.quaternion.identity();
  car.visible = true;
  y.car.setScan(99);
  y.car.flagMat.opacity = 0;
  portal.setBeam(false);
  portal.setTraffic(portal.lightsIn, "red");
  portal.setTraffic(portal.lightsOut, "red");
  portal.beacons.forEach((b) => (b.emissiveIntensity = 0.3));
  skip.rimMat.opacity = 0;
  hud?.phase(phaseAt(t));
  hud?.card(t > 2.4);
  hud?.tag(false);
  hud?.xray(t < 2 ? 0 : t < 5.4 ? seg(t, 2.6, 5.0) : 1);
  hud?.rows(t < 2 ? 0 : t < 5.4 ? Math.floor(seg(t, 3.2, 5.4) * 3.99) : t < 7.6 ? Math.floor(seg(t, 5.4, 6.4) * 2) + 3 : 5);
  hud?.score(t < 5.4 ? null : t < 7.6 ? Math.round(verdict.score * E.out(seg(t, 5.5, 6.6))) : verdict.score);
  hud?.verdict(t > 6.8);

  // ---- the gantry
  if (t < 2) {
    car.position.set(-16 + (SX - 3.3 + 16) * E.out(seg(t, 0, 2)), 0, 0);
    portal.setTraffic(portal.lightsIn, t > 1.5 ? "green" : "red");
  } else if (t < 5.4) {
    car.position.set(SX - 3.3 + 6.7 * seg(t, 2.1, 5.2), 0, 0);
    y.car.setScan(SX);
    portal.setBeam(true);
    portal.beacons.slice(0, 2).forEach((b) => (b.emissiveIntensity = blink ? 3 : 0.3));
  } else if (t < 7.6) {
    car.position.set(SX + 3.4, 0, 0);
    y.car.setScan(t < 6.4 ? -99 : 99);
    if (t > 6.8) y.car.flagMat.opacity = 0.5 + 0.5 * blink;
  } else if (t < 10.4) {
    car.position.set(SX + 3.4 + (PICK.x - SX - 3.4) * E.io(seg(t, 7.8, 10.2)), 0, 0);
  }
  if (t >= 7.6) y.car.flagMat.opacity = t < 10.4 ? 0.8 : 0;

  // ---- the crane
  const cs = craneAt(t);
  crane.setCrane(cs.root, cs.jaw, t >= 10.4 ? swingAt(t) : [0, 0]);

  // ---- the baler
  if (t >= 13.8) {
    baler.lids.forEach((p) => (p.rotation.x = lidAngle(t)));
    baler.sidePlate.position.z = sideZ(t);
    baler.setRam(ramX(t));
    baler.door.rotation.z = doorAngle(t);
    baler.sideRods.forEach((r) => (r.position.z = CZ + 1.65 - (SIDE_OPEN - sideZ(t))));
    portal.beacons[2].emissiveIntensity = t < 17.1 ? (blink ? 3 : 0.3) : 0.3;
  } else {
    baler.lids.forEach((p) => (p.rotation.x = LID_OPEN));
    baler.sidePlate.position.z = SIDE_OPEN;
    baler.setRam(RAM_OPEN);
    baler.door.rotation.z = 0;
    baler.sideRods.forEach((r) => (r.position.z = CZ + 1.65));
  }

  // ---- the car: intact, held, laid, crushed, ejected, carried, dropped
  if (t < 13.8) y.car.crush(0, 0, 0);
  if (t >= 10.4 && t < 13.8) {
    if (cs.hold === "car") crane.hang(car, cs.jaw, CAR_GRIP);
    else if (t >= 13.3) car.position.set(CHX, FLOOR, CHZ);
    else car.position.set(PICK.x, 0, 0);
  }
  if (t >= 13.8 && t < 17.15) {
    const st = pressState(t);
    y.car.crush(st.kT, st.kS, st.kE);
    car.position.set(st.cx, FLOOR, st.cz);
  }
  if (t >= 17.15) y.car.crush(1, 1, 1);
  if (t >= 17.15 && t < 19.45) {
    const b = baleOut(t);
    car.position.set(b.x, b.y, CZ - 0.04);
    car.rotation.set(0, 0, b.rz);
  }
  if (t >= 19.45) {
    if (cs.hold === "bale") crane.hang(car, cs.jaw, BALE_GRIP);
    else {
      // let go over the pile: a short fall, contact, settled
      const u = t - 21.15;
      const drop = Math.max(0, 0.04 - 0.5 * 9.81 * Math.max(0, u) * Math.max(0, u));
      car.position.set(SKIP_LAND.x, SKIP_LAND.y + drop, SKIP_LAND.z);
      car.rotation.set(0.04, 0.12, -0.05 * Math.min(1, Math.max(0, u) * 6));
      if (t > 21.2) {
        skip.rimMat.opacity = Math.max(0.35, 1 - (t - 21.2) / 1.2);
        hud?.tag(true);
      }
    }
  }
}
