import { HALFL0, HALFW0, TOP0 } from "./constants";

/* The crush, pure (no scene): a point of the car (its frame, base on the ground) under the three rams' coefficients,
   top kT, side kS, end kE, each 0..1; and the car's dimensions after a crush state, which mirror crushMap without its
   crumple, so a plate's position can be inverted into the k that just fits under it (solveK). As the reference. */

export function crushMap(x: number, y: number, z: number, kT: number, kS: number, kE: number) {
  const n = Math.sin(x * 6.3 + z * 4.1 + y * 5.2) * Math.cos(z * 7.3 - x * 3.1); // crumple, deterministic
  const a = 0.05 * (kT + kS + kE);
  let X = x * (1 + 0.05 * kT * (1 - kE)) * (1 - (1 - 1.0 / 2.3) * kE);
  let Y = y * (1 - (1 - 0.72 / 1.5) * kT);
  let Z = z * (1 + 0.16 * kT * (1 - kS)) * (1 - (1 - 0.52 / 0.95) * kS);
  X += n * a;
  Y += n * a * 0.5;
  Z += n * a;
  X += (Math.max(-1.02, Math.min(1.02, X)) - X) * kE;
  Z += (Math.max(-0.55, Math.min(0.55, Z)) - Z) * kS;
  Y += (Math.max(0, Math.min(0.76, Y)) - Y) * kT;
  return [X, Y, Z] as const;
}

export const topOf = (kT: number) => {
  const y = TOP0 * (1 - (1 - 0.72 / 1.5) * kT);
  return y + (Math.min(y, 0.76) - y) * kT;
};
export const halfWOf = (kT: number, kS: number) => {
  const z = HALFW0 * (1 + 0.16 * kT * (1 - kS)) * (1 - (1 - 0.52 / 0.95) * kS);
  return z + (Math.min(z, 0.55) - z) * kS;
};
export const halfLOf = (kT: number, kE: number) => {
  const x = HALFL0 * (1 + 0.05 * kT * (1 - kE)) * (1 - (1 - 1.0 / 2.3) * kE);
  return x + (Math.min(x, 1.02) - x) * kE;
};

/** f decreasing on [0, 1]: the smallest k with f(k) <= target (22 bisections) */
export function solveK(f: (k: number) => number, target: number) {
  if (f(0) <= target) return 0;
  if (f(1) >= target) return 1;
  let a = 0;
  let b = 1;
  for (let i = 0; i < 22; i++) {
    const m = (a + b) / 2;
    if (f(m) > target) a = m;
    else b = m;
  }
  return b;
}
