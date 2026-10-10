import { useSyncExternalStore } from "react";
import { sim } from "@/sim/store";
import type { AuditTx } from "@/sim/types";
import { HISTORY } from "./history";
import { createSentinelFeed, sentinelConfig } from "./sentinel";

/* The one data layer the audit screens read (Transactions, Registre, Validation humaine, Audit). With the team's API
   configured (NEXT_PUBLIC_SENTINEL_API, main's api/server.py) it is SentinelL1 itself: the decisions the brain sent to
   /authorize, as AuthorityRegistry recorded them, and its ThreatFlagged registry (data/sentinel.ts). Without it, the
   local simulation: a synthetic history plus every transaction played in the city. Nothing else in the UI changes. */

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
  by: "Sentinel" | "humain";
  onchain: { block: number; tx_hash: string };
  /** the latest attempt, to flash a fresh entry */
  last_at: string;
};

export interface AuditSource {
  name: string;
  /** the chain itself, not the simulation */
  live?: boolean;
  connected: boolean;
  transactions(): AuditTx[];
  /** the registry, when the source holds its own (the chain's ThreatFlagged); else it is derived from the refusals */
  banned?(): BannedEntry[];
  subscribe(f: () => void): () => void;
}

/** what the refusals kept from leaving: in USDC for the demo's agents, in SEC (SentinelL1's token) for the chain's */
export function protectedOf(txs: AuditTx[]): { value: number; token: string } {
  const sum = (token: string) => txs.filter((t) => t.status === "BLOCK" && t.amount.token === token).reduce((a, t) => a + t.amount.value, 0);
  const usdc = sum("USDC");
  return usdc > 0 || !LIVE_CONFIGURED ? { value: usdc, token: "USDC" } : { value: sum("SEC"), token: "SEC" };
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
      by: t.via === "humain" ? "humain" : "Sentinel",
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

/** SentinelL1 live (data/sentinel.ts): the chain's decisions and flags, with the city's own plays (the verdict stream's
    and the demo's) in front, whole; a decision the city played and the chain recorded shows once, with the chain's proof */
function sentinelSourceOf(): AuditSource {
  const subs = new Set<() => void>();
  let version = 0;
  const bump = () => {
    version++;
    subs.forEach((f) => f());
  };
  const feed = createSentinelFeed(bump);
  if (typeof window !== "undefined") (window as unknown as { __sentinel?: unknown }).__sentinel = feed;
  let cache: { v: number; ledger: AuditTx[]; txs: AuditTx[]; banned: BannedEntry[] } | null = null;
  const build = () => {
    const ledger = sim.get().ledger;
    if (cache && cache.v === version && cache.ledger === ledger) return cache;
    const chain = feed.transactions();
    const byId = new Map(chain.map((t) => [t.tx_id, t]));
    const played = ledger.map((l) => {
      const c = byId.get(l.tx_id);
      return c ? { ...l, onchain: c.onchain, partial: false } : l;
    });
    const seen = new Set(played.map((t) => t.tx_id));
    const txs = [...played, ...chain.filter((t) => !seen.has(t.tx_id))];
    const onChain = feed.banned();
    const flagged = new Set(onChain.map((b) => b.address.toLowerCase()));
    const banned = [...onChain, ...bannedOf(played).filter((b) => !flagged.has(b.address.toLowerCase()))];
    cache = { v: version, ledger, txs, banned };
    return cache;
  };
  return {
    name: "Sentinel L1 (on-chain)",
    live: true,
    get connected() {
      return feed.ok;
    },
    transactions: () => build().txs,
    banned: () => build().banned,
    subscribe(f) {
      subs.add(f);
      const off = sim.subscribe(f);
      if (subs.size === 1) feed.start();
      return () => {
        off();
        subs.delete(f);
        if (!subs.size) feed.stop();
      };
    },
  };
}

/** live as soon as the team's API is configured (.env.local), else the local simulation */
export const LIVE_CONFIGURED = !!sentinelConfig.api;
export const source: AuditSource = LIVE_CONFIGURED ? sentinelSourceOf() : simSource;

/** the screens' hook: the transactions, newest first, and the hackers' registry (the chain's flags when live) */
let bannedCache: { txs: AuditTx[]; out: BannedEntry[] } | null = null;
export function useAudit() {
  const txs = useSyncExternalStore(source.subscribe, source.transactions, source.transactions);
  let banned: BannedEntry[];
  if (source.banned) banned = source.banned();
  else {
    if (bannedCache?.txs !== txs) bannedCache = { txs, out: bannedOf(txs) };
    banned = bannedCache.out;
  }
  return { txs, banned, source };
}
