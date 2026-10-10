# Defense Sheet (1 page) — Authority-Chain Firewall for Agentic Payments

**Team 2 — Track 01 Fintech Security — ESSECKATHON Secure Horizons**

## Threat scenario addressed
An autonomous financial AI agent is driven to execute an unauthorized payment. A low-privilege agent (or a poisoned document / tool output) issues a payment order that the financial agent acts on, with no verification of **who is allowed to give the order**. Result: funds drained to an attacker. We insert the missing **authority-chain check** between the agent's decision and the payment: verify issuer authority (on-chain), score the order for injection (AI), then allow / block / escalate to human, and log the incident on-chain.

## NIST CSF 2.0 functions covered
- **GOVERN** — payment authority policy; accountability model (who is responsible when the model is wrong = human co-sign on severe + on-chain audit trail).
- **IDENTIFY** — map which agent/issuer may order which action and up to what amount (the authority chain).
- **PROTECT** — least-privilege authority, enforcement before the pay tool, human-in-the-loop approval (Step Functions).
- **DETECT** — AI judge (poisoned/unauthorized order) + on-chain flag lookup.
- **RESPOND** — block / escalate, incident recorded on-chain, DORA-style incident report.
- **RECOVER** — revocable flags (due process), tamper-evident audit trail, dispute path.

## ATT&CK / ATLAS / OWASP addressed
- **OWASP Agentic Security (ASI)**: **ASI03 Privilege Compromise**, **ASI07 Agent/Tool Misuse** (cited by the organizers).
- **OWASP LLM Top 10 (2025)**: **LLM01 Prompt Injection** (indirect, via source doc/tool output), **LLM06/LLM08 Excessive Agency**.
- **MITRE ATLAS**: **LLM Prompt Injection — Indirect** (AML.T0051.001, to verify) + LLM-enabled agent manipulation.
- **MITRE ATT&CK** (loose): abuse of legitimate automation / valid access to move funds.

## Metrics achieved (fill from the test harness)
| Metric | Target | Achieved |
|---|---|---|
| Detection rate (poisoned/unauthorized orders blocked) | > 95% on fixture set | ___ / ___ |
| False-positive rate (legit orders wrongly blocked) | 0 on legit fixtures | ___ / ___ |
| Time to detect (guard verdict latency) | < 5 s | ___ s |
| Time to respond (block + on-chain incident record) | < 10 s | ___ s |

> Source: `detection/` fixture set (N poisoned + M legit orders), measured live on Bedrock + Fuji.

## Known limitations (honest)
- The AI judge is non-deterministic; mitigated by the **deterministic on-chain authority check** as the hard gate (unauthorized issuer/amount is blocked regardless of the LLM).
- MCP is advisory unless the pay tool is hard-wrapped; we demonstrate the **hard gate** (payment cannot execute without passing the check).
- A novel injection could evade the judge; the authority + flag checks still block unauthorized orders.
- Human co-signer centralizes trust (v2: decentralize the approver set).
- Demo uses synthetic data + canary flags (event rules); real-world validation is roadmap.
