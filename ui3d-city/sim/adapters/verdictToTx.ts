import { signalsOfVerdict, type GuardSignal } from "@/data/signals";
import { CHECK_ORDER, type Check, type CheckKey, type Decision, type TxEvent } from "../types";

/** Exactly the team's detection/verdict.schema.json (AgenticPaymentVerdict). */
export type AgenticPaymentVerdict = {
  instruction_id: string;
  issuer: string;
  action: "pay" | "approve" | "transfer" | "swap";
  amount: number;
  currency?: string;
  recipient?: string;
  verdict: "allow" | "needs_approval" | "block";
  risk_score: number; // 0..1
  reasons: string[];
  owasp: ("ASI03" | "ASI07")[];
  authority_check?: { authorized?: boolean; within_limit?: boolean; source?: string };
  // the schema says string[]; the model sometimes returns one string, both are accepted
  poison_check?: { is_poisoned?: boolean; confidence?: number; evidence?: string[] | string };
  onchain_flagged?: boolean;
  timestamp?: string;
  /* the MCP agent's guard engine adds these (guard/models.py Verdict, guard/engine.py): all optional */
  trust_score?: number;
  latency_ms?: number;
  signals?: { id: string; layer?: string; weight?: number; evidence?: string; hard?: boolean }[];
  thresholds?: [number, number];
};

/** What the API may send beside a verdict to label it for people (all optional). */
export type VerdictContext = {
  use_case?: TxEvent["use_case"];
  issuer_label?: string;
  recipient_label?: string;
  recipient_domain?: string;
  mandate_limit?: number;
  timings_ms?: { detect?: number; decide?: number };
  source_excerpt?: string;
};

const DECISION: Record<AgenticPaymentVerdict["verdict"], Decision> = { allow: "ALLOW", needs_approval: "HUMAN", block: "BLOCK" };
const pct = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const noisyOr = (ws: number[]) => 1 - ws.reduce((p, w) => p * (1 - Math.min(Math.max(w, 0), 1)), 1);
/** "[content] imperative_to_agent (-42.5): …" as the guard writes a reason, without its prefix */
const plain = (r: string) => r.replace(/^\[[a-z]+\]\s*/, "").replace(/^([a-z_]+)\s*\(-[\d.]+\):/, "$1:");

/** the five checks from the MCP agent's own signals: each check's risk is its signals' weights combined as the guard
    combines them (scoring.noisy_or), a hard signal is 100 */
function checksOfSignals(sig: GuardSignal[]): Record<CheckKey, Check> {
  const out = {} as Record<CheckKey, Check>;
  for (const k of CHECK_ORDER) {
    const mine = sig.filter((s) => s.check === k);
    const risk = mine.some((s) => s.hard) ? 1 : noisyOr(mine.map((s) => s.weight ?? 0.5));
    out[k] = { score: pct(risk * 100), reason: mine.length ? mine.map((s) => s.text || s.id).join(" · ") : "aucun signal du garde" };
  }
  return out;
}

export function isVerdict(x: unknown): x is AgenticPaymentVerdict {
  const v = x as AgenticPaymentVerdict;
  return !!v && typeof v === "object" && typeof v.verdict === "string" && typeof v.risk_score === "number" && typeof v.issuer === "string";
}

export function verdictToTx(v: AgenticPaymentVerdict, ctx: VerdictContext = {}): TxEvent {
  const auth = v.authority_check ?? {};
  const poison = v.poison_check ?? {};
  const poisoned = !!poison.is_poisoned;
  const conf = poison.confidence ?? (poisoned ? 0.9 : 0.1);
  const authorized = auth.authorized !== false;
  const within = auth.within_limit !== false;
  const flagged = !!v.onchain_flagged;
  const cur = (v.currency ?? "USDC").toUpperCase();
  const token: TxEvent["amount"]["token"] = cur === "AVAX" ? "AVAX" : cur === "SEC" ? "SEC" : "USDC";
  const evidence = Array.isArray(poison.evidence) ? poison.evidence : poison.evidence ? [String(poison.evidence)] : [];
  // a payment id from SentinelL1 (0x + 64 hex) names the row as the chain's read does (data/sentinel.ts idOfPayment)
  const pid = String(v.instruction_id ?? "");
  const id = /^0x[0-9a-f]{64}$/i.test(pid) ? null : pid.replace(/[^0-9a-z]/gi, "").slice(-4) || String(Date.now() % 10000);
  const line = `${v.action}(${v.recipient ?? "?"}, ${v.amount} ${token})`;
  const signals = v.signals ? signalsOfVerdict(v) : undefined;
  const th = v.thresholds?.length === 2 ? { allow_below: pct(v.thresholds[0] * 100), block_from: pct(v.thresholds[1] * 100) } : { allow_below: 40, block_from: 70 };
  return {
    tx_id: id === null ? pid.slice(0, 10) : `tx_${id}`,
    created_at: v.timestamp ?? new Date().toISOString(),
    use_case: ctx.use_case ?? (v.action === "swap" ? "agent_to_agent" : "shopping"),
    from: { agent_id: ctx.issuer_label ?? v.issuer, address: v.issuer },
    to: { label: ctx.recipient_label ?? v.recipient ?? "inconnu", address: v.recipient ?? "", domain: ctx.recipient_domain },
    amount: { value: v.amount, token },
    contract: { method: `${v.action}()`, line, risky: v.verdict !== "allow" },
    contract_code: [line],
    authority_chain: [
      { step: "Humain", ok: true },
      { step: "Agent", ok: authorized },
      { step: "Source", ok: !poisoned },
    ],
    break_note: poisoned ? "rupture : l'ordre vient de la source" : undefined,
    injection_excerpt: evidence[0] ?? ctx.source_excerpt,
    checks: signals ? checksOfSignals(signals) : {
      authority: { score: authorized ? (within ? 8 : 45) : 90, reason: authorized ? "Émetteur dans le registre d'autorité" : "L'émetteur n'a pas l'autorité pour cette action" },
      beneficiary: { score: flagged ? 95 : 12, reason: flagged ? "Bénéficiaire signalé on-chain" : "Aucun signalement on-chain" },
      mandate: { score: within ? 10 : 80, reason: within ? "Montant dans le plafond" : "Montant au-dessus du plafond" },
      intent_ai: { score: pct(poisoned ? conf * 100 : (1 - conf) * 30), reason: poisoned ? "Directive injectée dans la source" : "Pas de directive injectée" },
      contract: { score: v.action === "approve" ? 55 : 15, reason: v.action === "approve" ? "approve() donne un droit de dépense" : `${v.action}() simple` },
    },
    score: pct(v.risk_score * 100),
    thresholds: th,
    decision: DECISION[v.verdict],
    reasons: v.reasons.slice(0, signals ? 4 : 2).map(plain),
    frameworks: [...v.owasp.map((o) => `OWASP ${o}`), ...(poisoned ? ["MITRE ATLAS"] : []), "NIST CSF"],
    timings_ms: { decide: (ctx.timings_ms?.detect ?? 0) + (ctx.timings_ms?.decide ?? 0) || (v.latency_ms ?? 0) },
    source: "live",
    raw: v,
    signals,
    trust: typeof v.trust_score === "number" ? v.trust_score : undefined,
  };
}
