"""A stand-in for `python -m sentinel_guard` in tests: same MCP tools and result shape, a few transparent rules.

It proves the plumbing, not the detection: the rules only fire if the wallet forwards what it must (the raw page
source with its hidden CSS, the observed domain age, the x402 quote). Every call is appended to the file given by --log (or $FAKE_GUARD_LOG).
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from typing import Any

from mcp.server.mcpserver import MCPServer

LOG = sys.argv[sys.argv.index("--log") + 1] if "--log" in sys.argv else os.environ.get("FAKE_GUARD_LOG", "")
ENV_KEYS = ("SENTINEL_MODE", "SENTINEL_API", "SENTINEL_API_KEY", "SENTINEL_CONFIG_DIR", "SENTINEL_STATE_DIR", "SENTINEL_LLM")
HIDDEN = re.compile(r"left:\s*-9999px|font-size:\s*0", re.I)
mcp = MCPServer("sentinel-guard")


def _log(entry: dict) -> None:
    if LOG:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, default=str) + "\n")


def _decide(amount: float, source_context: str, context: dict) -> tuple[str, str]:
    x = context.get("x402") or {}
    if x.get("quote_amount") is not None and amount > float(x["quote_amount"]) * 1.01:
        return "block", f"[transaction] amount_matches_402_quote (-100): order amount {amount} exceeds the 402 quote {x['quote_amount']}"
    if HIDDEN.search(source_context or ""):
        return "block", "[content] imperative_to_agent (-100): instruction to the agent in hidden content"
    age = (context.get("merchant") or {}).get("domain_age_days")
    if age is not None and age < 30:
        return "needs_approval", f"[counterparty] domain_age_days (-30): domain registered {age} days ago"
    return "allow", "[engine] no finding"


def _verdict(tool: str, issuer: str, recipient: str, amount: float, currency: str, source_context: str, action: str,
             task: str, context_type: str, context: dict | None, mandate: dict | None) -> dict:
    if "--crash" in sys.argv:  # tests: the guard dies in the middle of a call
        os._exit(3)
    ctx = context or {}
    verdict, reason = _decide(float(amount), source_context, ctx)
    args = {"issuer": issuer, "recipient": recipient, "amount": amount, "currency": currency, "action": action, "task": task,
            "context_type": context_type, "context": ctx, "mandate": mandate, "source_len": len(source_context or ""),
            "hidden_css": bool(HIDDEN.search(source_context or ""))}
    _log({"tool": tool, "args": args, "env": {k: os.environ.get(k) for k in ENV_KEYS}})
    iid = "0x" + hashlib.sha256(json.dumps([issuer, recipient, amount, action], default=str).encode()).hexdigest()
    return {"instruction_id": iid, "issuer": issuer.lower(), "action": action, "amount": float(amount), "currency": currency,
            "recipient": recipient.lower(), "verdict": verdict, "risk_score": {"allow": 0.05, "needs_approval": 0.5, "block": 1.0}[verdict],
            "reasons": [reason], "owasp": ["ASI03"] if verdict != "allow" else [],
            "authority_check": {"authorized": True, "within_limit": True, "source": "local"},
            "poison_check": {"is_poisoned": verdict == "block", "confidence": 1.0 if verdict == "block" else 0.0, "evidence": []},
            "onchain_flagged": False, "timestamp": datetime.now(timezone.utc).isoformat()}


@mcp.tool()
def screen_payment(issuer: str, recipient: str, amount: float, currency: str = "USDC", source_context: str = "",
                   mandate: dict[str, Any] | None = None, action: str = "pay", task: str = "", context_type: str = "text",
                   context: dict[str, Any] | None = None) -> dict[str, Any]:
    """Screen a payment intent (fake)."""
    return _verdict("screen_payment", issuer, recipient, amount, currency, source_context, action, task, context_type, context, mandate)


@mcp.tool()
def authorize_payment(issuer: str, recipient: str, amount: float, currency: str = "USDC", source_context: str = "",
                      mandate: dict[str, Any] | None = None, action: str = "pay", task: str = "", context_type: str = "text",
                      context: dict[str, Any] | None = None, ttl: int = 300) -> dict[str, Any]:
    """Screen, then record the decision (fake: nothing leaves the machine)."""
    v = _verdict("authorize_payment", issuer, recipient, amount, currency, source_context, action, task, context_type, context, mandate)
    tx = "0x" + hashlib.sha256(v["instruction_id"].encode()).hexdigest()
    api = {"allow": "allow", "needs_approval": "needs_human", "block": "block"}[v["verdict"]]
    v.update({"tx_hash": tx, "explorer_url": f"https://explorer.petroi.fr/tx/{tx}",
              "onchain": {"status": "recorded", "verdict": api, "payment_id": "0x" + "ab" * 32, "nonce": 1, "decision_tx": tx,
                          "visa_tx": tx if api == "allow" else None, "flag_tx": tx if api == "block" else None,
                          "rescreened": False, "server_verdict": None, "error": None}})
    return v


if __name__ == "__main__":
    print("fake guard ready", file=sys.stderr)
    mcp.run()
