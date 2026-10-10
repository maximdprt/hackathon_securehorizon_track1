"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { MCP_CONFIGURED, useAudit } from "@/data/source";
import { closeView, openView } from "@/sim/nav";
import { useSim, type View } from "@/sim/store";

/* The screens a building opens, over the city: the scene stays mounted under them (nothing is rebuilt), the URL follows
   (sim/nav.ts), Escape and Back return to the city. Each screen is its own file in this folder. */

export const VIEW_LABEL: Record<Exclude<View, null>, string> = { transactions: "Transactions", registry: "Registre des hackers", parking: "Validation humaine", audit: "Audit" };
const ORDER: Exclude<View, null>[] = ["transactions", "registry", "parking", "audit"];

/** where the data comes from, said plainly: the local simulation now, the MCP agent once its URL is set */
export function SourceBadge() {
  const { source } = useAudit();
  const live = MCP_CONFIGURED && source.connected;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 px-2 py-1 font-mono text-[10px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
      <span className={cn("h-1.5 w-1.5 rounded-full", live ? "bg-[#3FD08F]" : MCP_CONFIGURED ? "bg-[#FF5D57]" : "bg-[#F2B33D]")} />
      Source : {source.name.toLowerCase()} · MCP agent : {MCP_CONFIGURED ? (live ? "connecté" : "injoignable") : "non connecté"}
    </span>
  );
}

export function ViewHost({ screens }: { screens: Partial<Record<Exclude<View, null>, ReactNode>> }) {
  const view = useSim((s) => s.view);
  const viewTx = useSim((s) => s.viewTx);
  const box = useRef<HTMLDivElement>(null);

  // the screen takes the keyboard: Escape returns to the city (a row's own Escape closes its detail first)
  useEffect(() => {
    if (!view) return;
    box.current?.focus({ preventScroll: true });
    const on = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) closeView();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [view]);

  if (!view) return null;
  return (
    <div
      ref={box}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={VIEW_LABEL[view]}
      data-view={view}
      className="absolute inset-0 z-[60] flex flex-col bg-white/[0.97] outline-none backdrop-blur-xl animate-in fade-in-0 duration-200 motion-reduce:animate-none dark:bg-zinc-950/[0.96]"
    >
      <div className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-zinc-200 px-6 dark:border-zinc-800">
        <nav aria-label="Fil d'Ariane" className="flex min-w-0 items-center gap-1.5 font-mono text-[11.5px] text-zinc-500 dark:text-zinc-400">
          <button type="button" onClick={closeView} className="hover:text-zinc-900 dark:hover:text-zinc-100">
            City
          </button>
          <ChevronRight className="h-3.5 w-3.5 text-zinc-300 dark:text-zinc-700" />
          <span className={cn(viewTx ? "" : "text-zinc-900 dark:text-zinc-100")}>{VIEW_LABEL[view]}</span>
          {viewTx && (
            <>
              <ChevronRight className="h-3.5 w-3.5 text-zinc-300 dark:text-zinc-700" />
              <span className="truncate text-zinc-900 dark:text-zinc-100">{viewTx}</span>
            </>
          )}
        </nav>
        <div className="flex items-center gap-1">
          {ORDER.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => openView(v)}
              className={cn("rounded-lg px-2.5 py-1 text-[12.5px] transition-colors", v === view ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50" : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100")}
            >
              {VIEW_LABEL[v]}
            </button>
          ))}
        </div>
        <button type="button" onClick={closeView} className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1 text-[12.5px] text-zinc-600 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-300 dark:hover:text-zinc-50">
          <ArrowLeft className="h-3.5 w-3.5" />
          Retour à la ville
          <span className="ml-1 rounded border border-zinc-200 px-1 font-mono text-[9.5px] text-zinc-400 dark:border-zinc-800">Échap</span>
        </button>
      </div>
      <div className="min-h-0 flex-1">{screens[view] ?? <Soon label={VIEW_LABEL[view]} />}</div>
    </div>
  );
}

function Soon({ label }: { label: string }) {
  return <div className="flex h-full items-center justify-center font-mono text-[12px] text-zinc-400">{label} : écran en construction</div>;
}
