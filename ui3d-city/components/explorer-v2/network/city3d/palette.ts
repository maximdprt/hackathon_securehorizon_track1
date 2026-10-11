import { GLASS, type Fam, type Glass } from "@/components/explorer-v2/network/icm-map";

/* The 3D city's colors. The glass and the ledger's tiles are read from the
   city's classes (city-model.ts), so the districts' calmed hues show here as
   they are set there; the grade round them (the massing, the ground, the
   roofs, the lights) is the brand's own, each color named for the part of
   the city it paints. */

export type Theme = "light" | "dark";

/** a class pair's color in one theme: `fill-[#hex] dark:fill-[#hex]`, or `fill-white` */
export function hexOf(classes: string, dark: boolean): string {
  for (const c of classes.split(/\s+/)) {
    const isDark = c.startsWith("dark:");
    if (isDark !== dark) continue;
    const bare = isDark ? c.slice(5) : c;
    const hex = /^(?:fill|stroke|bg)-\[(#[0-9A-Fa-f]{6})\]/.exec(bare);
    if (hex) return hex[1];
    if (/^(?:fill|stroke|bg)-white/.test(bare)) return "#FFFFFF";
    if (/^(?:fill|stroke|bg)-black/.test(bare)) return "#000000";
  }
  return dark ? "#2D313B" : "#FFFFFF";
}

export interface Pair {
  light: string;
  dark: string;
}
const pair = (classes: string): Pair => ({ light: hexOf(classes, false), dark: hexOf(classes, true) });
const P = (light: string, dark: string): Pair => ({ light, dark });

/* The city's grade, the brand's: an architect's white model of a financial
   district, lit for a board meeting. By day a cool near-white massing with
   steel shading on the brand's cool ground (#EBF0FA); by night graphite on
   the brand's dark (#1F1F1F). Everything cool and quiet, so the glass's
   calmed district hues and the brand's red carry the meaning. */
/* AVAGUARD: Sentinel's grade instead: a developer tool's black and white, neutral greys with no blue in them, hairline
   contrasts, and one accent, a violet (SIGNAL3), for what guards the city (its perimeter, its plaza's ring, the hub's
   lines). By day an off-white plate (#F7F7F7) with paper-white massing; by night a near-black plate (#0B0B0C) with
   graphite massing. The protocol's own colors (AVAGUARD3, the cars' paints) are the only other hues on it. */

/** AVAGUARD: the one accent, its line by day and by night, and a softer tint of it for wide hairlines */
export const SIGNAL3 = {
  line: P("#6E56CF", "#9E8CFC"),
  soft: P("#B4A6EC", "#4B3F8F"),
  /** what stands on the perimeter: the pylons' body and their caps */
  pylon: P("#141416", "#2A2A2E"),
  cap: P("#FAFAFA", "#E8E8EC"),
};

/** the massing: its walls (the light shades them), the frame of its curtain walls, and its crisp edges */
export const MASS3 = {
  wall: P("#FBFBFB", "#232327"),
  frame: P("#E4E4E6", "#303035"),
  edge: P("#8E8E93", "#5A5A62"),
};
/** each glass, its lit face (the 3D light shades the rest) */
export const GLASS3 = Object.fromEntries(Object.entries(GLASS).map(([g, [lit]]) => [g, pair(lit)])) as Record<Glass, Pair>;
/** the curtain wall's glass itself, which each district's calmed hue tints: a graphite by day, a lit room's calm white by night (lit at seven tenths) */
export const GLASS_BASE = P("#4E4E55", "#EDEDF2");

/** the ground: the plate, its streets, blocks and lawns, the river and the outskirts, in quiet neutral greys */
export const GROUND = {
  plateTop: P("#F7F7F7", "#0B0B0C"),
  plateEdge: P("#D4D4D8", "#2A2A2E"),
  /** the built city's ground: its streets, a step under the plate */
  streets: P("#ECECEE", "#121214"),
  /** a district's light when the cursor or the camera is on it: the accent */
  district: P("#6E56CF", "#9E8CFC"),
  pad: P("#F1F1F2", "#161618"),
  park: P("#EAEAEC", "#17171A"),
  banks: P("#EAEAEC", "#17171A"),
  water: P("#D4D4D8", "#141416"),
  /** the river's bank: a hairline in a darker steel by day, a steel line by night, so the water keeps its shape on the dark ground */
  waterEdge: P("#A1A1AA", "#3F3F46"),
  current: P("rgba(255,255,255,0.5)", "rgba(160,160,170,0.3)"),
  bridge: P("#FBFBFB", "#1E1E21"),
  bridgeEdge: P("#D4D4D8", "#2A2A2E"),
  blockLip: P("#D9D9DC", "#050506"),
  blockTop: P("#FFFFFF", "#18181B"),
  blockEdge: P("rgba(0,0,0,0.11)", "rgba(255,255,255,0.07)"),
  garden: P("#EFEFF0", "#141416"),
  plotLine: P("rgba(0,0,0,0.06)", "rgba(255,255,255,0.05)"),
  plaza: P("#FFFFFF", "#141416"),
  /** downtown's plaza keeps the accent as hairlines only: its edge and a dashed ring, no glow */
  plazaEdge: P("rgba(110,86,207,0.45)", "rgba(158,140,252,0.55)"),
  plazaRing: P("rgba(110,86,207,0.25)", "rgba(158,140,252,0.32)"),
  /** a building site's lot, fenced in hairline steel */
  fence: P("rgba(150,150,158,0.9)", "rgba(150,150,158,0.5)"),
  /** a building's soft shade at its foot, the street's at a block's curb, and the ground's under a tree */
  contact: P("rgba(0,0,0,0.2)", "rgba(0,0,0,0.6)"),
  curb: P("rgba(0,0,0,0.15)", "rgba(0,0,0,0.65)"),
  canopy: P("rgba(0,0,0,0.16)", "rgba(0,0,0,0.5)"),
  /** the trees, as a white architectural model's: pale grey crowns by day, graphite by night */
  tree: P("#DADADD", "#26262A"),
  trunk: P("#BDBDC2", "#2E2E32"),
  roofGarden: P("#E4E4E6", "#1A1A1D"),
  roofTree: P("#D4D4D8", "#26262A"),
  /** the outskirts' low houses, in the massing's white */
  outskirt: P("#FFFFFF", "#232327"),
  /** a building site's stacked materials */
  pile: P("#D4D4D8", "#2E2E32"),
};

/** the paints a district's form may give its shapes, over the massing's white: a stadium's pitch, a calm sage by day and a
    graphite-green by night, which the massing's shade at its foot takes down to the lawns' lightness, and its lines, white
    by day and pale by night, as the helipad's are; and the private bank's one band of brass, a satin brass by day and a
    dim bronze by night, the only warm metal in the city */
export const PAINT = {
  pitch: P("#E4E4E6", "#1C1C1F"),
  line: P("#FFFFFF", "#8E8E93"),
  brass: P("#B8B8BE", "#55555C"),
};

/** the roofs' furniture: steel and glass, nothing warm */
export const ROOF = {
  cap: P("#F2F2F3", "#26262A"),
  timber: P("#BDBDC2", "#3A3A40"),
  cone: P("#A1A1AA", "#34343A"),
  steel: P("#8E8E93", "#6B6B72"),
  helipad: P("#3F3F46", "#2E2E33"),
  solar: P("#1C1C20", "#121215"),
  solarEdge: P("#71717A", "#52525B"),
  warn: P("#6E56CF", "#9E8CFC"),
  crane: P("#A1A1AA", "#A1A1AA"),
};

/** downtown's mark and its lights */
export const HUB3 = {
  mark: P("#6E56CF", "#9E8CFC"),
  flag: P("#6E56CF", "#9E8CFC"),
  strip: P("#FFFFFF", "#EDEDF2"),
};

/** the ledger's tiles by tx family: their tops, read from the map's */
export type { Fam };

/** the fleet's glass, lamps and paint */
export const FLEET = {
  glass: P("#1C1C20", "#0A0A0C"),
  lamp: P("#FFFFFF", "#F4F4F8"),
  tail: P("#E6212F", "#FF4D57"),
  box: P("#FBFBFB", "#C9C9CF"),
  beam: P("#F4F4F8", "#F4F4F8"),
  blue: P("#6E56CF", "#9E8CFC"),
  /** the model city's paint, for traffic whose sender has no color of its own */
  neutral: [P("#FFFFFF", "#E4E4E7"), P("#D4D4D8", "#A1A1AA"), P("#71717A", "#71717A"), P("#27272A", "#52525B")],
  /** a route's paving by its state: off, quiet, busy */
  roadLo: P("#E2E2E5", "#18181B"),
  roadHi: P("#D1D1D6", "#222226"),
  mark: P("rgba(255,255,255,0.95)", "rgba(240,240,245,0.3)"),
};


/** AVAGUARD: our parcel's paints, on the city's grade: the HQ's crown and the proof blocks in our brand green, the
    toll's discreet green band, the human lot's amber marking, the registry's red edge (more orange than the C-Chain's
    red), and the four states a protected payment can be in */
export const AVAGUARD3 = {
  crown: P("#2FB57B", "#3FD08F"),
  band: P("#2C9A6B", "#3FD08F"),
  gate: P("#2F343B", "#2B3036"),
  amber: P("#D99A1E", "#F2B33D"),
  registry: P("#E5483F", "#FF5D57"),
  proof: P("#2FB57B", "#3FD08F"),
  barrier: P("#E5483F", "#FF5D57"),
  verify: P("#3D7FE0", "#6FA8FF"),
  allow: P("#2FB57B", "#3FD08F"),
  block: P("#E5483F", "#FF5D57"),
  human: P("#D99A1E", "#F2B33D"),
};
