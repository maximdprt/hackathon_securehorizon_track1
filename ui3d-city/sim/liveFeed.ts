import { createPublicClient, defineChain, http, parseAbiItem, type Hex } from "viem";
import { avalancheFuji } from "viem/chains";
import { isVerdict, verdictToTx, type VerdictContext } from "./adapters/verdictToTx";
import type { TxEvent } from "./types";

/* Live mode, same interface as the scenario: verdicts stream from the team's API (SSE or WebSocket) and on-chain
   proofs are read from AuthorityRegistry (contracts/AuthorityRegistry.sol: DecisionRecorded) with viem. Read-only,
   no private key in the front. Configure in .env.local (never committed):
     NEXT_PUBLIC_AVAGUARD_SSE_URL=<api>/avaguard/events          (main's api/server.py; or NEXT_PUBLIC_AVAGUARD_WS_URL)
     NEXT_PUBLIC_RPC_URL=<api>/rpc                               (SentinelL1 through the API's proxy)
     NEXT_PUBLIC_REGISTRY_ADDRESS=0x...                          (the deployed AuthorityRegistry, CLAUDE.md 11.3)
     NEXT_PUBLIC_CHAIN=l1     NEXT_PUBLIC_L1_CHAIN_ID=99999 */
export const liveConfig = {
  sse: process.env.NEXT_PUBLIC_AVAGUARD_SSE_URL,
  ws: process.env.NEXT_PUBLIC_AVAGUARD_WS_URL,
  rpc: process.env.NEXT_PUBLIC_RPC_URL,
  registry: process.env.NEXT_PUBLIC_REGISTRY_ADDRESS as Hex | undefined,
  chain: process.env.NEXT_PUBLIC_CHAIN === "l1" ? "Sentinel L1" : "Fuji",
  l1ChainId: Number(process.env.NEXT_PUBLIC_L1_CHAIN_ID ?? 0),
};

// the event as AuthorityRegistry deploys it on SentinelL1 (contracts/AuthorityRegistry.sol on main)
const decisionRecorded = parseAbiItem("event DecisionRecorded(bytes32 indexed paymentId, address indexed issuer, string verdict, string reason)");

/** instruction_id is the payment id: api/server.py sends it as the verdict's instruction_id */
export type OnchainProof = { instruction_id: string; tx_hash: string; block: number; verdict: string };

/** what /avaguard/events adds beside a verdict: authorize.py's own proof (payment id and transaction hashes) */
type AuthorizeProof = { payment_id?: string; decision_tx?: string; visa_tx?: string; flag_tx?: string };

/** a TxEvent, a bare verdict, or { verdict, context } as the API sends it */
export function parseMessage(data: unknown): TxEvent | null {
  const d = data as { verdict?: unknown; context?: VerdictContext; proof?: AuthorizeProof; tx_id?: string; decision?: string };
  if (d && typeof d === "object" && typeof d.tx_id === "string" && typeof d.decision === "string") return { ...(d as TxEvent), source: "live" };
  if (d && typeof d === "object" && isVerdict(d.verdict)) {
    const tx = verdictToTx(d.verdict, d.context);
    // the decision's own transaction, until the chain's read gives its block (data/sentinel.ts joins them by payment id)
    const hash = d.proof?.decision_tx;
    return hash ? { ...tx, onchain: { chain: "Sentinel L1", block: 0, tx_hash: hash, visa_id: d.proof?.visa_tx ? `visa ${tx.tx_id}` : undefined } } : tx;
  }
  if (isVerdict(d)) return verdictToTx(d);
  return null;
}

export function startLiveFeed(onTx: (e: TxEvent) => void, onProof: (p: OnchainProof) => void, onStatus: (s: string) => void): () => void {
  const stops: (() => void)[] = [];
  const handle = (raw: string) => {
    try {
      const e = parseMessage(JSON.parse(raw));
      if (e) onTx(e);
      else console.warn("[liveFeed] message ignored: neither a TxEvent nor a verdict");
    } catch (err) {
      console.warn("[liveFeed] bad message", err);
    }
  };
  if (liveConfig.sse) {
    const es = new EventSource(liveConfig.sse);
    es.onopen = () => onStatus("API connectée (SSE)");
    es.onerror = () => onStatus("API injoignable, nouvelle tentative…");
    es.onmessage = (m) => handle(m.data);
    stops.push(() => es.close());
  } else if (liveConfig.ws) {
    const ws = new WebSocket(liveConfig.ws);
    ws.onopen = () => onStatus("API connectée (WebSocket)");
    ws.onerror = () => onStatus("API injoignable");
    ws.onmessage = (m) => handle(String(m.data));
    stops.push(() => ws.close());
  } else onStatus("Live : aucune URL d'API dans .env.local");
  if (liveConfig.rpc && liveConfig.registry) {
    const chain =
      liveConfig.chain === "Fuji"
        ? avalancheFuji
        : defineChain({ id: liveConfig.l1ChainId, name: "Sentinel L1", nativeCurrency: { name: "SEC", symbol: "SEC", decimals: 18 }, rpcUrls: { default: { http: [liveConfig.rpc] } } });
    const client = createPublicClient({ chain, transport: http(liveConfig.rpc) });
    stops.push(
      client.watchEvent({
        address: liveConfig.registry,
        event: decisionRecorded,
        onLogs: (logs) => logs.forEach((l) => onProof({ instruction_id: l.args.paymentId ?? "0x", tx_hash: l.transactionHash ?? "0x", block: Number(l.blockNumber ?? 0n), verdict: l.args.verdict ?? "" })),
      }),
    );
  }
  return () => stops.forEach((s) => s());
}
