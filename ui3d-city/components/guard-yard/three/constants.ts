import { Vector3 } from "three";

/* Every landmark and dimension of the Guard Yard, exactly as the reference (docs/reference/avaguard-fx.html). Metres,
   Y up, the car drives toward +x. Never change these to resize the scene: scale the root group instead, all the contact
   logic hangs on them. */

export const SX = -4; // x of the gantry (the beam's plane)
export const BX = 9; // x of the baler's centre
export const CZ = -5; // z of the baler's chamber axis
export const KX = 16.5; // skip centre
export const KZ = -1.8;

export const FLOOR = 0.95; // top of the chamber floor
export const WALL = 0.78; // inner height of the chamber: closed lids crush the car down to it
export const H = FLOOR + WALL; // lid hinges
export const BACK_IN = CZ - 1.125; // inner face of the fixed wall
export const DOOR_IN = BX + 3.26; // inner face of the end door
export const SIDE_OPEN = CZ + 1.15; // z of the side plate, open
export const LID_OPEN = -1.95; // lids open (0 = closed)
export const RAM_OPEN = BX - 3.15; // end ram retracted
export const RAM_END = DOOR_IN - 0.05; // end ram's full stroke (ejection)

export const CRANE = new Vector3(BX + 3.6, 2.4, CZ + 2.1); // turret base
export const L1 = 4.4; // boom
export const L2 = 3.8; // stick
export const JAW = 1.1;
export const JAW_OPEN = 0.35;
export const PIV = 1.02;

/* the intact car: roof, half width, half length. In the city the car is the fleet's own pod (city3d/GuardCar.tsx), a van
   drawn at a width of 1.82 m (Traffic.tsx PODS.van, section CLEAR/LOWER/UPPER, its canopy): 4.73 m long, 1.02 m tall.
   The reference's sedan was 4.6 x 1.52; every contact below is solved from these three numbers. */
export const POD_W = 1.82;
export const TOP0 = 1.02;
export const HALFW0 = 0.91;
export const HALFL0 = 2.366;
export const BALE_HL = 1.02; // the bale's half length

export const PICK = new Vector3(BX + 1.0, 0, 0); // where the car stops before the baler
export const CHX = BX - 0.3; // chamber centre
export const CHZ = (BACK_IN + (SIDE_OPEN - 0.1)) / 2;
export const CAR_GRIP = 0.36; // grip height over the held object's base: the pod's widest line (its equator)
export const BALE_GRIP = 0.38;
export const PARK = new Vector3(BX + 1.6, 4.6, CZ + 3.6); // the grapple's rest
export const SKIP_LAND = new Vector3(KX + 0.9, 1.11, KZ + 0.05); // the bale's base once laid on the old bales

/** lighting masts: position (x, z) and target (x, z) */
export const MASTS: [number, number, number, number][] = [
  [-8, -9, -4, 0],
  [6, -10, 8, -3],
  [19, -8, 15, -1],
];

/** the car's side profile (x, y), extruded across its width */
export const PROFILE: [number, number][] = [
  [-2.15, 0.32],
  [-2.2, 0.72],
  [-1.75, 0.93],
  [-1.15, 0.98],
  [-0.62, 1.4],
  [0.5, 1.42],
  [1.12, 1.0],
  [1.95, 0.9],
  [2.2, 0.7],
  [2.18, 0.32],
];
export const GLASS_PROFILE: [number, number][] = [
  [-1.08, 1.0],
  [-0.6, 1.36],
  [0.48, 1.38],
  [1.06, 1.0],
];

/** the sequence's lengths, s */
export const DURATION = 22.6;
export const SCAN_END = 8.0;
export const CRUSH_FROM = 7.6;
export const CRUSH_LEN = 14.8;
