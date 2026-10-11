"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDownUp, Check, Copy, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { LIVE_CONFIGURED, protectedOf, useAudit } from "@/data/source";
import { explorerUrl } from "@/data/sentinel";
import { signalLabel } from "@/data/signals";
import { setViewFilter, setViewTx } from "@/sim/nav";
import { sim, useSim, type ViewFilter } from "@/sim/store";
import { CHECK_LABEL, CHECK_ORDER, STATE, fmtAmount, shortAddr, type AuditTx } from "@/sim/types";
import { Gauge, Radar, SEC_LINE, StateIcon, iconOf, trustCuts, trustOf, trustZones, zoneHex } from "../ui/charts";
import { SourceBadge } from "./ViewHost";

/* The C-Chain's door: every agent payment Sentinel checked before it settled, as an explorer lists transactions, and
   for each its audit: the score and its five checks against the KPMG thresholds, the authority chain, the contract,
   the on-chain proof, the frameworks. The rows come from data/source.ts (the simulation now, the MCP agent next). */

export const LABEL = "text-[11.5px] font-semibold text-slate-500 dark:text-zinc-400";
export const CARD = "rounded-2xl border border-slate-200/80 bg-white shadow-[0_12px_32px_-24px_rgba(30,41,59,0.35)] dark:border-zinc-800 dark:bg-zinc-900/60";

export const STATUS: Record<AuditTx["status"], { word: string; hex: string; icon: "ok" | "bad" | "warn" | "wait" }> = {
  ALLOW: { word: "Visa", hex: STATE.allow.hex, icon: "ok" },
  BLOCK: { word: "Bloquée", hex: STATE.block.hex, icon: "bad" },
  HUMAN: { word: "Attente humaine", hex: STATE.human.hex, icon: "warn" },
  PENDING: { word: "En analyse", hex: STATE.verify.hex, icon: "wait" },
};
export const when = (iso?: string) => (iso ? new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "…");
export const secs = (ms: number) => `${(ms / 1000).toFixed(1).replace(".", ",")} s`;

export function Kpi({ label, value, sub, tone }: { label: string; value: ReactNode; sub: ReactNode; tone?: string }) {
  return (
    <div className={cn(CARD, "flex min-w-0 flex-col gap-1 px-4 py-3")}>
      <span className={LABEL}>{label}</span>
      <span className="text-[24px] font-semibold tabular-nums leading-tight text-slate-900 dark:text-zinc-50" style={tone ? { color: tone } : undefined}>
        {value}
      </span>
      <span className="truncate text-[11.5px] text-slate-500 dark:text-zinc-400">{sub}</span>
    </div>
  );
}

export function StatusPill({ status }: { status: AuditTx["status"] }) {
  const s = STATUS[status];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11.5px] font-medium" style={{ color: s.hex, background: `${s.hex}1a` }}>
      <StateIcon kind={s.icon} size={13} />
      {s.word}
    </span>
  );
}

/** the trust on its 0 (scam) to 100 (safe) line, the thresholds marked */
export function ScoreBar({ tx }: { tx: AuditTx }) {
  const t = tx.thresholds;
  const c = trustCuts(t);
  return (
    <span className="flex items-center gap-2">
      <span className="relative h-1.5 w-20 rounded-full bg-zinc-200 dark:bg-zinc-800">
        <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${trustOf(tx.score)}%`, background: zoneHex(tx.score, t) }} />
        <span className="absolute -top-0.5 h-2.5 w-px bg-zinc-400/70" style={{ left: `${c.block_at}%` }} />
        <span className="absolute -top-0.5 h-2.5 w-px bg-zinc-400/70" style={{ left: `${c.visa_above}%` }} />
      </span>
      <span className="w-6 text-right font-mono text-[12px] tabular-nums" style={{ color: zoneHex(tx.score, t) }}>
        {trustOf(tx.score)}
      </span>
    </span>
  );
}

/** a hash, a block or an address, opened on SentinelScan when the explorer is configured and the row is the chain's */
export function ExplorerLink({ kind, id, live, children }: { kind: "tx" | "block" | "address"; id: string | number; live: boolean; children: ReactNode }) {
  const url = live ? explorerUrl(kind, id) : null;
  if (!url) return <span className="font-mono">{children}</span>;
  return (
    <a href={url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="font-mono text-[#3D7FE0] underline-offset-2 hover:underline dark:text-[#6FA8FF]">
      {children}
    </a>
  );
}

export function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label="Copier"
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          window.setTimeout(() => setDone(false), 1200);
        });
      }}
      className="rounded p-0.5 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
    >
      {done ? <Check className="h-3.5 w-3.5 text-[#3FD08F]" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

const FILTERS: { k: ViewFilter; label: string; test: (t: AuditTx) => boolean }[] = [
  { k: "all", label: "Toutes", test: () => true },
  { k: "ALLOW", label: "Visas", test: (t) => t.status === "ALLOW" },
  { k: "BLOCK", label: "Bloquées", test: (t) => t.status === "BLOCK" },
  { k: "HUMAN", label: "Validation humaine", test: (t) => t.decision === "HUMAN" },
  { k: "PENDING", label: "En cours", test: (t) => t.status === "PENDING" || t.status === "HUMAN" },
  { k: "proof", label: "Preuve on-chain", test: (t) => !!t.onchain && (t.status === "ALLOW" || t.status === "BLOCK") },
];
type Sort = "date" | "amount" | "score";

export function TransactionsView() {
  const { txs } = useAudit();
  const filter = useSim((s) => s.viewFilter);
  const picked = useSim((s) => s.viewTx);
  const query = useSim((s) => s.search);
  const [use, setUse] = useState<"all" | "shopping" | "agent_to_agent">("all");
  const [sort, setSort] = useState<Sort>("date");
  const list = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => {
    const f = FILTERS.find((x) => x.k === filter) ?? FILTERS[0];
    const q = query.trim().toLowerCase();
    const out = txs.filter(
      (t) =>
        f.test(t) &&
        (use === "all" || t.use_case === use) &&
        (!q || [t.tx_id, t.from.agent_id, t.from.address, t.to.address, t.to.label, t.to.domain ?? ""].some((v) => v.toLowerCase().includes(q))),
    );
    if (sort === "amount") out.sort((a, b) => b.amount.value * (b.amount.token === "AVAX" ? 25 : 1) - a.amount.value * (a.amount.token === "AVAX" ? 25 : 1));
    if (sort === "score") out.sort((a, b) => b.score - a.score);
    return out;
  }, [txs, filter, query, use, sort]);

  const kpi = useMemo(() => {
    const done = txs.filter((t) => t.status === "ALLOW" || t.status === "BLOCK");
    const prot = protectedOf(txs);
    return {
      total: txs.length,
      visas: txs.filter((t) => t.status === "ALLOW").length,
      blocked: txs.filter((t) => t.status === "BLOCK").length,
      waiting: txs.filter((t) => t.status === "HUMAN").length,
      prot,
      avg: done.length ? done.reduce((a, t) => a + t.timings_ms.decide, 0) / done.length : 0,
    };
  }, [txs]);

  const current = picked ? txs.find((t) => t.tx_id === picked) ?? null : null;

  // the keyboard: up and down move the pick, Escape closes the detail before the screen
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT") return;
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const i = rows.findIndex((r) => r.tx_id === picked);
      const next = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
      if (next) {
        setViewTx(next.tx_id);
        list.current?.querySelector(`[data-tx="${next.tx_id}"]`)?.scrollIntoView({ block: "nearest" });
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [rows, picked]);

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-hidden px-6 py-5">
        {/* the head */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#E84142]/10">
              <svg width="20" height="20" viewBox="0 0 26 26" aria-hidden>
                <path d="M13 2 L23 6 V13 C23 18.5 18.8 22.6 13 24 C7.2 22.6 3 18.5 3 13 V6 Z" fill="none" stroke="#E84142" strokeWidth="2.2" strokeLinejoin="round" />
                <path d="M8.5 13.2 L11.8 16.4 L17.6 10" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-700 dark:text-zinc-200" />
              </svg>
            </span>
            <div>
              <h1 className="text-[20px] font-semibold text-zinc-900 dark:text-zinc-50">Transactions · C-Chain</h1>
              <p className="text-[12.5px] text-zinc-500 dark:text-zinc-400">Paiements d&apos;agents IA vérifiés par Sentinel avant règlement, chacun avec la preuve de sa décision</p>
            </div>
          </div>
          <SourceBadge />
        </div>

        {/* the figures */}
        <div className="grid grid-cols-6 gap-3">
          <Kpi label="Transactions" value={kpi.total} sub={LIVE_CONFIGURED ? "décisions sur Sentinel L1" : "vérifiées (simulé)"} />
          <Kpi label="Visas émis" value={kpi.visas} sub={`${kpi.total ? Math.round((kpi.visas / kpi.total) * 100) : 0} % des demandes`} tone={STATE.allow.hex} />
          <Kpi label="Bloquées" value={kpi.blocked} sub="adresses au registre" tone={STATE.block.hex} />
          <Kpi label="En attente" value={kpi.waiting} sub="validation humaine" tone={STATE.human.hex} />
          <Kpi label="Montant protégé" value={kpi.prot.value || !LIVE_CONFIGURED ? fmtAmount(kpi.prot.value) : "n.p."} sub={kpi.prot.value || !LIVE_CONFIGURED ? `${kpi.prot.token} refusés` : "montant non publié par un refus"} />
          <Kpi label="Décision moyenne" value={kpi.avg ? secs(kpi.avg) : "n.p."} sub={kpi.avg ? "du dépôt au verdict" : "non publié on-chain"} />
        </div>

        {/* the tools */}
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="État" className="flex items-center gap-0.5 rounded-xl border border-zinc-200 p-0.5 dark:border-zinc-800">
            {FILTERS.map((f) => {
              const n = txs.filter(f.test).length;
              return (
                <button
                  key={f.k}
                  role="tab"
                  aria-selected={filter === f.k}
                  type="button"
                  onClick={() => setViewFilter(f.k)}
                  className={cn("flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12.5px] transition-colors", filter === f.k ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50" : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100")}
                >
                  {f.label}
                  <span className="font-mono text-[10.5px] tabular-nums text-zinc-400">{n}</span>
                </button>
              );
            })}
          </div>
          <label className="flex h-8 min-w-[18rem] flex-1 items-center gap-2 rounded-xl border border-zinc-200 px-2.5 dark:border-zinc-800">
            <Search className="h-3.5 w-3.5 text-zinc-400" />
            <span className="sr-only">Rechercher</span>
            <input
              value={query}
              onChange={(e) => sim.set({ search: e.target.value })}
              placeholder="tx_id, agent, adresse, domaine…"
              className="h-full flex-1 bg-transparent text-[12.5px] text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
            />
            {query && (
              <button type="button" aria-label="Effacer" onClick={() => sim.set({ search: "" })} className="text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </label>
          <div role="group" aria-label="Cas d'usage" className="flex items-center gap-0.5 rounded-xl border border-zinc-200 p-0.5 dark:border-zinc-800">
            {(
              [
                ["all", "Tous"],
                ["shopping", "Shopping"],
                ["agent_to_agent", "Agent à agent"],
              ] as const
            ).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setUse(k)} className={cn("rounded-lg px-2.5 py-1 text-[12.5px]", use === k ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50" : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100")}>
                {label}
              </button>
            ))}
          </div>
          <label className="flex h-8 items-center gap-1.5 rounded-xl border border-zinc-200 px-2.5 text-[12.5px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            <ArrowDownUp className="h-3.5 w-3.5" />
            <span className="sr-only">Trier par</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="bg-transparent text-zinc-900 outline-none dark:text-zinc-100">
              <option value="date">Plus récentes</option>
              <option value="amount">Montant</option>
              <option value="score">Confiance (la plus basse d&apos;abord)</option>
            </select>
          </label>
        </div>

        {/* the table */}
        <div ref={list} className={cn(CARD, "min-h-0 flex-1 overflow-auto")}>
          <table className="w-full border-collapse text-left">
            <thead className="sticky top-0 z-10 bg-zinc-50 dark:bg-zinc-900">
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                {["État", "Transaction", "Agent", "Bénéficiaire", "Montant", "Score", "Décidé par", "Bloc", "Heure"].map((h) => (
                  <th key={h} className={cn(LABEL, "px-3 py-2.5 font-bold", h === "Montant" && "text-right")}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr
                  key={t.tx_id}
                  data-tx={t.tx_id}
                  onClick={() => setViewTx(picked === t.tx_id ? null : t.tx_id)}
                  aria-selected={picked === t.tx_id}
                  className={cn("h-11 cursor-pointer border-b border-zinc-100 text-[12.5px] transition-colors last:border-0 dark:border-zinc-800/70", picked === t.tx_id ? "bg-zinc-100 dark:bg-zinc-800/80" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/40")}
                >
                  <td className="px-3">
                    <StatusPill status={t.status} />
                  </td>
                  <td className="px-3 font-mono text-zinc-900 dark:text-zinc-100">
                    {t.tx_id}
                    {LIVE_CONFIGURED && t.source === "scenario" && <span className="ml-1.5 rounded bg-zinc-100 px-1 text-[9.5px] text-zinc-500 dark:bg-zinc-800">démo</span>}
                  </td>
                  <td className="px-3 text-zinc-700 dark:text-zinc-300">{t.from.agent_id}</td>
                  <td className="max-w-[16rem] px-3">
                    <span className="block truncate text-zinc-900 dark:text-zinc-100">{t.to.label}</span>
                    <span className="block font-mono text-[10.5px] text-zinc-500">{shortAddr(t.to.address)}</span>
                  </td>
                  <td className="px-3 text-right font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
                    {t.partial && !t.amount.value ? (
                      <span className="text-zinc-400">…</span>
                    ) : (
                      <>
                        {fmtAmount(t.amount.value)} <span className="text-zinc-500">{t.amount.token}</span>
                      </>
                    )}
                  </td>
                  <td className="px-3">
                    {t.partial ? (
                      <span className="font-mono text-[11px] text-zinc-500" title="Les signaux de l'agent MCP inscrits on-chain (leur poids arrive avec le verdict complet)">
                        {t.signals?.length ? `${t.signals.length} signal${t.signals.length > 1 ? "s" : ""} MCP` : "verdict seul"}
                      </span>
                    ) : (
                      <ScoreBar tx={t} />
                    )}
                  </td>
                  <td className="px-3 text-zinc-600 dark:text-zinc-400">{t.status === "PENDING" ? "…" : t.status === "HUMAN" ? "en attente" : t.via}</td>
                  <td className="px-3 font-mono text-[11.5px] text-zinc-500">{t.onchain && t.status !== "PENDING" && t.status !== "HUMAN" ? `#${t.onchain.block.toLocaleString("fr-FR")}` : "…"}</td>
                  <td className="px-3 font-mono text-[11.5px] text-zinc-500">{when(t.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="py-16 text-center font-mono text-[12px] text-zinc-400">{txs.length ? "Aucune transaction ne correspond" : "Aucune transaction pour l'instant"}</p>}
        </div>
        <p className="font-mono text-[10.5px] text-zinc-400">
          {rows.length} sur {txs.length} · ↑ ↓ ou clic pour ouvrir l&apos;audit · {LIVE_CONFIGURED ? "Données on-chain (Sentinel L1), lignes « démo » simulées" : "Données synthétiques"}
        </p>
      </div>

      {current && <TxDetail tx={current} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* one transaction's audit                                             */
/* ------------------------------------------------------------------ */

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="border-t border-zinc-200 px-5 py-4 dark:border-zinc-800">
      <div className="mb-2.5 flex items-center justify-between">
        <h3 className={LABEL}>{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-[10px] text-zinc-400">{label}</div>
      <div className="truncate text-[12.5px] text-zinc-900 dark:text-zinc-100">{children}</div>
    </div>
  );
}

export function TxDetail({ tx, onClose = () => setViewTx(null) }: { tx: AuditTx; onClose?: () => void }) {
  const [tab, setTab] = useState<"audit" | "json">("audit");
  const t = tx.thresholds;
  const code = tx.contract_code?.length ? tx.contract_code : [tx.contract.line];
  const final = tx.status === "ALLOW" || tx.status === "BLOCK";
  return (
    <aside aria-label={`Audit de ${tx.tx_id}`} className="flex w-[500px] shrink-0 flex-col border-l border-zinc-200 bg-white animate-in slide-in-from-right-4 fade-in-0 duration-200 motion-reduce:animate-none dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-4">
        <div className="min-w-0">
          <div className={LABEL}>Sentinel · Audit de la décision</div>
          <div className="mt-1 flex items-center gap-2">
            <span className="font-mono text-[18px] font-semibold text-zinc-900 dark:text-zinc-50">{tx.tx_id}</span>
            <StatusPill status={tx.status} />
          </div>
          <div className="mt-0.5 font-mono text-[10.5px] text-zinc-500">
            {final ? (tx.partial ? `décidé on-chain au bloc #${tx.onchain?.block ?? "…"}` : `décidé en ${secs(tx.timings_ms.decide)} par ${tx.via}`) : tx.status === "HUMAN" ? "en attente d'un humain" : "analyse en cours"} · {when(tx.created_at)}
          </div>
        </div>
        <button type="button" aria-label="Fermer l'audit" onClick={onClose} className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-100">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex gap-1 px-5 pb-2">
        {(
          [
            ["audit", "Audit"],
            ["json", "JSON brut"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={cn("rounded-lg px-2.5 py-1 text-[12px]", tab === k ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50" : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400")}>
            {label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "json" ? (
          <div className="relative px-5 pb-5">
            <div className="absolute right-6 top-2">
              <CopyButton text={JSON.stringify(tx.raw ?? tx, null, 2)} />
            </div>
            <pre className="overflow-x-auto rounded-xl bg-zinc-50 p-3 font-mono text-[10.5px] leading-relaxed text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">{JSON.stringify(tx.raw ?? tx, null, 2)}</pre>
          </div>
        ) : (
          <>
            <Section title="Résumé">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                <Field label="Agent">
                  {tx.from.agent_id} <span className="font-mono text-[10.5px] text-zinc-500">{shortAddr(tx.from.address)}</span>
                </Field>
                <Field label="Bénéficiaire">{tx.to.label}</Field>
                <Field label="Adresse">
                  <span className="inline-flex items-center gap-1 font-mono text-[11.5px]">
                    {shortAddr(tx.to.address)} <CopyButton text={tx.to.address} />
                  </span>
                </Field>
                <Field label="Domaine">
                  {tx.to.domain ?? "…"}
                  {tx.domain_age_days !== undefined && <span className="text-zinc-500"> · {tx.domain_age_days} j</span>}
                </Field>
                <Field label="Montant">
                  <span className="font-mono">{tx.partial && !tx.amount.value ? "non publié" : `${fmtAmount(tx.amount.value)} ${tx.amount.token}`}</span>
                </Field>
                <Field label="Cas d'usage">{tx.partial ? "non publié" : tx.use_case === "shopping" ? "Agentic shopping" : "Agent à agent (x402)"}</Field>
              </div>
            </Section>

            <Section title="Scoring d'audit" aside={<span className="font-mono text-[10px] text-zinc-400">seuils KPMG (confiance) : {trustZones(t)}</span>}>
              {tx.partial ? (
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-[12px] text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
                  <div className="mb-1 flex items-center gap-2">
                    <StatusPill status={tx.status} />
                    <span className="font-mono text-[11px] text-zinc-500">verdict on-chain : {(tx.raw as { verdict?: string })?.verdict ?? tx.decision}</span>
                  </div>
                  <ul className="mt-2.5 flex flex-col gap-2">
                    {CHECK_ORDER.map((k) => {
                      const fired = (tx.signals ?? []).filter((x) => x.check === k);
                      return (
                        <li key={k} className="flex items-start gap-2">
                          <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", fired.length ? (tx.status === "ALLOW" ? "bg-amber-400" : "bg-rose-500") : "bg-emerald-500")} />
                          <div className="min-w-0">
                            <div className="text-[12.5px] font-medium text-zinc-900 dark:text-zinc-100">
                              {CHECK_LABEL[k]} <span className="font-normal text-zinc-500">{fired.length ? `· ${fired.length} signal${fired.length > 1 ? "s" : ""}` : "· rien à signaler"}</span>
                            </div>
                            {fired.map((x) => (
                              <div key={x.id} className="mt-0.5 text-[11.5px] leading-snug">
                                <span className="font-medium text-zinc-800 dark:text-zinc-200">{signalLabel(x.id)}</span>
                                {x.text && <span className="text-zinc-500"> : {x.text}</span>}
                                <span className="ml-1 font-mono text-[10px] text-zinc-400">{x.id}</span>
                              </div>
                            ))}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  {!tx.signals?.length && <p className="mt-1.5">{tx.reasons[0] ?? "Sans raison publiée."}</p>}
                  <p className="mt-2.5 text-[11px] text-zinc-500">
                    Les signaux de l&apos;agent MCP, tels qu&apos;il les a inscrits on-chain dans la raison de sa décision. Leurs poids et le score de confiance arrivent avec son verdict complet (flux /avaguard/events), pour les décisions reçues en direct.
                  </p>
                </div>
              ) : (
              <>
              <div className="flex items-center justify-between">
                <Gauge tx={tx} live={false} />
                <Radar tx={tx} lit={() => true} />
              </div>
              <ul className="mt-3 flex flex-col gap-2.5">
                {CHECK_ORDER.map((k) => {
                  const c = tx.checks[k];
                  return (
                    <li key={k}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-zinc-900 dark:text-zinc-100">
                          <StateIcon kind={iconOf(c.score, t)} size={13} />
                          {CHECK_LABEL[k]}
                        </span>
                        <span className="font-mono text-[11px] tabular-nums" style={{ color: zoneHex(c.score, t) }}>
                          {trustOf(c.score)}/100
                        </span>
                      </div>
                      <div className="mt-1 h-1 rounded-full bg-zinc-100 dark:bg-zinc-800">
                        <div className="h-full rounded-full" style={{ width: `${trustOf(c.score)}%`, background: zoneHex(c.score, t) }} />
                      </div>
                      <p className="mt-1 text-[11.5px] text-zinc-500 dark:text-zinc-400">{c.reason}</p>
                    </li>
                  );
                })}
              </ul>
              {tx.reasons.length > 0 && (
                <ul className="mt-3 list-disc space-y-1 pl-4 text-[12px] text-zinc-700 dark:text-zinc-300">
                  {tx.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              )}
              </>
              )}
            </Section>

            {tx.authority_chain.length > 0 && <Section title="Chaîne d'autorité">
              <div className="flex flex-wrap items-center gap-1.5">
                {tx.authority_chain.map((n, i) => (
                  <span key={i} className="flex items-center gap-1.5">
                    {i > 0 && <span className={cn("h-px w-4", n.ok ? "bg-[#3FD08F]" : "bg-[#FF5D57]")} />}
                    <span className="rounded-md border px-2 py-0.5 font-mono text-[11px]" style={{ borderColor: `${n.ok ? STATE.allow.hex : STATE.block.hex}66`, color: n.ok ? undefined : STATE.block.hex }}>
                      {n.step}
                    </span>
                  </span>
                ))}
              </div>
              {tx.break_note && <p className="mt-2 font-mono text-[11px] text-[#FF5D57]">{tx.break_note}</p>}
            </Section>}

            <Section title={`Contrat · ${tx.contract.method}`}>
              <pre className="overflow-x-auto rounded-xl bg-zinc-50 p-3 font-mono text-[11px] leading-relaxed text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                {code.map((l, i) => {
                  const risky = tx.contract.risky && l.trim() === tx.contract.line.trim();
                  return (
                    <div key={i} className={cn("flex items-center justify-between gap-2 rounded px-1", risky && "bg-[#FF5D57]/10 text-zinc-900 outline outline-1 outline-[#FF5D57] dark:text-white")}>
                      <span>{l}</span>
                      {risky && <span className="rounded bg-[#FF5D57] px-1 text-[9px] font-bold text-white">RISQUE</span>}
                    </div>
                  );
                })}
              </pre>
              {tx.injection_excerpt && (
                <div className="mt-2 rounded-xl border border-[#FF5D57]/30 bg-[#FF5D57]/5 p-2.5">
                  <div className="mb-1 font-mono text-[9.5px] font-bold uppercase tracking-[0.14em] text-[#FF5D57]">Extrait injecté détecté</div>
                  <code className="block break-all font-mono text-[11px] text-zinc-700 dark:text-zinc-300">{tx.injection_excerpt}</code>
                </div>
              )}
            </Section>


            <Section title="Preuve on-chain">
              {tx.onchain && final ? (
                <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                  <Field label="Chaîne">{tx.onchain.chain}</Field>
                  <Field label="Bloc">
                    <ExplorerLink kind="block" id={tx.onchain.block} live={tx.source === "live"}>
                      #{tx.onchain.block.toLocaleString("fr-FR")}
                    </ExplorerLink>
                  </Field>
                  <Field label="Hash">
                    <span className="inline-flex items-center gap-1 font-mono text-[11.5px]">
                      <ExplorerLink kind="tx" id={tx.onchain.tx_hash} live={tx.source === "live"}>
                        {shortAddr(tx.onchain.tx_hash)}
                      </ExplorerLink>
                      <CopyButton text={tx.onchain.tx_hash} />
                    </span>
                  </Field>
                  <Field label="Visa">{tx.onchain.visa_id ?? (tx.status === "BLOCK" ? "refusé, adresse au registre" : "…")}</Field>
                </div>
              ) : (
                <p className="text-[12px] text-zinc-500">La preuve est écrite sur Sentinel L1 dès la décision.</p>
              )}
              <p className="mt-2.5 text-[11.5px] text-zinc-500 dark:text-zinc-400">
                <span className="font-mono text-[10px] font-bold text-[#6FA8FF]">SEC</span> {SEC_LINE}
              </p>
            </Section>

            <Section title="Conformité">
              <div className="flex flex-wrap gap-1.5">
                {tx.frameworks.map((f) => (
                  <span key={f} className="rounded-md bg-zinc-100 px-2 py-0.5 font-mono text-[10.5px] text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                    {f}
                  </span>
                ))}
              </div>
              {tx.dora_incident && <p className="mt-2 text-[12px] text-zinc-600 dark:text-zinc-400">Incident DORA ouvert : {tx.dora_incident}, notifiable sous 4 h si majeur.</p>}
            </Section>

            <div className="border-t border-zinc-200 px-5 py-3 font-mono text-[10.5px] text-zinc-400 dark:border-zinc-800">
              {tx.source === "live" ? (tx.partial ? "Lu sur Sentinel L1 (AuthorityRegistry.DecisionRecorded)" : "Verdict complet reçu du cerveau, preuve sur Sentinel L1") : "Ligne simulée (démo) · les décisions réelles viennent de Sentinel L1"}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
