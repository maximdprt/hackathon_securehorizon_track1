"use client";

import { useMemo } from "react";
import { ClipboardCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { LIVE_CONFIGURED, protectedOf, useAudit } from "@/data/source";
import { openView } from "@/sim/nav";
import { CHECK_LABEL, CHECK_ORDER, STATE, fmtAmount, type AuditTx, type CheckKey } from "@/sim/types";
import { CARD, Kpi, LABEL, secs } from "./TransactionsView";
import { SourceBadge } from "./ViewHost";

/* The Sentinel tower's door: the audit, for the people who answer for the guard (risk, compliance, the KPMG reviewer):
   how well it detects, how fast it decides, what it protected, which check catches what, the thresholds it runs on and
   how each decision maps to DORA, MiCA, the AI Act and the NIST CSF. All computed from data/source.ts. */

const day = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });

/** the check that weighed most in a refusal */
/** the check that weighed most: by score, or for a decision read on-chain alone, its first MCP signal's check */
const lead = (t: AuditTx): CheckKey =>
  t.partial && t.signals?.some((s) => s.check) ? t.signals.find((s) => s.check)!.check! : CHECK_ORDER.reduce((a, k) => (t.checks[k].score > t.checks[a].score ? k : a), CHECK_ORDER[0]);

export function AuditView() {
  const { txs, banned } = useAudit();
  const m = useMemo(() => {
    const final = txs.filter((t) => t.status === "ALLOW" || t.status === "BLOCK");
    const bad = new Set(banned.map((b) => b.address.toLowerCase()));
    const attacks = final.filter((t) => bad.has(t.to.address.toLowerCase()));
    const stopped = attacks.filter((t) => t.status === "BLOCK");
    const escalated = final.filter((t) => t.decision === "HUMAN");
    const escalatedOk = escalated.filter((t) => t.status === "ALLOW");
    // refused at once because the registry already held the address: the city's own, or the MCP agent's on-chain signal
    const isImmune = (t: AuditTx) => t.via === "registre" || !!t.registry_hit;
    const firstSeen = stopped.filter((t) => !isImmune(t));
    const immune = stopped.filter(isImmune);
    // every refusal on SentinelL1 is an incident record (DORA), with its ThreatFlagged proof
    const incidents = final.filter((t) => t.dora_incident || (t.source === "live" && t.status === "BLOCK"));
    const prot = protectedOf(final);
    const avg = (xs: AuditTx[]) => (xs.length ? xs.reduce((a, t) => a + t.timings_ms.decide, 0) / xs.length : 0);
    const byCheck = Object.fromEntries(CHECK_ORDER.map((k) => [k, firstSeen.filter((t) => lead(t) === k).length])) as Record<CheckKey, number>;
    // decisions a day, oldest first
    const days = new Map<string, { allow: number; block: number; human: number }>();
    for (const t of [...final].reverse()) {
      const d = day(t.created_at);
      const e = days.get(d) ?? { allow: 0, block: 0, human: 0 };
      if (t.decision === "HUMAN") e.human++;
      else if (t.status === "ALLOW") e.allow++;
      else e.block++;
      days.set(d, e);
    }
    return { final, attacks, stopped, escalated, escalatedOk, immune, incidents, prot, avgAll: avg(final), avgFirst: avg(firstSeen), avgImmune: avg(immune), byCheck, days: [...days.entries()] };
  }, [txs, banned]);

  // the thresholds the decisions were taken on: the MCP agent's (30 / 70 risk) on the chain, the demo's otherwise
  // shown as trust (100 − risk): refused at or under `lo`, a visa above `hi`
  const lo = 100 - (txs[0]?.thresholds.block_from ?? 70);
  const hi = 100 - (txs[0]?.thresholds.allow_below ?? 40);
  const detection = m.attacks.length ? Math.round((m.stopped.length / m.attacks.length) * 100) : 100;
  const maxDay = Math.max(1, ...m.days.map(([, v]) => v.allow + v.block + v.human));
  const maxCheck = Math.max(1, ...Object.values(m.byCheck));

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto px-6 py-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#3FD08F]/10 text-[#3FD08F]">
            <ClipboardCheck className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-[20px] font-semibold text-zinc-900 dark:text-zinc-50">Audit · Sentinel L1</h1>
            <p className="text-[12.5px] text-zinc-500 dark:text-zinc-400">Chaque décision a sa preuve : ce que le garde a détecté, en combien de temps, sur quels seuils, et sous quel cadre réglementaire</p>
          </div>
        </div>
        <SourceBadge />
      </div>

      <div className="grid grid-cols-6 gap-3">
        <Kpi label="Taux de détection" value={`${detection} %`} sub={`${m.stopped.length} attaques stoppées sur ${m.attacks.length}`} tone={STATE.allow.hex} />
        <Kpi label="Escalades humaines" value={m.escalated.length} sub={`${m.escalatedOk.length} approuvées ensuite (faux positifs probables)`} tone={STATE.human.hex} />
        <Kpi label="Délai de décision" value={m.avgAll ? secs(m.avgAll) : "n.p."} sub={m.avgAll ? `1re fois ${secs(m.avgFirst)} · immunité ${secs(m.avgImmune)}` : "non publié on-chain"} />
        <Kpi label="Incidents DORA" value={m.incidents.length} sub="ouverts à chaque refus" tone={STATE.block.hex} />
        <Kpi label="Montant protégé" value={fmtAmount(m.prot.value)} sub={`${m.prot.token} refusés`} />
        <Kpi label="Preuves on-chain" value={m.final.filter((t) => t.source === "live").length || m.final.length} sub={LIVE_CONFIGURED ? "décisions lues sur Sentinel L1, chacune payée en SEC" : "décisions ancrées (simulé)"} />
      </div>

      <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-4">
        <section className={cn(CARD, "p-5")}>
          <h2 className={cn(LABEL, "mb-4")}>Décisions par jour</h2>
          <div className="flex h-44 items-end gap-3">
            {m.days.map(([d, v]) => {
              const total = v.allow + v.block + v.human;
              return (
                <div key={d} className="flex flex-1 flex-col items-center gap-1.5">
                  <div className="flex w-full max-w-14 flex-col-reverse overflow-hidden rounded-md" style={{ height: `${(total / maxDay) * 140}px` }} title={`${d} : ${v.allow} visas, ${v.block} refus, ${v.human} humains`}>
                    <div style={{ height: `${(v.allow / total) * 100}%`, background: STATE.allow.hex }} />
                    <div style={{ height: `${(v.human / total) * 100}%`, background: STATE.human.hex }} />
                    <div style={{ height: `${(v.block / total) * 100}%`, background: STATE.block.hex }} />
                  </div>
                  <span className="font-mono text-[10.5px] text-zinc-500">{d}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex gap-4 font-mono text-[10.5px] text-zinc-500">
            {(
              [
                ["Visas", STATE.allow.hex],
                ["Humain", STATE.human.hex],
                ["Refus", STATE.block.hex],
              ] as const
            ).map(([l, c]) => (
              <span key={l} className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm" style={{ background: c }} />
                {l}
              </span>
            ))}
          </div>
        </section>

        <section className={cn(CARD, "p-5")}>
          <h2 className={cn(LABEL, "mb-4")}>Contrôle décisif des refus</h2>
          <ul className="flex flex-col gap-3">
            {CHECK_ORDER.map((k) => (
              <li key={k}>
                <div className="flex items-center justify-between text-[12.5px]">
                  <span className="text-zinc-800 dark:text-zinc-200">{CHECK_LABEL[k]}</span>
                  <span className="font-mono text-zinc-500">{m.byCheck[k]}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800">
                  <div className="h-full rounded-full bg-[#FF5D57]" style={{ width: `${(m.byCheck[k] / maxCheck) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11.5px] text-zinc-500">Le contrôle à la confiance la plus basse dans chaque refus de première main (hors immunité).</p>
        </section>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <section className={cn(CARD, "p-5")}>
          <h2 className={cn(LABEL, "mb-3")}>Seuils (recommandation KPMG : décider par seuils)</h2>
          <div className="relative mt-6 h-3 rounded-full" style={{ background: `linear-gradient(to right, ${STATE.block.hex} 0 ${lo}%, ${STATE.human.hex} ${lo}% ${hi}%, ${STATE.allow.hex} ${hi}% 100%)` }}>
            {[lo, hi].map((v) => (
              <span key={v} className="absolute -top-6 -translate-x-1/2 font-mono text-[11px] text-zinc-500" style={{ left: `${v}%` }}>
                {v}
              </span>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-3 text-[12px]">
            <span className="text-[#E5483F] dark:text-[#FF5D57]">0 à {lo} : refus, registre</span>
            <span className="text-center text-[#D99A1E] dark:text-[#F2B33D]">
              {lo + 1} à {hi} : un humain tranche
            </span>
            <span className="text-right text-[#2FB57B] dark:text-[#3FD08F]">{hi + 1} à 100 : visa signé</span>
          </div>
          <p className="mt-3 text-[11.5px] text-zinc-500">Le score de confiance (100 = sûr, 0 = arnaque) est la synthèse des 5 contrôles (autorité, bénéficiaire, mandat, intention IA, contrat). Une adresse au registre est refusée sans calcul.{LIVE_CONFIGURED ? " Seuils de l'agent MCP, resserrés quand le montant approche du plafond." : ""}</p>
        </section>

        <section className={cn(CARD, "p-5")}>
          <h2 className={cn(LABEL, "mb-3")}>Conformité</h2>
          <ul className="flex flex-col gap-2 text-[12.5px]">
            {(
              [
                ["DORA art. 17 à 19", "Chaque refus ouvre un incident numéroté, notifiable ; la preuve on-chain sert de registre."],
                ["MiCA", "Les paiements en USDC passent par un visa vérifiable ; traçabilité de chaque transfert."],
                ["AI Act art. 14", "Contrôle humain : les cas de doute attendent une personne, refus par défaut."],
                ["NIST CSF", "Identify (registre ERC-8004), Protect (Allow List L1), Detect (5 contrôles), Respond (refus, registre), Recover (immunité)."],
                ["OWASP ASI03 / ASI07", "Chaîne d'autorité vérifiée maillon par maillon ; injection détectée par l'IA."],
              ] as const
            ).map(([k, v]) => (
              <li key={k} className="flex gap-3">
                <span className="w-36 shrink-0 font-mono text-[11px] text-zinc-900 dark:text-zinc-100">{k}</span>
                <span className="text-zinc-600 dark:text-zinc-400">{v}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="flex gap-2">
        <button type="button" onClick={() => openView("transactions", { filter: "BLOCK" })} className="rounded-xl border border-zinc-200 px-3 py-1.5 text-[12.5px] text-zinc-600 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-300 dark:hover:text-zinc-50">
          Voir les refus
        </button>
        <button type="button" onClick={() => openView("registry")} className="rounded-xl border border-zinc-200 px-3 py-1.5 text-[12.5px] text-zinc-600 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-300 dark:hover:text-zinc-50">
          Ouvrir le registre
        </button>
        <button type="button" onClick={() => openView("parking")} className="rounded-xl border border-zinc-200 px-3 py-1.5 text-[12.5px] text-zinc-600 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-300 dark:hover:text-zinc-50">
          Décisions humaines
        </button>
      </div>
      <p className="font-mono text-[10.5px] text-zinc-400">{LIVE_CONFIGURED ? "Indicateurs calculés sur Sentinel L1 : les décisions de l'agent MCP (DecisionRecorded), ses signaux et le registre ThreatFlagged" : "Indicateurs calculés sur la simulation locale (données fictives)"}</p>
    </div>
  );
}
