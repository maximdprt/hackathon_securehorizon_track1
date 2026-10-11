"""`secure-agent wallet-mcp`: the guarded wallet and the scenario world as an MCP stdio server, for any MCP agent
(the real Hermes Agent, Claude Code, Cursor...).

The guard stays INSIDE pay and pay_x402: it applies even if the host LLM never calls a screening tool. Every outcome,
a block included, is a normal tool result (never an MCP error): hosts like Hermes trip a circuit breaker after three
errors and would then disable the whole server. Logs go to stderr; stdout belongs to the protocol.
"""
from __future__ import annotations

import logging
import sys
from typing import Any

from mcp.server.mcpserver import MCPServer

from secure_agent_starter.agent import GuardedWallet
from secure_agent_starter.guard import Guard
from secure_agent_starter.world import World

INSTRUCTIONS = ("A sandbox wallet with a simulated USDC balance and a small world to act in: web stores (open_page), "
                "investment research sheets (search, research) and a paid x402 API (call_api). pay and pay_x402 move "
                "money; each payment is checked by the Sentinel guard before the wallet signs, and the result says "
                "whether it was executed, parked for a human approver, or refused.")


def build_server(wallet: GuardedWallet) -> MCPServer:
    mcp = MCPServer("secure-agent-wallet", instructions=INSTRUCTIONS)

    @mcp.tool()
    def search(query: str) -> dict[str, Any]:
        """Search the sandbox catalog of web stores and investment opportunities. Returns names, snippets, urls or asset ids."""
        return wallet.search(query)

    @mcp.tool()
    def research(asset: str) -> dict[str, Any]:
        """Read the research sheet of an investment opportunity (yield, deposit address, audit, domain), by asset id."""
        return wallet.research(asset)

    @mcp.tool()
    def open_page(url: str) -> dict[str, Any]:
        """Open a sandbox web page as a browser would: rendered text, links, buttons, form fields."""
        return wallet.open_page(url)

    @mcp.tool()
    def call_api(resource: str) -> dict[str, Any]:
        """Call a paid API resource such as /weather. Status 402 means the body carries an x402 payment quote."""
        return wallet.call_api(resource)

    @mcp.tool()
    def pay(amount: float, recipient: str, action: str = "pay", currency: str = "USDC", item: str = "", asset: str = "",
            memo: str = "") -> dict[str, Any]:
        """Pay, transfer or approve USDC from the sandbox wallet to a 0x address. The result reports the guard decision
        (allow, needs_approval, block) and whether the wallet executed, parked or refused the payment."""
        return wallet.pay(amount, recipient, action=action, currency=currency, item=item, asset=asset, memo=memo)

    @mcp.tool()
    def pay_x402(resource: str, amount: float) -> dict[str, Any]:
        """Settle the x402 quote last received for a resource. Recipient, nonce and facilitator come from the quote;
        you set the amount. Call call_api again afterwards to get the data."""
        return wallet.pay_x402(resource, amount)

    @mcp.tool()
    def wallet_status() -> dict[str, Any]:
        """Balances of the sandbox wallets and the payments attempted so far, with their outcome."""
        return {"wallets": {sid: {"address": w.address, "balance": round(w.balance, 6), "currency": w.currency}
                            for sid, w in wallet.wallets.items()},
                "payments": [{"order": p["order"], "status": p["result"].get("status"), "guard": p["result"].get("guard")}
                             for p in wallet.payments]}

    return mcp


def serve(scenarios: list[str] | None, guard: Guard | None) -> None:
    logging.basicConfig(stream=sys.stderr, level=logging.WARNING)
    world = World.load(scenarios)
    wallet = GuardedWallet(world, guard, task="", default_scenario=(scenarios or ["shopping"])[0])
    try:
        build_server(wallet).run()  # stdio
    finally:
        world.close()
        if guard is not None:
            guard.close()
