// AVAGUARD: our parcel's geometry (not from builders-hub): one straight road from our control tower to the C-Chain, the
// way the Sentinel protocol reads (Sentinel Protocole Pub.html). The tower stands at the back of its block (city.ts
// sets it there), the X-ray gantry on the road in front of it, the human post on the right, the Guard Yard on the left,
// the C-Chain's gate at the plaza's edge; a raised pad (the campus) carries them all at the block's level. Every leg is
// a direct, forward way to its place: no U-turn, no reverse, no zigzag. World frame as model.ts: plan x -> X,
// plan y -> Z, Y up.
import { Matrix4, Vector3 } from "three";
import { CHX, CHZ, FLOOR, KX, KZ, PICK, POD_W, SKIP_LAND } from "@/components/guard-yard/three/constants";
import type { City } from "@/components/explorer-v2/network/city";
import { AVAGUARD_ID } from "@/components/explorer-v2/network/avaguard";
import type { Leg } from "@/sim/store";
import { BLOCK_H, type Building, type CityModel } from "./model";
import { LOT, SIZE, WIDTH } from "./Traffic";
import { CAR_LENGTH } from "./carModel";

/** the human post: a covered car park on the road's right, its drive-through aisle along the road, an entry gate and an
    exit gate on its front, the warden's booth by the aisle. Its frame: +x away from the road, +z toward the tower */
export type Parking = {
  c: Vector3;
  yaw: number;
  slotYaw: number;
  slots: Vector3[];
  /** a bay's width and depth, the aisle's width in front of the bays */
  bay: number;
  depth: number;
  aisle: number;
  /** the slab's extent in its frame; the entry gate (toward the tower) and the exit gate on its front side (x = x0) */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  gateZ: number;
  exitZ: number;
  gateW: number;
  gate: Vector3;
  exit: Vector3;
  /** where the car waits, in the aisle by the booth */
  wait: Vector3;
  /** the slab's level */
  y: number;
  w: number;
  d: number;
};

export type Path = { pts: Vector3[]; cum: number[]; len: number; back: boolean[] };
export type GuardGeo = {
  S: number;
  carW: number;
  carL: number;
  hq: Building;
  hubTop: number;
  /** the road's axis: F from the tower toward the C-Chain, R to its right (a driver's right) */
  F: Vector3;
  R: Vector3;
  /** a point at d from the hub along the axis, s to the right of it, at the campus' level */
  P: (d: number, s: number, y?: number) => Vector3;
  /** the campus: the raised pad under the parcel, in (d, s) */
  pad: { d0: number; d1: number; s0: number; s1: number; y: number };
  /** the X-ray gantry: its beam's point on the road, the road's heading there */
  toll: { p: Vector3; yaw: number; span: number };
  stop: { p: Vector3; yaw: number };
  /** the C-Chain's gate on the road into the hub: a visa's car goes through it and is gone (GuardCar clips it there) */
  gate: { p: Vector3; yaw: number; w: number };
  /** the yard's metres in the world */
  k: number;
  legs: Record<Exclude<Leg, "none">, Path>;
  parking: Parking;
  /** the Guard Yard (baler, crane, skip) standing in the city: its frame, its scale, its landmarks in the world */
  scrapyard: { c: Vector3; matrix: Matrix4; zHat: Vector3; crusher: Vector3; bin: Vector3; pick: Vector3; skip: Vector3; w: number; d: number; W: (x: number, y: number, z: number) => Vector3 };
  proof: Vector3;
  out: Vector3;
  dbg?: Record<string, number>;
};

/** a polyline resampled by its length; `back` marks the stretches the car drives in reverse */
export function pathOf(pts: Vector3[], back: boolean[] = []): Path {
  const clean = pts.filter((p, i) => i === 0 || p.distanceTo(pts[i - 1]) > 0.01);
  const cum = [0];
  for (let i = 1; i < clean.length; i++) cum.push(cum[i - 1] + clean[i].distanceTo(clean[i - 1]));
  return { pts: clean, cum, len: cum[cum.length - 1] || 1e-6, back: clean.map((_, i) => back[i] ?? false) };
}

/** the car's place and heading at a share u of a path (heading as the lanes' yaw: atan2(dz, dx)) */
export function poseAt(path: Path, u: number, out = new Vector3()): { p: Vector3; yaw: number; back: boolean } {
  const s = Math.max(0, Math.min(1, u)) * path.len;
  let i = 1;
  while (i < path.pts.length - 1 && path.cum[i] < s) i++;
  const a = path.pts[i - 1];
  const b = path.pts[i] ?? a;
  const seg = path.cum[i] - path.cum[i - 1] || 1;
  const t = Math.max(0, Math.min(1, (s - path.cum[i - 1]) / seg));
  out.copy(a).lerp(b, t);
  const back = path.back[i - 1];
  let yaw = Math.atan2(b.z - a.z, b.x - a.x);
  if (back) yaw += Math.PI;
  return { p: out, yaw, back };
}

/** smooth a corner-to-corner polyline (Catmull-Rom through its points) */
function smooth(pts: Vector3[], per = 10): Vector3[] {
  if (pts.length < 3) return pts;
  const out: Vector3[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < per; k++) {
      const t = k / per;
      const t2 = t * t;
      const t3 = t2 * t;
      const c = (a: number, b: number, c2: number, d: number) => 0.5 * (2 * b + (-a + c2) * t + (2 * a - 5 * b + 4 * c2 - d) * t2 + (-a + 3 * b - 3 * c2 + d) * t3);
      out.push(new Vector3(c(p0.x, p1.x, p2.x, p3.x), c(p0.y, p1.y, p2.y, p3.y), c(p0.z, p1.z, p2.z, p3.z)));
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** a straight run between two points, sampled every `step` */
function run(a: Vector3, b: Vector3, step: number): Vector3[] {
  const n = Math.max(1, Math.ceil(a.distanceTo(b) / step));
  return Array.from({ length: n + 1 }, (_, i) => a.clone().lerp(b, i / n));
}

export function guardGeoOf(model: CityModel, city: City): GuardGeo | null {
  const hubB = model.buildings[model.hub];
  const hqI = model.byId.get(AVAGUARD_ID);
  if (!hubB || hqI === undefined) return null;
  const hq = model.buildings[hqI];
  const S = city.lot;
  const carW = WIDTH * Math.min(1.25, Math.max(0.6, S / LOT)) * SIZE * 1.9; // our car stands out: about twice a pod
  const carL = CAR_LENGTH * carW; // the City's car (carModel.ts), a lane wide
  const k = carW / POD_W; // the yard's metres: its car is POD_W metres wide
  const padY = BLOCK_H; // the campus stands at the blocks' level

  // the axis: from the tower toward the hub (F), the driver's right (R); a point by its distance from the hub and its side
  const dHQ = Math.hypot(hq.x, hq.z) || 1;
  const F = new Vector3(-hq.x / dHQ, 0, -hq.z / dHQ);
  const up = new Vector3(0, 1, 0);
  const R = F.clone().cross(up);
  const P = (d: number, s: number, y = padY + 0.02) => new Vector3(0, y, 0).addScaledVector(F, -d).addScaledVector(R, s);
  const yaw = Math.atan2(F.z, F.x);

  // along the road, from the tower's door toward the hub: the gantry's beam, the car fully before it, fully past it and
  // short of its barrier (portal.ts); then the human post's entry, the post, its exit, the yard's lane, and the C-Chain's
  // gate on the plaza, each nearer the hub than the last, so every way is forward
  const core = city.core;
  const bay = carW * 1.5;
  const nBays = 3;
  const edge = carW * 0.5;
  const z1 = (nBays / 2) * bay + edge;
  const gateZ = z1 - bay * 0.55;
  const dDoor = dHQ - hq.n.w * 0.6;
  const dPre = dDoor - carL * 0.3;
  const dBeam = dPre - (carL / 2 + carW * 0.25);
  const dStop = dBeam - (carL / 2 + carW * 0.3);
  const dPost = dStop - carW * 2 - gateZ;
  const dYard = dPost - gateZ - carL;
  const dGate = Math.max(hubB.n.w * 0.75 + carW * 0.6, dYard - carW * 3);
  const dEnd = dGate - carL * 1.5;
  const dPadFront = dGate - carW * 0.4;
  const roadHalf = carW * 1.6;

  // the campus' level all the way to the gate; past it (where the car is gone) the road drops to the plaza
  const yRoad = (d: number) => (d >= dPadFront ? padY : Math.max(0, padY - (dPadFront - d) * 0.5)) + 0.02;
  const A = (d: number, s = 0) => P(d, s, yRoad(d));

  const step = carW * 0.25;
  const approach = pathOf(run(A(dHQ), A(dPre), step));
  const scanPass = pathOf(run(A(dPre), A(dStop), step));
  const straightOn = (from: number) => [...run(A(from), A(dGate + carW), step), ...run(A(dGate + carW), A(dEnd), step).slice(1)];
  const toCChain = pathOf(straightOn(dStop));

  // the human post on the right: the aisle runs along the road; in by the entry gate, the car waits by the booth, out by
  // the exit gate, onward to the C-Chain or across to the yard
  const depth = carL * 1.05;
  const aisle = carW * 1.9;
  const x0 = -depth / 2 - aisle - edge;
  const x1 = depth / 2 + edge;
  const front = roadHalf + carW * 0.35; // the lot's front railing, beside the road's edge
  const pc = P(dPost, front - x0);
  // its frame: +x away from the road (R), +z toward the tower (-F)
  const xHat = R.clone();
  const zHat = F.clone().negate();
  const L = (x: number, z: number, y = padY + 0.02) => pc.clone().addScaledVector(xHat, x).addScaledVector(zHat, z).setY(y);
  const exitZ = -gateZ;
  const aisleX = x0 + edge + aisle / 2;
  const slots = Array.from({ length: nBays }, (_, i) => L(0, (i - (nBays - 1) / 2) * bay));
  const wait = L(aisleX, 0);
  const parking: Parking = {
    c: pc.clone().setY(padY),
    yaw: Math.atan2(zHat.z, zHat.x),
    slotYaw: Math.atan2(xHat.z, xHat.x),
    slots,
    bay,
    depth,
    aisle,
    x0,
    x1,
    z0: -z1,
    z1,
    gateZ,
    exitZ,
    gateW: carW * 2,
    gate: L(x0, gateZ),
    exit: L(x0, exitZ),
    wait,
    y: padY,
    w: 2 * z1,
    d: x1 - x0,
  };
  const toParking = pathOf(smooth([A(dStop), A(dStop - carW * 0.8, carW * 0.15), L(x0 - carW * 0.5, gateZ + carW * 0.2), L(aisleX, gateZ - carW * 1.0), L(aisleX, carW * 0.5), wait]));

  // the Guard Yard on the left, in its own metres scaled by k: its x runs away from the road (-R), its lane (z = 0) along
  // the yard's x at dYard, the baler and the skip toward the tower; the car comes in along it to PICK, heading its +x
  const yx = R.clone().negate();
  const yz = yx.clone().cross(up);
  const s0 = -(roadHalf + carW * 0.4) - 5 * k; // the yard's x = -5 (its lane's start) just off the road's left edge
  const yo = P(dYard, s0, padY);
  const W = (x: number, y: number, z: number) => yo.clone().addScaledVector(yx, x * k).addScaledVector(up, y * k).addScaledVector(yz, z * k);
  const matrix = new Matrix4().makeBasis(yx, up, yz).scale(new Vector3(k, k, k)).setPosition(yo);
  const scrapyard = {
    c: W(11, 0, -3),
    matrix,
    zHat: yz,
    crusher: W(CHX, FLOOR, CHZ),
    bin: W(SKIP_LAND.x, SKIP_LAND.y, SKIP_LAND.z),
    pick: W(PICK.x, 0, 0),
    skip: W(KX, 1, KZ),
    w: 20 * k,
    d: 8 * k,
    W,
  };
  const lane = (from: Vector3) => [from, ...run(W(-3, 0, 0), W(PICK.x, 0, 0), step).map((v) => v.setY(padY + 0.02))];
  const toScrapyard = pathOf(smooth([...run(A(dStop), A(dYard + carW * 2.2), carW), A(dYard + carW * 0.9, -carW * 0.2), A(dYard + carW * 0.15, -roadHalf * 0.6), ...lane(W(-5, 0, 0).setY(padY + 0.02))]));
  // from the post: out by the exit gate, straight on to the C-Chain, or across the road into the yard's lane
  const outOfPost = [wait, L(aisleX, exitZ + carW * 0.9), L(x0 - carW * 0.2, exitZ + carW * 0.1)];
  const parkToCChain = pathOf(smooth([...outOfPost, A(dPost - gateZ - carW * 1.2, roadHalf * 0.2), A(dYard), ...run(A(dYard - carW), A(dEnd), carW)]));
  const parkToScrapyard = pathOf(smooth([...outOfPost, A(dPost - gateZ - carW * 1.3, roadHalf * 0.1), A(dYard + carW * 0.15, -roadHalf * 0.6), ...lane(W(-5, 0, 0).setY(padY + 0.02))]));

  const hubTop = hubB.base + hubB.crest;
  return {
    S,
    carW,
    carL,
    hq,
    hubTop,
    F,
    R,
    P,
    pad: { d0: dPadFront, d1: dDoor + carW * 0.5, s0: -(roadHalf + carW * 0.6) - 25 * k, s1: front + (x1 - x0) + carW, y: padY },
    toll: { p: A(dBeam), yaw, span: Math.max(carW * 2.4, S * 0.7) },
    stop: { p: A(dStop), yaw },
    gate: { p: A(dGate), yaw, w: carW * 2.4 },
    k,
    legs: { approach, scanPass, toCChain, toScrapyard, toParking, parkToCChain, parkToScrapyard },
    parking,
    scrapyard,
    dbg: { dHQ, dDoor, dPre, dBeam, dStop, dPost, dYard, dGate, dEnd, core, k },
    proof: P(dHQ - hq.n.w * 0.2, hq.n.w * 1.9, padY),
    out: A(dEnd),
  };
}
