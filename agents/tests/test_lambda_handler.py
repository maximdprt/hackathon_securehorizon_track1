"""La sandbox hébergée sur Lambda (deploy/lambda_handler.py) : le garde écrit son état dans un dossier inscriptible, et
un humain tranche un paiement en attente par /api/decide, comme en local. Agent scripté, Claude et chaîne coupés."""
import importlib
import json
import sys
from pathlib import Path

import pytest

from agents import world
from agents.browser_agent import run_browser
from agents.tests.test_world import Driver, buy

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def lam(tmp_path, monkeypatch):
    monkeypatch.setenv("GUARD_LLM", "off")
    monkeypatch.setenv("SENTINEL_API", "off")  # aucune écriture on-chain dans les tests
    monkeypatch.setenv("GUARD_DATA_DIR", str(tmp_path / "guard_data"))
    monkeypatch.delenv("GUARD_CONTRACT_ADDRESS", raising=False)
    monkeypatch.syspath_prepend(str(ROOT / "deploy"))
    sys.modules.pop("lambda_handler", None)
    m = importlib.import_module("lambda_handler")
    monkeypatch.delenv("GUARD_CONTRACT_ADDRESS", raising=False)  # le module le pose par défaut : pas de lecture on-chain ici
    yield m
    if m._guard:
        m._guard.close()
    sys.modules.pop("lambda_handler", None)


def call(m, path, body=None, method="POST"):
    event = {"rawPath": path, "requestContext": {"http": {"method": method}}, "body": json.dumps(body) if body is not None else None}
    res = m.handler(event, None)
    return res["statusCode"], json.loads(res["body"]) if res["headers"]["Content-Type"].startswith("application/json") else res["body"]


def test_the_guard_keeps_its_state_where_lambda_can_write(lam, tmp_path):
    code, w = call(lam, "/api/world", method="GET")
    assert code == 200 and w["guard"] == "engine" and w["chain"] is None
    assert (tmp_path / "guard_data" / "mandates.json").is_file()


def test_an_unknown_task_type_is_refused_before_any_model_is_called(lam):
    assert call(lam, "/api/run", {"prompt": "Achète une montre", "mode": "casino"})[0] == 400


def test_a_held_payment_is_settled_by_a_human_once(lam):
    guard, _ = lam._guard_chain()
    held = run_browser(f"Achète {world.PRODUCTS['series-10-46']['name']}", Driver(*buy("nimbus", "series-10-46")), guard=guard)
    assert held["verdict"]["verdict"] == "needs_approval"
    iid = held["verdict"]["instruction_id"]
    code, out = call(lam, "/api/decide", {"instruction_id": iid, "decision": "allow"})
    assert code == 200 and out["verdict"] == "allow" and out["approved_by"].startswith("humain") and out["onchain"] is None
    assert call(lam, "/api/decide", {"instruction_id": iid, "decision": "block"})[0] == 409  # tranché une fois
    assert call(lam, "/api/decide", {"instruction_id": iid, "decision": "maybe"})[0] == 400
