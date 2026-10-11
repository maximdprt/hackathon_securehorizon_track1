import { Vector3 } from "three";
import {
  BACK_IN,
  BALE_GRIP,
  BALE_HL,
  BX,
  CAR_GRIP,
  CHX,
  CHZ,
  CZ,
  DOOR_IN,
  FLOOR,
  H,
  HALFW0,
  JAW,
  JAW_OPEN,
  KX,
  LID_OPEN,
  PARK,
  PICK,
  PIV,
  RAM_END,
  RAM_OPEN,
  SIDE_OPEN,
  SKIP_LAND,
  WALL,
} from "./constants";
import { halfLOf, halfWOf, solveK, topOf } from "./crush";

/* The whole sequence as pure functions of time, no scene: where the grapple is and what it holds, how the baler's
   pieces stand, how crushed the car is and where it sits, where the ejected bale is, and the camera. frame.ts applies
   them; the tests check them. As the reference, plus the instant t itself as the last sample of the crush loops. */

export const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const E = {
  io: (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2),
  out: (u: number) => 1 - Math.pow(1 - u, 3),
  in: (u: number) => u * u * u,
  sm: (u: number) => u * u * (3 - 2 * u),
};
export const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const V = (x: number, y: number, z: number) => new Vector3(x, y, z);
const lerpV = (a: Vector3, b: Vector3, u: number) => new Vector3().lerpVectors(a, b, u);

// ---- the grapple's geometry
export const spread = (a: number) => PIV + JAW * Math.sin(a); // half gap between the tips
export const depth = (a: number) => JAW * Math.cos(a); // the tips' depth under the pivots
export const contactAngle = (w: number) => Math.asin(clamp((w + 0.05 - PIV) / JAW, -1, 1)); // jaws touching an object of half width w
export const A_CAR = contactAngle(HALFW0);
export const A_BALE = contactAngle(0.55);
export const ROOT_CAR = 0.45 + depth(A_CAR) + CAR_GRIP; // root height over the car's base
export const ROOT_BALE = 0.45 + depth(A_BALE) + BALE_GRIP;

/** the time samples of a contact loop: every .02 s from a to b, and b itself last */
function samples(a: number, b: number) {
  const out: number[] = [];
  for (let tt = a; tt <= b + 1e-6; tt += 0.02) out.push(tt);
  if (b >= a && (out.length === 0 || out[out.length - 1] < b - 1e-9)) out.push(b);
  return out;
}

// ---- the baler
export const lidAngle = (t: number) => LID_OPEN + (0 - LID_OPEN) * E.in(seg(t, 13.9, 14.6)) - (0 - LID_OPEN) * E.io(seg(t, 14.75, 15.15));
export const SIDE_INNER = BACK_IN + 2 * 0.55 + 0.005;
export const sideZ = (t: number) => SIDE_OPEN - (SIDE_OPEN - (SIDE_INNER + 0.1)) * E.in(seg(t, 15.15, 15.8)) + (SIDE_OPEN - (SIDE_INNER + 0.1)) * E.io(seg(t, 16.7, 17.1));
export const RAM_COMP = DOOR_IN - 2 * 1.02 - 0.1;
export function ramX(t: number) {
  let x = RAM_OPEN + (RAM_COMP - RAM_OPEN) * E.sm(seg(t, 15.9, 16.65));
  x += (RAM_END - RAM_COMP) * E.io(seg(t, 17.15, 17.85));
  return x - (RAM_END - RAM_OPEN) * E.io(seg(t, 18.0, 18.6));
}
export const doorAngle = (t: number) => 1.9 * E.io(seg(t, 16.85, 17.15)) - 1.9 * E.io(seg(t, 18.1, 18.5));

/** the lid's underside over the car's middle, above the chamber floor (99 while it stands past vertical) */
export function lidClearance(th: number) {
  const dz = CHZ - (CZ - 1.25);
  return th > -Math.PI / 2 + 0.01 ? H + dz * Math.tan(-th) - FLOOR : 99;
}

/** the car in the chamber at t: its crush (cumulative maxima, metal does not spring back) and its place */
export function pressState(t: number) {
  let kT = 0;
  for (const tt of samples(13.9, t)) kT = Math.max(kT, solveK(topOf, lidClearance(lidAngle(tt))));
  kT = Math.max(kT, t >= 14.6 ? solveK(topOf, WALL) : 0);
  const zi = sideZ(t) - 0.1;
  let kS = 0;
  for (const tt of samples(15.15, Math.min(t, 15.8))) {
    const z2 = sideZ(tt) - 0.1;
    kS = Math.max(kS, solveK((k) => halfWOf(kT, k), (z2 - BACK_IN) / 2));
  }
  if (t > 15.8) kS = Math.max(kS, solveK((k) => halfWOf(kT, k), 0.55 + 0.002));
  const hw = halfWOf(kT, kS);
  const cz = Math.max(BACK_IN + hw, Math.min(CHZ, zi - hw));
  // the end ram pushes the car to the door, then compresses it
  let kE = 0;
  const rear0 = CHX - halfLOf(kT, 0);
  for (const tt of samples(15.9, Math.min(t, 16.65))) {
    const r = Math.min(ramX(tt), RAM_COMP) + 0.1;
    if (r > rear0) {
      const len = DOOR_IN - r;
      if (2 * halfLOf(kT, 0) > len) kE = Math.max(kE, solveK((k) => 2 * halfLOf(kT, k), len));
    }
  }
  if (t > 16.65) kE = 1;
  const face = Math.min(ramX(t), RAM_COMP) + 0.1;
  const hl = halfLOf(kT, kE);
  let cx = Math.max(CHX, face + hl);
  cx = Math.min(cx, DOOR_IN - hl);
  return { kT, kS, kE, cx, cz };
}

// ---- the ejected bale: slides, tips at the edge, falls, bounces, settles
const pushAt = (tt: number) => Math.max(DOOR_IN - BALE_HL, Math.min(ramX(Math.min(tt, 17.85)), RAM_END) + 0.1 + BALE_HL);
const T_EDGE = (() => {
  const edge = DOOR_IN + 0.09; // the chamber floor's edge
  let tEdge = 17.15;
  while (tEdge < 17.85 && pushAt(tEdge) < edge) tEdge += 0.005; // the centre of gravity passes the edge
  return tEdge;
})();
export function baleOut(t: number) {
  const push = pushAt(Math.min(t, T_EDGE));
  if (t < T_EDGE) return { x: push, y: FLOOR, rz: 0 };
  const v = 2.4; // horizontal speed off the edge
  const tf = Math.sqrt((2 * FLOOR) / 9.81);
  const u = t - T_EDGE;
  if (u < tf) return { x: push + v * u * 0.7, y: FLOOR - 0.5 * 9.81 * u * u, rz: -Math.min(0.55, u * 2.4) };
  const land = push + v * tf * 0.7;
  const w = u - tf;
  const bounce = Math.max(0, 0.08 * Math.sin(w * 18) * Math.exp(-w * 9));
  return { x: land + 0.25 * (1 - Math.exp(-w * 8)), y: bounce, rz: -0.55 * Math.exp(-w * 10) * Math.cos(w * 14) };
}
export const baleRest = () => baleOut(18.3);
export const T_BALE_EDGE = T_EDGE;

// ---- the crane: (root, jaws' angle, what it holds) at t
export type Hold = null | "car" | "bale";
export function craneAt(t: number): { root: Vector3; jaw: number; hold: Hold } {
  const carry = 2.4; // clearance over the walls while transferring
  const pickTop = V(PICK.x, carry + ROOT_CAR, 0);
  const pickGrab = V(PICK.x, ROOT_CAR, 0);
  const chTop = V(CHX, FLOOR + 0.03 + ROOT_CAR + 1.0, CHZ);
  const chDrop = V(CHX, FLOOR + 0.03 + ROOT_CAR, CHZ);
  const ob = baleRest();
  const baleTop = V(ob.x, carry + ROOT_BALE, CZ - 0.04);
  const baleGrab = V(ob.x, ROOT_BALE, CZ - 0.04);
  const kTop = V(SKIP_LAND.x, 2.9 + ROOT_BALE, SKIP_LAND.z);
  const kDrop = V(SKIP_LAND.x, SKIP_LAND.y + 0.04 + ROOT_BALE, SKIP_LAND.z);
  const arc = (a: Vector3, b: Vector3, u: number, lift: number) => {
    const p = lerpV(a, b, u);
    p.y += Math.sin(u * Math.PI) * lift;
    return p;
  };
  if (t < 10.4) return { root: PARK.clone(), jaw: 0.2, hold: null };
  if (t < 11.0) return { root: arc(PARK, pickTop, E.io(seg(t, 10.4, 11.0)), 0.4), jaw: JAW_OPEN, hold: null };
  if (t < 11.35) return { root: lerpV(pickTop, pickGrab, E.io(seg(t, 11.0, 11.35))), jaw: JAW_OPEN, hold: null };
  if (t < 11.6) return { root: pickGrab, jaw: JAW_OPEN + (A_CAR - JAW_OPEN) * E.sm(seg(t, 11.35, 11.6)), hold: null };
  if (t < 12.0) return { root: lerpV(pickGrab, pickTop, E.io(seg(t, 11.6, 12.0))), jaw: A_CAR, hold: "car" };
  if (t < 12.9) return { root: arc(pickTop, chTop, E.io(seg(t, 12.0, 12.9)), 0.3), jaw: A_CAR, hold: "car" };
  if (t < 13.3) return { root: lerpV(chTop, chDrop, E.io(seg(t, 12.9, 13.3))), jaw: A_CAR, hold: "car" };
  if (t < 13.45) return { root: chDrop, jaw: A_CAR + (0 - A_CAR) * E.sm(seg(t, 13.3, 13.45)), hold: null };
  if (t < 13.8) return { root: lerpV(chDrop, chTop, E.io(seg(t, 13.45, 13.8))), jaw: 0, hold: null };
  if (t < 18.3) return { root: arc(chTop, PARK, E.io(seg(t, 13.8, 14.3)), 0.3), jaw: 0.2, hold: null };
  if (t < 18.9) return { root: arc(PARK, baleTop, E.io(seg(t, 18.3, 18.9)), 0.3), jaw: JAW_OPEN, hold: null };
  if (t < 19.2) return { root: lerpV(baleTop, baleGrab, E.io(seg(t, 18.9, 19.2))), jaw: JAW_OPEN, hold: null };
  if (t < 19.45) return { root: baleGrab, jaw: JAW_OPEN + (A_BALE - JAW_OPEN) * E.sm(seg(t, 19.2, 19.45)), hold: null };
  if (t < 19.8) return { root: lerpV(baleGrab, baleTop, E.io(seg(t, 19.45, 19.8))), jaw: A_BALE, hold: "bale" };
  if (t < 20.8) return { root: arc(baleTop, kTop, E.io(seg(t, 19.8, 20.8)), 0.3), jaw: A_BALE, hold: "bale" };
  if (t < 21.1) return { root: lerpV(kTop, kDrop, E.io(seg(t, 20.8, 21.1))), jaw: A_BALE, hold: "bale" };
  if (t < 21.25) return { root: kDrop, jaw: A_BALE + (0 - A_BALE) * E.sm(seg(t, 21.1, 21.25)), hold: null };
  return { root: arc(kDrop, PARK, E.io(seg(t, 21.3, 22.1)), 0.6), jaw: 0.2, hold: null };
}

/** the grapple's sway, from its root's horizontal acceleration (finite differences, deterministic) */
export function swingAt(t: number): [number, number] {
  const h = 0.06;
  const a = craneAt(t - h).root;
  const b = craneAt(t).root;
  const c = craneAt(t + h).root;
  const ax = (a.x - 2 * b.x + c.x) / (h * h);
  const az = (a.z - 2 * b.z + c.z) / (h * h);
  const k = 0.012;
  return [clamp(az * k, -0.18, 0.18), clamp(-ax * k, -0.18, 0.18)];
}

// ---- the camera
export const CAMS: [number, Vector3, Vector3][] = [
  [0, V(-18.5, 9.4, 8.2), V(-3.6, 0.7, -0.4)],
  [8.0, V(-18.5, 9.4, 8.2), V(-3.6, 0.7, -0.4)],
  [10.3, V(BX - 2.5, 8.6, 12.5), V(BX + 1.2, 1.4, -2.2)],
  [13.6, V(BX - 2.5, 8.6, 12.5), V(BX + 1.2, 1.4, -2.2)],
  [14.1, V(BX - 0.2, 12.5, 4.2), V(BX, 1.0, CZ + 0.3)],
  [16.9, V(BX - 0.2, 12.5, 4.2), V(BX, 1.0, CZ + 0.3)],
  [17.4, V(BX + 8.5, 5.2, CZ - 6.5), V(BX + 4.0, 0.9, CZ + 0.2)],
  [19.7, V(BX + 8.5, 5.2, CZ - 6.5), V(BX + 4.0, 0.9, CZ + 0.2)],
  [20.6, V(BX + 6.5, 9.0, 11.5), V(KX - 1.2, 1.2, -2.2)],
];
export function camAt(t: number): [Vector3, Vector3] {
  for (let i = 0; i < CAMS.length - 1; i++) {
    const [a, p0, l0] = CAMS[i];
    const [b, p1, l1] = CAMS[i + 1];
    if (t < b) {
      const u = E.io(seg(t, a, b));
      return [lerpV(p0, p1, u), lerpV(l0, l1, u)];
    }
  }
  const l = CAMS[CAMS.length - 1];
  return [l[1].clone(), l[2].clone()];
}

/** the phase's words in the top left cartouche */
export function phaseAt(t: number): string {
  if (t < 2) return "Transaction en approche du portique";
  if (t < 5.4) return "Radiographie du smart contract";
  if (t < 7.6) return t < 6.8 ? "Analyse Sentinel" : "Refusée : fraude détectée";
  if (t < 10.4) return "Direction la presse à épaves";
  if (t < 13.8) return t < 11.6 ? "La grue saisit l'épave" : t < 13.3 ? "Chargement dans la presse" : "Épave en place";
  if (t < 17.15) return t < 14.65 ? "Compactage : couvercles" : t < 15.85 ? "Compactage : vérin latéral" : t < 16.7 ? "Compactage : vérin d'extrémité" : "Ouverture de la porte";
  if (t < 19.45) return t < 18.3 ? "Éjection du bloc" : "La grue saisit le bloc";
  const cs = craneAt(t);
  return cs.hold === "bale" ? "Direction la benne" : "Adresse ajoutée au registre";
}
