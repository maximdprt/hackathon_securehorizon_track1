"""Le client de l'API authorize de Walid, testé contre un faux serveur local (aucun appel réseau)."""
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from agents.sentinel_chain import SentinelChain

ISSUER, SHOP = "0xA11ce00000000000000000000000000000000002", "0x3E21D1A400000000000000000000000000000C7B"


def verdict(v="block"):
    return {"instruction_id": "0x" + "ab" * 32, "issuer": ISSUER, "action": "pay", "amount": 229, "currency": "USDC",
            "recipient": SHOP, "verdict": v, "risk_score": 0.69, "trust_score": 31,
            "reasons": ["[counterparty] new_merchant_first_payment (-50): first payment to a merchant whose domain is 9 days old"] + ["x" * 300]}


@pytest.fixture
def api():
    seen, reply = [], {"status": 200, "body": None}

    class H(BaseHTTPRequestHandler):
        def do_POST(self):
            seen.append({"path": self.path, "body": json.loads(self.rfile.read(int(self.headers["Content-Length"])))})
            pid = "0x" + "11" * 32
            body = reply["body"] or {"status": "ok", "verdict": seen[-1]["body"]["verdict"], "payment_id": pid, "nonce": 1,
                                     "flag_tx": "0x" + "f1" * 32, "decision_tx": "0x" + "d1" * 32}
            data = json.dumps(body).encode()
            self.send_response(reply["status"])
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *a):
            pass

    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_port}", seen, reply
    srv.shutdown()


def test_block_is_sent_to_authorize_with_the_full_verdict_and_comes_back_with_explorer_links(api):
    base, seen, _ = api
    chain = SentinelChain(base, explorer="https://explorer.test")
    proof = chain.authorize(verdict("block"), {"name": "Meridian Watch Co.", "domain": "meridian-watch.example"}, item="Apple Watch SE")
    body = seen[0]["body"]
    assert seen[0]["path"] == "/authorize"
    assert body["verdict"] == "block" and body["payment"]["issuer"] == ISSUER and body["payment"]["recipient"] == SHOP
    assert body["payment"]["amount"] == 229 * 10**18 and isinstance(body["payment"]["nonce"], int)  # SEC wei, matches GuardedVault.pay
    assert len(body["reason"]) <= 200 and body["reason"].startswith("new_merchant_first_payment")
    assert body["full"]["verdict"] == "block" and body["full"]["instruction_id"] == verdict()["instruction_id"]
    assert body["context"]["recipient_label"] == "Meridian Watch Co." and body["context"]["issuer_label"] == "shopping-agent"
    assert proof["ok"] and proof["payment_id"] == "0x" + "11" * 32
    assert [t["kind"] for t in proof["txs"]] == ["flag", "decision"]
    assert proof["txs"][0]["url"] == "https://explorer.test/tx/0x" + "f1" * 32


def test_needs_approval_is_named_needs_human_on_chain(api):
    base, seen, _ = api
    SentinelChain(base).authorize(verdict("needs_approval"), None)
    assert seen[0]["body"]["verdict"] == "needs_human" and seen[0]["body"]["full"]["verdict"] == "needs_approval"


def test_chain_failure_never_raises_and_says_no_visa(api):
    base, _, reply = api
    reply.update(status=500, body={"detail": "ValueError: nonce too low"})
    proof = SentinelChain(base).authorize(verdict("allow"), None)
    assert proof["ok"] is False and "500" in proof["error"] and "nonce too low" in proof["error"]
    down = SentinelChain("http://127.0.0.1:9", timeout=2).authorize(verdict("allow"), None)
    assert down["ok"] is False and down["error"]
