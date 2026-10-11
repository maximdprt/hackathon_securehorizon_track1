"""The sandbox as the films show it: the real chat (agents/ui/dist), the real browser agent and the real guard over MCP,
with a scripted model in place of Bedrock.

The model is a script (agents/tests/test_world.py Driver) chosen by the request, with the reasons a real agent gives:
  "… Ultra 2 au meilleur prix"   the Ultra 2 at Meridian, the fake shop with the lowest price
  "… Ultra 2 chez Nimbus …"      the Ultra 2 at Nimbus, an honest shop, but far over the agent's usual amount
  "… SE …"                       the SE at Nimbus
  anything else                  the Series 10 at Meridian (the first film)
Everything else is the product: the shops' pages, the agent's browser, the guard's verify_payment, its verdict and the
card the chat shows.

    .venv/bin/python video/agent_server.py                       # no chain: nothing is written on SentinelL1
    .venv/bin/python video/agent_server.py --chain --log x.json  # each decision written on SentinelL1, as the product
                                                                 # does, and what the city receives logged to x.json
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from http.server import ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ["GUARD_LLM"] = "off"
os.environ.pop("GUARD_CONTRACT_ADDRESS", None)  # the guard starts from what it has seen itself: a first encounter

from agents import app, world  # noqa: E402
from agents.guard_client import GuardClient  # noqa: E402
from agents.sentinel_chain import SentinelChain  # noqa: E402
from agents.tests.test_world import Driver, fill_checkout, ref  # noqa: E402

PORT = 8765


def steps_for(site: str, product: str) -> list:
    name = world.PRODUCTS[product]["name"]
    shop = world.ALL_SITES[site]["name"]
    others = [k for k in ("nimbus", "meridian", "orchard") if k != site and product in world.ALL_SITES[k]["products"]][:1]
    considered = [{"merchant": world.ALL_SITES[k]["name"], "price": world.ALL_SITES[k]["products"][product], "assessment": "Plus cher."} for k in others]
    considered.append({"merchant": shop, "price": world.ALL_SITES[site]["products"][product], "assessment": "Je le retiens."})
    lowest = site == "meridian"
    why = lambda step, text: (lambda page: (lambda n, a: (n, {**a, "why": text}))(*(step(page) if callable(step) else step)))
    return [
        why(("search", {"query": name}), "Je cherche le modèle demandé sur le moteur de recherche."),
        why(("choose", {"merchant": shop, "considered": considered}),
            f"{shop} propose le prix le plus bas." if lowest else f"{shop} est un marchand connu : je le retiens."),
        why(("goto", {"url": world.url_of(site)}), "J'ouvre la boutique retenue."),
        why(lambda page: ("click", {"ref": ref(page, name)}), "J'ouvre la fiche du modèle demandé."),
        why(lambda page: ("click", {"ref": ref(page, "Ajouter au panier")}), "Je l'ajoute au panier."),
        why(lambda page: ("click", {"ref": ref(page, "Passer au paiement")}), "Je passe au paiement."),
        why(fill_checkout, "Je remplis le formulaire avec le profil de l'acheteur."),
        why(lambda page: ("click", {"ref": ref(page, "Payer")}), "Tout est rempli : je paie."),
    ]


def scenario(prompt: str) -> tuple[str, str]:
    p = prompt.lower()
    if "ultra" in p:
        return ("nimbus", "ultra-2") if "nimbus" in p else ("meridian", "ultra-2")
    if " se" in p:
        return "nimbus", "se-40"
    return "meridian", "series-10-46"


class ByPrompt(Driver):
    """The scripted model: its gestures are chosen from the request it receives."""

    def __init__(self):
        super().__init__()
        self.chosen = False

    def __call__(self, system, messages, tools):
        if not self.chosen:
            first = messages[0]["content"][0].get("text", "")
            self.steps = steps_for(*scenario(first))
            self.chosen = True
        return super().__call__(system, messages, tools)


class Scripted(dict):
    """app._llms : a fresh scripted model for every run."""

    def get(self, key, default=None):
        return ByPrompt()


class LoggedChain(SentinelChain):
    """The product's chain client; each decision it writes is also kept as the city's SSE message for it."""

    def __init__(self, log: Path, **kw):
        super().__init__(**kw)
        self.log = log

    def authorize(self, verdict, site, item="", ttl=300):
        proof = super().authorize(verdict, site, item=item, ttl=ttl)
        txs = {t["kind"]: t["hash"] for t in proof.get("txs", [])}
        entry = {"verdict": json.loads(json.dumps(verdict, default=str)),
                 "context": {"issuer_label": "shopping-agent", "recipient_label": (site or {}).get("name") or verdict["recipient"],
                             "merchant_domain": (site or {}).get("domain"), "item": item, "source": "sandbox-chat"},
                 "proof": {"payment_id": proof.get("payment_id"), "decision_tx": txs.get("decision"), "visa_tx": txs.get("visa"), "flag_tx": txs.get("flag")},
                 "ok": proof.get("ok"), "explorer": [t["url"] for t in proof.get("txs", [])]}
        kept = json.loads(self.log.read_text(encoding="utf-8")) if self.log.exists() else []
        self.log.write_text(json.dumps(kept + [entry], ensure_ascii=False, indent=1), encoding="utf-8")
        print("chain:", verdict["verdict"], proof.get("ok"), entry["explorer"], flush=True)
        return proof


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--chain", action="store_true", help="write each decision on SentinelL1 (POST rpc.petroi.fr/authorize)")
    ap.add_argument("--log", type=Path, help="with --chain: where to keep what the city receives for each decision")
    a = ap.parse_args()
    app._llms = Scripted()
    app._guard = GuardClient("mcp", Path(tempfile.mkdtemp()) / "guard_data")
    app._chain = LoggedChain(a.log, decide_url=f"http://127.0.0.1:{PORT}") if a.chain else None
    if a.log and a.log.exists():
        a.log.unlink()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), app.Handler)
    print(f"demo sandbox on http://127.0.0.1:{PORT}  (guard: {app._guard.backend}, chain: {'on' if a.chain else 'off'})", flush=True)
    try:
        server.serve_forever()
    finally:
        app._guard.close()
