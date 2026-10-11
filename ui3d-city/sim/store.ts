import { useSyncExternalStore } from "react";
import type { AuditTx, Tone, TxEvent } from "./types";

/* The simulation's state for the UI (cards, figures, alerts). It changes at step boundaries only; the per-frame
   values (positions, sweeps, gauges) live in `motion`, which GSAP tweens and the scene reads in useFrame. */

export type Phase = "idle" | "approach" | "analysis" | "allow" | "block" | "human" | "home";
export type Leg = "approach" | "scanPass" | "toCChain" | "uTurn" | "toScrapyard" | "toParking" | "fromParking" | "none";
/** the car's paint: white until Sentinel decides, then the decision's colour, all over the body */
export type Paint = "white" | "allow" | "block" | "human";
export type Panel = null | "detail" | "journal" | "registry" | "audit";
/** the screens that open over the city, a building's door each (sim/nav.ts) */
export type View = null | "transactions" | "registry" | "parking" | "audit";
export type ViewFilter = "all" | "ALLOW" | "BLOCK" | "HUMAN" | "PENDING" | "proof";

export type Review = { tx_id: string; approve: boolean; by: string; at: string; protocol: "visa" | "déchetterie" };
export type JournalEntry = { tx_id: string; outcome: "ALLOW" | "BLOCK" | "PENDING"; via: "Sentinel" | "humain" | "registre"; amount: number; token: string; to: string; at: string; block?: number };

export type SimState = {
  tx: TxEvent | null;
  phase: Phase;
  /** analysis step reached: -1 before the scan, STEPS.length once the verdict is out */
  step: number;
  queue: string[];
  paused: boolean;
  human: { tx_id: string; deadline: number } | null;
  /** the human's answer for the car in the car park: who, when, and the protocol it set off */
  review: Review | null;
  registry: string[];
  blocks: { n: number; tone: Tone; tx_id: string }[];
  journal: JournalEntry[];
  kpi: { transactions: number; visas: number; blocked: number; protectedUsd: number; decisionMs: number; decisions: number };
  toasts: { id: number; text: string; tone: Tone }[];
  panel: Panel;
  search: string;
  mode: "demo" | "live";
  liveStatus: string;
  /** our street lit in green while a visa drives it to the C-Chain */
  routeLit: boolean;
  /** every transaction played in the city, whole, newest first (the audit screens read it through data/source.ts) */
  ledger: AuditTx[];
  /** the screen open over the city, the transaction it shows, the filter it opened on */
  view: View;
  viewTx: string | null;
  viewFilter: ViewFilter;
};

/** live as soon as the team's verdict stream is configured (.env.local): every decision the API records (the explorer's
    test panel's too) drives in as a car; ?live=0 keeps the demo alone, ?live=1 forces the stream */
function initialMode(): SimState["mode"] {
  const q = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("live") : null;
  if (q === "0") return "demo";
  if (q === "1") return "live";
  return process.env.NEXT_PUBLIC_AVAGUARD_SSE_URL || process.env.NEXT_PUBLIC_AVAGUARD_WS_URL ? "live" : "demo";
}

const initial = (): SimState => ({
  tx: null,
  phase: "idle",
  step: -1,
  queue: [],
  paused: false,
  human: null,
  review: null,
  registry: [],
  blocks: [],
  journal: [],
  kpi: { transactions: 0, visas: 0, blocked: 0, protectedUsd: 0, decisionMs: 0, decisions: 0 },
  toasts: [],
  panel: null,
  search: "",
  mode: initialMode(),
  liveStatus: "",
  routeLit: false,
  ledger: [],
  view: null,
  viewTx: null,
  viewFilter: "all",
});

let state = initial();
const subs = new Set<() => void>();
export const sim = {
  get: () => state,
  set(patch: Partial<SimState> | ((s: SimState) => Partial<SimState>)) {
    state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
    subs.forEach((f) => f());
  },
  subscribe(f: () => void) {
    subs.add(f);
    return () => subs.delete(f);
  },
  reset() {
    const keep = { mode: state.mode, liveStatus: state.liveStatus, view: state.view, viewTx: state.viewTx, viewFilter: state.viewFilter };
    state = { ...initial(), ...keep };
    subs.forEach((f) => f());
  },
};

let toastId = 0;
export function toast(text: string, tone: Tone) {
  const id = ++toastId;
  sim.set((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, tone }] }));
  window.setTimeout(() => sim.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 6500);
}

export function useSim<T>(pick: (s: SimState) => T): T {
  return useSyncExternalStore(sim.subscribe, () => pick(state), () => pick(state));
}

/** Per-frame values, tweened by the Director and read by the scene (never React state). */
export const motion = {
  leg: "none" as Leg,
  /** progress along the current leg, 0..1 */
  u: 0,
  visible: false,
  tone: "verify" as Tone,
  /** 0..1 look effects on the car */
  xray: 0,
  frost: 0,
  cube: false,
  /** the press and the dumped cube */
  press: 0,
  dump: 0,
  /** toll: barrier lift 0..1, its red blink, the scanner sweep 0..1 */
  barrier: 0,
  blink: false,
  scan: 0,
  /** analysis sub-progress: 0..1 within the authority thread, the snowball waves, the registry ping, the gauge */
  authority: 0,
  snow: 0,
  ping: 0,
  gauge: 0,
  /** decision crystals 0..1 */
  crystals: 0,
  registryFlash: 0,
  /** the green route glow 0..1 */
  glow: 0,
  shield: 0,
  /** parking slot taken (0..5) */
  slot: 2,
  /** the Guard Yard's own clock for a refusal (components/guard-yard/three/timeline.ts): 0 at rest, 10.4 at PICK to 22.2 */
  yard: 0,
  /** the body's paint: from `paintFrom` to `paintTo` as `paint` goes 0..1 (a short fade, sim/Director.ts repaint) */
  paintFrom: "white" as Paint,
  paintTo: "white" as Paint,
  paint: 1,
};
export function resetMotion() {
  Object.assign(motion, { leg: "none", u: 0, visible: false, tone: "verify", xray: 0, frost: 0, cube: false, press: 0, dump: 0, barrier: 0, blink: false, scan: 0, authority: 0, snow: 0, ping: 0, gauge: 0, crystals: 0, registryFlash: 0, glow: 0, shield: 0, yard: 0, paintFrom: "white", paintTo: "white", paint: 1 });
}
