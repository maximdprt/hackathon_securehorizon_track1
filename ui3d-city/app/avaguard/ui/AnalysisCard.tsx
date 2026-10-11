"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { openView } from "@/sim/nav";
import { cn } from "@/lib/utils";
import { PANE, PANEL_W } from "@/components/explorer-v2/network/city-frame";
import { CAR_PARTS, useCarGeometries } from "@/components/explorer-v2/network/city3d/carModel";
import { answerHuman, followCar, stopFollow } from "@/sim/Director";
import { motion, useSim } from "@/sim/store";
import { STEPS } from "@/sim/timings";
import { CHECK_LABEL, CHECK_ORDER, STATE, fmtAmount, fmtSecs, shortAddr, toneOf, type CheckKey, type Decision } from "@/sim/types";
import { Gauge, Radar, StateIcon, iconOf, zoneHex } from "./charts";

/* The analysis card, at the right from the scan to the end of the protocol: the car's radiography building as it goes
   through the beam, the five checks lighting one by one (authority, beneficiary, mandate, AI intent, contract), the
   score climbing to its value; then the decision in its colour (VISA, BLOCK, HUMAIN) with its reasons, its time, the
   thresholds, the on-chain proof and, for a refusal, its DORA incident. A doubtful case asks a human here: Valider,
   Refuser. */

/** the step each check lights at (sim/Director.ts, sim/timings.ts STEPS) */
const LIT_AT: Record<CheckKey, number> = { authority: 1, beneficiary: 2, mandate: 3, intent_ai: 4, contract: 5 };
const STEP_FR: Record<(typeof STEPS)[number], string> = { scan: "Radiographie", authority: "Autorité", beneficiary: "Bénéficiaire", mandate: "Mandat", intent_ai: "Intention IA", contract: "Contrat", verdict: "Décision" };

export function Badge({ decision, pending }: { decision: Decision; pending?: boolean }) {
  if (pending) return <span className="rounded-md border border-[#6FA8FF]/50 bg-[#6FA8FF]/10 px-2 py-0.5 font-mono text-[10.5px] font-bold uppercase tracking-[0.1em] text-[#6FA8FF]">Analyse…</span>;
  const c = STATE[toneOf(decision)].hex;
  const word = decision === "ALLOW" ? "VISA" : decision === "BLOCK" ? "BLOCK" : "HUMAIN";
  return (
    <span className="rounded-md border px-2 py-0.5 font-mono text-[10.5px] font-bold uppercase tracking-[0.1em]" style={{ color: c, borderColor: `${c}80`, background: `${c}1a` }}>
      {word}
    </span>
  );
}

/** the car's radiography, drawn once from its own model seen from the side (its triangles, translucent, stacked), then
    revealed front first as the car goes through the beam; the flagged call framed in red once decided */
function Radiography({ flagged }: { flagged: string | null }) {
  const geos = useCarGeometries();
  const canvas = useRef<HTMLCanvasElement>(null);
  const base = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 600;
    c.height = 200;
    const g = c.getContext("2d")!;
    g.fillStyle = "#0b0f17";
    g.fillRect(0, 0, 600, 200);
    const X = (x: number) => 300 + x * 250;
    const Y = (y: number) => 178 - y * 250;
    const ink: Record<(typeof CAR_PARTS)[number], string> = {
      Paint: "rgba(150,190,255,0.05)",
      Dark: "rgba(190,210,245,0.05)",
      Glass: "rgba(225,238,255,0.12)",
      Metal: "rgba(235,242,255,0.10)",
      LightFront: "rgba(255,244,214,0.5)",
      LightRear: "rgba(255,120,110,0.4)",
    };
    for (const name of CAR_PARTS) {
      const pos = geos[name].getAttribute("position");
      const idx = geos[name].getIndex();
      const count = idx ? idx.count : pos.count;
      const at = (k: number) => (idx ? idx.getX(k) : k);
      g.fillStyle = ink[name];
      for (let k = 0; k + 2 < count; k += 3) {
        const a = at(k);
        const b = at(k + 1);
        const d = at(k + 2);
        g.beginPath();
        g.moveTo(X(pos.getX(a)), Y(pos.getY(a)));
        g.lineTo(X(pos.getX(b)), Y(pos.getY(b)));
        g.lineTo(X(pos.getX(d)), Y(pos.getY(d)));
        g.closePath();
        g.fill();
      }
    }
    return c;
  }, [geos]);
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const ctx = canvas.current?.getContext("2d");
      if (ctx) {
        // front first: the car's front (+x) is at the right, as it goes through the beam
        const u = Math.min(1, Math.max(0, motion.scan));
        const w = 600 * u;
        ctx.fillStyle = "#0b0f17";
        ctx.fillRect(0, 0, 600, 200);
        if (w > 0) ctx.drawImage(base, 600 - w, 0, w, 200, 600 - w, 0, w, 200);
        if (u > 0 && u < 1) {
          ctx.fillStyle = "rgba(143,184,255,0.9)";
          ctx.fillRect(600 - w - 2, 0, 3, 200);
        }
        if (flagged && u >= 1) {
          ctx.strokeStyle = "#FF5D57";
          ctx.lineWidth = 3;
          ctx.strokeRect(40, 70, 130, 60);
          ctx.fillStyle = "#FF5D57";
          ctx.font = "700 15px ui-monospace, monospace";
          ctx.fillText(flagged, 40, 62);
        }
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [base, flagged]);
  return <canvas ref={canvas} width={600} height={200} className="block h-auto w-full rounded-lg" aria-label="Radiographie du paiement" />;
}

/** a doubtful case's question to a human, in the card: the transaction, why it is doubtful, Valider, Refuser */
function HumanAsk() {
  const human = useSim((s) => s.human);
  const tx = useSim((s) => s.tx);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!human) return;
    const i = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(i);
  }, [human]);
  if (!human || !tx || human.tx_id !== tx.tx_id) return null;
  const left = Math.max(0, Math.round((human.deadline - now) / 1000));
  const c = STATE.human.hex;
  return (
    <div role="alertdialog" aria-label="Avis humain requis" className="mx-4 mt-3 rounded-xl border-2 p-3" style={{ borderColor: `${c}99`, background: `${c}12` }}>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.14em]" style={{ color: c }}>
          Avis humain requis
        </span>
        <span className="font-mono text-[15px] font-semibold tabular-nums" style={{ color: c }} aria-live="polite">
          {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
        </span>
      </div>
      <div className="mt-1.5 font-mono text-[11px] text-zinc-600 dark:text-zinc-300">
        {tx.tx_id} · {fmtAmount(tx.amount.value)} {tx.amount.token} · {tx.to.domain ?? shortAddr(tx.to.address)} · score {tx.score}
      </div>
      <p className="mt-1 text-[12.5px] leading-snug text-zinc-700 dark:text-zinc-200">{tx.reasons[0]}</p>
      <div className="mt-2.5 flex gap-2">
        <button type="button" onClick={() => answerHuman(true)} className="flex-1 rounded-lg px-3 py-2 text-[13px] font-semibold text-white" style={{ background: STATE.allow.hex }}>
          Valider <span className="font-mono text-[10px] opacity-80">A</span>
        </button>
        <button type="button" onClick={() => answerHuman(false)} className="flex-1 rounded-lg px-3 py-2 text-[13px] font-semibold text-white" style={{ background: STATE.block.hex }}>
          Refuser <span className="font-mono text-[10px] opacity-80">R</span>
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-zinc-500">Rien ne part sans décision. Sans réponse à la fin du compte à rebours, le paiement est refusé.</p>
    </div>
  );
}

export function AnalysisCard() {
  const tx = useSim((s) => s.tx);
  const step = useSim((s) => s.step);
  const phase = useSim((s) => s.phase);
  const panel = useSim((s) => s.panel);
  const review = useSim((s) => s.review);
  const follow = useSim((s) => s.follow);
  const open = !!tx && phase !== "idle" && panel !== "detail";
  const done = step >= STEPS.length;
  const decided = step >= 6;
  const lit = (k: CheckKey) => step >= LIT_AT[k];
  // a human's answer settles a doubtful case: the card then wears the colour it was painted
  const reviewed = review && tx && review.tx_id === tx.tx_id ? review : null;
  const shown: Decision | null = tx ? (reviewed ? (reviewed.approve ? "ALLOW" : "BLOCK") : tx.decision) : null;
  const tone = tx && decided && shown ? STATE[toneOf(shown)].hex : STATE.verify.hex;
  const dora = tx && shown === "BLOCK" ? (tx.dora_incident ?? `DORA-${new Date(tx.created_at).getFullYear()}-${tx.tx_id.replace(/^tx_/, "").slice(0, 8)}`) : null;
  return (
    <aside
      aria-label="Analyse Sentinel"
      inert={!open || undefined}
      className={cn(PANE, "right-(--frame) border-l-4", open ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-6 opacity-0")}
      style={{ width: PANEL_W, borderLeftColor: tone }}
    >
      {tx && shown && (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="flex items-start justify-between gap-3 border-b border-zinc-100 px-4 py-3 dark:border-zinc-900">
            <div>
              <div className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400 dark:text-zinc-500">Sentinel · Analyse</div>
              <div className="font-mono text-[15px] font-semibold text-zinc-900 dark:text-zinc-50">{tx.tx_id}</div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <Badge decision={shown} pending={!decided} />
              <span className="font-mono text-[10.5px] text-zinc-500 dark:text-zinc-400">{decided ? `décidé en ${fmtSecs(tx.timings_ms.decide)}` : STEP_FR[STEPS[Math.max(0, Math.min(step, 6))]]}</span>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 border-b border-zinc-100 px-4 py-2 dark:border-zinc-900">
            <span className="text-[11.5px] text-zinc-500 dark:text-zinc-400">{follow ? "La caméra suit le protocole" : "Le protocole se déroule tout seul"}</span>
            <button
              type="button"
              onClick={follow ? stopFollow : followCar}
              className="rounded-md border border-zinc-200 px-2 py-1 text-[11.5px] font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-300 dark:hover:text-zinc-50"
            >
              {follow ? "Libérer la caméra" : "Suivre la voiture"} <span className="font-mono text-[10px] text-zinc-400">{follow ? "Échap" : "F"}</span>
            </button>
          </div>
          <div className="px-4 pt-3 text-[13px] text-zinc-700 dark:text-zinc-300">
            {tx.from.agent_id} <span className="text-zinc-400">→</span> {tx.to.label} <span className="text-zinc-400">·</span>{" "}
            <span className="font-mono">
              {fmtAmount(tx.amount.value)} {tx.amount.token}
            </span>
          </div>
          <div className="px-4 pt-2.5">
            <Suspense fallback={<div className="aspect-[3/1] w-full rounded-lg bg-[#0b0f17]" />}>
              <Radiography flagged={tx.contract.risky ? tx.contract.method : null} />
            </Suspense>
          </div>
          <div className="flex items-center justify-between px-3 pt-1">
            <Gauge tx={tx} live={!done} />
            <Radar tx={tx} lit={(k) => done || lit(k)} />
          </div>
          <div className="px-4 font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
            seuils : visa &lt; {tx.thresholds.allow_below} · humain {tx.thresholds.allow_below} à {tx.thresholds.block_from - 1} · refus ≥ {tx.thresholds.block_from}
          </div>
          <ul className="mt-2 space-y-0.5 px-3">
            {CHECK_ORDER.map((k) => {
              const on = done || lit(k);
              const c = tx.checks[k];
              return (
                <li key={k} className={cn("flex items-start gap-2 rounded-md px-1 py-1.5 transition-opacity duration-300", on ? "opacity-100" : "opacity-40")}>
                  <StateIcon kind={on ? iconOf(c.score, tx.thresholds) : "wait"} />
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between gap-2 text-[13px]">
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">{CHECK_LABEL[k]}</span>
                      <span className="font-mono text-[12px]" style={{ color: on ? zoneHex(c.score, tx.thresholds) : undefined }}>
                        {on ? `${c.score}/100` : "…"}
                      </span>
                    </div>
                    {on && <div className="text-[12px] leading-snug text-zinc-500 dark:text-zinc-400">{c.reason}</div>}
                  </div>
                </li>
              );
            })}
          </ul>
          {decided && (
            <ul className="mx-4 mt-2 list-disc space-y-1 pl-4 text-[12.5px] leading-snug text-zinc-700 dark:text-zinc-300">
              {tx.reasons.slice(0, 3).map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
          <HumanAsk />
          {reviewed && (
            <div className="mx-4 mt-3 rounded-lg border border-zinc-200 px-3 py-2 text-[12px] text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">
              <span className="font-semibold">Décision humaine :</span> {reviewed.approve ? "validée" : "refusée"} par {reviewed.by} à{" "}
              {new Date(reviewed.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · protocole {reviewed.protocol === "visa" ? "visa vers la C-Chain" : "déchetterie"}
            </div>
          )}
          {dora && decided && (
            <div className="mx-4 mt-3 rounded-lg px-3 py-2 font-mono text-[11px]" style={{ color: STATE.block.hex, background: `${STATE.block.hex}12` }}>
              Incident DORA {dora} · ouvert au refus, notifiable
            </div>
          )}
          <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 px-4 py-3 dark:border-zinc-900">
            <span className="w-full font-mono text-[10.5px] text-zinc-500 dark:text-zinc-400">
              {tx.onchain && decided ? `Preuve on-chain : bloc #${fmtAmount(tx.onchain.block)} · ${shortAddr(tx.onchain.tx_hash)}` : "Preuve on-chain : en attente"}
            </span>
            <button
              type="button"
              onClick={() => tx && openView("transactions", { tx: tx.tx_id })}
              className="shrink-0 rounded-md border border-zinc-200 px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-700 transition-colors hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:text-zinc-100"
            >
              Voir le détail
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
