"""Interface de la sandbox : un navigateur agentique. On choisit un agent, on règle ses consignes, on lui écrit une
demande d'achat, et on le regarde naviguer : recherche, boutiques, fiche produit, panier, formulaire de carte, paiement.

    cd agents/ui && npm install && npm run build     # une fois, puis après chaque modification de l'interface
    .venv/Scripts/python agents/app.py --open        # http://127.0.0.1:8765

L'interface est une application React (agents/ui/src). Ce serveur sert sa version construite (agents/ui/dist), l'API
qu'elle appelle, et les 5 boutiques elles-mêmes sous /shop/<clé>/ : on peut y acheter à la main dans un onglet.
Pour modifier l'interface en direct : `npm run dev` dans agents/ui, avec ce serveur lancé à côté.

Aucun garde n'est branché ici : l'agent va jusqu'au bout et la boutique confirme la commande. Le paiement est simulé,
le profil et la carte de l'acheteur sont fictifs. La requête `verify_payment` que le garde aurait reçue juste avant le
clic sur "Payer" est montrée dans l'interface et enregistrée dans agents/out/runs.jsonl (voir `run_browser(guard=...)`).

Tout reste sur la machine : le serveur n'écoute que sur 127.0.0.1 et les boutiques n'existent que dans ce processus.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import sys
import time
import webbrowser
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from agents import shops, world  # noqa: E402
from agents.browser_agent import PROFILE, masked, run_browser  # noqa: E402
from agents.guard_client import GuardClient  # noqa: E402
from agents.llm import MODEL_ID, BedrockLLM  # noqa: E402
from agents.sentinel_chain import API as CHAIN_API, SentinelChain  # noqa: E402
from agents.sentinel_gateway import verdict_summary  # noqa: E402

OUT = ROOT / "agents" / "out"
DIST = ROOT / "agents" / "ui" / "dist"  # l'interface React construite par `npm run build`
ASSET_PATH = re.compile(r"/assets/([A-Za-z0-9._-]+)")
ASSET_TYPES = {".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".map": "application/json"}
NOT_BUILT = """<!DOCTYPE html><html lang="fr"><meta charset="utf-8"><title>Interface non construite</title>
<body style="font:16px/1.5 sans-serif;max-width:60ch;margin:12vh auto;padding:0 20px">
<h1>L'interface n'est pas encore construite</h1>
<p>Elle est en React et doit être compilée une fois (Node.js requis) :</p>
<pre>cd agents/ui
npm install
npm run build</pre>
<p>Puis recharge cette page.</p></body></html>"""
MODELS = {  # modèles proposés pour un agent
    "us.mistral.pixtral-large-2502-v1:0": "Pixtral Large",
    "us.amazon.nova-lite-v1:0": "Nova Lite",
    "us.anthropic.claude-sonnet-4-6": "Claude Sonnet 4.6",
}
SHOP_PATH = re.compile(r"/shop/([a-z0-9]+)(/.*)?")
# Les boutiques servies à un humain : formulaires vers ce serveur seulement, aucun script, aucune ressource externe.
SHOP_CSP = {"Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'"}
PACE = 0  # le serveur n'attend pas entre deux gestes : c'est l'interface qui les joue à vitesse humaine
_llms: dict[str, BedrockLLM] = {}
_guard: GuardClient | None = None   # le garde à l'entrée de la chaîne, réglé au lancement (--guard)
_chain: SentinelChain | None = None  # l'API authorize de SentinelL1, réglée au lancement (--chain)
_visitors: dict[str, shops.Session] = {}  # paniers et commandes des humains qui visitent /shop, par cookie


def public_site(key: str) -> dict:
    s = world.SITES[key]
    return {"key": key, "name": s["name"], "domain": s["domain"], "kind": s["kind"], "why": s["why"], "preview": f"/shop/{key}/"}


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, body: bytes, ctype: str, extra: dict | None = None) -> None:
        self.send_response(status)
        for k, v in {"Content-Type": ctype, "Content-Length": str(len(body)), "Cache-Control": "no-store",
                     "X-Content-Type-Options": "nosniff", **(extra or {})}.items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, status: int, data: dict) -> None:
        self._send(status, json.dumps(data, ensure_ascii=False).encode(), "application/json; charset=utf-8")

    def _local(self) -> bool:
        """Refuse les requêtes qui ne visent pas explicitement ce serveur local (rebinding DNS)."""
        return self.headers.get("Host", "").split(":")[0] in ("127.0.0.1", "localhost")

    def _shop(self, method: str, key: str, path: str, form: dict[str, str]) -> None:
        """Une boutique visitée par un humain. Son panier est tenu par un cookie de session."""
        cookie = SimpleCookie(self.headers.get("Cookie", "")).get("visitor")
        sid = cookie.value if cookie and cookie.value in _visitors else secrets.token_urlsafe(16)
        if len(_visitors) > 200:  # outil local : on ne garde pas indéfiniment les paniers abandonnés
            _visitors.clear()
        res = shops.handle(key, method, path, form, _visitors.setdefault(sid, shops.Session()), f"/shop/{key}")
        headers = {**SHOP_CSP, "Set-Cookie": f"visitor={sid}; Path=/shop; HttpOnly; SameSite=Strict"}
        if res.location:
            return self._send(303, b"", "text/html; charset=utf-8", {**headers, "Location": f"/shop/{key}{res.location}"})
        self._send(res.status, res.html.encode(), "text/html; charset=utf-8", headers)

    def do_GET(self):
        url = urlsplit(self.path)
        path = url.path
        if not self._local():
            return self._json(403, {"error": "local only"})
        if path == "/":
            index = DIST / "index.html"
            if not index.is_file():
                return self._send(503, NOT_BUILT.encode(), "text/html; charset=utf-8")
            return self._send(200, index.read_bytes(), "text/html; charset=utf-8")
        asset = ASSET_PATH.fullmatch(path)
        if asset:  # un nom de fichier seul, jamais un chemin : rien hors de dist/assets n'est servi
            file = DIST / "assets" / asset.group(1)
            if file.is_file() and file.suffix in ASSET_TYPES:
                return self._send(200, file.read_bytes(), ASSET_TYPES[file.suffix])
            return self._json(404, {"error": "not found"})
        if path == "/api/world":
            buyer = masked(PROFILE)
            return self._json(200, {"sites": [public_site(k) for k in world.SITES], "models": MODELS, "default_model": MODEL_ID,
                                    "profile": {"name": buyer["name"], "city": buyer["city"], "card": buyer["card_number"]},
                                    "guard": _guard.backend if _guard else None, "chain": _chain.base if _chain else None})
        if path == "/search":
            query = parse_qs(url.query).get("q", [""])[0]
            page = shops.search_page(query, "/search", lambda key: f"/shop/{key}/").replace('action="/search/"', 'action="/search"')
            return self._send(200, page.encode(), "text/html; charset=utf-8", SHOP_CSP)
        shop = SHOP_PATH.fullmatch(path)
        if shop and shop.group(1) in world.SITES:
            return self._shop("GET", shop.group(1), shop.group(2) or "/", {})
        self._json(404, {"error": "not found"})

    def do_POST(self):
        if not self._local():
            return self._json(403, {"error": "local only"})
        length = int(self.headers.get("Content-Length", 0))
        shop = SHOP_PATH.fullmatch(self.path.split("?", 1)[0])
        if shop and shop.group(1) in world.SITES and length <= 20_000:
            fields = parse_qs(self.rfile.read(length).decode("utf-8", "replace"), keep_blank_values=True)
            return self._shop("POST", shop.group(1), shop.group(2) or "/", {k: v[0] for k, v in fields.items()})
        # Content-Type JSON exigé : une page web tierce ne peut pas l'envoyer sans préflight CORS, que l'on n'accorde pas
        if self.path != "/api/run" or not self.headers.get("Content-Type", "").startswith("application/json"):
            return self._json(404, {"error": "not found"})
        try:
            body = json.loads(self.rfile.read(length))
            prompt, model = body["prompt"].strip(), body.get("model") or MODEL_ID
            instructions, agent = str(body.get("instructions", "")).strip(), str(body.get("agent", "")).strip()
            assert prompt and len(prompt) <= 2000 and len(instructions) <= 4000 and len(agent) <= 80 and model in MODELS
        except Exception:
            return self._json(400, {"error": "bad request"})

        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

        def emit(event: dict) -> None:
            self.wfile.write((json.dumps(event, ensure_ascii=False) + "\n").encode())
            self.wfile.flush()

        try:
            llm = _llms.get(model) or _llms.setdefault(model, BedrockLLM(model))
            # l'agent ne connaît pas le garde ; run_browser appelle guard.verify au clic "Payer" et ne paie que si allow
            run = run_browser(prompt, llm, guard=_guard, instructions=instructions, emit=emit, pace=PACE)
            if run["verdict"] and _chain:  # la transaction entre dans SentinelL1 : le garde a jugé, on inscrit la décision
                emit({"type": "submit", "network": "SentinelL1"})
                run["onchain"] = _chain.authorize(run["verdict"], public_site(run["site"]) if run["site"] else None,
                                                   item=", ".join(world.PRODUCTS[p]["name"] for p in run.get("items", {})) or run.get("chosen", ""))
                emit({"type": "onchain", **run["onchain"]})
            run.update(agent=agent, model=model, backend=_guard.backend if _guard else None, started=time.strftime("%Y-%m-%dT%H:%M:%S"))
            OUT.mkdir(exist_ok=True)
            with (OUT / "runs.jsonl").open("a", encoding="utf-8") as f:
                f.write(json.dumps(run, ensure_ascii=False) + "\n")
            request = run["request"] and {**run["request"], "source_context": f"<{len(run['request']['source_context'])} caractères de HTML lus par l'agent>"}
            keys = ("outcome", "order", "chosen", "why", "considered", "submitted", "confirmation", "expected", "final_text", "turns")
            emit({"type": "end", **{k: run[k] for k in keys}, "site": public_site(run["site"]) if run["site"] else None, "request": request,
                  **({"verdict": verdict_summary(run["verdict"], run["latency_ms"], _guard.backend if _guard else None),
                      "onchain": run.get("onchain")} if run["verdict"] else {})})
        except ConnectionError:
            pass  # l'onglet a été fermé pendant le run
        except Exception as exc:  # identifiants AWS expirés, modèle indisponible...
            try:
                emit({"type": "error", "message": f"{type(exc).__name__}: {str(exc)[:400]}"})
            except ConnectionError:
                pass

    def log_message(self, fmt, *args):
        print(f"[app] {fmt % args}")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--open", action="store_true", help="ouvre l'interface dans le navigateur")
    p.add_argument("--guard", choices=["engine", "stub", "off"], default="engine", help="le garde à l'entrée de SentinelL1 (défaut engine)")
    p.add_argument("--chain", default=CHAIN_API, help="API authorize de SentinelL1, ou off")
    a = p.parse_args()
    if a.guard != "off":
        _guard = GuardClient(a.guard)
        _chain = SentinelChain(a.chain) if a.chain != "off" else None
    url = f"http://127.0.0.1:{a.port}/"
    server = ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    print(f"Sandbox -> {url}   boutiques : {url}search   (Ctrl+C pour arrêter)")
    print(f"  garde : {_guard.backend if _guard else 'off'}   chaîne : {_chain.base if _chain else 'off'}   Claude : {os.environ.get('GUARD_LLM','off')}")
    if a.open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
