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
  parking: { c: Vector3; yaw: number; slots: Vector3[]; slotYaw: number; w: number; d: number };
  scrapyard: { c: Vector3; yaw: number; w: number; d: number; crusher: Vector3; bin: Vector3 };
  proof: Vector3;
  out: Vector3;
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

  // the side our street runs round on: the human lot stands on the other, the scrapyard on its side
  const ahead = Math.min(n - 1, iToll + Math.round(S * 3));
  const runSide = Math.sign(turn(Math.atan2(laneOut.z[ahead], laneOut.x[ahead]) - lot.a)) || 1;
  const room = Math.max(0.05, Math.min(lot.a - ward.a0, ward.a1 - lot.a) - (S * 0.6) / lot.r);
  const dP = Math.min((S * 2.3) / lot.r, room * 0.8);
  const dS = Math.min((S * 2.4) / lot.r, room * 0.8);
  const rIn = lot.r - S * 0.8;

  // the human lot: six bays side by side along the ring, their noses outward
  const aP = lot.a - runSide * dP;
  const bay = carW * 1.5;
  const tangent = (a: number) => new Vector3(-Math.sin(a), 0, Math.cos(a));
  const slots = Array.from({ length: 6 }, (_, k) => polar(lot.r + S * 0.1, aP, BLOCK_H * 0).add(tangent(aP).multiplyScalar((k - 2.5) * bay)));
  slots.forEach((s) => (s.y = 0.02));
  const parking = { c: polar(lot.r + S * 0.1, aP, 0.02), yaw: Math.atan2(Math.sin(aP + Math.PI / 2), Math.cos(aP + Math.PI / 2)), slots, slotYaw: aP, w: bay * 6.4, d: carL * 1.7 };

  // the scrapyard: fenced, its crusher by the gate, the registry's container at its far side
  const aS = lot.a + runSide * dS;
  const sc = polar(lot.r + S * 0.25, aS, 0.02);
  const scrapyard = { c: sc, yaw: Math.atan2(Math.sin(aS + Math.PI / 2), Math.cos(aS + Math.PI / 2)), w: S * 2.1, d: S * 1.9, crusher: polar(lot.r - S * 0.15, aS, 0.02), bin: polar(lot.r + S * 0.7, aS + runSide * (S * 0.55) / lot.r, 0.02) };

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
  const toScrapyard = pathOf(smooth([door, polar(rIn, lot.a + runSide * dS * 0.45, 0.02), polar(rIn, aS, 0.02), scrapyard.crusher.clone()]));
  const slot = slots[2];
  const toParking = pathOf(smooth([stopP, polar(rIn, lot.a - runSide * dP * 0.4, 0.02), polar(rIn, aP, 0.02).add(tangent(aP).multiplyScalar(-0.5 * bay)), slot.clone().add(polar(-S * 0.2, aP)), slot.clone()]));
  // out of the bay in reverse, then forward back to the toll's stop line
  const outOfBay = slot.clone().add(polar(-S * 0.55, aP));
  const ahead2 = smooth([outOfBay, polar(rIn, lot.a - runSide * dP * 0.35, 0.02), stopP.clone()]);
  const fromParking = pathOf([slot.clone(), ...ahead2], [true, ...ahead2.map(() => false)]);
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
    proof: polar(lot.r + hq.n.w * 2.2, lot.a, BLOCK_H),
    out: lp(laneOut, n - 1),
  };
}
