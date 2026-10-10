"use client";

import { useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { X } from "lucide-react";
import { sim, useSim } from "@/sim/store";

/* The Guard Yard over the City, full screen: opened by "Voir le contrôle" on a refused transaction (the analysis card,
   the transaction's audit), closed by its button or Escape. The scene unmounts on close and frees its GPU memory. */

const GuardYard = dynamic(() => import("./GuardYard").then((m) => m.GuardYard), { ssr: false });

export function GuardYardModal() {
  const verdict = useSim((s) => s.guard);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!verdict) return;
    box.current?.focus();
    // Escape closes the modal first, before the screen under it
    const on = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      sim.set({ guard: null });
    };
    window.addEventListener("keydown", on, true);
    return () => window.removeEventListener("keydown", on, true);
  }, [verdict]);
  if (!verdict) return null;
  return (
    <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`Contrôle de ${verdict.txId}`} className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-4 outline-none backdrop-blur-sm">
      <div className="relative w-full max-w-[1280px]">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[15px] font-semibold text-zinc-50">Contrôle Sentinel · {verdict.txId}</div>
          <button type="button" onClick={() => sim.set({ guard: null })} className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-2.5 py-1 text-[12.5px] text-zinc-300 hover:text-zinc-50">
            <X className="h-3.5 w-3.5" /> Fermer <span className="ml-1 rounded border border-zinc-700 px-1 font-mono text-[9.5px] text-zinc-500">Échap</span>
          </button>
        </div>
        <GuardYard verdict={verdict} />
      </div>
    </div>
  );
}
