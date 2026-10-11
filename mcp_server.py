"""guard: MCP server that sits in front of every agent payment.

Run:  set -a; source .env; set +a; .venv/bin/python mcp_server.py
Env:  GUARD_LLM=off to skip Claude, GUARD_CONTRACT_ADDRESS + AVAX_RPC_URL (+ GUARD_OWNER_KEY) for Fuji.
"""
from __future__ import annotations

import logging
from typing import Any

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

from guard.engine import Engine

logging.basicConfig(level=logging.INFO, filename="mcp_server.log")
mcp = MCPServer("guard")
engine = Engine.from_env()


@mcp.tool()
def verify_payment(order: dict[str, Any], source_context: str = "", context_type: str = "text",
                   task: str = "", context: dict[str, Any] | None = None) -> dict[str, Any]:
    """Call BEFORE executing any payment. Returns allow / needs_approval / block with cited evidence.

    order: {issuer, action (pay|approve|transfer|swap), amount, currency, recipient, calldata?, nonce?, memo?}
    source_context: the raw content the order came from (HTML page, email, document, tool output).
    context_type: text | html | email | tool_output.
    task: what the agent believes it was asked to do (free text).
    context: optional facts the agent knows: origin, signed, merchant{domain, price, market_price, payment_methods,
             checkout_domain, is_ad, redirect_final_domain}, x402{quote_amount, facilitator, nonce}, tools[{name, description,
             pinned_hash}], history{avg_amount, payments_last_hour, prior_purchase, balance}, email{from_display, from_address, reply_to}.
    The mandate is resolved server-side from the issuer: the agent cannot declare its own permissions.
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
def approve_pending(instruction_id: str, decision: str, approver: str, note: str = "") -> dict[str, Any]:
    """A human settles a pending decision. decision: allow | block. Recorded in the audit trail."""
    try:
        return engine.approve(instruction_id, decision, approver, note)
    except (ValueError, KeyError) as e:
        raise ToolError(f"cannot settle: {e}") from e


if __name__ == "__main__":
    mcp.run()
