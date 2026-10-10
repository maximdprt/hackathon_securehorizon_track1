"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtCompact } from "@/components/explorer-v2/evm/metric-charts";
import { DISTRICTS } from "@/components/explorer-v2/network/districts";
import { GLASS } from "@/components/explorer-v2/network/city-frame";
import { Logo, type Node } from "@/components/explorer-v2/network/icm-map";
import { openView } from "@/sim/nav";

/* Any other tower's door: the City flies to it (its own behaviour), and this sheet tells what it is, from the
   snapshot's real figures, and what AvaGuard sees of it (nothing yet: the guard's payments settle on the C-Chain). */

export function ChainSheet({ node, partner, onClose, simulated }: { node: Node; partner: string | null; onClose: () => void; simulated: boolean }) {
  const district = DISTRICTS.find((d) => d.key === node.district);
  return (
    <aside aria-label={`Fiche de ${node.name}`} className={cn("absolute right-(--frame) top-(--frame) z-40 w-[340px] rounded-2xl p-4 animate-in fade-in-0 slide-in-from-right-2 duration-200 motion-reduce:animate-none", GLASS)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-[9.5px] font-bold uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">Fiche chaîne · Fuji</div>
          <div className="mt-1 flex items-center gap-2 text-[15px] font-semibold text-zinc-900 dark:text-zinc-50">
            <Logo uri={node.logo} name={node.name} />
            <span className="truncate">{node.name}</span>
          </div>
          {district && <div className="mt-0.5 text-[12px] text-zinc-500">Quartier {district.label}</div>}
        </div>
        <button type="button" aria-label="Fermer la fiche" onClick={onClose} className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-100">
          <X className="h-4 w-4" />
        </button>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-[11.5px]">
        {(
          [
            ["Validators", node.validators.toLocaleString("fr-FR")],
            [simulated ? "Messages ICM (simulés)" : "Messages ICM · 24 h", node.out + node.in > 0 ? `${fmtCompact(node.out)} out · ${fmtCompact(node.in)} in` : "aucun sur 24 h"],
            ["Partenaire principal", partner ?? "…"],
            ["Paiements AvaGuard", "0 (simulé)"],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-[10px] text-zinc-400">{k}</dt>
            <dd className="truncate text-zinc-900 dark:text-zinc-100">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-[11.5px] text-zinc-500">Les paiements d&apos;agents vérifiés par AvaGuard+ se règlent sur la C-Chain : la tour rouge ouvre leur liste.</p>
      <button type="button" onClick={() => openView("transactions")} className="mt-3 w-full rounded-xl border border-zinc-200 py-1.5 text-[12.5px] text-zinc-700 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-300 dark:hover:text-zinc-50">
        Voir les transactions AvaGuard
      </button>
    </aside>
  );
}
