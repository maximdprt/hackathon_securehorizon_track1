import type { GuardVerdict } from "./types";

/** the reference's values, fictive: tx_0042, the poisoned invoice */
export const DEMO_VERDICT: GuardVerdict = {
  txId: "tx_0042",
  decision: "block",
  score: 92,
  thresholds: { allow: 40, block: 70 },
  criteria: [
    { label: "Autorité", value: 95 },
    { label: "Bénéficiaire", value: 88 },
    { label: "Mandat", value: 70 },
    { label: "Intention IA", value: 97 },
    { label: "Contrat", value: 40 },
  ],
  reasons: ["L'ordre vient de la facture, pas de l'humain.", "Instruction cachée dans facture_oct.pdf.", "Bénéficiaire jamais vu, domaine de 2 jours."],
  latencyMs: 1800,
  proofBlock: 18342,
  incidentId: "INC-2026-0042",
  beneficiary: "0xBad1…7e3A",
  amount: { value: 4800, asset: "USDC" },
  flaggedCall: "transfer() → 0xBad1…",
};
