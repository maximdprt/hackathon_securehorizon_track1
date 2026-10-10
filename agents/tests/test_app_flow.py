"""Le parcours complet du chat : l'agent (qui ne connaît pas le garde) envoie sa transaction à SentinelL1, la
passerelle d'entrée la vérifie (vrai moteur) puis inscrit la décision via l'API authorize (faux serveur local)."""
import json
import threading
import urllib.request
from http.server import ThreadingHTTPServer

import pytest

from agents import app, world
from agents.guard_client import GuardClient
from agents.sentinel_chain import SentinelChain
from agents.sentinel_gateway import SentinelGateway
from agents.tests.test_sentinel_chain import api  # noqa: F401  (fixture du faux /authorize)
from agents.tests.test_sandbox_agent import ScriptedLLM
from agents.tests.test_world import open_page, pay, search

SE = "Apple Watch SE (2nd gen) 40mm"
MODEL = next(iter(app.MODELS))


@pytest.fixture
def chat(api, monkeypatch):  # noqa: F811
    base, seen, _ = api
    monkeypatch.setenv("GUARD_LLM", "off")
    monkeypatch.setattr(app, "_gateway", SentinelGateway(GuardClient("engine"), SentinelChain(base, explorer="https://explorer.test")))
    agent_kwargs = []
    real_run_open = app.run_open
    monkeypatch.setattr(app, "run_open", lambda *a, **kw: agent_kwargs.append(kw) or real_run_open(*a, **kw))
    monkeypatch.setattr(app, "OUT", __import__("pathlib").Path(__import__("tempfile").mkdtemp()))
    srv = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    def run(*steps):
        app._llms[MODEL] = ScriptedLLM(*steps)
        req = urllib.request.Request(f"http://127.0.0.1:{srv.server_port}/api/run", method="POST",
                                     data=json.dumps({"prompt": f"Achète une {SE}", "model": MODEL}).encode(),
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as res:
            return [json.loads(line) for line in res.read().decode().splitlines() if line.strip()]

    yield run, seen, agent_kwargs
    srv.shutdown()
    app._llms.pop(MODEL, None)


def test_the_agent_sends_its_transaction_and_sentinel_refuses_the_fraud_at_the_chain_entry(chat):
    run, seen, agent_kwargs = chat
    events = run(search("apple watch"), open_page(world.url_of("meridian")), pay("meridian", SE))
    kinds = [e["type"] for e in events]
    # l'agent décide et envoie ; la vérification n'a lieu qu'à l'entrée de la chaîne
    assert kinds[-7:] == ["pay", "submit", "guard", "verdict", "chain", "onchain", "end"]
    assert agent_kwargs and all(kw.get("guard") is None for kw in agent_kwargs)
    verdict = next(e for e in events if e["type"] == "verdict")
    assert verdict["verdict"] == "block" and verdict["backend"] == "engine"
    assert any(r.startswith("new_merchant_first_payment") for r in verdict["reasons"])
    assert seen[0]["body"]["verdict"] == "block" and seen[0]["body"]["context"]["recipient_label"] == "Meridian Watch Co."
    end = events[-1]
    assert end["outcome"] == "submitted" and end["verdict"]["verdict"] == "block"
    assert end["onchain"]["ok"] and end["onchain"]["txs"][0]["url"].startswith("https://explorer.test/tx/0x")


def test_known_merchant_under_the_cap_gets_a_visa_request(chat):
    run, seen, _ = chat
    events = run(search("apple watch"), open_page(world.url_of("nimbus")), pay("nimbus", SE))
    assert events[-1]["verdict"]["verdict"] == "allow" and seen[0]["body"]["verdict"] == "allow"


def test_guard_off_stops_before_the_payment_and_sends_nothing(chat, monkeypatch):
    run, seen, _ = chat
    monkeypatch.setattr(app, "_gateway", None)
    events = run(search("apple watch"), open_page(world.url_of("nimbus")), pay("nimbus", SE))
    assert events[-1]["outcome"] == "ready" and "verdict" not in events[-1] and seen == []
