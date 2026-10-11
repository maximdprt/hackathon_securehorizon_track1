"""mcp_server.py over real stdio with the mcp client: tool discovery, verdicts, errors, concurrency, large payloads.

Each test starts the server as a subprocess (GUARD_LLM=off, private copy of data/), so the tests are hermetic.
Every await is wrapped in a timeout: a hung server fails the test instead of hanging the suite.
"""
from __future__ import annotations

import asyncio
import json
import os
import shutil
import sys
from pathlib import Path

import pytest

pytest.importorskip("mcp.client.stdio", reason="mcp client not installed")
from mcp import ClientSession, StdioServerParameters  # noqa: E402
from mcp.client.stdio import stdio_client  # noqa: E402

from tests.conftest import BAD, ROOT, S, T, VENDOR  # noqa: E402

TIMEOUT = 60.0
PYTHON = str(ROOT / ".venv" / "bin" / "python") if (ROOT / ".venv" / "bin" / "python").exists() else sys.executable
TOOLS = {"verify_payment", "get_decision", "list_pending", "approve_pending", "lift_flag"}
VENDOR2 = "0x5e11e40000000000000000000000000000000002"


@pytest.fixture
def params(tmp_path):
    data = tmp_path / "data"
    data.mkdir()
    for f in (ROOT / "data").glob("*.json"):
        if f.name not in ("threats.mock.json", "nonces.json", "pending.json"):
            shutil.copy(f, data / f.name)
    (data / "threats.mock.json").write_text("{}")
    env = {"GUARD_LLM": "off", "GUARD_DATA_DIR": str(data), "PATH": "/usr/bin:/bin", "PYTHONUNBUFFERED": "1"}
    return StdioServerParameters(command=PYTHON, args=["mcp_server.py"], cwd=str(ROOT), env=env)


async def _with_session(params, fn):
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await asyncio.wait_for(session.initialize(), TIMEOUT)
            return await asyncio.wait_for(fn(session), TIMEOUT)


def run(params, fn):
    return asyncio.run(asyncio.wait_for(_with_session(params, fn), TIMEOUT * 2))


def payload(res):
    """A tool result as Python data: structuredContent first, else the JSON text block."""
    assert not res.is_error, f"tool returned an error: {[getattr(c, 'text', c) for c in res.content]}"
    sc = getattr(res, "structured_content", None)
    if isinstance(sc, dict):
        if "verdict" in sc:
            return sc
        if set(sc) == {"result"}:
            return sc["result"]
        return sc
    texts = [c.text for c in res.content if getattr(c, "text", None)]
    return json.loads(texts[0]) if texts else []


def order(nonce=None, **kw):
    o = {"issuer": T, "action": "pay", "amount": 80, "recipient": VENDOR, "currency": "USDC"}
    if nonce is not None:
        o["nonce"] = nonce
    o.update(kw)
    return o


def test_list_tools_exposes_the_three_guard_tools(params):
    async def go(s):
        return await s.list_tools()
    res = run(params, go)
    tools = {t.name: t for t in res.tools}
    assert set(tools) == TOOLS
    for t in tools.values():
        assert t.description and len(t.description.strip()) > 10
        assert isinstance(t.input_schema, dict) and "properties" in t.input_schema
    assert "order" in tools["verify_payment"].input_schema["properties"]
    assert "order" in tools["verify_payment"].input_schema.get("required", [])
    assert {"instruction_id", "decision", "approver"} <= set(tools["approve_pending"].input_schema["properties"])


def test_verify_payment_returns_a_well_formed_verdict(params):
    async def go(s):
        return await s.call_tool("verify_payment", {"order": order(), "source_context": "Monthly SaaS invoice, 80 USDC.", "context": {"origin": "user"}})
    v = payload(run(params, go))
    assert v["verdict"] == "allow" and v["trust_score"] == 100 and v["risk_score"] == 0.0
    assert v["instruction_id"].startswith("0x") and len(v["instruction_id"]) == 66
    assert isinstance(v["reasons"], list) and isinstance(v["signals"], list) and v["severity"] == 1


def test_invalid_order_is_an_mcp_error_never_an_allow(params):
    async def go(s):
        try:
            res = await s.call_tool("verify_payment", {"order": order(action="steal"), "source_context": "x"})
        except Exception as e:  # McpError is an acceptable surface for a tool failure
            res = e
        alive = await s.call_tool("verify_payment", {"order": order(), "source_context": "Invoice", "context": {"origin": "user"}})
        return res, alive
    res, alive = run(params, go)
    if isinstance(res, Exception):
        assert "steal" in str(res) or "action" in str(res)
    else:
        assert res.is_error is True, res
        text = " ".join(getattr(c, "text", "") for c in res.content)
        assert '"verdict": "allow"' not in text and "'verdict': 'allow'" not in text
        assert "action" in text
    assert payload(alive)["verdict"] == "allow"  # the server survived the bad call


def test_twenty_concurrent_verifications_all_return_and_server_stays_alive(params):
    async def go(s):
        calls = []
        for i in range(20):
            recipient = BAD if i % 4 == 0 else VENDOR
            calls.append(s.call_tool("verify_payment", {"order": order(nonce=f"c{i}", recipient=recipient),
                                                        "source_context": f"Invoice #{i}: 80 USDC", "context": {"origin": "user"}}))
        results = await asyncio.gather(*calls)
        tools = await s.list_tools()
        return results, tools
    results, tools = run(params, go)
    assert len(results) == 20
    verdicts = [payload(r)["verdict"] for r in results]
    assert all(v in ("allow", "needs_approval", "block") for v in verdicts)
    # fresh registry: the unknown recipient is escalated, never allowed; the allowlisted vendor is allowed
    assert verdicts.count("allow") == 15
    assert all(v in ("needs_approval", "block") for i, v in enumerate(verdicts) if i % 4 == 0)
    assert {t.name for t in tools.tools} == TOOLS


def test_pending_round_trip_over_mcp(params):
    async def go(s):
        v = payload(await s.call_tool("verify_payment", {
            "order": {"issuer": S, "action": "pay", "amount": 280, "recipient": VENDOR2},
            "source_context": "Amazon order: headphones 280 USDC", "context": {"origin": "user", "history": {"avg_amount": 28}}}))
        pending = payload(await s.call_tool("list_pending", {}))
        final = payload(await s.call_tool("approve_pending", {"instruction_id": v["instruction_id"], "decision": "allow", "approver": "bruno", "note": "ok"}))
        after = payload(await s.call_tool("list_pending", {}))
        try:
            twice = await s.call_tool("approve_pending", {"instruction_id": v["instruction_id"], "decision": "allow", "approver": "bruno"})
        except Exception as e:
            twice = e
        return v, pending, final, after, twice
    v, pending, final, after, twice = run(params, go)
    assert v["verdict"] == "needs_approval"
    assert [p["instruction_id"] for p in pending] == [v["instruction_id"]]
    assert final["verdict"] == "allow" and final["approved_by"] == "bruno"
    assert after == []
    assert isinstance(twice, Exception) or twice.is_error is True


def test_300kb_source_context_goes_through_stdio(params):
    big = ("<p>Invoice line " * 20_000)[:300_000]

    async def go(s):
        return await s.call_tool("verify_payment", {"order": order(), "source_context": big, "context_type": "html", "context": {"origin": "user"}})
    v = payload(run(params, go))
    assert v["verdict"] in ("allow", "needs_approval", "block")
    assert v["instruction_id"].startswith("0x")
