import { describe, expect, it } from "vitest";
import { halfLOf, halfWOf, solveK, topOf } from "../three/crush";
import { baleOut, camAt, craneAt, pressState, swingAt } from "../three/timeline";
import { DURATION } from "../three/constants";

const times = (a: number, b: number, step = 0.01) => Array.from({ length: Math.round((b - a) / step) + 1 }, (_, i) => +(a + i * step).toFixed(4));

describe("guard yard: the crush's inverse", () => {
  it("solveK finds a k that fits under each target (50 targets each)", () => {
    const fs: [(k: number) => number, number, number][] = [
      [topOf, topOf(1), topOf(0)],
      [(k) => halfWOf(0, k), halfWOf(0, 1), halfWOf(0, 0)],
      [(k) => halfLOf(0, k), halfLOf(0, 1), halfLOf(0, 0)],
    ];
    for (const [f, lo, hi] of fs)
      for (let i = 0; i < 50; i++) {
        const x = lo + ((hi - lo) * i) / 49;
        expect(f(solveK(f, x))).toBeLessThanOrEqual(x + 1e-4);
      }
  });
});

describe("guard yard: the timeline is a pure function of time", () => {
  it("pressState(15.5) is the same computed directly or after a pass from 0", () => {
    const direct = pressState(15.5);
    for (const t of times(0, 15.5, 0.05)) pressState(t);
    expect(pressState(15.5)).toEqual(direct);
  });
  it("every function is defined and finite over the whole sequence", () => {
    for (const t of times(0, DURATION, 0.05)) {
      const c = craneAt(t);
      expect(Number.isFinite(c.root.x + c.root.y + c.root.z + c.jaw)).toBe(true);
      const [p, l] = camAt(t);
      expect(Number.isFinite(p.x + l.z)).toBe(true);
      const s = swingAt(t);
      expect(Math.abs(s[0]) <= 0.18 && Math.abs(s[1]) <= 0.18).toBe(true);
      const b = baleOut(t);
      expect(Number.isFinite(b.x + b.y + b.rz)).toBe(true);
    }
  });
});
