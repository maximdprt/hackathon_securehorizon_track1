import { expect, test } from "@playwright/test";

/* Every way the Sentinel car drives (city3d/guardGeo.ts legs), checked on the scene itself, as it stands in the page:
   each leg starts where the one before it ends; it never kinks or turns back on itself; it never turns tighter than a
   car can (a radius under 1.2 car widths); and the car, its whole body along the whole leg, meets no wall, pillar, post,
   booth, machine or tower. The barriers aside (they lift as it comes), and the control tower's corner while the car
   leaves from under its canopy (its tail starts in the tower). */

type Report = { gaps: string[]; kinks: string[]; tight: string[]; hits: string[]; obstacles: number; legs: Record<string, number> };

test("paths: every leg of the car is joined, smooth and clear of the protocol's pieces", async ({ page }) => {
  await page.goto("/?live=0");
  await page.waitForFunction(() => {
    const w = window as unknown as { __carClip?: { geo?: unknown }; __city3d?: { scene?: unknown } };
    return !!w.__carClip?.geo && !!w.__city3d?.scene;
  }, null, { timeout: 60_000 });
  // the city stands: its streetlights' posts are placed with it
  await page.waitForTimeout(12_000);
  const r = await page.evaluate((): Report => {
    type V = { x: number; y: number; z: number };
    type Path = { pts: V[]; len: number };
    type O3 = {
      name: string;
      visible: boolean;
      parent: O3 | null;
      children: O3[];
      isMesh?: boolean;
      isInstancedMesh?: boolean;
      count: number;
      matrixWorld: { elements: number[] };
      instanceMatrix: { array: Float32Array };
      geometry?: { boundingBox: { min: V; max: V } | null; computeBoundingBox: () => void };
      material?: { transparent?: boolean; depthWrite?: boolean } | { transparent?: boolean; depthWrite?: boolean }[];
      updateMatrixWorld: (b: boolean) => void;
      traverse: (f: (o: O3) => void) => void;
    };
    const w = window as unknown as { __carClip: { geo: { legs: Record<string, Path>; carW: number; carL: number; hq: { x: number; z: number; n: { w: number } } } }; __city3d: { scene: O3 } };
    const geo = w.__carClip.geo;
    const { carW, carL } = geo;
    const top = carW * 0.6 + 0.1;
    type P2 = [number, number];
    const hull = (pts: P2[]): P2[] => {
      const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const cross = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
      const lo: P2[] = [];
      const up: P2[] = [];
      for (const q of p) {
        while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
        lo.push(q);
      }
      for (const q of [...p].reverse()) {
        while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
        up.push(q);
      }
      return [...lo.slice(0, -1), ...up.slice(0, -1)];
    };
    const axes = (poly: P2[]) =>
      poly.map((a, i) => {
        const b = poly[(i + 1) % poly.length];
        const n = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        return [-(b[1] - a[1]) / n, (b[0] - a[0]) / n] as P2;
      });
    const overlap = (p1: P2[], p2: P2[]) => {
      let depth = Infinity;
      for (const ax of [...axes(p1), ...axes(p2)]) {
        const a = p1.map((q) => ax[0] * q[0] + ax[1] * q[1]);
        const b = p2.map((q) => ax[0] * q[0] + ax[1] * q[1]);
        const o = Math.min(Math.max(...a), Math.max(...b)) - Math.max(Math.min(...a), Math.min(...b));
        if (o <= 0) return 0;
        depth = Math.min(depth, o);
      }
      return depth;
    };
    // the protocol's pieces: every mesh of the parcel's named groups, its box in the world seen from above
    const obstacles: { name: string; poly: P2[] }[] = [];
    const scene = w.__city3d.scene;
    scene.updateMatrixWorld(true);
    scene.traverse((g) => {
      if (!g.name.startsWith("guard:") || g.name === "guard:car") return;
      g.traverse((m) => {
        if (!m.isMesh || !m.geometry) return;
        for (let p: O3 | null = m; p; p = p.parent) if (!p.visible || p.name === "barrier") return;
        const mat = Array.isArray(m.material) ? m.material[0] : m.material;
        if (mat?.transparent && mat.depthWrite === false) return;
        m.geometry.computeBoundingBox();
        const bb = m.geometry.boundingBox;
        if (!bb) return;
        const e = m.matrixWorld.elements;
        const corners: [number, number, number][] = [];
        for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) corners.push([e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]]);
        const ys = corners.map((c) => c[1]);
        if (Math.max(...ys) < 0.45 || Math.min(...ys) > top) return;
        obstacles.push({ name: `${g.name} ${m.name || "mesh"} @${corners[0][0].toFixed(0)},${corners[0][2].toFixed(0)}`, poly: hull(corners.map((c) => [c[0], c[2]] as P2)) });
      });
    });
    // the city's thin posts (its streetlights), as instanced boxes stood up
    scene.traverse((o) => {
      if (!o.isInstancedMesh) return;
      const a = o.instanceMatrix.array;
      for (let i = 0; i < o.count; i++) {
        const e = a.subarray(i * 16, i * 16 + 16);
        const sx = Math.hypot(e[0], e[1], e[2]);
        const sy = Math.hypot(e[4], e[5], e[6]);
        const sz = Math.hypot(e[8], e[9], e[10]);
        if (sy < 3.5 || sy > 8 || sx > 0.7 || sz > 0.7 || Math.hypot(e[12], e[14]) > 300) continue;
        const h = Math.max(sx, 0.3) / 2;
        obstacles.push({ name: `post @${e[12].toFixed(0)},${e[14].toFixed(0)}`, poly: [[e[12] - h, e[14] - h], [e[12] + h, e[14] - h], [e[12] + h, e[14] + h], [e[12] - h, e[14] + h]] });
      }
    });
    // the control tower's base: a square turned to the plate, its half diagonal its width
    const { x: hx, z: hz } = geo.hq;
    const hw = geo.hq.n.w;
    const tower: P2[] = [[hx + hw, hz], [hx, hz + hw], [hx - hw, hz], [hx, hz - hw]];

    const legs = geo.legs;
    const gaps: string[] = [];
    const d3 = (a: V, b: V) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    for (const [a, b] of [["approach", "scanPass"], ["scanPass", "toCChain"], ["scanPass", "toScrapyard"], ["scanPass", "toParking"], ["toParking", "parkToCChain"], ["toParking", "parkToScrapyard"]]) {
      const gap = d3(legs[a].pts[legs[a].pts.length - 1], legs[b].pts[0]);
      if (gap > 0.01) gaps.push(`${a} -> ${b}: ${gap.toFixed(2)}`);
    }
    const kinks: string[] = [];
    const tight: string[] = [];
    const hits: string[] = [];
    for (const [name, leg] of Object.entries(legs)) {
      const pts = leg.pts;
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
      const at = (s: number) => {
        let j = 1;
        while (j < pts.length - 1 && cum[j] < s) j++;
        const a = pts[j - 1];
        const b = pts[j];
        const f = Math.max(0, Math.min(1, (s - cum[j - 1]) / (cum[j] - cum[j - 1] || 1)));
        return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, yaw: Math.atan2(b.z - a.z, b.x - a.x) };
      };
      const total = cum[cum.length - 1];
      // a kink: two segments a step apart meeting at more than 45 degrees
      for (let i = 2; i < pts.length; i++) {
        const y0 = Math.atan2(pts[i - 1].z - pts[i - 2].z, pts[i - 1].x - pts[i - 2].x);
        const y1 = Math.atan2(pts[i].z - pts[i - 1].z, pts[i].x - pts[i - 1].x);
        const d = Math.abs(((y1 - y0 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
        if (d > Math.PI / 4) kinks.push(`${name} at ${pts[i - 1].x.toFixed(1)},${pts[i - 1].z.toFixed(1)}: ${((d * 180) / Math.PI).toFixed(0)} deg`);
      }
      // the turning radius through three points two units apart
      for (let s = 2; s < total - 2; s += 1) {
        const [a, b, c] = [at(s - 2), at(s), at(s + 2)];
        const ab = Math.hypot(b.x - a.x, b.z - a.z);
        const bc = Math.hypot(c.x - b.x, c.z - b.z);
        const ca = Math.hypot(a.x - c.x, a.z - c.z);
        const area = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) / 2;
        if (area > 1e-6 && (ab * bc * ca) / (4 * area) < carW * 1.2) {
          tight.push(`${name} at ${b.x.toFixed(1)},${b.z.toFixed(1)}: radius ${((ab * bc * ca) / (4 * area)).toFixed(1)}`);
          break;
        }
      }
      // the car's body along the leg against every piece
      const met = new Set<string>();
      for (let s = 0; s <= total; s += 0.25) {
        const p = at(s);
        const c = Math.cos(p.yaw);
        const sn = Math.sin(p.yaw);
        const hl = (carL * 0.96) / 2;
        const hw2 = (carW * 0.92) / 2;
        const car: P2[] = [[hl, hw2], [hl, -hw2], [-hl, -hw2], [-hl, hw2]].map(([dx, dz]) => [p.x + c * dx - sn * dz, p.z + sn * dx + c * dz]);
        for (const o of obstacles) if (!met.has(o.name) && overlap(car, o.poly) > 0.05) met.add(o.name) && hits.push(`${name} s=${s.toFixed(1)}: ${o.name}`);
        if (!(name === "approach" && s < carL) && !met.has("tower") && overlap(car, tower) > 0.05) met.add("tower") && hits.push(`${name} s=${s.toFixed(1)}: the control tower`);
      }
    }
    return { gaps, kinks, tight, hits, obstacles: obstacles.length, legs: Object.fromEntries(Object.entries(legs).map(([k, l]) => [k, Math.round(l.len)])) };
  });
  console.log(`paths: ${JSON.stringify(r.legs)}, against ${r.obstacles} pieces`);
  expect(r.obstacles, "the parcel's pieces were found").toBeGreaterThan(100);
  expect(r.gaps).toEqual([]);
  expect(r.kinks).toEqual([]);
  expect(r.tight).toEqual([]);
  expect(r.hits).toEqual([]);
});
