"use client";

import { useMemo, type ReactNode } from "react";
import { BadgeCheck, Ban, FileWarning, Gauge as GaugeIcon, Link2, RotateCcw, ScanLine, ShieldCheck, Store, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { LIVE_CONFIGURED, useAudit } from "@/data/source";
import { isInjection } from "@/data/signals";
import { explorerUrl } from "@/data/sentinel";
import { SCENARIO } from "@/sim/scenario";
import { playScene, resetAll } from "@/sim/Director";
import { useSim } from "@/sim/store";
import { fmtAmount } from "@/sim/types";
import type { SceneKey } from "@/sim/scenario";

/* The page's foreground for someone who has never heard of the project (a jury): what Sentinel's MCP agent does, in
   three steps the city plays; four situations to try; and the few figures that show what it is worth. Light first, in
   calm colours; the city underneath is untouched. */

/** the four outcomes, the same colours as the city's cars */
export const TONE = {
  scan: { dot: "bg-sky-500", text: "text-sky-600 dark:text-sky-400", soft: "bg-sky-50 dark:bg-sky-500/10", ring: "ring-sky-200 dark:ring-sky-500/30" },
  ok: { dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400", soft: "bg-emerald-50 dark:bg-emerald-500/10", ring: "ring-emerald-200 dark:ring-emerald-500/30" },
  bad: { dot: "bg-rose-500", text: "text-rose-600 dark:text-rose-400", soft: "bg-rose-50 dark:bg-rose-500/10", ring: "ring-rose-200 dark:ring-rose-500/30" },
  human: { dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400", soft: "bg-amber-50 dark:bg-amber-500/10", ring: "ring-amber-200 dark:ring-amber-500/30" },
  brand: { dot: "bg-indigo-500", text: "text-indigo-600 dark:text-indigo-400", soft: "bg-indigo-50 dark:bg-indigo-500/10", ring: "ring-indigo-200 dark:ring-indigo-500/30" },
} as const;
type Tone = keyof typeof TONE;

export const PANEL = "rounded-2xl border border-slate-200/80 bg-white/90 shadow-[0_18px_40px_-24px_rgba(30,41,59,0.35)] backdrop-blur-xl dark:border-zinc-800 dark:bg-zinc-950/85";

/* ------------------------------------------------------------------ */
/* how it works                                                        */
/* ------------------------------------------------------------------ */

function Step({ n, icon, title, children, tone }: { n: number; icon: ReactNode; title: string; children: ReactNode; tone: Tone }) {
  return (
    <li className="flex gap-3">
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1", TONE[tone].soft, TONE[tone].text, TONE[tone].ring)}>{icon}</span>
      <div className="min-w-0">
        <div className="text-[13.5px] font-semibold text-slate-900 dark:text-zinc-50">
          <span className="mr-1 text-slate-400 dark:text-zinc-500">{n}.</span>
          {title}
        </div>
        <p className="text-[12.5px] leading-snug text-slate-600 dark:text-zinc-400">{children}</p>
      </div>
    </li>
  );
}

export function HowItWorks() {
  return (
    <section aria-label="Comment ça marche" className={cn(PANEL, "w-[380px] p-5")}>
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
          <ShieldCheck className="h-4.5 w-4.5" />
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-indigo-600 dark:text-indigo-400">Agent MCP Sentinel</span>
      </div>
      <h1 className="mt-3 text-[19px] font-semibold leading-snug text-slate-900 dark:text-zinc-50">Le garde du corps des agents IA qui paient</h1>
      <p className="mt-1.5 text-[13px] leading-relaxed text-slate-600 dark:text-zinc-400">
        Un agent IA peut se faire piéger par une fausse facture et envoyer l&apos;argent à un escroc. Sentinel contrôle chaque paiement <b className="font-semibold text-slate-800 dark:text-zinc-200">avant</b> qu&apos;il parte.
      </p>
      <ol className="mt-4 flex flex-col gap-3">
        <Step n={1} icon={<Wallet className="h-4.5 w-4.5" />} title="Un agent IA veut payer" tone="brand">
          Chaque paiement est une voiture qui sort de la tour Sentinel.
        </Step>
        <Step n={2} icon={<ScanLine className="h-4.5 w-4.5" />} title="Sentinel le passe au scanner" tone="scan">
          Qui a donné l&apos;ordre ? L&apos;intention est-elle saine ? Le bénéficiaire est-il connu ?
        </Step>
        <Step n={3} icon={<BadgeCheck className="h-4.5 w-4.5" />} title="Il décide, et le prouve" tone="ok">
          Paiement autorisé, fraude bloquée ou validation par un humain, chaque décision gravée sur la blockchain.
        </Step>
      </ol>
      <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-slate-100 pt-3 text-[12px] text-slate-600 dark:border-zinc-800 dark:text-zinc-400">
        {(
          [
            ["scan", "en contrôle"],
            ["ok", "paiement autorisé"],
            ["bad", "fraude bloquée, broyée"],
            ["human", "attend un humain"],
          ] as [Tone, string][]
        ).map(([t, label]) => (
          <span key={t} className="flex items-center gap-2">
            <span className={cn("h-2.5 w-2.5 rounded-full", TONE[t].dot)} />
            {label}
          </span>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* try it                                                              */
/* ------------------------------------------------------------------ */

const SITUATIONS: { k: SceneKey; key: string; title: string; detail: string; tone: Tone; icon: ReactNode }[] = [
  { k: "fraud", key: "1", title: "Facture piégée", detail: "4 800 USDC vers un escroc", tone: "bad", icon: <FileWarning className="h-4 w-4" /> },
  { k: "legit", key: "2", title: "Paiement normal", detail: "12 USDC à un service connu", tone: "ok", icon: <BadgeCheck className="h-4 w-4" /> },
  { k: "doubt", key: "3", title: "Boutique inconnue", detail: "640 USDC, un humain tranche", tone: "human", icon: <Store className="h-4 w-4" /> },
  { k: "immunity", key: "4", title: "Le même escroc revient", detail: "bloqué en 0,3 s", tone: "bad", icon: <Ban className="h-4 w-4" /> },
];

export function TryIt() {
  const busy = useSim((s) => s.phase !== "idle");
  const human = useSim((s) => s.human);
  return (
    <section aria-label="Essayer" className={cn(PANEL, "w-[380px] p-4")}>
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-[13px] font-semibold text-slate-900 dark:text-zinc-50">
          Essayez une situation
          {LIVE_CONFIGURED && <span className="block text-[11px] font-normal text-slate-400 dark:text-zinc-500">rejouée en démo, hors blockchain</span>}
        </span>
        <button type="button" onClick={resetAll} className="flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100">
          <RotateCcw className="h-3.5 w-3.5" /> Recommencer
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {SITUATIONS.map((s) => (
          <button
            key={s.k}
            type="button"
            onClick={() => playScene(s.k)}
            className={cn("group flex flex-col items-start gap-1 rounded-xl p-3 text-left ring-1 transition hover:-translate-y-0.5 hover:shadow-md", TONE[s.tone].soft, TONE[s.tone].ring)}
          >
            <span className={cn("flex items-center gap-1.5 text-[13px] font-semibold", TONE[s.tone].text)}>
              {s.icon}
              {s.title}
            </span>
            <span className="text-[11.5px] leading-snug text-slate-600 dark:text-zinc-400">{s.detail}</span>
            <span className="mt-0.5 rounded border border-slate-200 bg-white/70 px-1 font-mono text-[10px] text-slate-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-500">touche {s.key}</span>
          </button>
        ))}
      </div>
      {(busy || human) && <p className="mt-2.5 text-[11.5px] text-slate-500 dark:text-zinc-400">{human ? "Un humain doit trancher : Approuver (A) ou Refuser (R), à droite." : "Suivez la voiture dans la ville, l'analyse s'affiche à droite."}</p>}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* what it is worth                                                    */
/* ------------------------------------------------------------------ */

function Kpi({ icon, value, label, sub, tone }: { icon: ReactNode; value: ReactNode; label: string; sub: ReactNode; tone: Tone }) {
  return (
    <div className="flex min-w-0 flex-1 items-start gap-3 px-5 py-4">
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1", TONE[tone].soft, TONE[tone].text, TONE[tone].ring)}>{icon}</span>
      <div className="min-w-0">
        <div className="text-[26px] font-semibold leading-none tabular-nums text-slate-900 dark:text-zinc-50">{value}</div>
        <div className="mt-1.5 text-[13px] font-medium text-slate-800 dark:text-zinc-200">{label}</div>
        <div className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-slate-500 dark:text-zinc-400">{sub}</div>
      </div>
    </div>
  );
}

/** the figures as SentinelL1 holds them: every decision the MCP agent took, its signals, the chain's registry */
function LiveImpact() {
  const { txs, banned, source } = useAudit();
  const k = useMemo(() => {
    const onchain = txs.filter((t) => !!t.onchain?.tx_hash);
    const blocked = txs.filter((t) => t.status === "BLOCK");
    const injections = txs.filter((t) => t.signals?.some(isInjection)).length;
    const repeats = blocked.filter((t) => t.registry_hit).length;
    const latest = Math.max(0, ...onchain.map((t) => t.onchain?.block ?? 0));
    const timed = txs.filter((t) => t.timings_ms.decide > 0);
    const avg = timed.length ? timed.reduce((a, t) => a + t.timings_ms.decide, 0) / timed.length : 0;
    return {
      total: txs.length,
      allow: txs.filter((t) => t.status === "ALLOW").length,
      human: txs.filter((t) => t.status === "HUMAN" || t.status === "PENDING").length,
      blocked: blocked.length,
      injections,
      repeats,
      proved: onchain.length,
      latest,
      avg,
    };
  }, [txs]);
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
  const ms = (n: number) => (n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(1).replace(".", ",")} s`);
  const block = explorerUrl("block", k.latest);
  return (
    <section aria-label="Ce que l'agent MCP Sentinel a fait, lu sur la blockchain" className={cn(PANEL, "relative flex divide-x divide-slate-100 pt-3 dark:divide-zinc-800")}>
      <span className="absolute -top-2.5 right-5 flex items-center gap-1.5 rounded-full border border-emerald-200 bg-white px-2 py-0.5 text-[10.5px] font-semibold text-emerald-700 shadow-sm dark:border-emerald-500/30 dark:bg-zinc-950 dark:text-emerald-400">
        <span className={cn("h-1.5 w-1.5 rounded-full", source.connected ? "animate-pulse bg-emerald-500" : "bg-slate-300")} />
        {source.connected ? "En direct · blockchain Sentinel L1 + agent MCP" : "Connexion à Sentinel L1…"}
      </span>
      <Kpi icon={<ScanLine className="h-5 w-5" />} tone="scan" value={k.total} label="Paiements d'agents contrôlés" sub={`${k.allow} visas · ${k.blocked} refus · ${k.human} à un humain${k.avg ? ` · ${ms(k.avg)} pour décider` : ""}`} />
      <Kpi icon={<Ban className="h-5 w-5" />} tone="bad" value={k.blocked} label="Arnaques bloquées" sub={`${pct(k.blocked, k.total)} % des ordres stoppés avant que l'argent parte`} />
      <Kpi icon={<FileWarning className="h-5 w-5" />} tone="human" value={k.injections} label="Injections de prompt détectées" sub="des ordres cachés dans ce que l'agent a lu (OWASP ASI03)" />
      <Kpi icon={<ShieldCheck className="h-5 w-5" />} tone="bad" value={banned.length} label="Escrocs bannis on-chain" sub={`${k.repeats} récidives refusées d'office, sans nouvelle analyse`} />
      <Kpi
        icon={<Link2 className="h-5 w-5" />}
        tone="brand"
        value={`${pct(k.proved, k.total)} %`}
        label="Décisions prouvées on-chain"
        sub={
          block ? (
            <a href={block} target="_blank" rel="noreferrer" className="underline decoration-slate-300 underline-offset-2 hover:text-indigo-600">
              {k.proved} preuves · bloc #{k.latest} sur l&apos;explorer
            </a>
          ) : (
            `${k.proved} preuves · bloc #${k.latest}`
          )
        }
      />
    </section>
  );
}

export function Impact() {
  return LIVE_CONFIGURED ? <LiveImpact /> : <DemoImpact />;
}

/** without the chain configured: the city's own plays and the synthetic history (the demo) */
function DemoImpact() {
  const { txs, banned } = useAudit();
  const k = useMemo(() => {
    const final = txs.filter((t) => t.status === "ALLOW" || t.status === "BLOCK");
    const blocked = txs.filter((t) => t.status === "BLOCK");
    const bad = new Set(banned.map((b) => b.address.toLowerCase()));
    const attacks = final.filter((t) => bad.has(t.to.address.toLowerCase()));
    const caught = attacks.filter((t) => t.status === "BLOCK").length;
    // the decision time: measured on the decisions that carry it (the demo's, the brain's), else the four demo cases'
    const timed = final.filter((t) => t.timings_ms.decide > 0);
    const demo = Object.values(SCENARIO).map((t) => t.timings_ms.decide);
    const avg = timed.length ? timed.reduce((a, t) => a + t.timings_ms.decide, 0) / timed.length : demo.reduce((a, b) => a + b, 0) / demo.length;
    const measured = timed.length > 0;
    // money saved: what the refused payments carried, in USDC (the chain's own refusals do not publish their amount)
    const usdc = blocked.filter((t) => t.amount.token === "USDC").reduce((a, t) => a + t.amount.value, 0);
    const proved = final.filter((t) => !!t.onchain).length;
    const human = txs.filter((t) => t.decision === "HUMAN").length;
    return { blocked: blocked.length, rate: attacks.length ? Math.round((caught / attacks.length) * 100) : 100, usdc, avg, measured, proved, final: final.length, human, total: txs.length, banned: banned.length };
  }, [txs, banned]);
  const secs = (ms: number) => `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
  return (
    <section aria-label="Ce que Sentinel a évité" className={cn(PANEL, "flex divide-x divide-slate-100 dark:divide-zinc-800")}>
      <Kpi icon={<Ban className="h-5 w-5" />} tone="bad" value={k.blocked} label="Fraudes bloquées" sub={`${k.rate} % des attaques arrêtées avant paiement`} />
      <Kpi icon={<Wallet className="h-5 w-5" />} tone="ok" value={fmtAmount(k.usdc)} label="USDC sauvés" sub={k.usdc ? "argent qui serait parti chez les escrocs" : "jouez « Facture piégée » pour le voir"} />
      <Kpi icon={<ShieldCheck className="h-5 w-5" />} tone="bad" value={k.banned} label="Escrocs bannis" sub="leur prochaine tentative est refusée en 0,3 s" />
      <Kpi icon={<GaugeIcon className="h-5 w-5" />} tone="scan" value={secs(k.avg)} label="Pour décider" sub={k.measured ? "en moyenne, avant que l'argent parte" : "moyenne des 4 cas de démo"} />
      <Kpi icon={<Link2 className="h-5 w-5" />} tone="brand" value={`${k.final ? Math.round((k.proved / k.final) * 100) : 100} %`} label="Décisions prouvées on-chain" sub={`${k.proved} preuves, auditables (DORA, MiCA)`} />
    </section>
  );
}
