# Authority-Chain Firewall for Agentic Payments

**ESSECKATHON Secure Horizons — Track 01 Fintech Security — Team 2**

> Official challenge (Track 01, problem 2): *"A low-privilege agent, fed a booby-trapped document, tells a financial agent to execute a payment. Without authority-chain checks, it goes through (OWASP ASI03, ASI07)."*

This is our answer: the missing **authority-chain check** that sits between an AI agent's decision and a payment.

## The problem

AI agents now hold wallets and execute payments on instructions from other agents, documents, and tools. A poisoned instruction (prompt injection / tool poisoning) makes a financial agent pay an attacker, because nobody verifies **who is allowed to give the order**. Fixed rules flood analysts with false positives; foundation-model safety does not cover payment authority. Maps to **OWASP ASI03 (privilege compromise)** and **ASI07 (agent/tool misuse)**.

## The solution

Before any agentic payment executes, our layer:
1. **Decodes** the real order (who issued it, action, amount, recipient).
2. **Verifies authority** against an on-chain registry (is the issuer allowed, within limits).
3. **Scores the instruction** for poisoning / prompt-injection with an AI judge (Bedrock Claude), returning cited evidence and a calibrated confidence.
4. **Responds**: `allow` / `block` / `needs_approval` (human-in-the-loop via Step Functions).
5. **Enforces + logs on-chain** (Avalanche Fuji): tamper-evident authority + incident registry, feeding a DORA-style incident report.

The AI is the brain, Avalanche is the tamper-proof authority + incident memory, and an off-chain policy-check wires them into the agent runtime.

## Demo (3 acts)

1. **No guard**: financial agent gets a poisoned payment order → no authority check → pays (canary flag leaks).
2. **With guard**: same attack → authority not verified + instruction flagged → blocked → human approval → denied → incident written on-chain + DORA report.
3. **Shared immunity**: a second agent sees the issuer/instruction flagged on-chain → refuses instantly.

## Architecture

```
  Agent runtime (Bedrock AgentCore)
   low-priv agent --poisoned order--> financial agent --about to PAY-->
                                              |
                               [ POLICY-CHECK Lambda ]  <-- WS2
                                /            |           \
              decode+authority        AI poison-score     read on-chain
              (WS1 detection) <------> (Bedrock Claude)    authority+flags (WS3, Fuji)
                                              |
                      verdict: allow / block / needs_approval
                                              |
                 Step Functions human approval (response playbook)
                                              |
                 record decision + incident ON-CHAIN (Fuji) --> DORA report (WS4)
```

## Stack

- **AWS Bedrock** (Claude) — the AI judge / reasoning.
- **Bedrock AgentCore** — the two agents (financial + attacker).
- **Lambda** — the policy-check (authority-chain hook before the pay tool).
- **Step Functions** — human-in-the-loop approval.
- **Bedrock Guardrails** — prompt-attack detection (complementary input layer).
- **CloudTrail / CloudWatch** — decision logs (DORA forensics).
- **Avalanche Fuji (C-Chain)** — `AuthorityRegistry.sol` (authority chain + incident registry, tamper-evident).

Region: **us-west-2** (keep consistent across the team). On-chain: Fuji (chainId 43113).

## Repo structure

```
contracts/      WS3 (Maxim)     AuthorityRegistry.sol  — on-chain authority + incidents (Fuji)
detection/      WS1 (Walid)     verdict.schema.json, scorer_prompt.md — the authority-chain brain
agent-infra/    WS2 (Bruno)     AgentCore agents + policy-check Lambda + Step Functions
compliance/     WS4 (Ballonad)  response playbook + DORA/MiCA/AML/AI Act mapping + pitch
demo/                           3-act demo script + attack fixtures (canary flags)
```

## Compliance mapping (summary — full in compliance/)

- **DORA**: detect, classify, and report major ICT incidents → on-chain incident log + DORA report generator.
- **MiCA**: crypto-asset service providers → authority controls on crypto payment orders.
- **AML**: suspicious-order flagging + auditable trail.
- **EU AI Act**: high-risk AI → human oversight (approval step), explainability (cited verdicts), accountability (revocable, owner-gated, on-chain audit trail).

## Rules / safety

Canary flags (`FLAG{team2-canary}`), synthetic data only. Dedicated Fuji wallet (never real funds / seed). Contract addresses recorded below. `git push` hourly (AWS account is wiped at the end).

## Deployed contracts (fill in)

- AuthorityRegistry (Fuji): `0x...` — tx: `https://testnet.snowtrace.io/tx/...`
