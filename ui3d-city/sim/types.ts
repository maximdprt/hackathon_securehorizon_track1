import type { GuardSignal } from "@/data/signals";

// Section 8 contract. The team's detection/verdict.schema.json is mapped onto it by adapters/verdictToTx.ts;
// the schema itself is never modified here.

export type Decision = "ALLOW" | "HUMAN" | "BLOCK";
export type Check = { score: number; reason: string };
export type CheckKey = "authority" | "beneficiary" | "mandate" | "intent_ai" | "contract";

export type TxEvent = {
  tx_id: string;
  created_at: string;
  use_case: "shopping" | "agent_to_agent";
  from: { agent_id: string; address: string };
  to: { label: string; address: string; domain?: string };
  amount: { value: number; token: "USDC" | "AVAX" | "SEC" };
  contract: { method: string; line: string; risky: boolean };
  authority_chain: { step: string; ok: boolean }[];
  checks: Record<CheckKey, Check>;
  score: number;
  thresholds: { allow_below: number; block_from: number };
  decision: Decision;
  reasons: string[];
  frameworks: string[];
  timings_ms: { decide: number };
  onchain?: { chain: string; block: number; tx_hash: string; visa_id?: string };
  registry_hit?: boolean;
  /* presentation extras, all optional: the scenario or the adapter fills them */
  contract_code?: string[];
  injection_excerpt?: string;
  break_note?: string;
  domain_age_days?: number;
  dora_incident?: string;
  source?: "scenario" | "live";
  raw?: unknown;
  /** the MCP agent's own signals (guard engine), from its full verdict or read back from the on-chain reason */
  signals?: GuardSignal[];
  /** the MCP agent's trust score 0..100 (100 - risk), when its full verdict came */
  trust?: number;
};

/** a transaction as the audit screens read it: the event, where it stands, who decided it and when */
export type AuditStatus = "ALLOW" | "BLOCK" | "HUMAN" | "PENDING";
export type AuditTx = TxEvent & {
  status: AuditStatus;
  via: "Sentinel" | "humain" | "registre";
  decided_at?: string;
  /** read from the chain alone: the verdict, its reason and its proof, not the five checks' scores */
  partial?: boolean;
  /** a doubtful case's human answer: who decided, when, and the protocol it set off */
  review?: { by: string; at: string; approve: boolean; protocol: "visa" | "déchetterie" };
};

export const CHECK_ORDER: CheckKey[] = ["authority", "beneficiary", "mandate", "intent_ai", "contract"];
export const CHECK_LABEL: Record<CheckKey, string> = { authority: "Autorité", beneficiary: "Bénéficiaire", mandate: "Mandat", intent_ai: "Intention IA", contract: "Contrat" };

/** the four Sentinel states, with the colours the prompt fixes */
export const STATE = {
  verify: { hex: "#6FA8FF", label: "en vérification" },
  allow: { hex: "#3FD08F", label: "visa émis" },
  block: { hex: "#FF5D57", label: "refusée" },
  human: { hex: "#F2B33D", label: "attente humaine" },
} as const;
export type Tone = keyof typeof STATE;
export const toneOf = (d: Decision): Tone => (d === "ALLOW" ? "allow" : d === "BLOCK" ? "block" : "human");

export const shortAddr = (a: string) => (a?.startsWith("0x") && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
/** 4 800 with a regular space, as the prompt writes amounts */
export const fmtAmount = (n: number) => (n >= 1000 ? Math.round(n).toLocaleString("fr-FR").replace(/[  ]/g, " ") : String(+n.toFixed(3)).replace(".", ","));
export const fmtSecs = (ms: number) => `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
