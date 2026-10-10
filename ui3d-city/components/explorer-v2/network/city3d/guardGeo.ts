// AVAGUARD: our parcel's geometry, read from the vendored plan and lanes (not from builders-hub). Every place is
// derived from our chain's lot (city.ts CityLot), its ward's arc and our street's lanes (lanes.ts streetsOf), so the
// parcel follows the plan wherever planCity puts it. World frame as model.ts: plan x -> X, plan y -> Z, Y up.
import { Vector3 } from "three";
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
  toll: { p: Vector3; yaw: number; span: number };
  stop: { p: Vector3; yaw: number };
  legs: Record<Exclude<Leg, "none">, Path>;
  parking: Parking;
  scrapyard: { c: Vector3; yaw: number; w: number; d: number; crusher: Vector3; bin: Vector3 };
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
  const carL = PODS.car.length * carW;
  const n = laneOut.x.length;
  const hqR = hq.n.w * 1.5;
  const away = (lane: typeof laneOut, k: number) => Math.hypot(lane.x[k] - hq.x, lane.z[k] - hq.z) > hqR;

  // out of the HQ's door, to where the lane leaves our block: the toll stands on that curb
  let iDoor = 0;
  while (iDoor < n - 1 && !away(laneOut, iDoor)) iDoor++;
  let iExit = iDoor;
  while (iExit < n - 1 && inBlock(laneOut.x[iExit], laneOut.z[iExit])) iExit++;
  const iToll = Math.min(n - 2, Math.max(iDoor + Math.round(carL * 1.6), iExit));
  const iStop = Math.max(iDoor + 1, iToll - Math.round(carL * 0.7));
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
  const rP = rLat + carL * 0.75 + z1;
  const aP = lot.a - runSide * ((corridor - x0) / rP);
  const radial = new Vector3(Math.cos(aP), 0, Math.sin(aP));
  const tangent = (a: number) => new Vector3(-Math.sin(a), 0, Math.cos(a));
  // the frame: +x away from the central lane, +z a quarter turn from it (outward or inward, as the side falls)
  const xHat = tangent(aP).multiplyScalar(-runSide);
  const slotYaw = Math.atan2(xHat.z, xHat.x);
  const zHat = new Vector3(-Math.sin(slotYaw), 0, Math.cos(slotYaw));
  const inward = -Math.sign(zHat.dot(radial)) || -1;
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

  // the scrapyard: fenced, across the central lane from the human lot; its crusher by the lane, the registry's container at its far side
  const sw = S * 1.5;
  const sd = S * 1.6;
  const rS = rLat + carL * 0.75 + sd / 2;
  const aS = lot.a + runSide * ((corridor + sw / 2) / rS);
  const sc = G(rS, aS);
  const scrapyard = {
    c: sc,
    yaw: Math.atan2(Math.sin(aS + Math.PI / 2), Math.cos(aS + Math.PI / 2)),
    w: sw,
    d: sd,
    crusher: G(rS - sd * 0.22, aS - runSide * ((sw * 0.22) / rS)),
    bin: G(rS + sd * 0.26, aS + runSide * ((sw * 0.12) / rS)),
  };

  // the legs the Director drives
  const lanePts = (lane: typeof laneOut, a: number, b: number) => {
    const out: Vector3[] = [];
    const step = a <= b ? 1 : -1;
    for (let k = a; step > 0 ? k <= b : k >= b; k += step) out.push(lp(lane, k));
    return out;
  };
  const approach = pathOf(lanePts(laneOut, iDoor, iStop));
  const toCChain = pathOf(lanePts(laneOut, iStop, n - 1));
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
  const toScrapyard = pathOf(smooth([door, G(rIn, sideA), G(rLat, sideA), lane0, G(rS - sd * 0.3, lot.a), scrapyard.crusher.clone()]));
  const slot = slots[2];
  // in by the gate, along the aisle, a turn into P3; out in reverse to the aisle, then forward through the gate to the toll
  const slotZ = (2 - 2.5) * bay;
  const aisleX = -depth / 2 - aisle * 0.5;
  const toParking = pathOf(
    smooth([stopP, G(rIn, sideA), G(rLat, sideA), lane0, L(x0 - carL * 0.7, gateZ), L(x0 + carW * 0.3, gateZ), L(aisleX, gateZ - inward * bay * 0.25), L(aisleX + aisle * 0.1, slotZ + inward * bay * 0.1), L(-depth / 2 + carW * 0.2, slotZ), slot.clone()]),
  );
  const outOfBay = L(aisleX - aisle * 0.05, slotZ - inward * bay * 0.15);
  const ahead2 = smooth([outOfBay, L(aisleX, gateZ - inward * bay * 0.2), L(x0 + carW * 0.3, gateZ), L(x0 - carL * 0.6, gateZ), lane0, G(rLat, sideA), G(rIn, sideA), stopP.clone()]);
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
    legs: { approach, toCChain, uTurn, toScrapyard, toParking, fromParking },
    parking,
    scrapyard,
    dbg: { ...room, lotA: lot.a, aP, aS, rP, rS, runSide },
    proof: polar(lot.r + hq.n.w * 2.2, lot.a, BLOCK_H),
    out: lp(laneOut, n - 1),
  };
}
