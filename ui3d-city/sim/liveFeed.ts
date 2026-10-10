import { createPublicClient, defineChain, http, parseAbiItem, type Hex } from "viem";
import { avalancheFuji } from "viem/chains";
import { isVerdict, verdictToTx, type VerdictContext } from "./adapters/verdictToTx";
import type { TxEvent } from "./types";

/* Live mode, same interface as the scenario: verdicts stream from the team's API (SSE or WebSocket) and on-chain
   proofs are read from AuthorityRegistry (contracts/AuthorityRegistry.sol: DecisionRecorded) with viem. Read-only,
   no private key in the front. Configure in .env.local (never committed):
     NEXT_PUBLIC_AVAGUARD_SSE_URL=http://localhost:8787/events   (or NEXT_PUBLIC_AVAGUARD_WS_URL=ws://...)
     NEXT_PUBLIC_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
     NEXT_PUBLIC_REGISTRY_ADDRESS=0x...                         (the deployed AuthorityRegistry)
     NEXT_PUBLIC_CHAIN=fuji | l1     NEXT_PUBLIC_L1_CHAIN_ID=... (our own L1 only) */
export const liveConfig = {
  sse: process.env.NEXT_PUBLIC_AVAGUARD_SSE_URL,
  ws: process.env.NEXT_PUBLIC_AVAGUARD_WS_URL,
  rpc: process.env.NEXT_PUBLIC_RPC_URL,
  registry: process.env.NEXT_PUBLIC_REGISTRY_ADDRESS as Hex | undefined,
  chain: process.env.NEXT_PUBLIC_CHAIN === "l1" ? "AvaGuard L1" : "Fuji",
  l1ChainId: Number(process.env.NEXT_PUBLIC_L1_CHAIN_ID ?? 0),
};

const decisionRecorded = parseAbiItem("event DecisionRecorded(bytes32 indexed instructionId, address indexed issuer, uint256 amount, uint8 verdict, string reason)");

export type OnchainProof = { instruction_id: string; tx_hash: string; block: number; verdict: number };

/** a TxEvent, a bare verdict, or { verdict, context } as the API sends it */
export function parseMessage(data: unknown): TxEvent | null {
  const d = data as { verdict?: unknown; context?: VerdictContext; tx_id?: string; decision?: string };
  if (d && typeof d === "object" && typeof d.tx_id === "string" && typeof d.decision === "string") return { ...(d as TxEvent), source: "live" };
  if (d && typeof d === "object" && isVerdict(d.verdict)) return verdictToTx(d.verdict, d.context);
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
        : defineChain({ id: liveConfig.l1ChainId, name: "AvaGuard L1", nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 }, rpcUrls: { default: { http: [liveConfig.rpc] } } });
    const client = createPublicClient({ chain, transport: http(liveConfig.rpc) });
    stops.push(
      client.watchEvent({
        address: liveConfig.registry,
        event: decisionRecorded,
        onLogs: (logs) => logs.forEach((l) => onProof({ instruction_id: l.args.instructionId ?? "0x", tx_hash: l.transactionHash ?? "0x", block: Number(l.blockNumber ?? 0n), verdict: Number(l.args.verdict ?? 0) })),
      }),
    );
  }
  return () => stops.forEach((s) => s());
}
