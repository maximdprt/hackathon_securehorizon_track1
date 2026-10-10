"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import { DEMO_VERDICT } from "@/components/guard-yard/demo-verdict";
import { guardVerdictOf } from "@/components/guard-yard/verdict";
import { SCENARIO } from "@/sim/scenario";

/* /guard: the Guard Yard alone. The demo's fraud (tx_0042) by default; ?tx=fraud|immunity plays that scenario's refusal. */

const GuardYard = dynamic(() => import("@/components/guard-yard/GuardYard").then((m) => m.GuardYard), { ssr: false });

export default function GuardPage() {
  const verdict = useMemo(() => {
    const k = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("tx") : null;
    const tx = k && k in SCENARIO ? SCENARIO[k as keyof typeof SCENARIO] : null;
    return (tx && tx.decision === "BLOCK" && guardVerdictOf(tx)) || DEMO_VERDICT;
  }, []);
  return (
    <main className="min-h-screen bg-[#07090F] px-4 py-4 text-zinc-50">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-3">
        <div>
          <h1 className="text-[20px] font-semibold">Guard Yard · scanner et broyeur</h1>
          <p className="mt-0.5 max-w-[75ch] text-[14px] text-zinc-400">
            La transaction traverse un portique de radiographie comme aux douanes, puis, refusée, elle est saisie par la grue, compactée dans une presse à épaves et jetée dans la benne du registre des hackers. Données fictives.
          </p>
        </div>
        <GuardYard verdict={verdict} />
      </div>
    </main>
  );
}
