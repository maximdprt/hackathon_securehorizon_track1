"""The sandbox as the film shows it: the real chat (agents/ui/dist), the real browser agent and the real guard over MCP,
with a scripted model in place of Bedrock and no chain (nothing is written on SentinelL1).

The model is a script (agents/tests/test_world.py Driver) that buys the Series 10 at Meridian, the fake shop with the
lowest price, with the reasons a real agent gives. Everything else is the product: the shops' pages, the agent's
browser, the guard's verify_payment, its verdict and the card the chat shows.

    .venv/bin/python video/agent_server.py      # http://127.0.0.1:8765
"""
from __future__ import annotations

import os
import sys
import tempfile
from http.server import ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ["GUARD_LLM"] = "off"
os.environ.pop("GUARD_CONTRACT_ADDRESS", None)

from agents import app, world  # noqa: E402
from agents.guard_client import GuardClient  # noqa: E402
from agents.tests.test_world import Driver, fill_checkout, ref  # noqa: E402

S10 = "series-10-46"


def demo_steps():
    name = world.PRODUCTS[S10]["name"]
    shop = world.SITES["meridian"]["name"]
    why = lambda step, text: (lambda page: (lambda n, a: (n, {**a, "why": text}))(*(step(page) if callable(step) else step)))
    return [
        why(("search", {"query": name}), "Je cherche la montre demandée sur le moteur de recherche."),
        why(("choose", {"merchant": shop, "considered": [
            {"merchant": "Nimbus Store", "price": 429, "assessment": "Marchand connu, mais plus cher."},
            {"merchant": shop, "price": 389, "assessment": "Le prix le plus bas : je le retiens."}]}),
            "Meridian Watch Co. propose le prix le plus bas : 389 € contre 429 € chez Nimbus."),
        why(("goto", {"url": world.url_of("meridian")}), "J'ouvre la boutique retenue."),
        why(lambda page: ("click", {"ref": ref(page, name)}), "J'ouvre la fiche du modèle demandé."),
        why(lambda page: ("click", {"ref": ref(page, "Ajouter au panier")}), "Je l'ajoute au panier."),
        why(lambda page: ("click", {"ref": ref(page, "Passer au paiement")}), "Je passe au paiement."),
        why(fill_checkout, "Je remplis le formulaire avec le profil de l'acheteur."),
        why(lambda page: ("click", {"ref": ref(page, "Payer")}), "Tout est rempli : je paie."),
    ]


class Scripted(dict):
    """app._llms : a fresh scripted model for every run."""

    def get(self, key, default=None):
        return Driver(*demo_steps())


if __name__ == "__main__":
    app._llms = Scripted()
    app._guard = GuardClient("mcp", Path(tempfile.mkdtemp()) / "guard_data")
    app._chain = None
    server = ThreadingHTTPServer(("127.0.0.1", 8765), app.Handler)
    print("demo sandbox on http://127.0.0.1:8765  (guard:", app._guard.backend, ", chain: off)", flush=True)
    try:
        server.serve_forever()
    finally:
        app._guard.close()
