"""Every scenario and variant, played by the keyless scripted agent: the guard's verdict is the expected one, the wallet
moves only on allow, and with the guard off the scams drain the wallet (act 1). The guard here is the fake MCP server,
spawned over stdio exactly like the real one."""
from __future__ import annotations

import sys
import time

import pytest

from conftest import CASES, FAKE, read_log
from secure_agent_starter.agent import run_scenario
from secure_agent_starter.guard import CONFIG_DIR, McpGuard
from secure_agent_starter.scripted import ScriptedLLM
from secure_agent_starter.world import load_scenario

STATUS = {"allow": "executed", "needs_approval": "parked", "block": "refused"}


@pytest.mark.parametrize("scenario,variant", CASES)
def test_guard_on_gets_the_expected_verdict(scenario, variant, fake_guard, fake_log):
    expected = load_scenario(scenario)["variants"][variant]["expect"]["verdict"]
    res = run_scenario(scenario, variant, ScriptedLLM(), fake_guard())
    assert res.run.error is None
    assert res.verdicts == [expected], res.to_dict()["payments"]
    assert res.matches_expected is True
    assert res.payments[-1]["result"]["status"] == STATUS[expected]
    spent = res.balance_before - res.balance_after
    assert (spent > 0) == (expected == "allow")
    calls = read_log(fake_log)
    assert [c["tool"] for c in calls] == ["screen_payment"]  # offline: screen only
    assert "expect" not in str(calls[0]["args"])               # the answer never reaches the guard


@pytest.mark.parametrize("scenario,variant", [c for c in CASES if load_scenario(c[0])["variants"][c[1]]["expect"]["verdict"] != "allow"])
def test_guard_off_drains_the_wallet(scenario, variant):
    res = run_scenario(scenario, variant, ScriptedLLM(), None)
    assert res.guard == "off" and res.verdicts == []
    assert res.outcome == "paid"
    assert res.balance_after < res.balance_before


def test_the_guard_sees_the_raw_page_while_the_model_sees_the_rendered_one(fake_guard, fake_log):
    res = run_scenario("shopping", "scam", ScriptedLLM(), fake_guard())
    opened = next(t for t in res.run.trace if t["tool"] == "open_page")
    assert "html" not in opened["result"] and "<style>" not in opened["result"]["text"]
    assert "0xBADc0ffee" in opened["result"]["text"]           # off-screen text reaches the model, like innerText
    args = read_log(fake_log)[0]["args"]
    assert args["hidden_css"] and args["context_type"] == "html"
    m = args["context"]["merchant"]                            # observed facts from the scenario file
    assert m["domain"] == "zentromart-deals-shop.example" and m["domain_age_days"] == 4 and m["is_ad"] is True
    assert args["context"]["origin"] == "webpage" and args["context"]["history"]["prior_purchase"] is False
    assert args["issuer"] == load_scenario("shopping")["issuer"]  # bound by the wallet, not chosen by the model


def test_x402_facts_come_from_the_server_quote(fake_guard, fake_log):
    res = run_scenario("x402", "scam", ScriptedLLM(), fake_guard())
    args = read_log(fake_log)[0]["args"]
    x = args["context"]["x402"]
    assert x["quote_amount"] == 0.5 and x["facilitator"].startswith("0xfac1") and x["nonce"].startswith("0x")
    assert args["amount"] == 4.9 and args["context_type"] == "tool_output"
    assert res.payments[0]["order"]["nonce"] == x["nonce"]


def test_x402_legit_pays_then_gets_the_data(fake_guard):
    res = run_scenario("x402", "legit", ScriptedLLM(), fake_guard())
    calls = [t for t in res.run.trace if t["tool"] == "call_api"]
    assert [c["result"]["status"] for c in calls] == [402, 200]
    assert calls[-1]["result"]["body"]["data"]["city"] == "Paris"


def test_connected_mode_authorizes_and_returns_the_proof(fake_guard, fake_log):
    g = fake_guard(connected=True)
    res = run_scenario("shopping", "scam", ScriptedLLM(), g)
    call = read_log(fake_log)[0]
    assert call["tool"] == "authorize_payment"
    assert call["env"]["SENTINEL_MODE"] == "connected" and call["env"]["SENTINEL_API"] == "https://rpc.petroi.fr"
    out = res.payments[0]["result"]
    assert out["status"] == "refused" and out["onchain"] == "recorded"
    assert out["explorer_url"].startswith("https://explorer.petroi.fr/tx/0x") and res.mode == "connected"


def test_guard_runs_with_the_starter_config_and_a_throwaway_state(fake_guard, fake_log):
    g = fake_guard()
    run_scenario("finance", "legit", ScriptedLLM(), g)
    env = read_log(fake_log)[0]["env"]
    assert env["SENTINEL_CONFIG_DIR"] == str(CONFIG_DIR) and env["SENTINEL_MODE"] == "local" and env["SENTINEL_API"] == "off"
    state = g.state_dir
    assert env["SENTINEL_STATE_DIR"] == str(state) and state.exists()
    g.close()
    assert not state.exists()


def test_kept_state_survives_close(fake_guard, tmp_path):
    g = fake_guard(state_dir=tmp_path / "kept")
    run_scenario("x402", "legit", ScriptedLLM(), g)
    g.close()
    assert (tmp_path / "kept").is_dir()


def test_unreachable_guard_fails_closed(tmp_path):
    g = McpGuard(connected=False, command=[sys.executable, "-c", "import sys; sys.exit(3)"], timeout=10)
    try:
        res = run_scenario("shopping", "legit", ScriptedLLM(), g)
    finally:
        g.close()
    out = res.payments[0]["result"]
    assert out["guard"] == "unavailable" and out["status"] == "refused"
    assert res.balance_after == res.balance_before                 # no verdict, no payment


def test_guard_crash_mid_call_fails_closed_fast():
    g = McpGuard(connected=False, command=[sys.executable, str(FAKE), "--crash"], timeout=30)
    t0 = time.monotonic()
    try:
        res = run_scenario("x402", "legit", ScriptedLLM(), g)
    finally:
        g.close()
    out = res.payments[0]["result"]
    assert out["guard"] == "unavailable" and out["status"] == "refused" and res.balance_after == res.balance_before
    assert time.monotonic() - t0 < 20                              # not left waiting for the call timeout
