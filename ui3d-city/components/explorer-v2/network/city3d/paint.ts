import { arcPath, diceOf } from "@/components/explorer-v2/network/city-geometry"; // AVAGUARD: + diceOf, the perimeter's traces
import { PLATE, RING_IN } from "@/components/explorer-v2/network/icm-map"; // AVAGUARD: + RING_IN, the perimeter's reach
import { SENTINEL_ONLY, SENTINEL_RING } from "@/components/explorer-v2/network/avaguard"; // AVAGUARD: the perimeter is the bare Sentinel city's own
import type { City } from "@/components/explorer-v2/network/city";
import type { Ground } from "@/components/explorer-v2/network/ground";
import { AVAGUARD3, GROUND, FLEET, SIGNAL3, type Theme } from "./palette"; // AVAGUARD: + SIGNAL3, AVAGUARD3
import type { Outskirts } from "./model";
import type { RouteStreets } from "./lanes";

/* The ground's paint, as the map lays its ground layer: the plate in the
   P-Chain's earth, the built city's streets a shade under it, the
   outskirts' plots and parks, the boulevards run on to the ledger, the
   river and its banks, the streets the traffic drives paved as busy as
   they are, the blocks' tops with their plots and lawns, downtown's plaza
   in its light, and a soft shadow at the foot of every outskirts house. It
   is painted once in the plan, into one canvas that the plate and every
   block's top read at their own place. The towers' own shades are a layer
   apart (paintFeet), so each comes in with its tower's rise. */

/** the paint's size in pixels: about two to a unit of the plan */
export const PAINT_PX = 2048;

/* AVAGUARD: Sentinel's protected perimeter, shared by its paint here and its standing parts (Decor.tsx). The river's band,
   between the city's last houses and the rim, now carries it: a fine bezel of ticks under a fence of slim pylons on the
   rim, circuit traces out through the band, and a few sentinel monoliths on their pads, all clear of the box our parcel
   stands in (the other side of the plan, KEEP) and of the hub's plaza. Plan x is the world's x, plan y the world's z. */
export const PERIMETER = {
  /** the fence's round, between the ledger's inner edge and the plate's rim */
  fence: (RING_IN + PLATE) / 2 + 4,
  /** the band the traces run through: from clear of the parcel's box and the last houses, out to the ledger */
  band: [352, RING_IN - 8] as [number, number],
  /** the sentinel monoliths: their plan angle (degrees, from +x toward +z), their radius and their height */
  monoliths: [
    { a: -158, r: 466, h: 40 },
    { a: -122, r: 462, h: 52 },
    { a: -90, r: 466, h: 60 },
    { a: -58, r: 462, h: 52 },
    { a: -22, r: 466, h: 40 },
  ],
};
/** the box our parcel stands in (x from, x to, z from, z to), which nothing of the perimeter may enter, and the hub's plaza */
export const KEEP = { box: [-215, 130, 80, 270] as [number, number, number, number], plaza: 110 };
export const kept = (x: number, z: number, pad = 0) =>
  Math.hypot(x, z) < KEEP.plaza + pad || (x > KEEP.box[0] - pad && x < KEEP.box[1] + pad && z > KEEP.box[2] - pad && z < KEEP.box[3] + pad);

/* AVAGUARD: the perimeter's paint on the plate: a bezel of ticks round the rim under the fence, two hairline rounds bounding
   the band, a dashed round in the accent through it, and circuit traces out from the city to the rim, each a radial run,
   a short jog along its round and a run out again, a dot where it starts and a ring where it lands; a pad under each
   monolith. Neutral hairlines with the accent on a few, faint enough to read as the plate's own engraving */
function paintPerimeter(ctx: CanvasRenderingContext2D, theme: Theme) {
  const dark = theme === "dark";
  const ink = dark ? "rgba(255,255,255,0.085)" : "rgba(0,0,0,0.09)";
  const inkHi = dark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.18)";
  const accent = SIGNAL3.line[theme];
  const accentA = (a: number) => {
    const n = parseInt(accent.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };
  const [b0, b1] = PERIMETER.band;
  const P = (r: number, a: number): [number, number] => [r * Math.cos(a), r * Math.sin(a)];
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const round = (r: number, color: string, w: number, dash: number[] = []) => {
    ctx.setLineDash(dash);
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  };
  // the band's bounds and the fence's foot
  round(b0, ink, 0.6);
  round(b1, ink, 0.6);
  round(PERIMETER.fence, inkHi, 0.8);
  round((b0 + b1) / 2 + 18, accentA(dark ? 0.32 : 0.28), 0.6, [3, 5]);
  // the bezel: a tick every degree and a half under the fence, a longer one every fifteen in the accent
  const f = PERIMETER.fence;
  for (let i = 0; i < 240; i++) {
    const a = (i / 240) * Math.PI * 2;
    const major = i % 10 === 0;
    const [x0, y0] = P(f - (major ? 13 : 7), a);
    const [x1, y1] = P(f - 3, a);
    ctx.strokeStyle = major ? accentA(dark ? 0.6 : 0.55) : ink;
    ctx.lineWidth = major ? 0.8 : 0.5;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  // the traces, out from the city's side of the band to the rim's
  const roll = diceOf("sentinel:traces");
  const N = 44;
  for (let i = 0; i < N; i++) {
    const a0 = ((i + 0.5) / N) * Math.PI * 2 + (roll() - 0.5) * 0.05;
    const r0 = b0 + 6 + roll() * 22;
    const r1 = r0 + 24 + roll() * 50;
    const jog = (roll() < 0.5 ? -1 : 1) * (0.03 + roll() * 0.05);
    const r2 = b1 - 14 - roll() * 36;
    const pts: [number, number][] = [P(r0, a0), P(r1, a0)];
    for (let k = 1; k <= 6; k++) pts.push(P(r1, a0 + (jog * k) / 6));
    pts.push(P(r2, a0 + jog));
    if (pts.some(([x, y]) => kept(x, y, 12))) continue;
    const hot = i % 4 === 1;
    ctx.strokeStyle = hot ? accentA(dark ? 0.5 : 0.42) : inkHi;
    ctx.lineWidth = hot ? 0.75 : 0.6;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
    ctx.stroke();
    // its ends: a dot at the city's side, a ring where it lands
    ctx.fillStyle = hot ? accentA(dark ? 0.7 : 0.6) : inkHi;
    ctx.beginPath();
    ctx.arc(pts[0][0], pts[0][1], 1.1, 0, Math.PI * 2);
    ctx.fill();
    const [ex, ey] = pts[pts.length - 1];
    ctx.beginPath();
    ctx.arc(ex, ey, 1.8, 0, Math.PI * 2);
    ctx.stroke();
  }
  // a pad under each monolith: a hairline square turned to the centre, its inner edge in the accent
  for (const m of PERIMETER.monoliths) {
    const a = (m.a * Math.PI) / 180;
    const [cx, cy] = P(m.r, a);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a);
    ctx.strokeStyle = inkHi;
    ctx.lineWidth = 0.6;
    ctx.strokeRect(-7, -12, 14, 24);
    ctx.strokeStyle = accentA(dark ? 0.7 : 0.6);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-7, -12);
    ctx.lineTo(-7, 12);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

type Pt = [number, number];

export interface PaintInput {
  theme: Theme;
  city: City;
  terrain: Ground;
  outskirts: Outskirts;
  streets: RouteStreets[];
  heats: number[];
  /** each building's foot on its lot: a box's corners, or a drum's centre and radius */
  feet: { poly?: Pt[]; round?: [number, number, number] }[];
  /** each new L1's lot, fenced while it goes up */
  sites: Pt[][];
  /** the trees on the ground, whose feet darken it: their places in the plan and their crowns' radii */
  trees?: { x: number; z: number; r: number }[];
}


/** a foot's outline, as the paint and the feet layer draw it: a box's corners or a drum's circle */
function footPath(feet: { poly?: Pt[]; round?: [number, number, number] }[]): Path2D {
  const p = new Path2D();
  for (const f of feet) {
    if (f.round) {
      p.moveTo(f.round[0] + f.round[2], f.round[1]);
      p.arc(f.round[0], f.round[1], f.round[2], 0, Math.PI * 2);
    } else if (f.poly) {
      p.moveTo(f.poly[0][0], f.poly[0][1]);
      for (const q of f.poly.slice(1)) p.lineTo(q[0], q[1]);
      p.closePath();
    }
  }
  return p;
}

/** the blur of a foot's contact shade, in the plan's units: longer by day, so the towers sit on the ground */
export const FOOT_BLUR: Record<Theme, number> = { light: 12, dark: 7 };

/** the towers' contact shades' soft coverage, apart from the ground's paint (shaders.ts FEET_U), in the mask's alpha:
    blurred by `blur` as the paint's shade is, one union, so two that meet are no darker. It lies over the plate as the
    paint does, at its own size */
export function paintFeetMask(mask: HTMLCanvasElement, feet: { poly?: Pt[]; round?: [number, number, number] }[], blur: number) {
  const mx = mask.getContext("2d");
  if (!mx) return;
  const S = mask.width;
  const k = S / (2 * PLATE);
  const away = S * 1.5;
  mx.setTransform(1, 0, 0, 1, 0, 0);
  mx.clearRect(0, 0, S, S);
  mx.save();
  mx.setTransform(k, 0, 0, k, S / 2 - away, S / 2);
  mx.shadowColor = "#000";
  mx.shadowBlur = blur * k;
  mx.shadowOffsetX = away;
  mx.fillStyle = "#000";
  mx.fill(footPath(feet));
  mx.restore();
}

/** each tower's rise on the city's clock, as a gray (0 to 254 of `maxAt`, 255 none), over its contact shade's reach at
    `blur`; the earliest drawn last, so that where two reaches meet the earlier one shows first */
export function paintFeetTime(time: HTMLCanvasElement, feet: { poly?: Pt[]; round?: [number, number, number]; at: number }[], maxAt: number, blur: number) {
  const tx = time.getContext("2d");
  if (!tx) return;
  const T = time.width;
  const kt = T / (2 * PLATE);
  tx.setTransform(1, 0, 0, 1, 0, 0);
  tx.fillStyle = "#fff";
  tx.fillRect(0, 0, T, T);
  tx.setTransform(kt, 0, 0, kt, T / 2, T / 2);
  tx.lineJoin = "round";
  tx.lineWidth = blur * 2.6;
  for (const f of [...feet].sort((a, b) => b.at - a.at)) {
    const g = Math.round(Math.min(1, Math.max(0, f.at / Math.max(maxAt, 1e-3))) * 254);
    tx.fillStyle = tx.strokeStyle = `rgb(${g},${g},${g})`;
    const p = footPath([f]);
    tx.fill(p);
    tx.stroke(p);
  }
}

/* a CSS color between two, by share */
function mixHex(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(",")})`;
}

export function paintGround(canvas: HTMLCanvasElement, input: PaintInput) {
  const { theme, city, terrain, outskirts, streets, heats, feet, sites, trees = [] } = input;
  const c = (p: { light: string; dark: string }) => p[theme];
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const S = canvas.width;
  const k = S / (2 * PLATE);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, S, S);
  ctx.setTransform(k, 0, 0, k, S / 2, S / 2);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const fill = (d: string, color: string) => {
    ctx.fillStyle = color;
    ctx.fill(new Path2D(d));
  };
  // a lawn: a model's lawn, a matte cool green-gray
  const lawn = (d: string, color: string) => fill(d, color);
  const stroke = (d: string, color: string, width: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke(new Path2D(d));
  };
  /* the ground's shade where things meet it: a path's blurred shadow and not the path, cast
     back from off the canvas, so two shades that meet are no darker where they overlap */
  const shade = (path: Path2D, color: string, blur: number, kind: "fill" | "stroke" = "fill", width = 0) => {
    const away = S * 1.5;
    ctx.save();
    ctx.setTransform(k, 0, 0, k, S / 2 - away, S / 2);
    ctx.shadowColor = color;
    ctx.shadowBlur = blur * k;
    ctx.shadowOffsetX = away;
    ctx.fillStyle = ctx.strokeStyle = "#000";
    ctx.lineWidth = width;
    if (kind === "fill") ctx.fill(path);
    else ctx.stroke(path);
    ctx.restore();
  };
  const line = (pts: Pt[], color: string, width: number) => {
    if (pts.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  };

  // the plate, and the built city's ground a shade under it
  ctx.beginPath();
  ctx.arc(0, 0, PLATE, 0, Math.PI * 2);
  ctx.fillStyle = c(GROUND.plateTop);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, city.edge + city.lot * 0.3, 0, Math.PI * 2);
  ctx.fillStyle = c(GROUND.streets);
  ctx.fill();

  // AVAGUARD: the protected perimeter's engraving, in the band the river ran through
  if (SENTINEL_ONLY && !SENTINEL_RING) paintPerimeter(ctx, theme);

  // the outskirts: their plots, their parks, and each building site's fence
  for (const d of outskirts.pads) {
    fill(d, c(GROUND.pad));
    stroke(d, c(GROUND.blockEdge), 0.5);
  }
  for (const d of outskirts.parks) lawn(d, c(GROUND.park));
  for (const d of outskirts.fences) stroke(d, c(GROUND.fence), 0.7);

  // the boulevards run on to the ledger; the river crosses them
  if (terrain.roads) fill(terrain.roads, c(GROUND.streets));
  if (terrain.river) {
    lawn(terrain.river.banks, c(GROUND.banks));
    fill(terrain.river.water, c(GROUND.water));
    stroke(terrain.river.water, c(GROUND.waterEdge), theme === "dark" ? 1.6 : 1.2);
    // the current, a pale dashed line down the river's middle
    ctx.setLineDash([7, 11]);
    stroke(terrain.river.current, c(GROUND.current), 0.8);
    ctx.setLineDash([]);
  }

  // the streets the traffic drives, paved as busy as they are: the quiet first, so the busiest holds the street
  const order = streets.map((_, i) => i).sort((a, b) => heats[a] - heats[b]);
  for (const i of order) {
    const tone = mixHex(c(FLEET.roadLo), c(FLEET.roadHi), heats[i]);
    line(streets[i].street, tone, 0.5 * city.lot);
    for (const [a, b] of streets[i].avenues) line([a, b], tone, 0.9 * city.lot);
  }
  // the paint down each street's middle: dashes round a ring road, a double line and lane lines on a boulevard
  const dash = 0.13 * city.lot;
  const period = 0.3 * city.lot;
  ctx.strokeStyle = c(FLEET.mark);
  ctx.lineWidth = 0.035 * city.lot;
  ctx.lineCap = "butt";
  ctx.setLineDash([dash, period - dash]);
  const seenRing = new Set<string>();
  const seenWay = new Set<string>();
  for (const s of streets) {
    for (const r of s.rings) {
      const key = `${r.r.toFixed(0)}:${r.a0.toFixed(2)}:${r.a1.toFixed(2)}`;
      if (seenRing.has(key)) continue;
      seenRing.add(key);
      ctx.lineDashOffset = -r.a0 * r.r;
      ctx.beginPath();
      ctx.arc(0, 0, r.r, r.a0, r.a1);
      ctx.stroke();
    }
    for (const w of s.ways) {
      const key = `${w.bearing.toFixed(2)}:${w.r0.toFixed(0)}:${w.r1.toFixed(0)}`;
      if (seenWay.has(key)) continue;
      seenWay.add(key);
      const u: Pt = [Math.cos(w.bearing), Math.sin(w.bearing)];
      const n: Pt = [-u[1], u[0]];
      const run = (o: number, dashed: boolean) => {
        ctx.setLineDash(dashed ? [dash, period - dash] : []);
        ctx.lineDashOffset = -w.r0;
        ctx.beginPath();
        ctx.moveTo(u[0] * w.r0 + n[0] * o, u[1] * w.r0 + n[1] * o);
        ctx.lineTo(u[0] * w.r1 + n[0] * o, u[1] * w.r1 + n[1] * o);
        ctx.stroke();
      };
      const lot = city.lot;
      run(0.02 * lot, false);
      run(-0.02 * lot, false);
      for (const o of [0.157, 0.313]) {
        run(o * lot, true);
        run(-o * lot, true);
      }
    }
  }
  ctx.setLineDash([]);
  ctx.lineCap = "round";

  // the curbs: the street darkens at the foot of every block; the block's top then covers its inner half
  const curbs = new Path2D();
  for (const b of city.blocks) curbs.addPath(new Path2D(arcPath(b.a0, b.a1, b.r0 + 1.5, b.r1 - 1.5)));
  shade(curbs, c(GROUND.curb), 2.4, "stroke", 1.6);

  // the blocks' tops, their plots, and the ones no L1 stands on laid to lawn
  for (const b of city.blocks) {
    const d = arcPath(b.a0, b.a1, b.r0 + 1.5, b.r1 - 1.5);
    // AVAGUARD: the protocol's campus, its block a breath of the crown's green with a green hairline, so it reads as a place
    const ours = SENTINEL_ONLY && b.district === "security";
    fill(d, ours ? mixHex(c(GROUND.blockTop), c(AVAGUARD3.crown), theme === "dark" ? 0.07 : 0.06) : c(GROUND.blockTop));
    stroke(d, ours ? mixHex(c(GROUND.blockTop), c(AVAGUARD3.crown), theme === "dark" ? 0.45 : 0.5) : c(GROUND.blockEdge), ours ? 0.8 : 0.6);
  }
  if (terrain.gardens) lawn(terrain.gardens, c(GROUND.garden));
  if (terrain.plots) stroke(terrain.plots, c(GROUND.plotLine), 0.5);

  // downtown's plaza: its paving, its hairline edge and its dashed ring in the brand's red, and no glow round it
  ctx.beginPath();
  ctx.arc(0, 0, city.core - 3, 0, Math.PI * 2);
  ctx.fillStyle = c(GROUND.plaza);
  ctx.fill();
  ctx.strokeStyle = c(GROUND.plazaEdge);
  ctx.lineWidth = 0.7;
  ctx.stroke();
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  ctx.arc(0, 0, city.core - 9, 0, Math.PI * 2);
  ctx.strokeStyle = c(GROUND.plazaRing);
  ctx.stroke();
  ctx.setLineDash([]);

  // a new L1's lot, fenced while it goes up
  for (const poly of sites) {
    ctx.beginPath();
    ctx.moveTo(poly[0][0], poly[0][1]);
    for (const p of poly.slice(1)) ctx.lineTo(p[0], p[1]);
    ctx.closePath();
    ctx.fillStyle = theme === "dark" ? "rgba(242,193,78,0.06)" : "rgba(217,154,6,0.06)";
    ctx.fill();
    ctx.strokeStyle = c(GROUND.fence);
    ctx.lineWidth = 0.7;
    ctx.stroke();
  }

  // a soft shade at every building's foot, where its walls meet its lot, and under every tree
  // the outskirts houses' feet (the towers' are the feet layer's): by day the shade reaches further out, so they sit on the ground
  shade(footPath(feet), c(GROUND.contact), FOOT_BLUR[theme]);
  const canopy = new Path2D();
  for (const t of trees) {
    canopy.moveTo(t.x + t.r * 1.05, t.z);
    canopy.arc(t.x, t.z, t.r * 1.05, 0, Math.PI * 2);
  }
  shade(canopy, c(GROUND.canopy), 1.6);
}

/** the site's mono face, as the page has loaded it, for words painted in the scene */
export function monoFamily(): string {
  if (typeof document === "undefined") return "ui-monospace, monospace";
  const el = document.createElement("span");
  el.className = "font-mono";
  el.style.position = "absolute";
  el.style.visibility = "hidden";
  document.body.appendChild(el);
  const f = getComputedStyle(el).fontFamily;
  el.remove();
  return f || "ui-monospace, monospace";
}
