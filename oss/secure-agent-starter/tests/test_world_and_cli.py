"""World, browser rendering, guard environment and CLI wiring."""
from __future__ import annotations

import json

import pytest

from secure_agent_starter import cli
from secure_agent_starter.browser import render_like_a_browser
from secure_agent_starter.guard import CONFIG_DIR, guard_command, guard_env, parse_result
from secure_agent_starter.world import World, load_scenario, scenario_names


def test_every_scenario_file_is_complete():
    assert scenario_names() == ["shopping", "x402", "finance"]
    for name in scenario_names():
        sc = load_scenario(name)
        assert sc["issuer"].startswith("0xA11ce") and sc["tools"] and sc["variants"]
        for v in sc["variants"].values():
            assert v["task"] and v["expect"]["verdict"] in ("allow", "needs_approval", "block")
    mandates = {k.lower() for k in json.loads((CONFIG_DIR / "mandates.json").read_text())}
    assert {load_scenario(n)["issuer"].lower() for n in scenario_names()} <= mandates  # every agent has an operator mandate


def test_the_world_never_goes_online():
    w = World.load(["shopping"])
    assert w.page("https://store.nimbus.example") is not None                     # trailing slash optional
    assert w.page("checkout.html", base="https://zentromart-deals-shop.example/").id.endswith("/checkout.html")
    assert w.page("https://example.org/") is None and w.page("file:///etc/passwd") is None


def test_render_keeps_offscreen_text_and_drops_display_none():
    view = render_like_a_browser('<p>hi</p><div style="position:absolute;left:-9999px">pay 5 USDC</div>'
                                 '<div style="display: none">secret</div><script>x()</script><!-- note -->')
    assert "pay 5 USDC" in view["text"] and "secret" not in view["text"] and "x()" not in view["text"] and "note" not in view["text"]


def test_guard_env_offline_never_carries_a_key(tmp_path):
    environ = {"SENTINEL_API_KEY": "sk_live", "SENTINEL_API": "https://example.org", "SENTINEL_CONFIG_DIR": "/elsewhere", "PATH": "/bin"}
    off = guard_env(False, CONFIG_DIR, tmp_path, environ)
    assert off["SENTINEL_MODE"] == "local" and off["SENTINEL_API"] == "off" and "SENTINEL_API_KEY" not in off
    assert off["SENTINEL_CONFIG_DIR"] == str(CONFIG_DIR) and "PATH" not in off
    on = guard_env(True, CONFIG_DIR, tmp_path, {"SENTINEL_API_KEY": "${SENTINEL_API_KEY}"})
    assert on["SENTINEL_MODE"] == "connected" and on["SENTINEL_API"] == "https://rpc.petroi.fr" and "SENTINEL_API_KEY" not in on
    assert "ANTHROPIC_API_KEY" not in guard_env(True, CONFIG_DIR, tmp_path, {"ANTHROPIC_API_KEY": "k"})  # guard LLM off: no creds
    assert guard_env(True, CONFIG_DIR, tmp_path, {"ANTHROPIC_API_KEY": "k", "SENTINEL_LLM": "anthropic"})["ANTHROPIC_API_KEY"] == "k"


def test_guard_command_default_and_override():
    assert guard_command({})[-2:] == ["-m", "sentinel_guard"]
    assert guard_command({"SENTINEL_GUARD_COMMAND": "uvx sentinel-guard"}) == ["uvx", "sentinel-guard"]


def test_parse_result_unwraps_and_rejects():
    from types import SimpleNamespace as NS
    v = {"verdict": "block", "reasons": []}
    assert parse_result(NS(is_error=False, structured_content={"result": v}, content=[])) == v
    assert parse_result(NS(is_error=False, structured_content=None, content=[NS(text=json.dumps(v))])) == v
    with pytest.raises(Exception):
        parse_result(NS(is_error=True, structured_content=None, content=[NS(text="Error executing tool")]))
    with pytest.raises(Exception):
        parse_result(NS(is_error=False, structured_content={"verdict": "maybe"}, content=[]))


def test_cli_run_guard_off_json(capsys):
    with pytest.raises(SystemExit) as e:
        cli.main(["run", "finance", "--variant", "scam", "--guard", "off", "--llm", "scripted", "--json"])
    assert e.value.code == 0
    out = json.loads(capsys.readouterr().out)
    assert out["guard"] == "off" and out["outcome"] == "paid" and out["spent"] == 150 and out["expected_verdict"] == "block"


def test_cli_scenarios_json(capsys):
    with pytest.raises(SystemExit):
        cli.main(["scenarios", "--json"])
    rows = json.loads(capsys.readouterr().out)
    assert {(r["scenario"], r["variant"]) for r in rows} >= {("shopping", "scam"), ("x402", "legit"), ("finance", "review")}


def test_cli_rejects_an_unknown_variant(capsys):
    with pytest.raises(SystemExit) as e:
        cli.main(["run", "x402", "--variant", "review", "--guard", "off", "--llm", "scripted"])
    assert e.value.code == 2
