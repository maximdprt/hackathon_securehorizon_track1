"""The guarded wallet as an MCP server: its tools are listed, and a block is a normal result, never an MCP error."""
from __future__ import annotations

import asyncio
import os
import shlex
import sys

from mcp import Client, ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from conftest import FAKE, read_log
from secure_agent_starter.agent import GuardedWallet
from secure_agent_starter.wallet_mcp import build_server
from secure_agent_starter.world import World

TOOLS = {"search", "research", "open_page", "call_api", "pay", "pay_x402"}


def _sc(res) -> dict:
    sc = res.structured_content
    return sc["result"] if isinstance(sc, dict) and set(sc) == {"result"} else sc


def test_tools_are_listed_in_process():
    world = World.load()
    try:
        server = build_server(GuardedWallet(world, None))

        async def go():
            async with Client(server) as c:
                tools = (await c.list_tools()).tools
                res = await c.call_tool("search", {"query": "yield"})
                return {t.name for t in tools}, _sc(res)

        names, found = asyncio.run(go())
    finally:
        world.close()
    assert TOOLS <= names
    assert {r.get("id") for r in found["results"]} >= {"stableharbor", "novayield", "hyperyield"}


def test_stdio_wallet_blocks_the_scam_as_a_normal_result(fake_log):
    env = {**{k: v for k, v in os.environ.items() if k in ("PATH", "HOME")},
           "SENTINEL_GUARD_COMMAND": shlex.join([sys.executable, str(FAKE), "--log", str(fake_log)])}
    params = StdioServerParameters(command=sys.executable, args=["-m", "secure_agent_starter", "wallet-mcp", "--offline"], env=env)

    async def go():
        async with stdio_client(params) as (read, write), ClientSession(read, write) as s:
            await s.initialize()
            names = {t.name for t in (await s.list_tools()).tools}
            page = await s.call_tool("open_page", {"url": "https://zentromart-deals-shop.example/"})
            pay = await s.call_tool("pay", {"amount": 500, "recipient": "0xBADc0ffee0000000000000000000000000000000"})
            ok = await s.call_tool("pay", {"amount": 429, "recipient": "0x5e11e40000000000000000000000000000000002"})
            return names, page, pay, ok

    names, page, pay, ok = asyncio.run(go())
    assert TOOLS <= names
    assert not page.is_error and _sc(page)["status"] == 200
    assert not pay.is_error and _sc(pay)["status"] == "refused" and _sc(pay)["guard"] == "block"
    # no page names this recipient as its source: the guard still gets the latest page read, and judges it
    assert not ok.is_error and _sc(ok)["guard"] in ("allow", "needs_approval", "block")
    calls = read_log(fake_log)
    assert calls[0]["tool"] == "screen_payment" and calls[0]["env"]["SENTINEL_MODE"] == "local"
