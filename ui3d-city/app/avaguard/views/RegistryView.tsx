"use client";

import { useMemo, useState } from "react";
import { Download, Search, ShieldBan, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { LIVE_CONFIGURED, useAudit, type BannedEntry } from "@/data/source";
import { openView } from "@/sim/nav";
import { STATE, fmtAmount, shortAddr } from "@/sim/types";
import { CARD, CopyButton, ExplorerLink, Kpi, LABEL, StatusPill, when } from "./TransactionsView";
import { SourceBadge } from "./ViewHost";

/* The red container's door: the hackers' registry on Sentinel L1. Every address a refusal banned, its key's
   fingerprint, why, what was tried against it and how often, and the on-chain record. A payment to any of them is
   refused at once, without analysis: the immunity the second agent gets. Derived from the refusals (data/source.ts). */

const FRESH_MS = 9000;

function csvOf(rows: BannedEntry[]) {
  const head = ["adresse", "empreinte_cle", "label", "domaine", "raison", "montant_tente", "jeton", "tentatives", "bannie_le", "par", "tx_origine", "bloc", "tx_hash"];
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = rows.map((b) => [b.address, b.key_fingerprint, b.label, b.domain ?? "", b.reason, b.attempted.value, b.attempted.token, b.hits, b.banned_at, b.by, b.first_tx, b.onchain.block, b.onchain.tx_hash].map(esc).join(","));
  return [head.join(","), ...lines].join("\n");
}

export function RegistryView() {
  const { banned, txs } = useAudit();
  const [q, setQ] = useState("");
  const [by, setBy] = useState<"all" | "Sentinel" | "humain">("all");
  const [open, setOpen] = useState<string | null>(null);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return banned.filter((b) => (by === "all" || b.by === by) && (!s || [b.address, b.label, b.domain ?? "", b.key_fingerprint, b.first_tx].some((v) => v.toLowerCase().includes(s))));
  }, [banned, q, by]);
  const immune = banned.reduce((a, b) => a + b.hits - 1, 0);
  const tried = banned.filter((b) => b.attempted.token === "USDC").reduce((a, b) => a + b.attempted.value, 0);
  const onChain = LIVE_CONFIGURED && banned.some((b) => b.attempted.value === 0);
  const current = open ? banned.find((b) => b.address === open) ?? null : null;
  const now = Date.now();

  const download = () => {
    const url = URL.createObjectURL(new Blob([csvOf(rows)], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "registre-hackers-avaguard.csv" });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-hidden px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#FF5D57]/10 text-[#FF5D57]">
              <ShieldBan className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-[20px] font-semibold text-zinc-900 dark:text-zinc-50">Registre des hackers · Sentinel L1</h1>
              <p className="text-[12.5px] text-zinc-500 dark:text-zinc-400">Adresses et clés bannies : tout paiement vers elles est refusé sans analyse (immunité)</p>
            </div>
          </div>
          <SourceBadge />
        </div>

        <div className="grid grid-cols-4 gap-3">
          <Kpi label="Adresses bannies" value={banned.length} sub={`${banned.filter((b) => b.by === "humain").length} par un humain`} tone={STATE.block.hex} />
          <Kpi label="Refus par immunité" value={immune} sub="tentatives répétées, refusées en 0,3 s" />
          <Kpi label="Montant tenté" value={tried || !onChain ? fmtAmount(tried) : "n.p."} sub={tried || !onChain ? "USDC, toutes tentatives" : "non publié par ThreatFlagged"} />
          <Kpi label="Dernière entrée" value={banned[0] ? shortAddr(banned[0].address) : "…"} sub={banned[0] ? when(banned[0].last_at) : "aucune"} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex h-8 min-w-[20rem] flex-1 items-center gap-2 rounded-xl border border-zinc-200 px-2.5 dark:border-zinc-800">
            <Search className="h-3.5 w-3.5 text-zinc-400" />
            <span className="sr-only">Rechercher</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Adresse, empreinte, domaine, transaction…" className="h-full flex-1 bg-transparent text-[12.5px] text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100" />
          </label>
          <div role="group" aria-label="Banni par" className="flex items-center gap-0.5 rounded-xl border border-zinc-200 p-0.5 dark:border-zinc-800">
            {(
              [
                ["all", "Tous"],
                ["Sentinel", "Par Sentinel"],
                ["humain", "Par un humain"],
              ] as const
            ).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setBy(k)} className={cn("rounded-lg px-2.5 py-1 text-[12.5px]", by === k ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50" : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100")}>
                {label}
              </button>
            ))}
          </div>
          <button type="button" onClick={download} className="flex h-8 items-center gap-1.5 rounded-xl border border-zinc-200 px-3 text-[12.5px] text-zinc-600 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-300 dark:hover:text-zinc-50">
            <Download className="h-3.5 w-3.5" />
            Exporter CSV
          </button>
        </div>

        <div className={cn(CARD, "min-h-0 flex-1 overflow-auto")}>
          <table className="w-full border-collapse text-left">
            <thead className="sticky top-0 z-10 bg-zinc-50 dark:bg-zinc-900">
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                {["Adresse", "Empreinte de clé", "Label · domaine", "Raison", "Montant tenté", "Tentatives", "Bannie le", "Par", "Preuve"].map((h) => (
                  <th key={h} className={cn(LABEL, "px-3 py-2.5", (h === "Montant tenté" || h === "Tentatives") && "text-right")}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => {
                const fresh = now - Date.parse(b.last_at) < FRESH_MS;
                return (
                  <tr
                    key={b.address}
                    onClick={() => setOpen(open === b.address ? null : b.address)}
                    className={cn(
                      "h-12 cursor-pointer border-b border-zinc-100 text-[12.5px] transition-colors last:border-0 dark:border-zinc-800/70",
                      open === b.address ? "bg-zinc-100 dark:bg-zinc-800/80" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/40",
                      fresh && "animate-pulse bg-[#FF5D57]/10 motion-reduce:animate-none",
                    )}
                  >
                    <td className="px-3">
                      <span className="inline-flex items-center gap-1 font-mono text-[11.5px] text-[#FF5D57]">
                        {b.address.slice(0, 10)}…{b.address.slice(-6)}
                        <CopyButton text={b.address} />
                      </span>
                    </td>
                    <td className="px-3 font-mono text-[11px] text-zinc-500">{b.key_fingerprint}</td>
                    <td className="max-w-[15rem] px-3">
                      <span className="block truncate text-zinc-900 dark:text-zinc-100">{b.label}</span>
                      <span className="block truncate font-mono text-[10.5px] text-zinc-500">{b.domain ?? "…"}</span>
                    </td>
                    <td className="max-w-[18rem] truncate px-3 text-zinc-600 dark:text-zinc-400">{b.reason}</td>
                    <td className="px-3 text-right font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
                      {b.attempted.value ? (
                        <>
                          {fmtAmount(b.attempted.value)} <span className="text-zinc-500">{b.attempted.token}</span>
                        </>
                      ) : (
                        <span className="text-zinc-400">…</span>
                      )}
                    </td>
                    <td className="px-3 text-right font-mono tabular-nums" style={{ color: b.hits > 1 ? STATE.block.hex : undefined }}>
                      {b.hits}
                    </td>
                    <td className="px-3 font-mono text-[11.5px] text-zinc-500">{when(b.banned_at)}</td>
                    <td className="px-3 text-zinc-600 dark:text-zinc-400">{b.by}</td>
                    <td className="px-3 text-[11.5px] text-zinc-500">
                      <ExplorerLink kind="tx" id={b.onchain.tx_hash} live={LIVE_CONFIGURED && b.attempted.value === 0}>
                        #{b.onchain.block.toLocaleString("fr-FR")}
                      </ExplorerLink>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && <p className="py-16 text-center font-mono text-[12px] text-zinc-400">Aucune adresse ne correspond</p>}
        </div>
        <p className="font-mono text-[10.5px] text-zinc-400">{rows.length} adresses · {LIVE_CONFIGURED ? "lues sur Sentinel L1 (AuthorityRegistry.ThreatFlagged), lignes de démo simulées" : "les empreintes de clé et les adresses sont fictives · Données synthétiques"}</p>
      </div>

      {current && (
        <aside aria-label={`Fiche de ${current.address}`} className="flex w-[440px] shrink-0 flex-col border-l border-zinc-200 bg-white animate-in slide-in-from-right-4 fade-in-0 duration-200 motion-reduce:animate-none dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-4">
            <div className="min-w-0">
              <div className={LABEL}>Registre · fiche de l&apos;adresse</div>
              <div className="mt-1 flex items-center gap-1 break-all font-mono text-[13px] text-[#FF5D57]">
                {current.address}
                <CopyButton text={current.address} />
              </div>
              <div className="mt-1 text-[12.5px] text-zinc-700 dark:text-zinc-300">
                {current.label} · <span className="font-mono text-zinc-500">{current.domain}</span>
              </div>
            </div>
            <button type="button" aria-label="Fermer la fiche" onClick={() => setOpen(null)} className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-100">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <section className="grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-zinc-200 px-5 py-4 dark:border-zinc-800">
              {(
                [
                  ["Statut", "Bannie, refus immédiat"],
                  ["Empreinte de clé", current.key_fingerprint],
                  ["Bannie le", when(current.banned_at)],
                  ["Par", current.by],
                  ["Tentatives", String(current.hits)],
                  ["Montant tenté", `${fmtAmount(current.attempted.value)} ${current.attempted.token}`],
                  ["Bloc", `#${current.onchain.block.toLocaleString("fr-FR")}`],
                  ["Hash", shortAddr(current.onchain.tx_hash)],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <div className="font-mono text-[10px] text-zinc-400">{k}</div>
                  <div className="truncate font-mono text-[12px] text-zinc-900 dark:text-zinc-100">{v}</div>
                </div>
              ))}
            </section>
            <section className="border-t border-zinc-200 px-5 py-4 dark:border-zinc-800">
              <h3 className={cn(LABEL, "mb-2")}>Raison du bannissement</h3>
              <p className="text-[12.5px] text-zinc-700 dark:text-zinc-300">{current.reason}</p>
            </section>
            <section className="border-t border-zinc-200 px-5 py-4 dark:border-zinc-800">
              <h3 className={cn(LABEL, "mb-2")}>Tentatives</h3>
              <ul className="flex flex-col gap-1.5">
                {txs
                  .filter((t) => t.to.address.toLowerCase() === current.address.toLowerCase())
                  .map((t) => (
                    <li key={t.tx_id}>
                      <button type="button" onClick={() => openView("transactions", { tx: t.tx_id })} className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900">
                        <span className="flex items-center gap-2">
                          <StatusPill status={t.status} />
                          <span className="font-mono text-[12px] text-zinc-900 dark:text-zinc-100">{t.tx_id}</span>
                          {t.tx_id === current.first_tx && <span className="font-mono text-[10px] text-zinc-400">origine</span>}
                        </span>
                        <span className="font-mono text-[11px] text-zinc-500">
                          {fmtAmount(t.amount.value)} {t.amount.token} · {t.via}
                        </span>
                      </button>
                    </li>
                  ))}
              </ul>
            </section>
            <div className="border-t border-zinc-200 px-5 py-4 dark:border-zinc-800">
              <button type="button" onClick={() => openView("transactions", { tx: current.first_tx })} className="w-full rounded-xl border border-zinc-200 py-2 text-[12.5px] text-zinc-700 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-300 dark:hover:text-zinc-50">
                Ouvrir l&apos;audit de la transaction d&apos;origine ({current.first_tx})
              </button>
            </div>
          </div>
        </aside>
      )}
    </div>
  );
}
