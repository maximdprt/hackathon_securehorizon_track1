"use client";

import { openView } from "@/sim/nav";
import { guardVerdictOf } from "@/components/guard-yard/verdict";
import { cn } from "@/lib/utils";
import { PANE, PANEL_W } from "@/components/explorer-v2/network/city-frame";
import { sim, useSim } from "@/sim/store";
import { STEPS } from "@/sim/timings";
import { CHECK_LABEL, CHECK_ORDER, STATE, fmtAmount, fmtSecs, shortAddr, toneOf, type CheckKey } from "@/sim/types";
import { Confidence, Gauge, Radar, StateIcon, iconOf, zoneHex } from "./charts";

/** the line each check lights at: contract with the hologram, authority with the thread, intent with the snowball… */
const LIT_AT: Record<CheckKey, number> = { contract: 2, authority: 3, intent_ai: 4, beneficiary: 5, mandate: 6 };
const STEP_FR: Record<(typeof STEPS)[number], string> = { scan: "Scan", holo: "Contrat", authority: "Autorité", snowball: "Échantillonnage", registry: "Registre", score: "Score", verdict: "Verdict" };

export function Badge({ decision, pending }: { decision: "ALLOW" | "HUMAN" | "BLOCK"; pending?: boolean }) {
  if (pending) return <span className="rounded-md border border-[#6FA8FF]/50 bg-[#6FA8FF]/10 px-2 py-0.5 font-mono text-[10.5px] font-bold uppercase tracking-[0.1em] text-[#6FA8FF]">Analyse…</span>;
  const c = STATE[toneOf(decision)].hex;
  const word = decision === "ALLOW" ? "ALLOW · visa" : decision === "BLOCK" ? "BLOCK" : "HUMAIN";
  return (
    <span className="rounded-md border px-2 py-0.5 font-mono text-[10.5px] font-bold uppercase tracking-[0.1em]" style={{ color: c, borderColor: `${c}80`, background: `${c}1a` }}>
      {word}
    </span>
  );
}

/** Level 2: the analysis card, at the right as the chain's panel, built line by line during the analysis */
export function AnalysisCard() {
  const tx = useSim((s) => s.tx);
  const step = useSim((s) => s.step);
  const phase = useSim((s) => s.phase);
  const human = useSim((s) => s.human);
  const panel = useSim((s) => s.panel);
  const open = !!tx && phase !== "idle" && panel !== "detail" && !human;
  const done = step >= STEPS.length;
  const lit = (k: CheckKey) => step >= LIT_AT[k];
  const tone = tx ? (done || step >= 6 ? STATE[toneOf(tx.decision)].hex : STATE.verify.hex) : STATE.verify.hex;
  return (
    <aside
      aria-label="Analyse Sentinel"
      inert={!open || undefined}
      className={cn(PANE, "right-(--frame) border-l-4", open ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-6 opacity-0")}
      style={{ width: PANEL_W, borderLeftColor: tone }}
    >
      {tx && (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="flex items-start justify-between gap-3 border-b border-zinc-100 px-4 py-3 dark:border-zinc-900">
            <div>
              <div className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400 dark:text-zinc-500">Sentinel · Analyse</div>
              <div className="font-mono text-[15px] font-semibold text-zinc-900 dark:text-zinc-50">{tx.tx_id}</div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <Badge decision={tx.decision} pending={step < 6} />
              <span className="font-mono text-[10.5px] text-zinc-500 dark:text-zinc-400">{step >= 6 ? `décidé en ${fmtSecs(tx.timings_ms.decide)}` : STEP_FR[STEPS[Math.max(0, Math.min(step, 6))]]}</span>
            </div>
          </div>
          <div className="px-4 pt-3 text-[13px] text-zinc-700 dark:text-zinc-300">
            {tx.from.agent_id} <span className="text-zinc-400">→</span> {shortAddr(tx.to.address)} <span className="text-zinc-400">·</span>{" "}
            <span className="font-mono">
              {fmtAmount(tx.amount.value)} {tx.amount.token}
            </span>
          </div>
          <div className="flex items-center justify-between px-3 pt-2">
            <Gauge tx={tx} live={!done} />
            <Radar tx={tx} lit={(k) => done || lit(k)} />
          </div>
          <div className="px-4 font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
            seuils : visa &lt; {tx.thresholds.allow_below} · humain {tx.thresholds.allow_below} à {tx.thresholds.block_from - 1} · refus ≥ {tx.thresholds.block_from}
          </div>
          <div className="px-4 pt-3">
            <Confidence live={!done} done={done || step > 3} tone={tone} />
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
          {step >= 6 && (
            <ul className="mx-4 mt-2 list-disc space-y-1 pl-4 text-[12.5px] leading-snug text-zinc-700 dark:text-zinc-300">
              {tx.reasons.slice(0, 2).map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
          <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 px-4 py-3 dark:border-zinc-900">
            <span className="w-full font-mono text-[10.5px] text-zinc-500 dark:text-zinc-400">{tx.onchain && step >= 6 ? `Preuve on-chain : bloc #${fmtAmount(tx.onchain.block)} · ${shortAddr(tx.onchain.tx_hash)}` : "Preuve on-chain : en attente"}</span>
            {tx.decision === "BLOCK" && step >= 6 && guardVerdictOf(tx) && (
              <button
                type="button"
                onClick={() => sim.set({ guard: guardVerdictOf(tx) })}
                className="shrink-0 rounded-md border border-[#FF5D57]/50 bg-[#FF5D57]/10 px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-[#E5483F] transition-colors hover:bg-[#FF5D57]/20 dark:text-[#FF5D57]"
              >
                Voir le contrôle
              </button>
            )}
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
