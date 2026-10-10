import { CHECK_LABEL, CHECK_ORDER, type TxEvent } from "@/sim/types";
import { DEMO_VERDICT } from "./demo-verdict";
import type { GuardVerdict } from "./types";

/* A transaction of the city (sim/types.ts TxEvent, the team's verdict.schema.json mapped by verdictToTx) as the Guard
   Yard reads it. A row read from the chain alone (`partial`) has no checks' scores: it gets no Guard Yard (null), so
   no score is ever invented. */

const short = (a: string) => (a?.startsWith("0x") && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || "…");

export function guardVerdictOf(tx: TxEvent & { partial?: boolean }): GuardVerdict | null {
  if (tx.partial) return null;
  const decision = tx.decision === "ALLOW" ? "allow" : tx.decision === "BLOCK" ? "block" : "human";
  // TODO(schema): the shared schema has no short "reasons" list of three: the TxEvent's reasons, completed by the checks' own
  const reasons = [...tx.reasons, ...CHECK_ORDER.map((k) => tx.checks[k].reason)].filter(Boolean).slice(0, 3);
  return {
    txId: tx.tx_id,
    decision,
    score: tx.score,
    thresholds: { allow: tx.thresholds.allow_below, block: tx.thresholds.block_from },
    criteria: CHECK_ORDER.map((k) => ({ label: CHECK_LABEL[k], value: tx.checks[k].score })),
    reasons: reasons.length ? reasons : DEMO_VERDICT.reasons,
    latencyMs: tx.timings_ms.decide || DEMO_VERDICT.latencyMs,
    proofBlock: tx.onchain?.block || undefined,
    incidentId: tx.dora_incident,
    beneficiary: short(tx.to.address),
    amount: { value: tx.amount.value, asset: tx.amount.token },
    flaggedCall: `${tx.contract.method} → ${tx.to.address ? `${tx.to.address.slice(0, 6)}…` : "?"}`,
  };
}
