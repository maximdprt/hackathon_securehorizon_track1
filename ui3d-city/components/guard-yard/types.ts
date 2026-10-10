/** what the Guard Yard shows of one transaction (prompt section 14.4) */
export type GuardVerdict = {
  txId: string;
  decision: "allow" | "human" | "block";
  /** 0..100 */
  score: number;
  thresholds: { allow: number; block: number };
  criteria: { label: string; value: number }[];
  /** three short reasons */
  reasons: string[];
  latencyMs: number;
  proofBlock?: number;
  incidentId?: string;
  /** always truncated */
  beneficiary: string;
  amount: { value: number; asset: string };
  /** the call framed in red on the X-ray */
  flaggedCall?: string;
};

export type GuardMode = "all" | "scan" | "crush";
