import { describe, expect, it } from "vitest";
import { BACK_IN, BALE_HL, BX, CRANE, CZ, DOOR_IN, H, HALFW0, L1, L2 } from "../three/constants";
import { halfLOf, halfWOf, topOf } from "../three/crush";
import { RAM_COMP, baleOut, craneAt, doorAngle, lidAngle, lidClearance, pressState, ramX, sideZ, spread } from "../three/timeline";

/* No visible interpenetration (prompt section 16): every contact is computed, so it can be checked at every instant. */

const times = (a: number, b: number, step = 0.01) => Array.from({ length: Math.round((b - a) / step) + 1 }, (_, i) => +(a + i * step).toFixed(4));

describe("guard yard: no plate goes through the car", () => {
  it("the lids' underside never sinks into the roof (13.9 to 15.15)", () => {
    for (const t of times(13.9, 15.15)) {
      const { kT } = pressState(t);
      expect(lidClearance(lidAngle(t)), `t=${t}`).toBeGreaterThanOrEqual(topOf(kT) - 1e-3);
    }
  });
  it("the side plate and the fixed wall hold the car between them", () => {
    for (const t of times(13.8, 17.15)) {
      const { kT, kS, cz } = pressState(t);
      const hw = halfWOf(kT, kS);
      expect(sideZ(t) - 0.1, `t=${t}`).toBeGreaterThanOrEqual(cz + hw - 1e-3);
      expect(cz - hw, `t=${t}`).toBeGreaterThanOrEqual(BACK_IN - 1e-3);
    }
  });
  it("the end ram touches the car's rear, never enters it, and the car stays behind the closed door", () => {
    for (const t of times(13.8, 17.15)) {
      const { kT, kE, cx } = pressState(t);
      const hl = halfLOf(kT, kE);
      const face = Math.min(ramX(t), RAM_COMP) + 0.1;
      expect(face, `t=${t}`).toBeLessThanOrEqual(cx - hl + 1e-3);
      if (doorAngle(t) < 0.05) expect(cx + hl, `t=${t}`).toBeLessThanOrEqual(DOOR_IN + 1e-3);
    }
  });
  it("metal never springs back: kT, kS, kE never decrease", () => {
    let last = { kT: 0, kS: 0, kE: 0 };
    for (const t of times(13.8, 17.15)) {
      const s = pressState(t);
      expect(s.kT, `t=${t}`).toBeGreaterThanOrEqual(last.kT - 1e-9);
      expect(s.kS, `t=${t}`).toBeGreaterThanOrEqual(last.kS - 1e-9);
      expect(s.kE, `t=${t}`).toBeGreaterThanOrEqual(last.kE - 1e-9);
      last = s;
    }
  });
});

describe("guard yard: the crane", () => {
  it("the jaws stop at the held object's flanks, never inside", () => {
    for (const t of times(0, 22.6)) {
      const c = craneAt(t);
      if (c.hold === "car") expect(spread(c.jaw), `t=${t}`).toBeGreaterThanOrEqual(HALFW0 + 0.05 - 1e-3);
      if (c.hold === "bale") expect(spread(c.jaw), `t=${t}`).toBeGreaterThanOrEqual(0.55 + 0.05 - 1e-3);
    }
  });
  it("stays within reach (the IK never cheats)", () => {
    const base = { x: CRANE.x, y: CRANE.y + 0.5, z: CRANE.z };
    for (const t of times(0, 22.6)) {
      const r = craneAt(t).root;
      const d = Math.hypot(r.x - base.x, r.y + 0.35 - base.y, r.z - base.z);
      expect(d, `t=${t}`).toBeLessThanOrEqual(L1 + L2 - 0.05 + 1e-6);
    }
  });
  it("is out of the chamber while it compacts (14.3 to 18.3)", () => {
    for (const t of times(14.3, 18.3)) {
      const r = craneAt(t).root;
      const inside = r.x > BX - 3.3 - 0.3 && r.x < BX + 3.3 + 0.3 && r.z > CZ - 1.25 - 0.3 && r.z < CZ + 1.25 + 0.3 && r.y < H + 0.3;
      expect(inside, `t=${t}`).toBe(false);
    }
  });
});

describe("guard yard: the bale", () => {
  it("never goes under the ground, nor through the door before it has opened", () => {
    let opened = false;
    for (const t of times(17.15, 19.45)) {
      const b = baleOut(t);
      expect(b.y, `t=${t}`).toBeGreaterThanOrEqual(0);
      opened ||= doorAngle(t) > 1.2;
      if (!opened) expect(b.x + BALE_HL, `t=${t}`).toBeLessThanOrEqual(DOOR_IN + 0.2);
    }
  });
  it("the closing door swings over the bale lying outside (18.1 to 18.5)", () => {
    const pivotY = H + 0.05;
    const len = 0.78 + 0.05; // WALL + .05, the door's plate hangs under its pivot
    for (const t of times(18.1, 18.5)) {
      const b = baleOut(t);
      const lowest = pivotY - len * Math.cos(doorAngle(t)); // its free edge
      const reach = BX + 3.35 + len * Math.sin(doorAngle(t));
      const baleTop = b.y + 0.76;
      const baleRear = b.x - BALE_HL;
      expect(lowest > baleTop || reach < baleRear, `t=${t}`).toBe(true);
    }
  });
});
