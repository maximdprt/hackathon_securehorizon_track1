// AVAGUARD: our parcel's geometry, read from the vendored plan and lanes (not from builders-hub). Every place is
// derived from our chain's lot (city.ts CityLot), its ward's arc and our street's lanes (lanes.ts streetsOf), so the
// parcel follows the plan wherever planCity puts it. World frame as model.ts: plan x -> X, plan y -> Z, Y up.
import { Matrix4, Vector3 } from "three";
import { CHX, CHZ, FLOOR, KX, KZ, PICK, POD_W, SKIP_LAND } from "@/components/guard-yard/three/constants";
import type { City } from "@/components/explorer-v2/network/city";
import type { Route } from "@/components/explorer-v2/network/icm-map";
import { AVAGUARD_ID, guardBackKey, guardKey } from "@/components/explorer-v2/network/avaguard";
import type { Leg } from "@/sim/store";
import type { RouteStreets } from "./lanes";
import { BLOCK_H, type Building, type CityModel } from "./model";
import { LOT, PODS, SIZE, WIDTH } from "./Traffic";

/** the human lot: closed, covered, entered by one gate. Its frame: +x outward (the bays' noses), +z along the ring */
export type Parking = {
  c: Vector3;
  yaw: number;
  slotYaw: number;
  slots: Vector3[];
  /** a bay's width and depth, the aisle's width in front of the bays */
  bay: number;
  depth: number;
  aisle: number;
  /** the slab's extent in its frame, and the gate on its front side (x = x0) */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  gateZ: number;
  gateW: number;
  gate: Vector3;
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
  /** the X-ray gantry: its beam's point on our street, the street's heading there */
  toll: { p: Vector3; yaw: number; span: number };
  stop: { p: Vector3; yaw: number };
  /** the C-Chain's gate on the lane into the hub: a visa's car goes through it and is gone (GuardCar clips it there) */
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

const polar = (r: number, a: number, y = 0) => new Vector3(r * Math.cos(a), y, r * Math.sin(a));
const turn = (d: number) => d - 2 * Math.PI * Math.ceil((d - Math.PI) / (2 * Math.PI));

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

/** smooth a corner-to-corner polyline (Catmull-Rom through its points), keeping the lanes' own samples as they are */
function smooth(pts: Vector3[], per = 6): Vector3[] {
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
      out.push(
        new Vector3(
          0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
          0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
          0.5 * (2 * p1.z + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3),
        ),
      );
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export function guardGeoOf(model: CityModel, city: City, routes: Route[], streets: RouteStreets[]): GuardGeo | null {
  const hubB = model.buildings[model.hub];
  const hqI = model.byId.get(AVAGUARD_ID);
  const lot = city.lots.get(AVAGUARD_ID);
  const ward = city.wards.find((w) => w.district === "security");
  if (!hubB || hqI === undefined || !lot || !ward) return null;
  const hq = model.buildings[hqI];
  const iOut = routes.findIndex((r) => r.key === guardKey(hubB.id));
  const iBack = routes.findIndex((r) => r.key === guardBackKey(hubB.id));
  const laneOut = streets[iOut]?.lane;
  const laneBack = streets[iBack]?.lane;
  if (!laneOut || !laneBack) return null;

  // the curbs, as Traffic.tsx finds them: a lane runs at the block's height inside a block, else on the street
  const inBlock = (x: number, z: number) => {
    const r = Math.hypot(x, z);
    const a = Math.atan2(z, x);
    return city.blocks.some((b) => r > b.r0 + 1 && r < b.r1 - 1 && (((a - b.a0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) <= b.a1 - b.a0);
  };
  const yAt = (x: number, z: number) => (inBlock(x, z) ? BLOCK_H : 0) + 0.02;
  const lp = (lane: typeof laneOut, k: number) => new Vector3(lane.x[k], yAt(lane.x[k], lane.z[k]), lane.z[k]);
  const S = city.lot;
  const carW = WIDTH * Math.min(1.25, Math.max(0.6, S / LOT)) * SIZE * 1.9; // our car stands out of the traffic: about twice a pod
  const carL = PODS.van.length * carW; // our car: the fleet's van, the yard's car at POD_W metres wide
  const k = carW / POD_W;
  const n = laneOut.x.length;
  const hqR = hq.n.w * 1.5;
  const away = (lane: typeof laneOut, k: number) => Math.hypot(lane.x[k] - hq.x, lane.z[k] - hq.z) > hqR;

  // out of the HQ's door, to where the lane leaves our block: the toll stands on that curb
  let iDoor = 0;
  while (iDoor < n - 1 && !away(laneOut, iDoor)) iDoor++;
  let iExit = iDoor;
  while (iExit < n - 1 && inBlock(laneOut.x[iExit], laneOut.z[iExit])) iExit++;
  // the gantry stands a good two car lengths out of the HQ's door (on the ring road, past the turn), so the car is seen
  // leaving the tower and driving up to it
  const iToll = Math.min(n - 2, Math.max(iDoor + Math.round(carL * 2.2), iExit));
  // the X-ray gantry's beam stands at iToll: the car waits before it, drives through it while scanned, stops past it
  // (the yard's SX - 3.3 and SX + 3.4), as the customs portals work
  const iPre = Math.max(iDoor + 1, iToll - Math.round(3.3 * k));
  const iStop = Math.min(n - 2, Math.max(iToll + 1, iToll + Math.round(3.4 * k)));
  const tollP = lp(laneOut, iToll);
  const stopP = lp(laneOut, iStop);
  const fwd = new Vector3(Math.cos(laneOut.yaw[iStop]), 0, Math.sin(laneOut.yaw[iStop]));

  // the side our street runs round on: the parcel's service road goes round the HQ's block on the other side
  const ahead = Math.min(n - 1, iToll + Math.round(S * 3));
  const runSide = Math.sign(turn(Math.atan2(laneOut.z[ahead], laneOut.x[ahead]) - lot.a)) || 1;
  const rIn = lot.r - S * 0.8;
  // our lot's block: the parcel stands beyond its outer edge, in the open part of the ward (its wedge widens outward)
  const angIn = (a: number, b0: number, b1: number) => ((((a - b0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) <= b1 - b0;
  const block = city.blocks.find((bk) => lot.r > bk.r0 && lot.r < bk.r1 && angIn(lot.a, bk.a0, bk.a1));
  const r1 = block?.r1 ?? lot.r + S;
  const blockHalf = block ? (block.a1 - block.a0) / 2 : S / lot.r;
  const blockMid = block ? block.a0 + blockHalf : lot.a;
  const G = (r: number, a: number) => {
    const v = polar(r, a);
    v.y = yAt(v.x, v.z);
    return v;
  };
  /** the service road: round the block's side away from our street, then a lateral street along its outer edge */
  const sideA = blockMid - runSide * (blockHalf + (carL * 0.9) / lot.r);
  const rLat = r1 + carL * 0.75;
  const corridor = carL * 0.9; // half the central lane between the human lot and the scrapyard
  const room = { lotR: lot.r, wardA0: ward.a0, wardA1: ward.a1, blockHalf, r1 };

  // the human lot: six bays in a row along the radius, their noses away from the central lane, the aisle and the gate on it
  const bay = carW * 1.5;
  const depth = carL * 1.15;
  const aisle = carL * 0.95;
  const edge = carW * 0.5;
  const x0 = -depth / 2 - aisle - edge;
  const x1 = depth / 2 + edge;
  const z1 = 3 * bay + edge;
  // a ward that holds the whole circle (the Sentinel-only city): the human lot and the scrapyard stand either side of the
  // HQ's block, in its block row, served by the ring road downtown's side of it; a narrow ward: beyond the block, a
  // central lane between them
  const beside = ward.a1 - ward.a0 > Math.PI;
  // the ring road the HQ's block fronts on: its centre and its outer kerb (city.ts rings, ROAD = 0.5 lot)
  const ringR = city.rings.find((r) => r < lot.r) ?? lot.r - S;
  const ringKerb = ringR + S * 0.25;
  const tangent = (a: number) => new Vector3(-Math.sin(a), 0, Math.cos(a));
  // beside: the lot's long side runs along the ring, its gate on the ring road's kerb, its bays' noses outward (the lot
  // is deeper than a block row, so its bays stand over the row's mid lane rather than over the ring road)
  const rP = beside ? ringKerb + carW * 0.4 - x0 : rLat + carL * 0.75 + z1;
  const aP = beside ? blockMid - runSide * (blockHalf + (corridor + z1) / rP) : lot.a - runSide * ((corridor - x0) / rP);
  const radial = new Vector3(Math.cos(aP), 0, Math.sin(aP));
  // the frame: +x away from the lane the car comes by (outward, beside; away from the central lane otherwise), +z a
  // quarter turn from it
  const xHat = beside ? radial.clone() : tangent(aP).multiplyScalar(-runSide);
  const slotYaw = Math.atan2(xHat.z, xHat.x);
  const zHat = new Vector3(-Math.sin(slotYaw), 0, Math.cos(slotYaw));
  // the gate's end of the row: toward the HQ's block (beside), else the inward end
  const inward = beside ? runSide : -Math.sign(zHat.dot(radial)) || -1;
  const pc = polar(rP, aP, 0);
  const py = yAt(pc.x, pc.z);
  pc.y = py;
  /** a point of the lot's frame in the world */
  const L = (x: number, z: number, y = py) => pc.clone().addScaledVector(xHat, x).addScaledVector(zHat, z).setY(y);
  // the gate near the lot's inner end, the side the car comes from
  const gateZ = inward * 1.25 * bay;
  const slots = Array.from({ length: 6 }, (_, k) => L(0, (k - 2.5) * bay));
  const parking: Parking = {
    c: pc,
    yaw: Math.atan2(zHat.z, zHat.x),
    slotYaw,
    slots,
    bay,
    depth,
    aisle,
    x0,
    x1,
    z0: -z1,
    z1,
    gateZ,
    gateW: carW * 1.9,
    gate: L(x0, gateZ),
    y: py,
    w: 2 * z1,
    d: x1 - x0,
  };

  // the Guard Yard (baler, crane, skip) across the service lane from the human lot, in its own metres scaled by k: its x
  // runs away from the HQ along the ring (the car comes in along it to PICK), its z a quarter turn from it, inward.
  // Beside: its lane (z = 0) runs on the ring road's outer half, the baler and the skip in the block row behind it
  const r0 = beside ? ringR + carW * 0.45 + 2.75 * k : rLat + carL + 3.5 * k;
  const a0 = beside ? blockMid + runSide * (blockHalf + (2 * corridor) / lot.r) : lot.a + runSide * (corridor / r0);
  const sideS = blockMid + runSide * (blockHalf + corridor / lot.r);
  const yx = tangent(a0).multiplyScalar(runSide);
  const up = new Vector3(0, 1, 0);
  const yz = yx.clone().cross(up);
  const g0 = G(r0, a0);
  const yo = g0.clone().addScaledVector(yz, 2.75 * k); // the yard's z = -2.75 (between the lane and the baler) on r0
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

  // the legs the Director drives
  const lanePts = (lane: typeof laneOut, a: number, b: number) => {
    const out: Vector3[] = [];
    const step = a <= b ? 1 : -1;
    for (let k = a; step > 0 ? k <= b : k >= b; k += step) out.push(lp(lane, k));
    return out;
  };
  const approach = pathOf(lanePts(laneOut, iDoor, iPre));
  const scanPass = pathOf(lanePts(laneOut, iPre, iStop));
  const toCChain = pathOf(lanePts(laneOut, iStop, n - 1));
  // the gate: a car and a half before the lane's end, so the whole car has gone through it before the leg ends
  let iGate = n - 1;
  for (let left = 0; iGate > iStop + 1 && left < carL * 1.5; iGate--) left += Math.hypot(laneOut.x[iGate] - laneOut.x[iGate - 1], laneOut.z[iGate] - laneOut.z[iGate - 1]);
  // the U-turn: a loop ahead onto the lane back, then back toward the HQ's door
  const nb = laneBack.x.length;
  const turnPoint = stopP.clone().add(fwd.clone().multiplyScalar(carL * 1.1));
  let jNear = 0;
  for (let k = 0, best = Infinity; k < nb; k++) {
    const d = Math.hypot(laneBack.x[k] - turnPoint.x, laneBack.z[k] - turnPoint.z);
    if (d < best) {
      best = d;
      jNear = k;
    }
  }
  let jDoor = nb - 1;
  while (jDoor > jNear && !away(laneBack, jDoor)) jDoor--;
  const backAt = lp(laneBack, Math.min(nb - 1, jNear + 2));
  const uTurn = pathOf(smooth([stopP, stopP.clone().add(fwd.clone().multiplyScalar(carL * 0.6)), turnPoint.clone().lerp(backAt, 0.5).add(fwd.clone().multiplyScalar(carL * 0.35)), backAt, ...lanePts(laneBack, Math.min(nb - 1, jNear + 4), jDoor)]));
  const door = lp(laneBack, jDoor);
  // round the block by the service road, along the lateral street, down the central lane, in to the crusher
  const lane0 = G(rLat, lot.a);
  // round the block by the service lane, onto the yard's lane, up to PICK, heading along the yard's x
  const toScrapyard = pathOf(smooth(beside ? [door, G(rIn, sideS), W(-5, 0, 0), W(0, 0, 0), W(PICK.x, 0, 0)] : [door, G(rIn, sideA), G(rLat, sideA), lane0, W(-5, 0, 0), W(0, 0, 0), W(PICK.x, 0, 0)]));
  const slot = slots[2];
  // in by the gate, along the aisle, a turn into P3; out in reverse to the aisle, then forward through the gate to the toll
  const slotZ = (2 - 2.5) * bay;
  const aisleX = -depth / 2 - aisle * 0.5;
  const toParking = pathOf(
    smooth([stopP, G(rIn, sideA), ...(beside ? [] : [G(rLat, sideA), lane0]), L(x0 - carL * 0.7, gateZ), L(x0 + carW * 0.3, gateZ), L(aisleX, gateZ - inward * bay * 0.25), L(aisleX + aisle * 0.1, slotZ + inward * bay * 0.1), L(-depth / 2 + carW * 0.2, slotZ), slot.clone()]),
  );
  const outOfBay = L(aisleX - aisle * 0.05, slotZ - inward * bay * 0.15);
  const ahead2 = smooth([outOfBay, L(aisleX, gateZ - inward * bay * 0.2), L(x0 + carW * 0.3, gateZ), L(x0 - carL * 0.6, gateZ), ...(beside ? [] : [lane0, G(rLat, sideA)]), G(rIn, sideA), stopP.clone()]);
  const fromParking = pathOf([slot.clone(), L(-depth / 2 + carW * 0.1, slotZ), ...ahead2], [true, true, ...ahead2.map(() => false)]);
  const hubTop = hubB.base + hubB.crest;
  return {
    S,
    carW,
    carL,
    hq,
    hubTop,
    toll: { p: tollP, yaw: laneOut.yaw[iToll], span: Math.max(carW * 2.4, S * 0.7) },
    stop: { p: stopP, yaw: laneOut.yaw[iStop] },
    gate: { p: lp(laneOut, iGate), yaw: laneOut.yaw[iGate], w: carW * 2.2 },
    k,
    legs: { approach, scanPass, toCChain, uTurn, toScrapyard, toParking, fromParking },
    parking,
    scrapyard,
    dbg: { ...room, lotA: lot.a, aP, a0, rP, r0, runSide, k },
    proof: polar(lot.r + hq.n.w * 2.2, lot.a, BLOCK_H),
    out: lp(laneOut, n - 1),
  };
}
