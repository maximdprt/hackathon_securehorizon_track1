"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Hourglass, ParkingSquare, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAudit } from "@/data/source";
import { answerHuman } from "@/sim/Director";
import { openView } from "@/sim/nav";
import { useSim } from "@/sim/store";
import { STATE, fmtAmount, shortAddr, type AuditTx } from "@/sim/types";
import { CARD, Kpi, LABEL, ScoreBar, StatusPill, when } from "./TransactionsView";
import { SourceBadge } from "./ViewHost";

/* The human lot's door: what waits for a person (score between the thresholds: neither a visa nor a refusal), with
   the countdown and the two buttons, and every decision people took before, how long they took and what they chose.
   The lot's plan mirrors the 3D one: six bays, the waiting car in P3. */

/** a reviewer's delay, synthetic but stable per transaction: 40 s to 1 min 50 */
const humanDelay = (t: AuditTx) => 40 + ((parseInt(t.tx_id.replace(/\D/g, ""), 10) * 37) % 70);
const REVIEWERS = ["Analyste conformité n°1", "Analyste conformité n°2", "Responsable paiements"];
const reviewerOf = (t: AuditTx) => REVIEWERS[parseInt(t.tx_id.replace(/\D/g, ""), 10) % REVIEWERS.length];
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, "0")}`;

export function ParkingView() {
  const { txs } = useAudit();
  const human = useSim((s) => s.human);
  const current = useSim((s) => s.tx);
  const paused = useSim((s) => s.paused);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!human) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [human]);

  const waiting = human && current && current.tx_id === human.tx_id ? current : null;
  // the screen keeps the keyboard: A approves, R refuses, as in the city
  useEffect(() => {
    if (!waiting) return;
    const on = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT" || e.repeat) return;
      if (e.key.toLowerCase() === "a") answerHuman(true);
      if (e.key.toLowerCase() === "r") answerHuman(false);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [waiting]);
  const decided = useMemo(() => txs.filter((t) => t.decision === "HUMAN" && (t.status === "ALLOW" || t.status === "BLOCK")), [txs]);
  const approved = decided.filter((t) => t.status === "ALLOW").length;
  const avg = decided.length ? decided.reduce((a, t) => a + humanDelay(t), 0) / decided.length : 0;
  const left = human ? Math.max(0, (human.deadline - now) / 1000) : 0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto px-6 py-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#F2B33D]/10 text-[#F2B33D]">
            <ParkingSquare className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-[20px] font-semibold text-zinc-900 dark:text-zinc-50">Validation humaine</h1>
            <p className="text-[12.5px] text-zinc-500 dark:text-zinc-400">Les paiements au score de doute (40 à 69) attendent une personne : sans réponse au bout du compte à rebours, ils sont refusés</p>
          </div>
        </div>
        <SourceBadge />
      </div>

      <div className="grid grid-cols-4 gap-3">
        <Kpi label="En attente" value={waiting ? 1 : 0} sub={waiting ? `place P3 · ${waiting.tx_id}` : "aucune demande"} tone={waiting ? STATE.human.hex : undefined} />
        <Kpi label="Décisions humaines" value={decided.length} sub="depuis le début (simulé)" />
        <Kpi label="Approuvées" value={`${decided.length ? Math.round((approved / decided.length) * 100) : 0} %`} sub={`${approved} approuvées · ${decided.length - approved} refusées`} tone={STATE.allow.hex} />
        <Kpi label="Délai moyen" value={avg ? mmss(avg) : "0:00"} sub="de la demande à la décision" />
      </div>

      <div className="grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] gap-4">
        {/* the request that waits */}
        <section className={cn(CARD, "p-5")}>
          <h2 className={cn(LABEL, "mb-3")}>File d&apos;attente</h2>
          {waiting && human ? (
            <div className="rounded-xl border border-[#F2B33D]/40 bg-[#F2B33D]/[0.06] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[15px] font-semibold text-zinc-900 dark:text-zinc-50">{waiting.tx_id}</span>
                    <StatusPill status="HUMAN" />
                  </div>
                  <p className="mt-1 text-[13px] text-zinc-800 dark:text-zinc-200">
                    {waiting.from.agent_id} → {waiting.to.label} <span className="font-mono text-[11px] text-zinc-500">{waiting.to.domain}</span>
                  </p>
                  <p className="font-mono text-[11.5px] text-zinc-500">
                    {fmtAmount(waiting.amount.value)} {waiting.amount.token} · {waiting.contract.method} · {shortAddr(waiting.to.address)}
                  </p>
                </div>
                <div className="text-right">
                  <div className={LABEL}>Temps restant</div>
                  <div className="font-mono text-[26px] font-semibold tabular-nums text-[#F2B33D]">{mmss(left)}</div>
                  {paused && <div className="font-mono text-[10px] text-zinc-400">démo en pause</div>}
                </div>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <ScoreBar tx={{ ...waiting, status: "HUMAN", via: "Sentinel" }} />
                <span className="text-[12px] text-zinc-600 dark:text-zinc-400">{waiting.reasons[0]}</span>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <button type="button" onClick={() => answerHuman(true)} className="flex items-center justify-center gap-1.5 rounded-xl border border-[#3FD08F]/50 bg-[#3FD08F]/10 py-2 text-[13px] font-medium text-[#2FB57B] hover:bg-[#3FD08F]/20 dark:text-[#3FD08F]">
                  <Check className="h-4 w-4" /> Approuver <span className="font-mono text-[10px] opacity-70">A</span>
                </button>
                <button type="button" onClick={() => answerHuman(false)} className="flex items-center justify-center gap-1.5 rounded-xl border border-[#FF5D57]/50 bg-[#FF5D57]/10 py-2 text-[13px] font-medium text-[#E5483F] hover:bg-[#FF5D57]/20 dark:text-[#FF5D57]">
                  <X className="h-4 w-4" /> Refuser <span className="font-mono text-[10px] opacity-70">R</span>
                </button>
                <button type="button" onClick={() => openView("transactions", { tx: waiting.tx_id })} className="rounded-xl border border-zinc-200 py-2 text-[13px] text-zinc-600 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-300 dark:hover:text-zinc-50">
                  Voir l&apos;audit
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-zinc-200 py-10 text-center dark:border-zinc-800">
              <Hourglass className="h-5 w-5 text-zinc-400" />
              <p className="text-[13px] text-zinc-600 dark:text-zinc-300">Aucune demande en attente</p>
              <p className="font-mono text-[11px] text-zinc-400">Touche 3 dans la ville : un paiement douteux vient se garer ici</p>
            </div>
          )}
        </section>

        {/* the lot's plan, as in the city */}
        <section className={cn(CARD, "p-5")}>
          <h2 className={cn(LABEL, "mb-3")}>Plan du parking</h2>
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div className="grid grid-rows-6 gap-1.5">
              {Array.from({ length: 6 }, (_, k) => {
                const busy = !!waiting && k === 2;
                return (
                  <div key={k} className={cn("flex h-9 items-center justify-between rounded-md border px-3 font-mono text-[11px]", busy ? "border-[#F2B33D] bg-[#F2B33D]/10 text-[#F2B33D]" : "border-dashed border-[#F2B33D]/35 text-zinc-400")}>
                    <span>P{k + 1}</span>
                    <span>{busy ? waiting.tx_id : "libre"}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex w-16 flex-col items-center justify-between rounded-md bg-zinc-50 py-2 font-mono text-[9.5px] text-zinc-400 dark:bg-zinc-900">
              <span>allée</span>
              <span className="rounded border border-[#F2B33D]/50 px-1 text-[#F2B33D]">entrée</span>
            </div>
          </div>
        </section>
      </div>

      {/* what people decided before */}
      <section className={cn(CARD, "overflow-hidden")}>
        <h2 className={cn(LABEL, "px-5 pt-4")}>Historique des décisions humaines</h2>
        <table className="mt-2 w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-800">
              {["Issue", "Transaction", "Demande", "Montant", "Score", "Décidé par", "Délai", "Quand"].map((h) => (
                <th key={h} className={cn(LABEL, "px-4 py-2", h === "Montant" && "text-right")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {decided.map((t) => (
              <tr key={t.tx_id} onClick={() => openView("transactions", { tx: t.tx_id })} className="h-11 cursor-pointer border-b border-zinc-100 text-[12.5px] last:border-0 hover:bg-zinc-50 dark:border-zinc-800/70 dark:hover:bg-zinc-800/40">
                <td className="px-4">
                  <StatusPill status={t.status} />
                </td>
                <td className="px-4 font-mono text-zinc-900 dark:text-zinc-100">{t.tx_id}</td>
                <td className="px-4 text-zinc-700 dark:text-zinc-300">
                  {t.from.agent_id} → {t.to.label}
                </td>
                <td className="px-4 text-right font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
                  {fmtAmount(t.amount.value)} <span className="text-zinc-500">{t.amount.token}</span>
                </td>
                <td className="px-4">
                  <ScoreBar tx={t} />
                </td>
                <td className="px-4 text-zinc-600 dark:text-zinc-400">{reviewerOf(t)}</td>
                <td className="px-4 font-mono text-[11.5px] text-zinc-500">{mmss(humanDelay(t))}</td>
                <td className="px-4 font-mono text-[11.5px] text-zinc-500">{when(t.decided_at ?? t.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {decided.length === 0 && <p className="py-10 text-center font-mono text-[12px] text-zinc-400">Aucune décision humaine pour l&apos;instant</p>}
      </section>
      <p className="font-mono text-[10.5px] text-zinc-400">Règle : AI Act art. 14 (contrôle humain) · DORA art. 17 · les décideurs et délais sont simulés</p>
    </div>
  );
}
