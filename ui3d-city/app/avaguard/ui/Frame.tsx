"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Activity, ArrowUpRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { GLASS } from "@/components/explorer-v2/network/city-frame";
import { KEY_W } from "@/components/explorer-v2/network/city-key";
import { LIVE_CONFIGURED, protectedOf, useAudit } from "@/data/source";
import { explorerUrl, sentinelConfig } from "@/data/sentinel";
import { isInjection, signalLabel } from "@/data/signals";
import { openView } from "@/sim/nav";
import { STATE, fmtAmount, type AuditTx } from "@/sim/types";

/* The cards around the city, in builders-hub's grammar (city-app.tsx, city-frame.tsx, city-key.tsx: the same glass, the
   same mono labels, the same places), with Sentinel's contents in plain words: someone who has never used a blockchain
   reads what the agent did from the figures, the key and the list. Live, every figure is read on SentinelL1 (the MCP
   agent's decisions, its signals, the ThreatFlagged registry); without the chain configured, the demo's. */

const MONO_LABEL = "font-mono text-[9.5px] font-bold uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500";
const toneOf = (t: AuditTx) => (t.status === "ALLOW" ? STATE.allow.hex : t.status === "BLOCK" ? STATE.block.hex : STATE.human.hex);

/** what a decision is about, in words: the MCP agent's first signal, or the reason it gave */
export function whatOf(t: AuditTx): string {
  const s = t.signals?.[0];
  if (s) return signalLabel(s.id);
  if (t.status === "ALLOW") return t.partial ? "Aucun signal suspect" : t.to.label;
  return t.reasons[0] ?? t.to.label;
}

export function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
}

/* ------------------------------------------------------------------ */
/* the figures                                                         */
/* ------------------------------------------------------------------ */

export function useKpis() {
  const { txs, banned, source } = useAudit();
  return useMemo(() => {
    const blocked = txs.filter((t) => t.status === "BLOCK");
    const proved = txs.filter((t) => !!t.onchain?.tx_hash).length;
    return {
      connected: source.connected,
      total: txs.length,
      allow: txs.filter((t) => t.status === "ALLOW").length,
      human: txs.filter((t) => t.status === "HUMAN" || t.status === "PENDING").length,
      blocked: blocked.length,
      injections: txs.filter((t) => t.signals?.some(isInjection) || !!t.injection_excerpt).length,
      repeats: blocked.filter((t) => t.registry_hit || t.via === "registre").length,
      banned: banned.length,
      saved: protectedOf(txs),
      proved,
      latest: Math.max(0, ...txs.map((t) => t.onchain?.block ?? 0)),
    };
  }, [txs, banned, source.connected]);
}

/** one cell of the strip, with city-app.tsx's hudFigure classes; its title says it in a sentence */
function Figure({ label, value, sub, title, tone, href, className }: { label: string; value: ReactNode; sub: ReactNode; title: string; tone?: string; href?: string; className?: string }) {
  const body = (
    <>
      <span className={cn(MONO_LABEL, "whitespace-nowrap")}>{label}</span>
      <span className="whitespace-nowrap font-mono text-[17px] font-semibold tabular-nums leading-tight text-zinc-900 dark:text-zinc-50" style={tone ? { color: tone } : undefined}>
        {value}
      </span>
      <span className="whitespace-nowrap font-mono text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400">{sub}</span>
    </>
  );
  const box = cn("flex min-w-0 flex-col items-start gap-0.5 px-4 py-2.5", className);
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" title={title} className={cn(box, "transition-colors first:rounded-l-2xl last:rounded-r-2xl hover:bg-zinc-50/80 dark:hover:bg-zinc-900/60")}>
      {body}
    </a>
  ) : (
    <button type="button" title={title} onClick={() => openView("audit")} className={cn(box, "text-left transition-colors first:rounded-l-2xl last:rounded-r-2xl hover:bg-zinc-50/80 dark:hover:bg-zinc-900/60")}>
      {body}
    </button>
  );
}

/** the strip's six cells: what the agent checked, stopped, saved, banned, asked a human, and proved */
export function Figures() {
  const k = useKpis();
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
  const block = explorerUrl("block", k.latest);
  return (
    <>
      <Figure label="Paiements" value={k.total} sub="vérifiés" title="Chaque paiement qu'un agent IA a voulu faire, contrôlé par Sentinel avant de partir" />
      <Figure label="Fraudes" value={k.blocked} sub={`bloquées · ${pct(k.blocked, k.total)} %`} tone={STATE.block.hex} title="Paiements refusés : l'argent n'est jamais parti chez l'escroc" />
      <Figure
        label="Argent sauvé"
        value={fmtAmount(k.saved.value)}
        sub={k.saved.token}
        className="@max-[640px]/strip:hidden"
        tone={STATE.allow.hex}
        title="Ce que les paiements refusés auraient envoyé aux escrocs (montants publiés par l'agent)"
      />
      <Figure label="Pièges" value={k.injections} sub="ordres cachés" className="@max-[780px]/strip:hidden" title="Des instructions cachées dans un document ou une page, écrites pour manipuler l'agent IA (prompt injection)" />
      <Figure label="Escrocs" value={k.banned} sub="bannis" title="Adresses inscrites au registre des hackers : leurs tentatives suivantes sont refusées d'office" />
      <Figure label="Avis humain" value={k.human} sub="cas douteux" className="@max-[700px]/strip:hidden" tone={STATE.human.hex} title="Les cas trop incertains pour décider seul : une personne valide ou refuse" />
      <Figure
        label="Preuves"
        value={`${pct(k.proved, k.total)} %`}
        sub={LIVE_CONFIGURED ? `bloc #${k.latest}` : "des décisions"}
        title="Chaque décision est gravée sur la blockchain : personne ne peut la modifier après coup (audit DORA, MiCA)"
        href={LIVE_CONFIGURED && block ? block : undefined}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* the key                                                             */
/* ------------------------------------------------------------------ */

const keyRow = (label: string, body: ReactNode) => (
  <>
    <span className={MONO_LABEL}>{label}</span>
    <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-zinc-600 dark:text-zinc-300">{body}</div>
  </>
);
const dot = (hex: string, label: string) => (
  <span key={label} className="flex items-center gap-1">
    <span className="h-2 w-2 rounded-full" style={{ background: hex }} />
    {label}
  </span>
);

/** the key, in the bottom left corner as city-key.tsx stands: what the city shows, in words; `network` the other L1s that
    stand round the protocol (the ring), 0 when the city is the protocol alone */
export function SentinelKey({ network = 0 }: { network?: number }) {
  return (
    <div className={cn("rounded-2xl px-4 py-3", GLASS)} style={{ width: KEY_W }}>
      <p className="text-[12px] leading-snug text-zinc-700 dark:text-zinc-200">
        Un agent IA veut payer : chaque <b className="font-semibold">voiture</b> est un paiement. Sentinel le contrôle <b className="font-semibold">avant</b> que l&apos;argent parte.
      </p>
      <div className="mt-2.5 grid grid-cols-[3.75rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
        {keyRow(
          "Voitures",
          <>
            {dot(STATE.verify.hex, "contrôle")}
            {dot(STATE.allow.hex, "autorisé")}
            {dot(STATE.block.hex, "fraude")}
            {dot(STATE.human.hex, "humain")}
          </>,
        )}
        {keyRow("Péage", "le contrôle Sentinel")}
        {keyRow("Casse", "la fraude refusée, l'escroc banni")}
        {keyRow("Parking", "attend l'avis d'un humain")}
        {keyRow("Tours", "Sentinel, et la C-Chain où l'argent arrive")}
        {network > 0 && keyRow("Ville", `les ${network.toLocaleString("fr-FR")} autres L1 d'Avalanche Fuji, réelles`)}
      </div>
      <p className="mt-2.5 border-t border-zinc-100 pt-2 font-mono text-[9px] text-zinc-400 dark:border-zinc-900 dark:text-zinc-500">Ville 3D d&apos;après Avalanche Builder Hub (open source, BSD-3) · Voiture d&apos;après « Ferrari 458 Italia » par vicent091036 (Sketchfab), simplifiée</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* the list                                                            */
/* ------------------------------------------------------------------ */

const GROUPS: { key: string; label: string; about: string; of: (t: AuditTx) => boolean }[] = [
  { key: "block", label: "Fraudes bloquées", about: "L'argent n'est jamais parti. L'adresse rejoint le registre des hackers.", of: (t) => t.status === "BLOCK" },
  { key: "human", label: "Avis humain", about: "Trop incertain pour décider seul : une personne tranche.", of: (t) => t.status === "HUMAN" || t.status === "PENDING" },
  { key: "allow", label: "Paiements autorisés", about: "Rien de suspect : Sentinel délivre un visa, le paiement passe.", of: (t) => t.status === "ALLOW" },
];

/** the sidebar's list (city-app.tsx's directory): the decisions by outcome, each opening its audit */
export function Directory({ query }: { query: string }) {
  const { txs } = useAudit();
  const q = query.trim().toLowerCase();
  const rows = q ? txs.filter((t) => [t.tx_id, t.from.agent_id, t.from.address, t.to.label, t.to.address, t.to.domain ?? "", whatOf(t)].some((s) => s.toLowerCase().includes(q))) : txs;
  return (
    <div className="pb-2">
      {GROUPS.map((g) => {
        const mine = rows.filter(g.of);
        if (!mine.length) return null;
        return (
          <section key={g.key}>
            <div className="px-4 pb-1.5 pt-4">
              <span className="flex items-baseline gap-2">
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-900 dark:text-zinc-100">{g.label}</span>
                <span className="font-mono text-[10px] tabular-nums text-zinc-400 dark:text-zinc-500">{mine.length}</span>
              </span>
              <span className="mt-0.5 block text-[11.5px] leading-snug text-zinc-500 dark:text-zinc-400">{g.about}</span>
            </div>
            <ul>
              {mine.slice(0, 60).map((t) => (
                <li key={t.tx_id}>
                  <button
                    type="button"
                    onClick={() => openView("transactions", { tx: t.tx_id })}
                    className="flex w-full items-center gap-2.5 px-4 py-2 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900"
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: toneOf(t) }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-zinc-900 dark:text-zinc-100">{whatOf(t)}</span>
                      <span className="block truncate font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
                        {t.amount.value ? `${fmtAmount(t.amount.value)} ${t.amount.token} · ` : ""}
                        {ago(t.decided_at ?? t.created_at)}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-zinc-400 dark:text-zinc-500">{t.tx_id}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {rows.length === 0 && <p className="px-4 py-8 text-center text-[13px] text-zinc-500">Aucun paiement ne correspond.</p>}
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-zinc-100 px-4 pt-3 dark:border-zinc-900">
        <button type="button" onClick={() => openView("transactions")} className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
          Tout le détail
        </button>
        {sentinelConfig.explorer && (
          <a href={sentinelConfig.explorer} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-[10.5px] uppercase tracking-[0.1em] text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
            Explorer de la blockchain
            <ArrowUpRight className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* the latest decisions                                                */
/* ------------------------------------------------------------------ */

/** the round button in the bottom right corner (builders-hub's news): the latest decisions, a new one marked */
export function LatestFeed({ away }: { away: boolean }) {
  const { txs } = useAudit();
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<string | null>(null);
  const head = txs[0]?.tx_id ?? null;
  const first = useRef(true);
  useEffect(() => {
    // the first read is the past, not news
    if (first.current && head) {
      first.current = false;
      setSeen(head);
    }
  }, [head]);
  useEffect(() => {
    if (open) setSeen(head);
  }, [open, head]);
  if (away) return null;
  const fresh = head !== null && seen !== null && head !== seen;
  return (
    <div className="absolute bottom-(--frame) right-(--frame) z-30 flex flex-col items-end gap-2">
      {open && (
        <div className={cn("w-[320px] overflow-hidden rounded-2xl", GLASS)}>
          <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2.5 dark:border-zinc-900">
            <span className={MONO_LABEL}>Dernières décisions</span>
            <button type="button" aria-label="Fermer" onClick={() => setOpen(false)} className="rounded-full p-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-50">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <ul className="max-h-80 overflow-y-auto">
            {txs.slice(0, 8).map((t) => (
              <li key={t.tx_id}>
                <button type="button" onClick={() => openView("transactions", { tx: t.tx_id })} className="flex w-full items-start gap-2.5 px-4 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: toneOf(t) }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] text-zinc-900 dark:text-zinc-100">{whatOf(t)}</span>
                    <span className="block font-mono text-[10px] text-zinc-400">
                      {t.status === "BLOCK" ? "bloqué" : t.status === "ALLOW" ? "autorisé" : "avis humain"} · {ago(t.decided_at ?? t.created_at)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
            {txs.length === 0 && <li className="px-4 py-6 text-center text-[12.5px] text-zinc-500">Aucune décision pour l&apos;instant.</li>}
          </ul>
        </div>
      )}
      <button
        type="button"
        aria-label="Dernières décisions"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn("relative flex h-12 w-12 items-center justify-center rounded-full text-zinc-600 transition-colors hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-50", GLASS)}
      >
        <Activity className="h-5 w-5" />
        {fresh && <span className="absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-zinc-950" style={{ background: STATE.allow.hex }} />}
      </button>
    </div>
  );
}
