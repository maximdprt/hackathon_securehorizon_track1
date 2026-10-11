import gsap from "gsap";
import { SCENARIO, type SceneKey } from "./scenario";
import { STEPS, TIMINGS } from "./timings";
import { motion, resetMotion, sim, toast, type JournalEntry, type Paint } from "./store";
import { fmtAmount, shortAddr, toneOf, type TxEvent } from "./types";

/* One transaction at a time, the Sentinel protocol (Sentinel Protocole Pub.html): a car leaves the Sentinel tower (our
   MCP agent) white, drives through the X-ray gantry, stands as a hologram while the five checks light one by one, then
   is painted all over in its decision's colour and takes that colour's road: red to the yard (the crane, the baler, the
   hackers' registry skip), green through the C-Chain's gate, orange to the human post, where a person's answer paints
   it green or red and sends it the same way. No particle anywhere: the body's colour alone tells the decision. Each
   transaction is a GSAP timeline; the scene registers how to move the camera and shake (city3d/AvaGuardRun.tsx); the
   Director never touches React state per frame. */

export type Shot = "security" | "toll" | "parking" | "scrapyard" | "press" | "skip" | "cchain" | "gate" | "follow";
export type SceneHooks = { fly: (shot: Shot) => void; home: () => void; flashTower: () => void; shake: () => void; still: () => boolean };
let hooks: SceneHooks = { fly: () => {}, home: () => {}, flashTower: () => {}, shake: () => {}, still: () => false };
export function registerScene(h: SceneHooks) {
  hooks = h;
}

let tl: gsap.core.Timeline | null = null;
let busy = false;
const pendingTx: TxEvent[] = [];
/** who answers a parked car: the operator in the city, the guard (a human settled it in the sandbox's chat), or the
    clock (no answer: refused here, the safe default, and the guard's queue is left to its own humans) */
type By = "ville" | "garde" | "délai";
let humanAnswer: ((approve: boolean, by: By) => void) | null = null;
/** answers the guard sent before their car reached the post, by instruction id */
const early = new Map<string, boolean>();
const idOf = (tx: TxEvent | null | undefined) => (tx?.raw as { instruction_id?: string } | undefined)?.instruction_id;

const still = () => hooks.still();
const fly = (s: Shot) => hooks.fly(s);

/** queue a scene or a live transaction; it starts at once when nothing is running */
export function enqueue(tx: TxEvent) {
  pendingTx.push(structuredClone(tx));
  sim.set({ queue: pendingTx.map((t) => t.tx_id) });
  if (!busy) void next();
}
export const playScene = (k: SceneKey) => enqueue({ ...SCENARIO[k], created_at: new Date().toISOString() });

/** a live message: a new transaction, or a human's answer to one the city already shows (the guard sends the settled
    verdict on, approved_by set). That answer moves the parked car on instead of starting a second one. */
export function receive(tx: TxEvent) {
  const raw = tx.raw as { instruction_id?: string; approved_by?: string } | undefined;
  const id = raw?.instruction_id;
  if (raw?.approved_by && id) {
    const s = sim.get();
    if (idOf(s.tx) === id && s.phase !== "idle" && s.phase !== "home") {
      if (humanAnswer && s.human) humanAnswer(tx.decision === "ALLOW", "garde");
      else early.set(id, tx.decision === "ALLOW");
      return;
    }
    if (pendingTx.some((t) => idOf(t) === id) || s.ledger.some((l) => idOf(l) === id)) return; // already in the city
  }
  enqueue(tx);
}

/** the operator's answer on a live car goes to the guard that holds it (the sandbox's /api/decide): it settles its
    queue, flags or clears the recipient, and writes the decision on SentinelL1 */
async function settle(tx: TxEvent, approve: boolean) {
  const id = idOf(tx);
  if (!tx.decide_url || !id) return;
  try {
    const res = await fetch(`${tx.decide_url}/api/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction_id: id, decision: approve ? "allow" : "block" }),
    });
    const out = (await res.json().catch(() => ({}))) as { error?: string; onchain?: { ok?: boolean } | null };
    if (!res.ok) toast(`${tx.tx_id} : le garde n'a pas enregistré la décision (${out.error ?? res.status})`, "block");
    else toast(`${tx.tx_id} : décision transmise au garde${out.onchain?.ok ? " · inscrite sur SentinelL1" : ""}`, approve ? "allow" : "block");
  } catch {
    toast(`${tx.tx_id} : garde injoignable, décision gardée dans la ville seulement`, "block");
  }
}

/** a click on the car, or F: the camera follows the protocol to its end (city3d/AvaGuardRun.tsx flies its shots) */
export function followCar() {
  if (sim.get().tx && sim.get().phase !== "idle") sim.set({ follow: true });
}
/** the reader takes the camera back: the protocol carries on by itself */
export function stopFollow() {
  if (sim.get().follow) sim.set({ follow: false });
}

/** the human's answer for the parked car (Valider / Refuser, or A / R) */
export function answerHuman(approve: boolean) {
  humanAnswer?.(approve, "ville");
}

export function setPaused(p: boolean) {
  gsap.globalTimeline.paused(p);
  sim.set({ paused: p });
}

export function resetAll() {
  tl?.kill();
  tl = null;
  humanAnswer = null;
  early.clear();
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
const span = (s: number) => (still() ? 0.01 : s);

/** a leg of the car's route; the scene maps (leg, u) to a point on our street's lanes */
function leg(t: gsap.core.Timeline, name: typeof motion.leg, duration: number, ease = "power2.inOut") {
  t.call(() => {
    motion.leg = name;
    motion.u = 0;
  });
  t.to(motion, { u: 1, duration: span(duration), ease });
}

/** the body repainted all over, in one short fade: the only moments the car changes colour are the decision and a
    human's answer */
function repaint(t: gsap.core.Timeline, to: Paint) {
  t.call(() => {
    motion.paintFrom = motion.paintTo;
    motion.paintTo = to;
    motion.paint = 0;
  });
  t.to(motion, { paint: 1, duration: span(TIMINGS.paint), ease: "power1.inOut" });
}
const paintOf = (d: TxEvent["decision"]): Paint => (d === "ALLOW" ? "allow" : d === "BLOCK" ? "block" : "human");

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
  sim.set((s) => ({ tx, phase: "approach", step: -1, review: null, follow: s.follow && s.phase !== "idle", journal: [entry, ...s.journal].slice(0, 40), ledger: [{ ...tx, status: "PENDING" as const, via: "Sentinel" as const }, ...s.ledger] }));

  // 1. out of the Sentinel tower's door, white: nothing is decided yet; it pulls away gently toward the gantry
  motion.visible = true;
  motion.tone = "verify";
  motion.paintFrom = motion.paintTo = "white";
  motion.paint = 1;
  fly("follow");
  await run((t) => leg(t, "approach", TIMINGS.approach, "power1.in"));
  if (!busy) return;

  // 2. the scan: through the gantry's fixed beam at an even speed, what has passed it a hologram; it stops just past the
  //    gantry, all hologram, while the card lights the five checks one by one and the score climbs to its value
  sim.set({ phase: "analysis" });
  fly("toll");
  const pace = immune ? 0 : tx.decision === "ALLOW" ? TIMINGS.healthy : 1;
  const dur = (s: number) => span(immune ? TIMINGS.immunity / 6 : s * pace);
  await run((t) => {
    t.call(() => sim.set({ step: 0 }));
    leg(t, "scanPass", TIMINGS.scan, "none");
    t.to(motion, { scan: 1, duration: span(TIMINGS.scan), ease: "none" }, "<");
    t.call(() => {
      motion.xray = 1;
    });
    const c0 = t.duration();
    t.to(motion, { gauge: 1, duration: dur(TIMINGS.check) * 5, ease: "power1.out" }, c0);
    // authority, beneficiary, mandate, intent, contract (sim/timings.ts STEPS 1 to 5)
    for (let i = 1; i <= 5; i++) t.call(() => sim.set({ step: i }), [], c0 + (i - 1) * dur(TIMINGS.check));
    t.to({}, { duration: dur(TIMINGS.verdict) });
    // 3. the decision paints itself: the hologram goes, the body is whole again, in the decision's colour
    t.call(() => {
      sim.set({ step: 6 });
      motion.xray = 0;
      motion.tone = toneOf(tx.decision);
    });
    repaint(t, paintOf(tx.decision));
    // the barrier past the gantry lifts for whichever way it takes: the car never drives through it
    t.to(motion, { barrier: 1, duration: span(TIMINGS.barrier), ease: "power2.out" }, "<");
    t.call(() => sim.set({ step: STEPS.length }));
  });
  if (!busy) return;
  if (immune) toast("Adresse déjà au registre des hackers · refus d'office", "block");
  sim.set((s) => ({ kpi: { ...s.kpi, transactions: s.kpi.transactions + 1, decisionMs: s.kpi.decisionMs + tx.timings_ms.decide, decisions: s.kpi.decisions + 1 } }));

  // 4. the road of its colour
  if (tx.decision === "ALLOW") await allow(tx, "Sentinel", "toCChain");
  else if (tx.decision === "BLOCK") await block(tx, immune ? "registre" : "Sentinel", "toScrapyard");
  else await human(tx);
  if (!busy) return;

  sim.set({ phase: "home", follow: false });
  motion.visible = false;
  hooks.home();
  await wait(TIMINGS.home);
  sim.set({ phase: "idle" });
}

function finish(tx: TxEvent, outcome: "ALLOW" | "BLOCK", via: "Sentinel" | "humain" | "registre") {
  const s = sim.get();
  const n = Math.max(18342, (s.blocks.at(-1)?.n ?? 18341) + 1, tx.onchain?.block ?? 0);
  const r = s.review && s.review.tx_id === tx.tx_id ? s.review : null;
  const review = r ? { by: r.by, at: r.at, approve: r.approve, protocol: r.protocol } : undefined;
  const proof = { chain: tx.onchain?.chain ?? "Sentinel L1", tx_hash: tx.onchain?.tx_hash ?? "0x", visa_id: tx.onchain?.visa_id, block: n };
  sim.set((st) => ({
    blocks: [...st.blocks.slice(-15), { n, tone: outcome === "ALLOW" ? "allow" : "block", tx_id: tx.tx_id }],
    journal: st.journal.map((j) => (j.tx_id === tx.tx_id && j.outcome === "PENDING" ? { ...j, outcome, via, block: n } : j)),
    kpi: { ...st.kpi, visas: st.kpi.visas + (outcome === "ALLOW" ? 1 : 0), blocked: st.kpi.blocked + (outcome === "BLOCK" ? 1 : 0), protectedUsd: st.kpi.protectedUsd + (outcome === "BLOCK" ? tx.amount.value : 0) },
    ledger: st.ledger.map((l) => (l.tx_id === tx.tx_id ? { ...l, status: outcome, via, review, decided_at: new Date().toISOString(), onchain: proof } : l)),
    tx: st.tx && st.tx.tx_id === tx.tx_id ? { ...st.tx, onchain: proof } : st.tx,
  }));
  return n;
}

/* 4b. green: the barrier lifts, the road to the C-Chain lights in green, the car drives it, through the C-Chain's
   gate and on into the C-Chain's tower, gathering speed; it is gone the moment its nose meets the tower (guardGeo): the
   payment is executed, its visa spent, its proof on-chain */
async function allow(tx: TxEvent, via: "Sentinel" | "humain", from: "toCChain" | "parkToCChain") {
  motion.tone = "allow";
  sim.set({ phase: "allow", routeLit: true });
  await run((t) => {
    t.call(() => fly("cchain"));
    t.to(motion, { glow: 1, duration: 0.4 });
    const at = t.duration();
    leg(t, from, from === "toCChain" ? TIMINGS.toCChain : TIMINGS.parkToCChain, "power1.in");
    // the barrier falls back once the car has gone past it
    t.to(motion, { barrier: 0, duration: span(TIMINGS.barrier) }, at + span(1.2));
    if (!still()) t.call(() => fly("gate"), [], at + (from === "toCChain" ? TIMINGS.toCChain : TIMINGS.parkToCChain) * 0.45);
    t.call(() => {
      motion.visible = false;
      const n = finish(tx, "ALLOW", via);
      toast(`Paiement exécuté sur la C-Chain · visa consommé · preuve bloc #${fmtAmount(n)}`, "allow");
    });
    t.to({}, { duration: span(TIMINGS.arrivalHold) });
    t.to(motion, { glow: 0, duration: 0.5 });
    t.call(() => sim.set({ routeLit: false }));
  });
}

/* 4a. red: round to the yard, red from start to end; the crane picks it, the baler crushes it in three strokes into a
   red block that still reads as a car, the block is ejected and laid in the hackers' registry skip */
async function block(tx: TxEvent, via: "Sentinel" | "humain" | "registre", from: "toScrapyard" | "parkToScrapyard") {
  motion.tone = "block";
  sim.set({ phase: "block" });
  await run((t) => {
    t.call(() => fly("scrapyard"));
    const at0 = t.duration();
    leg(t, from, from === "toScrapyard" ? TIMINGS.toScrapyard : TIMINGS.parkToScrapyard, "power1.inOut");
    t.to(motion, { barrier: 0, duration: span(TIMINGS.barrier) }, at0 + span(1.2));
    // the Guard Yard's own timeline from PICK (components/guard-yard/three/timeline.ts), a little faster than the
    // reference; no camera shake
    const Y0 = 10.4;
    const Y1 = 22.2;
    t.call(() => {
      motion.yard = Y0;
    });
    const at = t.duration();
    const len = span((Y1 - Y0) / TIMINGS.yardSpeed);
    const when = (yt: number) => at + ((yt - Y0) / (Y1 - Y0)) * len;
    t.to(motion, { yard: Y1, duration: len, ease: "none" }, at);
    if (!still()) {
      t.call(() => fly("press"), [], when(13.6));
      t.call(() => fly("skip"), [], when(18.3));
    }
    // the block lands in the skip: the fraudster's address joins the registry, with the proof's block
    t.call(
      () => {
        const addr = tx.to.address.toLowerCase();
        sim.set((s) => (s.registry.includes(addr) ? {} : { registry: [...s.registry, addr] }));
        const n = finish(tx, "BLOCK", via);
        toast(`${shortAddr(tx.to.address)} enregistrée au registre des hackers · ${fmtAmount(tx.amount.value)} ${tx.amount.token} protégés · preuve bloc #${fmtAmount(n)}`, "block");
      },
      [],
      when(21.2),
    );
    t.to({}, { duration: span(1.2) });
  });
}

/* 4c. orange: the car parks at the human post and waits; nothing leaves until a person decides. Valider paints it
   green and it takes 4b, Refuser paints it red and it takes 4a; the answer is kept: who, when, which protocol */
async function human(tx: TxEvent) {
  motion.tone = "human";
  sim.set({ phase: "human" });
  await run((t) => {
    t.call(() => fly("parking"));
    leg(t, "toParking", TIMINGS.toParking, "power1.inOut");
  });
  if (!busy) return;
  sim.set((s) => ({ human: { tx_id: tx.tx_id, deadline: Date.now() + TIMINGS.humanTimeout * 1000 }, ledger: s.ledger.map((l) => (l.tx_id === tx.tx_id ? { ...l, status: "HUMAN" as const } : l)) }));
  const id = idOf(tx);
  const { approve, by } = await new Promise<{ approve: boolean; by: By }>((resolve) => {
    // the guard may have been answered in the sandbox's chat while the car drove to the post
    if (id && early.has(id)) return resolve({ approve: early.get(id)!, by: "garde" });
    const tick = gsap.delayedCall(TIMINGS.humanTimeout, () => resolve({ approve: false, by: "délai" })); // no answer: refused, the safe default
    humanAnswer = (a, b) => {
      tick.kill();
      resolve({ approve: a, by: b });
    };
  });
  humanAnswer = null;
  if (id) early.delete(id);
  if (!busy) return;
  if (by === "ville") void settle(tx, approve);
  const at = new Date().toISOString();
  const who = by === "garde" ? "un humain (chat de la sandbox)" : "opérateur Sentinel";
  sim.set({ human: null, review: { tx_id: tx.tx_id, approve, by: who, at, protocol: approve ? "visa" : "déchetterie" } });
  toast(`${tx.tx_id} ${approve ? "validée" : "refusée"} ${by === "délai" ? "sans réponse (refus par défaut, dans la ville)" : `par ${who}`} à ${new Date(at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} · protocole ${approve ? "visa vers la C-Chain" : "déchetterie"}`, approve ? "allow" : "block");
  // repainted, then straight out of the post by its exit gate, the way of its new colour
  await run((t) => {
    t.call(() => {
      motion.tone = approve ? "allow" : "block";
    });
    repaint(t, approve ? "allow" : "block");
  });
  if (!busy) return;
  if (approve) await allow(tx, "humain", "parkToCChain");
  else await block(tx, "humain", "parkToScrapyard");
}

export const STEP_COUNT = STEPS.length;
