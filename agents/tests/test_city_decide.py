"""Le bouton Valider / Refuser de la ville 3D tranche une attente sur la sandbox locale : /api/decide accepte la ville
(préflight CORS, réseau privé) et elle seule ; toute autre page reste refusée comme avant."""
import json
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

import pytest

from agents import app


@pytest.fixture
def server():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_port}"
    srv.shutdown()


def call(url, method, origin, body=None):
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Origin": origin, "Content-Type": "application/json", "Access-Control-Request-Method": "POST"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers)


def test_the_city_may_settle_a_held_payment(server):
    code, h = call(f"{server}/api/decide", "OPTIONS", "https://city.petroi.fr")
    assert code == 204 and h["Access-Control-Allow-Origin"] == "https://city.petroi.fr" and h["Access-Control-Allow-Private-Network"] == "true"
    code, h = call(f"{server}/api/decide", "POST", "https://city.petroi.fr", {"instruction_id": "0xab", "decision": "maybe"})
    assert code == 400 and h["Access-Control-Allow-Origin"] == "https://city.petroi.fr"  # la ville lit la réponse


def test_any_other_page_is_still_refused(server):
    assert call(f"{server}/api/decide", "OPTIONS", "https://evil.example")[0] == 403
    assert call(f"{server}/api/run", "OPTIONS", "https://city.petroi.fr")[0] == 403  # la ville ne lance pas d'agent
    code, h = call(f"{server}/api/decide", "POST", "https://evil.example", {"instruction_id": "0xab", "decision": "allow"})
    assert "Access-Control-Allow-Origin" not in h
