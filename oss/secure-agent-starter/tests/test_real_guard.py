"""The same scenarios against the real guard (`python -m sentinel_guard`, offline, the starter's operator config).
Skipped when sentinel-guard is not installed. Nothing here calls the hosted API: connected mode is pointed at a closed
local port to check that a network failure keeps the local verdict."""
from __future__ import annotations

from importlib.util import find_spec

import pytest

from conftest import CASES
from secure_agent_starter.agent import run_scenario
from secure_agent_starter.guard import McpGuard
from secure_agent_starter.scripted import ScriptedLLM
from secure_agent_starter.world import load_scenario

pytestmark = pytest.mark.skipif(find_spec("sentinel_guard") is None, reason="sentinel-guard is not installed in this environment")


@pytest.mark.parametrize("scenario,variant", CASES)
def test_real_guard_gives_the_expected_verdict(scenario, variant):
    expected = load_scenario(scenario)["variants"][variant]["expect"]["verdict"]
    g = McpGuard(connected=False, timeout=60)
    try:
        res = run_scenario(scenario, variant, ScriptedLLM(), g)
    finally:
        g.close()
    assert res.verdicts == [expected], [p["result"] for p in res.payments]
    assert set(g.tools) >= {"screen_payment", "authorize_payment", "explain_decision"}


def test_real_guard_connected_but_unreachable_keeps_the_local_verdict():
    g = McpGuard(connected=True, timeout=60, environ={"SENTINEL_API": "http://127.0.0.1:9"})
    try:
        res = run_scenario("shopping", "scam", ScriptedLLM(), g)
    finally:
        g.close()
    out = res.payments[0]["result"]
    assert res.verdicts == ["block"] and out["status"] == "refused"
    assert out["onchain"] in ("error", "skipped")
