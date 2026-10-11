import gsap from "gsap";
import { SCENARIO, type SceneKey } from "./scenario";
import { STEPS, TIMINGS } from "./timings";
import { motion, resetMotion, sim, toast, type JournalEntry } from "./store";
import { fmtAmount, shortAddr, toneOf, type TxEvent } from "./types";

/* One transaction at a time (section 5). Each transaction is a GSAP timeline built from its TxEvent: the car's legs,
   the analysis steps (each lights a line of the card), then its outcome. The scene registers how to move the camera,
   flash the C-Chain tower and shake (city3d/AvaGuardRun.tsx); the Director never touches React state per frame. */

export type Shot = "security" | "toll" | "parking" | "scrapyard" | "press" | "skip" | "cchain" | "follow";
export type SceneHooks = { fly: (shot: Shot) => void; home: () => void; flashTower: () => void; shake: () => void; still: () => boolean };
let hooks: SceneHooks = { fly: () => {}, home: () => {}, flashTower: () => {}, shake: () => {}, still: () => false };
export function registerScene(h: SceneHooks) {
  hooks = h;
}

let tl: gsap.core.Timeline | null = null;
let busy = false;
const pendingTx: TxEvent[] = [];
let humanAnswer: ((approve: boolean) => void) | null = null;

const still = () => hooks.still();
const fly = (s: Shot) => hooks.fly(s);

/** queue a scene or a live transaction; it starts at once when nothing is running */
export function enqueue(tx: TxEvent) {
  pendingTx.push(structuredClone(tx));
  sim.set({ queue: pendingTx.map((t) => t.tx_id) });
  if (!busy) void next();
}
export const playScene = (k: SceneKey) => enqueue({ ...SCENARIO[k], created_at: new Date().toISOString() });

/** F: the camera back on the car while one runs */
export function followCar() {
  if (sim.get().tx && sim.get().phase !== "idle") fly("follow");
}

/** the human's answer for the parked car (buttons, or A / R) */
export function answerHuman(approve: boolean) {
  humanAnswer?.(approve);
}

export function setPaused(p: boolean) {
  gsap.globalTimeline.paused(p);
  sim.set({ paused: p });
}

export function resetAll() {
  tl?.kill();
  tl = null;
  humanAnswer = null;
  pendingTx.length = 0;
  busy = false;
  gsap.globalTimeline.paused(false);
  resetMotion();
  sim.reset();
  hooks.home();
}

/** play a timeline to its end (or until reset) */
function run(build: (t: gsap.core.Timeline) => void) {
  return new Promise<void>((resolve) => {
    tl = gsap.timeline({ onComplete: resolve });
    build(tl);
  });
}
const wait = (s: number) => run((t) => t.to({}, { duration: s }));

/** a leg of the car's route; the scene maps (leg, u) to a point on our street's lanes */
function leg(t: gsap.core.Timeline, name: typeof motion.leg, duration: number, ease = "power2.inOut") {
  t.call(() => {
    motion.leg = name;
    motion.u = 0;
  });
  t.to(motion, { u: 1, duration: still() ? 0.01 : duration, ease });
}

async function next() {
  const tx = pendingTx.shift();
  sim.set({ queue: pendingTx.map((t) => t.tx_id) });
  if (!tx) {
    busy = false;
    return;
  }
  busy = true;
  await play(tx);
  if (!busy) return; // reset while it ran
  await wait(TIMINGS.between);
  void next();
}

async function play(tx: TxEvent) {
  resetMotion();
  // a scene played again is a new transaction: it keeps its number, with a replay suffix
  const seen = sim.get().ledger.filter((l) => l.tx_id === tx.tx_id || l.tx_id.startsWith(`${tx.tx_id}-`)).length;
  if (seen) tx.tx_id = `${tx.tx_id}-${seen + 1}`;
  const known = sim.get().registry.includes(tx.to.address.toLowerCase());
  const immune = !!tx.registry_hit && known;
  const entry: JournalEntry = { tx_id: tx.tx_id, outcome: "PENDING", via: "Sentinel", amount: tx.amount.value, token: tx.amount.token, to: tx.to.address, at: new Date().toISOString() };
  sim.set((s) => ({ tx, phase: "approach", step: -1, journal: [entry, ...s.journal].slice(0, 40), ledger: [{ ...tx, status: "PENDING" as const, via: "Sentinel" as const }, ...s.ledger] }));
  motion.visible = true;
  motion.tone = "verify";
  fly("follow");

  // 1. from the HQ to the toll, on our street
  await run((t) => leg(t, "approach", TIMINGS.approach));
  if (!busy) return;

  // 2. the analysis at the toll: each step lights one more line of the card
  sim.set({ phase: "analysis" });
  fly("toll");
  const pace = immune ? 0 : tx.decision === "ALLOW" ? TIMINGS.healthy : 1;
  await run((t) => {
    const stepAt = (i: number) => t.call(() => sim.set({ step: i }));
    const dur = (s: number) => (immune ? TIMINGS.immunity / 7 : s * pace);
    stepAt(0);
    // the X-ray: the car drives through the gantry's fixed beam, what has passed it turns to a hologram
    leg(t, "scanPass", Math.max(0.01, dur(TIMINGS.scan)), "none");
    t.to(motion, { scan: 1, duration: Math.max(0.01, dur(TIMINGS.scan)), ease: "none" }, "<");
    stepAt(1);
    // the whole car a hologram a moment, its contract read, then solid again
    t.call(() => {
      motion.xray = 1;
    });
    t.to({}, { duration: dur(TIMINGS.holo) });
    t.call(() => {
      motion.xray = 0;
    });
    stepAt(2);
    t.to(motion, { authority: 1, duration: dur(TIMINGS.authority), ease: "none" });
    stepAt(3);
    t.to(motion, { snow: 1, duration: dur(TIMINGS.snowball), ease: "none" });
    stepAt(4);
    t.to(motion, { ping: 1, duration: dur(TIMINGS.registry), ease: "power1.in" });
    if (tx.registry_hit) t.to(motion, { registryFlash: 1, duration: 0.15 }).to(motion, { registryFlash: 0, duration: 0.9 });
    stepAt(5);
    t.to(motion, { gauge: 1, duration: dur(TIMINGS.score), ease: "power2.out" });
    stepAt(6);
    t.call(() => {
      motion.tone = toneOf(tx.decision);
    });
    t.to({}, { duration: dur(TIMINGS.verdict) });
    stepAt(7);
  });
  if (!busy) return;
  if (immune) toast("Adresse connue · refus en 0,3 s · le 2e agent est immunisé", "block");
  sim.set((s) => ({ kpi: { ...s.kpi, transactions: s.kpi.transactions + 1, decisionMs: s.kpi.decisionMs + tx.timings_ms.decide, decisions: s.kpi.decisions + 1 } }));

  // 3. the outcome
  if (tx.decision === "ALLOW") await allow(tx, "Sentinel", "toCChain");
  else if (tx.decision === "BLOCK") await block(tx, immune ? "registre" : "Sentinel", true);
  else await human(tx);
  if (!busy) return;

  sim.set({ phase: "home" });
  motion.visible = false;
  hooks.home();
  await wait(TIMINGS.home);
  sim.set({ phase: "idle" });
}

function finish(tx: TxEvent, outcome: "ALLOW" | "BLOCK", via: "Sentinel" | "humain" | "registre") {
  const s = sim.get();
  const n = Math.max(18342, (s.blocks.at(-1)?.n ?? 18341) + 1, tx.onchain?.block ?? 0);
  sim.set((st) => ({
    blocks: [...st.blocks.slice(-15), { n, tone: outcome === "ALLOW" ? "allow" : "block", tx_id: tx.tx_id }],
    journal: st.journal.map((j) => (j.tx_id === tx.tx_id && j.outcome === "PENDING" ? { ...j, outcome, via, block: n } : j)),
    kpi: { ...st.kpi, visas: st.kpi.visas + (outcome === "ALLOW" ? 1 : 0), blocked: st.kpi.blocked + (outcome === "BLOCK" ? 1 : 0), protectedUsd: st.kpi.protectedUsd + (outcome === "BLOCK" ? tx.amount.value : 0) },
    ledger: st.ledger.map((l) => (l.tx_id === tx.tx_id ? { ...l, status: outcome, via, decided_at: new Date().toISOString(), onchain: { chain: tx.onchain?.chain ?? "Sentinel L1", tx_hash: tx.onchain?.tx_hash ?? "0x", visa_id: tx.onchain?.visa_id, block: n } } : l)),
    tx: st.tx && st.tx.tx_id === tx.tx_id ? { ...st.tx, onchain: { chain: tx.onchain?.chain ?? "Sentinel L1", tx_hash: tx.onchain?.tx_hash ?? "0x", visa_id: tx.onchain?.visa_id, block: n } } : st.tx,
  }));
  return n;
}

async function allow(tx: TxEvent, via: "Sentinel" | "humain", from: "toCChain") {
  motion.tone = "allow";
  await run((t) => {
    t.to(motion, { crystals: 1, duration: 1.1, ease: "power2.out" });
    t.to(motion, { barrier: 1, duration: TIMINGS.barrier, ease: "power2.out" });
    t.call(() => {
      fly("cchain");
      sim.set({ routeLit: true });
    });
    t.to(motion, { glow: 1, duration: 0.5 }, "<");
    leg(t, from, TIMINGS.toCChain);
    t.call(() => hooks.flashTower());
    t.to(motion, { shield: 1, duration: 0.5, ease: "back.out(2)" });
    t.call(() => {
      finish(tx, "ALLOW", via);
      toast("Accepté et protégé par Sentinel", "allow");
    });
    t.to({}, { duration: TIMINGS.arrivalHold });
    t.to(motion, { glow: 0, barrier: 0, duration: 0.6 });
    t.call(() => sim.set({ routeLit: false }));
  });
}

async function block(tx: TxEvent, via: "Sentinel" | "humain" | "registre", fromToll: boolean) {
  motion.tone = "block";
  await run((t) => {
    if (fromToll) {
      t.call(() => {
        motion.blink = true;
      });
      t.to(motion, { frost: 1, duration: 0.9, ease: "power2.out" });
      leg(t, "uTurn", TIMINGS.uTurn);
      t.call(() => {
        motion.blink = false;
      });
    } else t.to(motion, { frost: 1, duration: 0.6 });
    t.call(() => fly("scrapyard"));
    leg(t, "toScrapyard", TIMINGS.toScrapyard);
    // the Guard Yard's own timeline from PICK (components/guard-yard/three/timeline.ts): the crane picks the car, the
    // baler crushes it in three strokes, the bale is ejected and laid in the hackers' registry skip
    const Y0 = 10.4;
    const Y1 = 22.2;
    t.call(() => {
      motion.yard = Y0;
    });
    const at = t.duration();
    const span = still() ? 0.01 : Y1 - Y0;
    const when = (yt: number) => at + ((yt - Y0) / (Y1 - Y0)) * span;
    t.to(motion, { yard: Y1, duration: span, ease: "none" }, at);
    if (!still()) {
      t.call(() => fly("press"), [], when(13.6));
      for (const hit of [14.6, 15.8, 16.65]) t.call(() => hooks.shake(), [], when(hit));
      t.call(() => fly("skip"), [], when(18.3));
    }
    // the bale lands in the skip: the address joins the registry
    t.call(
      () => {
        const addr = tx.to.address.toLowerCase();
        sim.set((s) => (s.registry.includes(addr) ? {} : { registry: [...s.registry, addr] }));
        finish(tx, "BLOCK", via);
        toast(`${shortAddr(tx.to.address)} ajoutée au registre`, "block");
        toast(`Transaction détruite · ${fmtAmount(tx.amount.value)} ${tx.amount.token} protégés${tx.dora_incident ? ` · incident DORA ${tx.dora_incident}` : ""}`, "block");
      },
      [],
      when(21.2),
    );
    t.to({}, { duration: 1.6 });
  });
}

async function human(tx: TxEvent) {
  motion.tone = "human";
  sim.set({ phase: "human" });
  await run((t) => {
    t.call(() => fly("parking"));
    leg(t, "toParking", TIMINGS.toParking);
  });
  if (!busy) return;
  sim.set((s) => ({ human: { tx_id: tx.tx_id, deadline: Date.now() + TIMINGS.humanTimeout * 1000 }, ledger: s.ledger.map((l) => (l.tx_id === tx.tx_id ? { ...l, status: "HUMAN" as const } : l)) }));
  // the timeline is paused-proof: the countdown only runs while the demo is not paused
  const approve = await new Promise<boolean>((resolve) => {
    humanAnswer = resolve;
    const tick = gsap.delayedCall(TIMINGS.humanTimeout, () => resolve(false)); // no answer: refused, the safe default
    const off = () => tick.kill();
    humanAnswer = (a) => {
      off();
      resolve(a);
    };
  });
  humanAnswer = null;
  sim.set({ human: null });
  toast(`${tx.tx_id} · ${approve ? "approuvée" : "refusée"} par un humain`, approve ? "allow" : "block");
  if (approve) {
    motion.tone = "allow";
    await run((t) => leg(t, "fromParking", TIMINGS.fromParking));
    await allow(tx, "humain", "toCChain");
  } else {
    // back out to the toll, then the same way as a refusal there: the U-turn, the scrapyard
    await run((t) => leg(t, "fromParking", TIMINGS.fromParking));
    await block(tx, "humain", true);
  }
}

export const STEP_COUNT = STEPS.length;
