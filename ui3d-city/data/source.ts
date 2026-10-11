import { useSyncExternalStore } from "react";
import { sim } from "@/sim/store";
import type { AuditTx } from "@/sim/types";
import { HISTORY } from "./history";
import { createSentinelFeed, idOfPayment, sentinelConfig } from "./sentinel";
import { parseMessage } from "@/sim/liveFeed";
import type { TxEvent } from "@/sim/types";

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

/** the MCP agent's full verdicts, as /avaguard/events streams them (one per decision POSTed to /authorize), by the
    short payment id the chain's rows carry. The stream does not replay the past: this browser keeps what it heard. */
function createVerdictStream(onChange: () => void) {
  const KEY = "sentinel.verdicts.v1";
  const byId = new Map<string, TxEvent>();
  try {
    for (const [k, v] of JSON.parse(localStorage.getItem(KEY) ?? "[]") as [string, TxEvent][]) byId.set(k, v);
  } catch {
    /* no storage: the stream alone */
  }
  const url = process.env.NEXT_PUBLIC_AVAGUARD_SSE_URL ?? (sentinelConfig.api ? `${sentinelConfig.api}/avaguard/events` : "");
  let es: EventSource | null = null;
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify([...byId].slice(-200)));
    } catch {
      /* full or blocked: kept in memory */
    }
  };
  return {
    get: (id: string) => byId.get(id),
    get size() {
      return byId.size;
    },
    start() {
      if (es || !url || typeof EventSource === "undefined") return;
      es = new EventSource(url);
      es.onmessage = (m) => {
        try {
          const d = JSON.parse(m.data) as { proof?: { payment_id?: string } };
          const tx = parseMessage(d);
          if (!tx) return;
          byId.set(d.proof?.payment_id ? idOfPayment(d.proof.payment_id) : tx.tx_id, tx);
          save();
          onChange();
        } catch {
          /* a message we do not read */
        }
      };
    },
    stop() {
      es?.close();
      es = null;
    },
  };
}

/** SentinelL1 live (data/sentinel.ts): the chain's decisions and flags, each joined to the MCP agent's full verdict when
    this browser heard it (scores, the five checks, the time to decide), with the verdicts the city played in front. The
    demo's own plays (synthetic scenarios) stay in the city: every row here is on the chain. */
function sentinelSourceOf(): AuditSource {
  const subs = new Set<() => void>();
  let version = 0;
  const bump = () => {
    version++;
    subs.forEach((f) => f());
  };
  const feed = createSentinelFeed(bump);
  const verdicts = createVerdictStream(bump);
  if (typeof window !== "undefined") (window as unknown as { __sentinel?: unknown }).__sentinel = { feed, verdicts };
  let cache: { v: number; ledger: AuditTx[]; txs: AuditTx[]; banned: BannedEntry[] } | null = null;
  const build = () => {
    const ledger = sim.get().ledger;
    if (cache && cache.v === version && cache.ledger === ledger) return cache;
    // a chain row with the MCP agent's verdict: its analysis whole, the chain's proof, time and outcome
    const chain = feed.transactions().map((c): AuditTx => {
      const full = verdicts.get(c.tx_id);
      if (!full) return c;
      return { ...full, tx_id: c.tx_id, created_at: c.created_at, decided_at: c.decided_at, onchain: c.onchain, status: c.status, decision: c.decision, via: c.via, signals: full.signals ?? c.signals, raw: full.raw, partial: false };
    });
    const byId = new Map(chain.map((t) => [t.tx_id, t]));
    // the city's plays from the verdict stream only (source "live"): the demo's scenarios are not on the chain
    const played = ledger.filter((l) => l.source === "live").map((l) => {
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
      if (subs.size === 1) {
        feed.start();
        verdicts.start();
      }
      return () => {
        off();
        subs.delete(f);
        if (!subs.size) {
          feed.stop();
          verdicts.stop();
        }
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
