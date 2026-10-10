import { useSyncExternalStore } from "react";
import { verdictToTx, isVerdict } from "@/sim/adapters/verdictToTx";
import { sim } from "@/sim/store";
import type { AuditTx } from "@/sim/types";
import { HISTORY } from "./history";

/* The one data layer the audit screens read (Transactions, Registre, Validation humaine, Audit). Today it is the local
   simulation: the synthetic history plus every transaction played in the city. Tomorrow it is the MCP agent: set
   NEXT_PUBLIC_AVAGUARD_MCP_URL and mcpSource reads its /transactions (verdicts in the team's schema), nothing else in
   the UI changes. */

export type BannedEntry = {
  address: string;
  label: string;
  domain?: string;
  /** a fingerprint of the address's key as the registry stores it (synthetic) */
  key_fingerprint: string;
  first_tx: string;
  reason: string;
  /** what was tried against it, all attempts */
  attempted: { value: number; token: string };
  hits: number;
  banned_at: string;
  by: "AvaGuard" | "humain";
  onchain: { block: number; tx_hash: string };
  /** the latest attempt, to flash a fresh entry */
  last_at: string;
};

export interface AuditSource {
  name: string;
  connected: boolean;
  transactions(): AuditTx[];
  subscribe(f: () => void): () => void;
}

/** the registry, derived from the refusals: one entry an address, its first refusal bans it, each later one is a hit */
export function bannedOf(txs: AuditTx[]): BannedEntry[] {
  const by = new Map<string, BannedEntry>();
  const oldestFirst = [...txs].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  for (const t of oldestFirst) {
    if (t.status !== "BLOCK") continue;
    const k = t.to.address.toLowerCase();
    const e = by.get(k);
    if (e) {
      e.hits += 1;
      e.attempted = { value: e.attempted.value + t.amount.value, token: e.attempted.token === t.amount.token ? e.attempted.token : "mixte" };
      e.last_at = t.decided_at ?? t.created_at;
      continue;
    }
    by.set(k, {
      address: t.to.address,
      label: t.to.label,
      domain: t.to.domain,
      key_fingerprint: `0x${k.slice(2, 6)}${k.slice(-12)}`,
      first_tx: t.tx_id,
      reason: t.reasons[0] ?? t.checks.intent_ai.reason,
      attempted: { ...t.amount },
      hits: 1,
      banned_at: t.decided_at ?? t.created_at,
      by: t.via === "humain" ? "humain" : "AvaGuard",
      onchain: { block: t.onchain?.block ?? 0, tx_hash: t.onchain?.tx_hash ?? "0x" },
      last_at: t.decided_at ?? t.created_at,
    });
  }
  return [...by.values()].sort((a, b) => Date.parse(b.last_at) - Date.parse(a.last_at));
}

/* ------------------------------------------------------------------ */

let simCache: { ledger: AuditTx[]; out: AuditTx[] } | null = null;
export const simSource: AuditSource = {
  name: "Simulation locale",
  connected: true,
  transactions() {
    const ledger = sim.get().ledger;
    if (simCache?.ledger !== ledger) simCache = { ledger, out: [...ledger, ...HISTORY] };
    return simCache.out;
  },
  subscribe: (f) => sim.subscribe(f),
};

/** the MCP agent's feed, polled every 4 s once its URL is set; inert without it */
function mcpSourceOf(url: string): AuditSource {
  let txs: AuditTx[] = [];
  let ok = false;
  const subs = new Set<() => void>();
  let timer: number | null = null;
  const pull = async () => {
    try {
      const res = await fetch(`${url.replace(/\/$/, "")}/transactions`);
      const body: unknown = await res.json();
      const list = Array.isArray(body) ? body : [];
      txs = list.flatMap((v: unknown) => {
        if (!isVerdict(v)) return [];
        const t = verdictToTx(v);
        return [{ ...t, status: t.decision === "HUMAN" ? "HUMAN" : t.decision, via: "AvaGuard", decided_at: t.created_at } as AuditTx];
      });
      ok = true;
    } catch {
      ok = false;
    }
    subs.forEach((f) => f());
  };
  return {
    name: "MCP agent",
    get connected() {
      return ok;
    },
    transactions: () => txs,
    subscribe(f) {
      subs.add(f);
      if (subs.size === 1) {
        void pull();
        timer = window.setInterval(pull, 4000);
      }
      return () => {
        subs.delete(f);
        if (!subs.size && timer !== null) window.clearInterval(timer);
      };
    },
  };
}

const MCP_URL = process.env.NEXT_PUBLIC_AVAGUARD_MCP_URL;
export const source: AuditSource = MCP_URL ? mcpSourceOf(MCP_URL) : simSource;
export const MCP_CONFIGURED = !!MCP_URL;

/** the screens' hook: the transactions, newest first, and the registry derived from them */
let bannedCache: { txs: AuditTx[]; out: BannedEntry[] } | null = null;
export function useAudit() {
  const txs = useSyncExternalStore(source.subscribe, source.transactions, source.transactions);
  if (bannedCache?.txs !== txs) bannedCache = { txs, out: bannedOf(txs) };
  return { txs, banned: bannedCache.out, source };
}
