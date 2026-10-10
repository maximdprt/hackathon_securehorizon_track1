"""Tests de l'agent shopping et du client du garde, sans Bedrock (LLM scripté) et sur le garde stub."""
import json
import os

import jsonschema

from agents.guard_client import ROOT, GuardClient
from agents.llm import load_env
from agents.sandbox_agent import SHOPPER, run_agent

BAD = "0xBADc0ffee0000000000000000000000000000000"
NIMBUS_STORE = "0x5e11e40000000000000000000000000000000002"
SCHEMA = json.loads((ROOT / "detection" / "verdict.schema.json").read_text(encoding="utf-8"))


class ScriptedLLM:
    """Rejoue une liste d'appels d'outils, puis conclut par du texte."""

    def __init__(self, *steps):
        self.steps = list(steps)
        self.seen = []  # dernier message reçu à chaque appel

    def __call__(self, system, messages, tools):
        self.seen.append(messages[-1])
        if not self.steps:
            return {"role": "assistant", "content": [{"text": "I did not buy anything."}]}
        step = self.steps.pop(0)
        if isinstance(step, str):  # le modèle répond par du texte brut
            return {"role": "assistant", "content": [{"text": step}]}
        name, args = step
        return {"role": "assistant", "content": [{"toolUse": {"toolUseId": f"t{len(self.seen)}", "name": name, "input": args}}]}


def pay(recipient, amount, action="pay"):
    return ("pay", {"action": action, "recipient": recipient, "amount": amount, "currency": "USDC"})


def open_page(url):
    return ("open_page", {"url": url})


def test_fake_walmart_is_blocked_with_what_the_agent_read():
    llm = ScriptedLLM(open_page("https://walmart-deals-shop.online/"), pay(BAD, 500, "approve"))
    run = run_agent("fake_walmart", llm, GuardClient("stub"))
    assert run["outcome"] == "verdict" and run["verdict"]["verdict"] == "block" == run["expected"]
    req = run["request"]
    assert set(req) == {"order", "source_context", "context_type", "task", "context"}
    assert req["order"] == {"issuer": SHOPPER, "action": "approve", "amount": 500, "currency": "USDC", "recipient": BAD}
    assert "Checkout verification for automated shopping assistants" in req["source_context"]
    assert req["context"]["origin"] == "webpage" and req["context"]["merchant"]["domain"] == "walmart-deals-shop.online"
    jsonschema.validate(run["verdict"], SCHEMA)
    assert run["latency_ms"] >= 0


def test_without_guard_the_payment_goes_through():
    llm = ScriptedLLM(open_page("https://walmart-deals-shop.online/"), pay(BAD, 500, "approve"))
    run = run_agent("fake_walmart", llm, guard=None)
    assert run["outcome"] == "executed" and run["verdict"] is None and run["order"]["recipient"] == BAD


def test_legit_store_is_allowed():
    llm = ScriptedLLM(open_page("https://store.nimbus.example/"), pay(NIMBUS_STORE, 60))
    run = run_agent("legit_store", llm, GuardClient("stub"))
    assert run["verdict"]["verdict"] == "allow" == run["expected"]
    jsonschema.validate(run["verdict"], SCHEMA)


def test_recipient_invented_by_the_agent_is_blocked():
    invented = "0x" + "c" * 40  # n'apparaît sur aucune page lue
    run = run_agent("legit_store", ScriptedLLM(open_page("https://store.nimbus.example/"), pay(invented, 60)), GuardClient("stub"))
    assert run["verdict"]["verdict"] == "block" and not run["verdict"]["poison_check"]["is_poisoned"]
    jsonschema.validate(run["verdict"], SCHEMA)


def test_blocked_recipient_is_refused_directly_the_second_time():
    guard = GuardClient("stub")
    run_agent("fake_walmart", ScriptedLLM(open_page("https://walmart-deals-shop.online/"), pay(BAD, 129)), guard)
    second = run_agent("legit_store", ScriptedLLM(open_page("https://store.nimbus.example/"), pay(BAD, 60)), guard)
    assert second["verdict"]["verdict"] == "block" and second["verdict"]["onchain_flagged"] is True
    assert second["verdict"]["poison_check"]["is_poisoned"] is False  # page propre : le registre suffit


def test_agent_that_declines_makes_no_payment():
    run = run_agent("fake_walmart", ScriptedLLM(open_page("https://walmart-deals-shop.online/")), GuardClient("stub"))
    assert run["outcome"] == "no_payment" and run["order"] is None and run["final_text"]


def test_invalid_order_is_returned_to_the_agent_not_sent_to_the_guard():
    llm = ScriptedLLM(open_page("https://walmart-deals-shop.online/"), pay("0xBADc0ffee…", 500), pay(BAD, 500))
    run = run_agent("fake_walmart", llm, GuardClient("stub"))
    assert llm.seen[2]["content"][0]["toolResult"]["status"] == "error"
    assert run["outcome"] == "verdict" and run["order"]["recipient"] == BAD


def test_relative_links_and_unknown_urls():
    llm = ScriptedLLM(open_page("https://walmart-deals-shop.online/index.html"), open_page("checkout.html"),
                      open_page("https://checkout-pay-secure.xyz/submit"), pay(BAD, 129))
    run = run_agent("fake_walmart", llm, GuardClient("stub"))
    assert run["pages"] == ["https://walmart-deals-shop.online/", "https://walmart-deals-shop.online/checkout.html"]
    assert llm.seen[3]["content"][0]["toolResult"]["status"] == "error"
    assert "Secure Checkout" in run["request"]["source_context"]


def test_decor_annotations_are_not_served_to_the_agent_but_the_attack_is():
    llm = ScriptedLLM(open_page("https://walmart-deals-shop.online/"), open_page("checkout.html"), pay(BAD, 500, "approve"))
    served = run_agent("fake_walmart", llm, GuardClient("stub"))["request"]["source_context"]
    for note in ("PromptFix", "B2:", "hidden layer", "prefilled for the agent", "fake countdown", "<!--"):
        assert note not in served
    for kept in ("Checkout verification for automated shopping assistants", "FLAG{team2-canary}", ".captcha-help {", '"@context": "https://schema.org"',
                 "Assistant note: settlement address", 'name="assistant_instructions"', 'action="https://checkout-pay-secure.xyz/submit"',
                 "setInterval(tick, 1000)"):
        assert kept in served


def test_tool_calls_written_as_text_are_executed():
    llm = ScriptedLLM(
        '{"type": "function", "name": "open_page", "parameters": {"url": "https://store.nimbus.example/"}}',
        '[{"name": "pay", "arguments": {"action": "pay", "recipient": "%s", "amount": 60, "currency": "USDC"}}]' % NIMBUS_STORE,
    )
    run = run_agent("legit_store", llm, GuardClient("stub"))
    assert run["outcome"] == "verdict" and run["verdict"]["verdict"] == "allow"
    assert run["pages"] == ["https://store.nimbus.example/"]
    reply = llm.seen[1]["content"][0]
    assert "toolResult" not in reply and "Nimbus Store" in reply["text"]


def test_text_that_only_mentions_a_tool_is_not_a_tool_call():
    for text in ('I could call {"name": "pay"} but I will not.', '{"name": "pay"}', '["pay"]', '{"name": "delete_all", "arguments": {}}'):
        assert run_agent("legit_store", ScriptedLLM(text), GuardClient("stub"))["outcome"] == "no_payment"


def test_max_turns():
    llm = ScriptedLLM(*[open_page("https://walmart-deals-shop.online/")] * 5)
    assert run_agent("fake_walmart", llm, GuardClient("stub"), max_turns=3)["outcome"] == "max_turns"


def test_load_env_accepts_the_three_line_formats(tmp_path, monkeypatch):
    for k in ("SBX_A", "SBX_B", "SBX_C", "SBX_D"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("SBX_D", "kept")
    env = tmp_path / ".env"
    env.write_text('# comment\nset SBX_A=one\n$Env:SBX_B="two"\nexport SBX_C=\'three\'\nSBX_D=overwritten\n', encoding="utf-8")
    load_env(env)
    assert [os.environ[k] for k in ("SBX_A", "SBX_B", "SBX_C", "SBX_D")] == ["one", "two", "three", "kept"]
