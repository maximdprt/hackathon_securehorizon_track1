// AVAGUARD: our parcel's geometry (not from builders-hub), on the city's own ground: the ring road round the plaza
// carries on straight up the tower's block to our control tower, which stands at the back of its block (city.ts sets it
// there), facing the C-Chain. The X-ray gantry stands on that road, the human post on the block at its right, the Guard
// Yard by the ring road at its left (its lane a stretch of the ring road, its machines on the open ground beside the
// block), the C-Chain's gate where the road meets the plaza. No pad, no other road. Every leg is a direct, forward way
// to its place, drawn as a driver drives it: straight runs and circular turns that meet tangent to each other, never
// tighter than a car can turn, clear of every post, wall and pillar (tests/visual/paths.spec.ts checks it): no U-turn,
// no reverse, no zigzag. World frame as model.ts: plan x -> X, plan y -> Z, Y up.
import { Matrix4, Vector3 } from "three";
import { CHX, CHZ, FLOOR, KX, KZ, PICK, POD_W, SKIP_LAND } from "@/components/guard-yard/three/constants";
import type { City } from "@/components/explorer-v2/network/city";
import { AVAGUARD_ID } from "@/components/explorer-v2/network/avaguard";
import type { Leg } from "@/sim/store";
import { BLOCK_H, type Building, type CityModel } from "./model";
import { LOT, SIZE, WIDTH } from "./Traffic";
import { CAR_LENGTH } from "./carModel";
import { hubFootOf } from "./HubTower";

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
  /** our road: from the ring road's outer edge (d0) up the tower's block to the tower's foot (d1), its half width, and
      its axis at the ground's height, from the tower down to the ring road */
  road: { d0: number; d1: number; half: number; axis: Vector3[] };
  /** where the car leaves the control tower: the tower's corner on the road (its base is a square turned to the plate),
      and the canopy over the road there, its depth along the road and its width */
  departure: { p: Vector3; yaw: number; depth: number; w: number };
  /** the X-ray gantry: its beam's point on the road, the road's heading there */
  toll: { p: Vector3; yaw: number; span: number };
  stop: { p: Vector3; yaw: number };
  /** the C-Chain's gate on the road into the hub: a visa's car goes through it on to the C-Chain's tower, and is gone
      only as its nose meets the tower's foot (the legs to the C-Chain end there) */
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
  const carW = WIDTH * Math.min(1.25, Math.max(0.6, S / LOT)) * SIZE * 0.9; // our car: a pod's size, on the city's own streets
  const carL = CAR_LENGTH * carW; // the City's car (carModel.ts)
  const k = carW / POD_W; // the yard's metres: its car is POD_W metres wide
  const blockY = BLOCK_H; // the tower's block stands a step over the streets

  // the axis: from the tower toward the hub (F), the driver's right (R); a point by its distance from the hub and its side
  const dHQ = Math.hypot(hq.x, hq.z) || 1;
  const a = Math.atan2(hq.z, hq.x);
  const F = new Vector3(-hq.x / dHQ, 0, -hq.z / dHQ);
  const up = new Vector3(0, 1, 0);
  const R = F.clone().cross(up);
  const P = (d: number, s: number, y = blockY + 0.02) => new Vector3(0, y, 0).addScaledVector(F, -d).addScaledVector(R, s);
  const yaw = Math.atan2(F.z, F.x);

  // the city's own ground: the ring road round the plaza (city.ts rings, ROAD 0.5 lot wide), and the tower's block, a
  // step up, from its inner edge outward; the road runs on the block, then down its front onto the ring road
  const ringR = city.rings[0] ?? city.core + S * 0.25;
  const ringHalf = S * 0.25;
  const blockIn = ringR + ringHalf; // the block's inner edge
  const core = city.core;
  const yRoad = (d: number) => (d >= blockIn + carW * 0.3 ? blockY : d <= blockIn - carW * 0.5 ? 0 : (blockY * (d - (blockIn - carW * 0.5))) / (carW * 0.8)) + 0.02;
  const A = (d: number, s = 0) => P(d, s, yRoad(d));
  // the ground's height under any point: the road's ramp near our road, the tower's block on it, the streets elsewhere
  const inBlock = (p: Vector3) => {
    const r = Math.hypot(p.x, p.z);
    const ang = Math.atan2(p.z, p.x);
    return city.blocks.some((b) => r > b.r0 + 1.5 && r < b.r1 - 1.5 && (((ang - b.a0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) <= b.a1 - b.a0);
  };
  const grounded = (pts: Vector3[]) =>
    pts.map((p) => {
      const d = -p.dot(F);
      const s = p.dot(R);
      const y = Math.abs(s) < ringHalf + carW && d > blockIn - carW && d < blockIn + carW ? yRoad(d) : inBlock(p) ? blockY + 0.02 : 0.02;
      return p.setY(y);
    });

  // along the road, from the tower's door toward the hub: the gantry's beam, the car fully before it, fully past it and
  // short of its barrier (portal.ts); the human post on the block at the road's right; the C-Chain's gate where the road
  // meets the plaza
  const bay = carW * 1.5;
  const nBays = 3;
  const edge = carW * 0.5;
  const dDoor = dHQ - hq.n.w * 0.6;
  // the tower's base is a square turned to the plate (model.ts YAW): its corner, on the road, is where the car comes out
  const dFace = dHQ - hq.n.w;
  // room between each piece: out of the door three car lengths before the gantry
  const dPre = dDoor - carL * 3;
  const dBeam = dPre - (carL / 2 + carW * 0.25);
  const dStop = dBeam - (carL / 2 + carW * 0.3);
  const dGate = core - carW * 0.4;
  // past the gate, on across the plaza to the C-Chain's tower: the leg ends where the car's nose meets the tower's foot
  // (its outer step or the stair down its front), never inside it
  const foot = hubFootOf(hubB.n.w);
  const inPoly = (poly: [number, number][], x: number, z: number) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i];
      const [xj, zj] = poly[j];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  };
  const inTower = (p: Vector3) => {
    const x = p.x - hubB.x;
    const z = p.z - hubB.z;
    return inPoly(foot.step, x, z) || (Math.abs(x) <= foot.stair.x && z >= foot.stair.z0 && z <= foot.stair.z1);
  };
  const touches = (d: number) => {
    const nose = P(d, 0, 0).addScaledVector(F, carL / 2);
    return [-0.5, -0.25, 0, 0.25, 0.5].some((s) => inTower(nose.clone().addScaledVector(R, s * carW)));
  };
  const nudge = carW * 0.02;
  let dEnd = dGate - carL;
  for (let d = dGate; d > 0; d -= nudge)
    if (touches(d)) {
      dEnd = d + nudge;
      break;
    }
  const roadHalf = Math.min(ringHalf * 0.8, 2.6 * k); // no wider than the gantry

  const step = carW * 0.25;
  /** the road's axis from d0 down to d1, each point at the ground's own height (the block, its front, the plaza) */
  const along = (d0: number, d1: number) => {
    const n = Math.max(1, Math.ceil(Math.abs(d0 - d1) / step));
    return Array.from({ length: n + 1 }, (_, i) => A(d0 + ((d1 - d0) * i) / n));
  };
  /** a turn: the arc round (d, s) of radius r from angle t0 to t1, its angles from the driver's right (+s) toward the
      tower (+d), a point every step, at the ground's height */
  const turn = (cd: number, cs: number, r: number, t0: number, t1: number) => {
    const n = Math.max(2, Math.ceil((Math.abs(t1 - t0) * r) / step));
    return grounded(Array.from({ length: n + 1 }, (_, i) => {
      const t = t0 + ((t1 - t0) * i) / n;
      return P(cd + r * Math.sin(t), cs + r * Math.cos(t), 0);
    }));
  };
  /** legs joined end to start, their shared points once */
  const join = (...runs: Vector3[][]) => runs.reduce<Vector3[]>((all, r) => (all.length ? [...all, ...r.slice(1)] : [...r]), []);

  // out of the tower's corner, from under the departure canopy, down the road through the gantry's beam to its stop
  const dStart = dFace - carW * 0.6;
  const approach = pathOf(along(dStart, dPre));
  const scanPass = pathOf(along(dPre, dStop));
  const toCChain = pathOf(along(dStop, dEnd));

  /* the human post on the block at the road's right, a drive-through: the car leaves the gantry's stop in an S, two
     quarter turns of one radius (right through the entry gate, left into the aisle), and waits in the aisle by the
     warden's booth; it leaves by the mirror S (left through the exit gate, right back onto the road). The radius is half
     the aisle's offset from the road's axis, so each S ends square on its straight; each gate stands where its S crosses
     the post's front, wide enough for the car crossing it at that angle */
  const depth = carL * 1.05;
  const aisle = carW * 1.9;
  const x0 = -depth / 2 - aisle - edge;
  const x1 = depth / 2 + edge;
  const front = roadHalf + carW * 0.6;
  const aisleS = front + edge + aisle / 2;
  const r = aisleS / 2;
  const dWait = dStop - 2 * r;
  const dPost = dWait;
  // where each S crosses the post's front (s = front): its angle on the turn that crosses it, and its distance from the wait
  const cross = r * Math.cos(Math.asin(Math.min(1, Math.max(-1, (front - r) / r))));
  const gateZ = cross;
  const exitZ = -cross;
  const gateW = carW * 2.4;
  const z1 = gateZ + gateW / 2 + carW * 0.35;
  const pc = P(dPost, front - x0);
  const xHat = R.clone();
  const zHat = F.clone().negate();
  const L = (x: number, z: number, y = blockY + 0.02) => pc.clone().addScaledVector(xHat, x).addScaledVector(zHat, z).setY(y);
  const aisleX = x0 + edge + aisle / 2;
  const slots = Array.from({ length: nBays }, (_, i) => L(0, (i - (nBays - 1) / 2) * bay));
  const wait = L(aisleX, 0);
  const parking: Parking = {
    c: pc.clone().setY(blockY),
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
    gateW,
    gate: L(x0, gateZ),
    exit: L(x0, exitZ),
    wait,
    y: blockY,
    w: 2 * z1,
    d: x1 - x0,
  };
  // in: right round (r, dStop), left round (r, dWait); out: left round (r, dWait), right round (r, dWait - 2r)
  const toParking = pathOf(join(turn(dStop, r, r, Math.PI, 1.5 * Math.PI), turn(dWait, r, r, 0.5 * Math.PI, 0)));
  const outOfPost = join(turn(dWait, r, r, 0, -0.5 * Math.PI), turn(dWait - 2 * r, r, r, 0.5 * Math.PI, Math.PI));
  const dBack = dWait - 2 * r;

  // the Guard Yard by the ring road at the road's left: its lane is the ring road's outer lane (a straight stretch of it,
  // tangent to the ring), the car comes round onto it and up to PICK heading the yard's +x; the baler, the crane and the
  // skip stand outward of the ring, on the open ground beside the tower's block, at the streets' level
  const laneR = ringR + ringHalf * 0.45;
  // the side the yard stands on, round the ring from the axis: R points clockwise or counter-clockwise
  const ccw = new Vector3(-Math.sin(a), 0, Math.cos(a));
  const leftSign = R.dot(ccw) > 0 ? -1 : 1; // the driver's left, as a turn round the ring
  // the tangent point: far enough round that the baler clears the tower's block (its arc half-width), with a margin
  const block = city.blocks.find((b) => {
    const m = (((a - b.a0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    return m <= b.a1 - b.a0 && dHQ > b.r0 && dHQ < b.r1;
  });
  const half = block ? (block.a1 - block.a0) / 2 : 0.4;
  const theta0 = a + leftSign * (half - (2.5 * k) / laneR + (carW * 1.2) / laneR);
  const T = new Vector3(laneR * Math.cos(theta0), 0, laneR * Math.sin(theta0));
  const yx = new Vector3(-Math.sin(theta0), 0, Math.cos(theta0)).multiplyScalar(leftSign); // round the ring, the way the car turns
  const yz = yx.clone().cross(up); // inward on the left turn (the baler's -z outward)
  const outward = new Vector3(Math.cos(theta0), 0, Math.sin(theta0));
  const flip = yz.dot(outward) > 0 ? -1 : 1; // keep the baler (-z) outward whichever way round
  const yzz = yz.multiplyScalar(flip);
  const yo = T.clone().addScaledVector(yx, -2.5 * k);
  const W = (x: number, y: number, z: number) => yo.clone().addScaledVector(yx, x * k).addScaledVector(up, y * k).addScaledVector(yzz, z * k);
  const matrix = new Matrix4().makeBasis(yx, up, yzz).scale(new Vector3(k, k, k)).setPosition(yo);
  const scrapyard = {
    c: W(11, 0, -3),
    matrix,
    zHat: yzz,
    crusher: W(CHX, FLOOR, CHZ),
    bin: W(SKIP_LAND.x, SKIP_LAND.y, SKIP_LAND.z),
    pick: W(PICK.x, 0, 0),
    skip: W(KX, 1, KZ),
    w: 20 * k,
    d: 8 * k,
    W,
  };
  /* down the road onto the ring road, round it to the left, onto the yard's lane: a left turn off the road's axis that
     meets the ring's outer lane tangent to it (the two circles touch outside: |its centre| = laneR + rf, on the driver's
     left of the axis), round the ring to the yard's tangent point T, and straight along the yard's lane to PICK. The turn
     starts where the post's S comes back onto the road, so the refusal from the gantry and the one from the post take
     the same way round */
  const rfFit = (dBack * dBack - laneR * laneR) / (2 * laneR);
  const rf = Math.min(carW * 2.6, Math.max(carW * 0.8, rfFit));
  const dTurn = Math.sqrt(laneR * laneR + 2 * laneR * rf);
  const tJ = Math.atan2(-dTurn, rf); // from the turn's centre toward the hub, where it meets the ring
  const offRoad = turn(dTurn, -rf, rf, 0, tJ);
  const J = offRoad[offRoad.length - 1];
  const thJ = Math.atan2(J.z, J.x);
  const dth = (((theta0 - thJ) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI; // the short way round, toward the yard
  const nRing = Math.max(2, Math.ceil((Math.abs(dth) * laneR) / step));
  const roundRing = Array.from({ length: nRing + 1 }, (_, i) => {
    const th = thJ + (dth * i) / nRing;
    return new Vector3(laneR * Math.cos(th), 0.02, laneR * Math.sin(th));
  });
  const yardLane = run(T, W(PICK.x, 0, 0), step).map((v) => v.setY(0.02));
  const toYard = join(offRoad, roundRing, yardLane);
  const toScrapyard = pathOf(join(along(dStop, dTurn), toYard));

  // from the post: out by the exit gate, back onto the road, then straight on to the C-Chain or round to the yard
  const parkToCChain = pathOf(join(outOfPost, along(dBack, dEnd)));
  const parkToScrapyard = pathOf(join(outOfPost, dBack - dTurn > step ? along(dBack, dTurn) : [], toYard));

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
    road: { d0: blockIn - carW * 0.5, d1: dFace + carW * 0.3, half: roadHalf, axis: along(dFace + carW * 0.3, blockIn - carW * 0.5) },
    // the canopy reaches from the tower to just short of the gantry's furniture (its camera pole stands 6.2 m before the beam)
    departure: { p: A(dFace), yaw, depth: Math.min(carL * 1.35, dFace - (dBeam + 6.6 * k) - carW * 0.2), w: 2 * roadHalf + carW * 0.5 },
    toll: { p: A(dBeam), yaw, span: Math.max(carW * 2.4, S * 0.7) },
    stop: { p: A(dStop), yaw },
    gate: { p: A(dGate), yaw, w: carW * 2.4 },
    k,
    legs: { approach, scanPass, toCChain, toScrapyard, toParking, parkToCChain, parkToScrapyard },
    parking,
    scrapyard,
    dbg: { dHQ, dDoor, dFace, dStart, dPre, dBeam, dStop, dPost, dWait, dBack, r, rf, dTurn, dGate, dEnd, core, ringR, laneR, theta0, a, k },
    proof: P(dHQ - hq.n.w * 0.2, hq.n.w * 1.9, blockY),
    out: A(dEnd),
  };
}
