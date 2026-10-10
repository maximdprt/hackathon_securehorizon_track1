"use client";

import { useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { GLASS, PANE } from "@/components/explorer-v2/network/city-frame";
import { answerHuman } from "@/sim/Director";
import { sim, useSim, type Panel } from "@/sim/store";
import { STEPS } from "@/sim/timings";
import { STATE, fmtAmount, shortAddr, type Tone } from "@/sim/types";
import { StateIcon } from "./charts";

const EYEBROW = "font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400 dark:text-zinc-500";
const STEP_FR = ["Scan du portique", "Contrat lu", "Fil d'autorité", "Échantillonnage", "Registre consulté", "Score", "Verdict"];

function PanelShell({ name, title, width, children }: { name: Exclude<Panel, null>; title: ReactNode; width: number; children: ReactNode }) {
  const open = useSim((s) => s.panel === name);
  return (
    <aside aria-label={typeof title === "string" ? title : name} inert={!open || undefined} className={cn(PANE, "right-(--frame)", open ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-6 opacity-0")} style={{ width }}>
      <div className="flex h-[3.25rem] shrink-0 items-center justify-between border-b border-zinc-100 px-4 dark:border-zinc-900">
        <span className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100">{title}</span>
        <button type="button" aria-label="Fermer" onClick={() => sim.set({ panel: null })} className="rounded-full p-1.5 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-50">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{open && children}</div>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-zinc-100 px-4 py-3 dark:border-zinc-900">
      <div className={cn(EYEBROW, "mb-2")}>{title}</div>
      {children}
    </section>
  );
}

/** Level 3: the detail (chronology, authority chain, injection, compliance, on-chain, raw JSON) */
export function DetailPanel() {
  const tx = useSim((s) => s.tx);
  const [tab, setTab] = useState<"detail" | "json">("detail");
  if (!tx) return <PanelShell name="detail" title="Détail" width={460}>{null}</PanelShell>;
  const t0 = Date.parse(tx.created_at);
  return (
    <PanelShell name="detail" title={`Détail · ${tx.tx_id}`} width={460}>
      <div className="flex gap-1 px-4 pt-3" role="tablist">
        {(["detail", "json"] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("rounded-xl px-3 py-1.5 text-[12.5px]", tab === k ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50" : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100")}>
            {k === "detail" ? "Détail" : "JSON brut"}
          </button>
        ))}
      </div>
      {tab === "json" ? (
        <pre className="whitespace-pre-wrap break-all p-4 font-mono text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">{JSON.stringify(tx.raw ?? tx, null, 2)}</pre>
      ) : (
        <>
          <Section title="Chronologie">
            <ol className="space-y-1 font-mono text-[11.5px] text-zinc-700 dark:text-zinc-300">
              {STEPS.map((s, i) => (
                <li key={s} className="flex justify-between">
                  <span>{STEP_FR[i]}</span>
                  <span className="text-zinc-400">+{((tx.timings_ms.decide * (i + 1)) / STEPS.length / 1000).toFixed(2).replace(".", ",")} s</span>
                </li>
              ))}
              <li className="flex justify-between">
                <span>Écriture on-chain</span>
                <span className="text-zinc-400">{tx.onchain ? `bloc #${fmtAmount(tx.onchain.block)}` : "…"}</span>
              </li>
            </ol>
            <div className="mt-1 font-mono text-[10px] text-zinc-400">ordre reçu {new Date(Number.isNaN(t0) ? Date.now() : t0).toLocaleTimeString("fr-FR")}</div>
          </Section>
          <Section title="Chaîne d'autorité">
            <div className="flex flex-wrap items-center gap-1.5">
              {tx.authority_chain.map((n, i) => (
                <span key={n.step} className="flex items-center gap-1.5">
                  {i > 0 && <span className={n.ok ? "text-zinc-400" : "text-[#FF5D57]"}>{n.ok ? "→" : "⇢"}</span>}
                  <span className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px]" style={{ borderColor: n.ok ? `${STATE.allow.hex}66` : `${STATE.block.hex}aa`, color: n.ok ? undefined : STATE.block.hex }}>
                    <StateIcon kind={n.ok ? "ok" : "bad"} size={12} />
                    {n.step}
                  </span>
                </span>
              ))}
            </div>
            {tx.break_note && <div className="mt-1.5 text-[12px] text-[#FF5D57]">{tx.break_note}</div>}
          </Section>
          <Section title="Preuve">
            {tx.injection_excerpt ? (
              <mark className="block rounded-md bg-[#FF5D57]/10 p-2 font-mono text-[11.5px] leading-relaxed text-zinc-800 dark:text-zinc-200">{tx.injection_excerpt}</mark>
            ) : (
              <p className="text-[12.5px] text-zinc-500">Aucune instruction injectée.</p>
            )}
            <dl className="mt-2 grid grid-cols-2 gap-y-1 text-[12px]">
              <dt className="text-zinc-500">Bénéficiaire</dt>
              <dd className="font-mono">{shortAddr(tx.to.address)}</dd>
              <dt className="text-zinc-500">Domaine</dt>
              <dd className="font-mono">
                {tx.to.domain ?? "-"}
                {tx.domain_age_days !== undefined && <span className={tx.domain_age_days < 30 ? "text-[#FF5D57]" : "text-zinc-400"}> · {tx.domain_age_days} j</span>}
              </dd>
            </dl>
          </Section>
          <Section title="Conformité">
            <div className="flex flex-wrap gap-1.5">
              {(tx.dora_incident ? [`DORA ${tx.dora_incident}`, ...tx.frameworks.filter((f) => !f.startsWith("DORA"))] : tx.frameworks).map((f) => (
                <span key={f} className="rounded-md border border-zinc-200 px-2 py-0.5 font-mono text-[10.5px] text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
                  {f}
                </span>
              ))}
            </div>
          </Section>
          <Section title="On-chain">
            {tx.onchain ? (
              <dl className="grid grid-cols-2 gap-y-1 text-[12px]">
                <dt className="text-zinc-500">Chaîne</dt>
                <dd>{tx.onchain.chain}</dd>
                <dt className="text-zinc-500">Bloc</dt>
                <dd className="font-mono">#{fmtAmount(tx.onchain.block)}</dd>
                <dt className="text-zinc-500">Hash</dt>
                <dd className="font-mono">{shortAddr(tx.onchain.tx_hash)}</dd>
                {tx.onchain.visa_id && (
                  <>
                    <dt className="text-zinc-500">Visa</dt>
                    <dd className="font-mono">{tx.onchain.visa_id}</dd>
                  </>
                )}
                <dt className="text-zinc-500">Signature</dt>
                <dd>signé KMS</dd>
              </dl>
            ) : (
              <p className="text-[12.5px] text-zinc-500">Pas encore écrit.</p>
            )}
          </Section>
        </>
      )}
    </PanelShell>
  );
}

const TONE_ICON: Record<Tone, "ok" | "bad" | "warn" | "wait"> = { allow: "ok", block: "bad", human: "warn", verify: "wait" };

/** the decisions' log (round button at the bottom right) */
export function JournalPanel() {
  const journal = useSim((s) => s.journal);
  const q = useSim((s) => s.search.trim().toLowerCase());
  const rows = q ? journal.filter((j) => `${j.tx_id} ${j.to}`.toLowerCase().includes(q)) : journal;
  return (
    <PanelShell name="journal" title="Journal des décisions" width={372}>
      {rows.length === 0 && <p className="p-4 text-[12.5px] text-zinc-500">Aucune décision pour l'instant. Touche 1 pour lancer la fraude.</p>}
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-900">
        {rows.map((j) => {
          const tone: Tone = j.outcome === "ALLOW" ? "allow" : j.outcome === "BLOCK" ? "block" : "verify";
          return (
            <li key={`${j.tx_id}-${j.at}`} className="flex items-center gap-2.5 px-4 py-2.5">
              <StateIcon kind={TONE_ICON[tone]} />
              <div className="min-w-0 flex-1">
                <div className="flex justify-between text-[13px]">
                  <span className="font-mono text-zinc-900 dark:text-zinc-100">{j.tx_id}</span>
                  <span className="font-mono text-[11px] tabular-nums text-zinc-500">
                    {fmtAmount(j.amount)} {j.token}
                  </span>
                </div>
                <div className="font-mono text-[10.5px] text-zinc-500">
                  {j.outcome === "PENDING" ? "en cours" : j.outcome === "ALLOW" ? "visa" : "refus"} · {j.via} · {shortAddr(j.to)}
                  {j.block ? ` · bloc #${fmtAmount(j.block)}` : ""}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </PanelShell>
  );
}

/** the hackers' registry (top bar tab) */
export function RegistryPanel() {
  const registry = useSim((s) => s.registry);
  return (
    <PanelShell name="registry" title="Registre des hackers" width={372}>
      {registry.length === 0 ? <p className="p-4 text-[12.5px] text-zinc-500">Vide. Une fraude bloquée y inscrit son adresse.</p> : null}
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-900">
        {registry.map((a) => (
          <li key={a} className="flex items-center gap-2 px-4 py-2.5 font-mono text-[12px] text-zinc-800 dark:text-zinc-200">
            <StateIcon kind="bad" size={14} />
            {shortAddr(a)}
            <span className="ml-auto text-[10.5px] text-zinc-500">refus immédiat</span>
          </li>
        ))}
      </ul>
    </PanelShell>
  );
}

/** the on-chain proofs (top bar tab "Audit") */
export function AuditPanel() {
  const blocks = useSim((s) => s.blocks);
  return (
    <PanelShell name="audit" title="Audit · preuves on-chain" width={372}>
      {blocks.length === 0 && <p className="p-4 text-[12.5px] text-zinc-500">Chaque décision écrit un bloc sur AvaGuard L1.</p>}
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-900">
        {[...blocks].reverse().map((b) => (
          <li key={b.n} className="flex items-center gap-2 px-4 py-2.5 text-[12.5px]">
            <span className="h-3 w-3 rounded-sm" style={{ background: STATE[b.tone].hex }} />
            <span className="font-mono">#{fmtAmount(b.n)}</span>
            <span className="text-zinc-500">{b.tx_id}</span>
            <span className="ml-auto font-mono text-[10.5px] text-zinc-500">{b.tone === "allow" ? "visa" : "refus"} · KMS</span>
          </li>
        ))}
      </ul>
    </PanelShell>
  );
}

/** the human's decision, at the top right with its countdown (A / R) */
export function HumanAlert() {
  const human = useSim((s) => s.human);
  const tx = useSim((s) => s.tx);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!human) return;
    const i = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(i);
  }, [human]);
  if (!human || !tx) return null;
  const left = Math.max(0, Math.round((human.deadline - now) / 1000));
  return (
    <div role="alertdialog" aria-label="Validation humaine requise" data-city-chrome className={cn("absolute right-(--frame) top-[calc(var(--frame)+3.25rem)] z-40 w-[372px] rounded-2xl border-l-4 p-4", GLASS)} style={{ borderLeftColor: STATE.human.hex }}>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: STATE.human.hex }}>
          Validation humaine
        </span>
        <span className="font-mono text-[18px] font-semibold tabular-nums" style={{ color: STATE.human.hex }} aria-live="polite">
          {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
        </span>
      </div>
      <div className="mt-2 text-[13.5px] text-zinc-900 dark:text-zinc-100">
        {tx.from.agent_id} → {tx.to.domain ?? shortAddr(tx.to.address)}
      </div>
      <div className="font-mono text-[11px] text-zinc-500">
        {fmtAmount(tx.amount.value)} {tx.amount.token} · score {tx.score} · {tx.tx_id}
      </div>
      <p className="mt-1.5 text-[12.5px] text-zinc-600 dark:text-zinc-400">{tx.reasons[0]}</p>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={() => answerHuman(true)} className="flex-1 rounded-xl border px-3 py-2 text-[13px] font-medium" style={{ borderColor: `${STATE.allow.hex}88`, color: STATE.allow.hex, background: `${STATE.allow.hex}14` }}>
          Approuver <span className="font-mono text-[10px] opacity-70">A</span>
        </button>
        <button type="button" onClick={() => answerHuman(false)} className="flex-1 rounded-xl border px-3 py-2 text-[13px] font-medium" style={{ borderColor: `${STATE.block.hex}88`, color: STATE.block.hex, background: `${STATE.block.hex}14` }}>
          Refuser <span className="font-mono text-[10px] opacity-70">R</span>
        </button>
      </div>
      <p className="mt-2 text-[11px] text-zinc-500">Sans réponse à la fin du compte à rebours, le paiement est refusé.</p>
    </div>
  );
}

export function Toasts() {
  const toasts = useSim((s) => s.toasts);
  return (
    <div className="pointer-events-none absolute bottom-[calc(var(--frame)+5.5rem)] right-(--frame) z-40 flex w-[420px] flex-col items-end gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={cn("flex items-center gap-2.5 rounded-2xl border-l-4 px-4 py-3 text-[13px] text-zinc-900 animate-in fade-in-0 slide-in-from-bottom-2 dark:text-zinc-100", GLASS)} style={{ borderLeftColor: STATE[t.tone].hex }}>
          <StateIcon kind={TONE_ICON[t.tone]} />
          {t.text}
        </div>
      ))}
    </div>
  );
}

/** progress words for the analysis steps (exported for the scene's labels) */
export const STEP_WORDS = STEP_FR;
