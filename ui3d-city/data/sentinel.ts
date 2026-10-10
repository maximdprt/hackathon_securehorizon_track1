import { createPublicClient, defineChain, http, parseAbiItem, type Hex } from "viem";
import { AVAGUARD_NAME, SENTINEL_EVM_CHAIN_ID } from "@/components/explorer-v2/network/avaguard";
import type { AuditTx, Decision } from "@/sim/types";
import type { BannedEntry } from "./source";

/* The audit screens' live source: SentinelL1 itself, through the team's API (api/server.py on main, CLAUDE.md 11.4 and
   11.7). Every decision the brain POSTs to /authorize is written on-chain by AuthorityRegistry; we read back
     GET  {api}/cars?sinceBlock=N   the decisions (DecisionRecorded, with VisaGranted's recipient and amount)
     POST {api}/rpc                 eth_getLogs ThreatFlagged (the hackers' registry) and the blocks' times
   Read-only, no key. Configure in .env.local (never committed): NEXT_PUBLIC_SENTINEL_API, NEXT_PUBLIC_REGISTRY_ADDRESS,
   NEXT_PUBLIC_EXPLORER_URL. The chain publishes the verdict, its reason and its proof, not the five checks' scores:
   those come whole only through the verdict stream (/avaguard/events), and a row says so when it has none. */

export const sentinelConfig = {
  api: process.env.NEXT_PUBLIC_SENTINEL_API?.replace(/\/$/, ""),
  registry: process.env.NEXT_PUBLIC_REGISTRY_ADDRESS as Hex | undefined,
  explorer: process.env.NEXT_PUBLIC_EXPLORER_URL?.replace(/\/$/, ""),
};

/** a link into the SentinelScan explorer (explorer/frontend routes: /tx/[hash], /block/[number], /address/[address]) */
export const explorerUrl = (kind: "tx" | "block" | "address", id: string | number) => (sentinelConfig.explorer ? `${sentinelConfig.explorer}/${kind}/${id}` : null);

export type Car = { verdict: "allow" | "block" | "needs_human"; lane: string; paymentId: string; issuer: string; recipient: string | null; amount: string | null; reason: string; txHash: string; block: number };
type Flag = { address: string; severity: number; reason: string; block: number; txHash: string };

const DECISION: Record<Car["verdict"], Decision> = { allow: "ALLOW", block: "BLOCK", needs_human: "HUMAN" };
/** the API's own placeholder scores for a bare verdict (api/server.py), shown as such */
const SCORE: Record<Car["verdict"], number> = { allow: 8, needs_human: 55, block: 90 };
const threatFlagged = parseAbiItem("event ThreatFlagged(bytes32 indexed subject, uint8 severity, string reason)");

/** a decision's id in the screens: its payment id, short (the verdict stream uses the same, sim/adapters/verdictToTx.ts) */
export const idOfPayment = (paymentId: string) => paymentId.slice(0, 10);

function carToTx(c: Car, at: number | undefined, recipientOf: (c: Car) => string | null): AuditTx {
  const d = DECISION[c.verdict] ?? "HUMAN";
  const to = c.recipient ?? recipientOf(c);
  const value = c.amount ? Number(BigInt(c.amount) / 10n ** 12n) / 1e6 : 0;
  const unknown = { score: 0, reason: "non publié on-chain" };
  const iso = new Date(at ? at * 1000 : Date.now()).toISOString();
  return {
    tx_id: idOfPayment(c.paymentId),
    created_at: iso,
    decided_at: iso,
    use_case: "agent_to_agent",
    from: { agent_id: `${c.issuer.slice(0, 6)}…${c.issuer.slice(-4)}`, address: c.issuer },
    to: { label: !to ? "destinataire non publié" : c.verdict === "block" ? "Adresse signalée" : c.verdict === "allow" ? "Bénéficiaire du visa" : "Destinataire", address: to ?? "" },
    amount: { value, token: "SEC" },
    contract: { method: c.verdict === "allow" ? "grantVisa()" : c.verdict === "block" ? "flagThreat()" : "recordDecision()", line: `recordDecision(${idOfPayment(c.paymentId)}…, "${c.verdict}")`, risky: c.verdict === "block" },
    authority_chain: [],
    checks: { authority: unknown, beneficiary: unknown, mandate: unknown, intent_ai: unknown, contract: unknown },
    score: SCORE[c.verdict] ?? 55,
    thresholds: { allow_below: 40, block_from: 70 },
    decision: d,
    reasons: c.reason ? [c.reason] : [],
    frameworks: d === "BLOCK" ? ["DORA (incident)", "OWASP ASI03", "ASI07"] : d === "HUMAN" ? ["AI Act art. 14"] : ["MiCA", "DORA"],
    timings_ms: { decide: 0 },
    onchain: { chain: AVAGUARD_NAME, block: c.block, tx_hash: c.txHash, visa_id: c.verdict === "allow" ? `visa ${idOfPayment(c.paymentId)}` : undefined },
    registry_hit: false,
    source: "live",
    raw: c,
    status: d === "HUMAN" ? "HUMAN" : d,
    via: "Sentinel",
    partial: true,
  };
}

/** SentinelL1's decisions and flags, polled every 3 s; the subscribers hear each change */
export function createSentinelFeed(onChange: () => void) {
  const { api, registry } = sentinelConfig;
  const state = { cars: [] as Car[], flags: [] as Flag[], times: new Map<number, number>(), latest: -1, flagFrom: 0n, ok: false, error: "" };
  const client = api
    ? createPublicClient({ chain: defineChain({ id: SENTINEL_EVM_CHAIN_ID, name: AVAGUARD_NAME, nativeCurrency: { name: "SEC", symbol: "SEC", decimals: 18 }, rpcUrls: { default: { http: [`${api}/rpc`] } } }), transport: http(`${api}/rpc`) })
    : null;
  let timer: number | null = null;

  const pull = async () => {
    if (!api || !client) return;
    try {
      // the API answers 500 for an empty range (sinceBlock at the head): ask from the head's block again, its cars dedupe by hash
      const q = state.latest >= 0 ? `sinceBlock=${Math.max(0, state.latest - 1)}` : "lookback=1000000";
      const res = await fetch(`${api}/cars?${q}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { cars: Car[]; latestBlock: number };
      const fresh = body.cars.filter((c) => !state.cars.some((o) => o.txHash === c.txHash));
      state.cars.push(...fresh);
      state.latest = body.latestBlock;
      // a fresh range only: a range past the chain's head is an error for the node
      if (registry && state.flagFrom <= BigInt(body.latestBlock)) {
        const logs = await client.getLogs({ address: registry, event: threatFlagged, fromBlock: state.flagFrom, toBlock: BigInt(body.latestBlock) });
        for (const l of logs) {
          if (state.flags.some((f) => f.txHash === l.transactionHash)) continue;
          state.flags.push({ address: `0x${(l.args.subject ?? "0x").slice(-40)}`, severity: Number(l.args.severity ?? 0), reason: l.args.reason ?? "", block: Number(l.blockNumber ?? 0n), txHash: l.transactionHash ?? "0x" });
        }
        state.flagFrom = BigInt(body.latestBlock + 1);
      }
      // the blocks' times, once each
      const need = [...new Set([...state.cars.map((c) => c.block), ...state.flags.map((f) => f.block)])].filter((b) => !state.times.has(b));
      await Promise.all(
        need.map(async (b) => {
          const blk = await client.getBlock({ blockNumber: BigInt(b) });
          state.times.set(b, Number(blk.timestamp));
        }),
      );
      const changed = fresh.length > 0 || need.length > 0 || !state.ok;
      state.ok = true;
      state.error = "";
      if (changed) onChange();
    } catch (e) {
      const was = state.ok;
      state.ok = false;
      state.error = e instanceof Error ? e.message : String(e);
      if (was || !state.error) onChange();
    }
  };

  /** a refusal's recipient: authorize.py flags it in the transaction just before the decision, with the same reason */
  const recipientOf = (c: Car) => {
    if (c.verdict !== "block") return null;
    const f = [...state.flags].reverse().find((x) => x.block <= c.block && x.block >= c.block - 2 && x.reason === c.reason);
    return f?.address ?? null;
  };

  return {
    start() {
      if (timer !== null || !api) return;
      void pull();
      timer = window.setInterval(pull, 3000);
    },
    stop() {
      if (timer !== null) window.clearInterval(timer);
      timer = null;
    },
    get ok() {
      return state.ok;
    },
    get error() {
      return state.error;
    },
    transactions(): AuditTx[] {
      return [...state.cars].sort((a, b) => b.block - a.block).map((c) => carToTx(c, state.times.get(c.block), recipientOf));
    },
    /** the registry as the chain holds it: every ThreatFlagged, one entry an address */
    banned(): BannedEntry[] {
      const by = new Map<string, BannedEntry>();
      for (const f of [...state.flags].sort((a, b) => a.block - b.block)) {
        const k = f.address.toLowerCase();
        const at = new Date((state.times.get(f.block) ?? Date.now() / 1000) * 1000).toISOString();
        const decision = state.cars.find((c) => c.verdict === "block" && c.reason === f.reason && c.block >= f.block && c.block <= f.block + 2);
        const e = by.get(k);
        if (e) {
          e.hits += 1;
          e.last_at = at;
          continue;
        }
        by.set(k, {
          address: f.address,
          label: `sévérité ${f.severity}`,
          key_fingerprint: `0x${k.slice(2, 6)}${k.slice(-12)}`,
          first_tx: decision ? idOfPayment(decision.paymentId) : "",
          reason: f.reason,
          attempted: { value: 0, token: "SEC" },
          hits: 1,
          banned_at: at,
          by: "Sentinel",
          onchain: { block: f.block, tx_hash: f.txHash },
          last_at: at,
        });
      }
      return [...by.values()].sort((a, b) => Date.parse(b.last_at) - Date.parse(a.last_at));
    },
  };
}
