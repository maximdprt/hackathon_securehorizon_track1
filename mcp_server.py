"""guard: MCP server that sits in front of every agent payment.

Run:  set -a; source .env; set +a; .venv/bin/python mcp_server.py
Env:  GUARD_LLM=off to skip Claude, GUARD_CONTRACT_ADDRESS + AVAX_RPC_URL (+ GUARD_OWNER_KEY) for Fuji.
      GUARD_APPROVER_TOKEN: the secret a human's interface presents to settle a pending decision or lift a flag.
      An agent calls verify_payment on this same server: without the token it cannot approve its own order.
"""
from __future__ import annotations

import hmac
import logging
import os
from typing import Any

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

from guard.engine import Engine

logging.basicConfig(level=logging.INFO, filename="mcp_server.log")
log = logging.getLogger("guard.mcp")
mcp = MCPServer("guard")
engine = Engine.from_env()
APPROVER_TOKEN = os.environ.get("GUARD_APPROVER_TOKEN", "")
if not APPROVER_TOKEN:
    log.warning("GUARD_APPROVER_TOKEN is not set: any caller of this server, an agent included, can settle a pending decision")


def _human(token: str) -> None:
    """The tools below are a human's. When the server holds a token, the caller must present it."""
    if APPROVER_TOKEN and not hmac.compare_digest(str(token).encode(), APPROVER_TOKEN.encode()):
        raise ToolError("not authorized: this tool belongs to the human approver, the approver token is missing or wrong")


@mcp.tool()
def verify_payment(order: dict[str, Any], source_context: str = "", context_type: str = "text",
                   task: str = "", context: dict[str, Any] | None = None) -> dict[str, Any]:
    """Call BEFORE executing any payment. Returns allow / needs_approval / block with cited evidence.

    order: {issuer, action (pay|approve|transfer|swap), amount, currency, recipient, calldata?, nonce?, memo?}
    source_context: the raw content the order came from (HTML page, email, document, tool output).
    context_type: text | html | email | tool_output.
    task: what the agent believes it was asked to do (free text).
    context: optional facts the agent knows: origin, signed, relayed_by (the agent or agents the order came through),
             merchant{domain, price, market_price, payment_methods, checkout_domain, is_ad, redirect_final_domain},
             x402{quote_amount, facilitator, nonce}, tools[{name, description, pinned_hash}],
             history{avg_amount, payments_last_hour, prior_purchase, balance}, email{from_display, from_address, reply_to}.
    The mandate is resolved server-side from the issuer: the agent cannot declare its own permissions. What the guard knows
    by itself (its domain and address registry, its own journal of payments) wins over what the agent declares.
    After a human approved a held order, send the exact same order again: it passes once.
    """
    try:
        return engine.verify({"order": order, "source_context": source_context, "context_type": context_type,
                              "task": task, "context": context or {}})
    except ValueError as e:  # malformed order (missing field, wrong type): the caller's mistake, reported verbatim, never a verdict
        raise ToolError(f"invalid request: {e}") from e


@mcp.tool()
def get_decision(instruction_id: str) -> dict[str, Any]:
    """The recorded decision for one order: verdict, trust score, every deduction and its evidence. For audit."""
    found = engine.decision(instruction_id)
    if found is None:
        raise ToolError(f"no decision recorded for {instruction_id}")
    return found


@mcp.tool()
def list_pending() -> list[dict[str, Any]]:
    """Decisions waiting for a human (verdict needs_approval)."""
    return engine.pending()


@mcp.tool()
def approve_pending(instruction_id: str, decision: str, approver: str, note: str = "", token: str = "") -> dict[str, Any]:
    """A human settles a pending decision. Recorded in the audit trail. Needs the approver token.

    decision: allow (the same order, sent again, passes once) | decline (not this payment, nothing held against the recipient)
              | block (this is a fraud: the recipient is refused from now on).
    """
    _human(token)
    try:
        return engine.approve(instruction_id, decision, approver, note)
    except (ValueError, KeyError) as e:
        raise ToolError(f"cannot settle: {e}") from e


@mcp.tool()
def lift_flag(subject: str, approver: str, note: str = "", token: str = "") -> dict[str, Any]:
    """A human takes an address or a domain out of the incident registry (a flag raised by mistake). Needs the approver token."""
    _human(token)
    return engine.lift_flag(subject, approver, note)


if __name__ == "__main__":
    mcp.run()
