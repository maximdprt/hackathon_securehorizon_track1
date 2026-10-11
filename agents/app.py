"""Interface de la sandbox : un navigateur agentique. On choisit un agent, on règle ses consignes, on lui écrit une
demande d'achat, et on le regarde naviguer : recherche, boutiques, fiche produit, panier, formulaire de carte, paiement.

    cd agents/ui && npm install && npm run build     # une fois, puis après chaque modification de l'interface
    .venv/Scripts/python agents/app.py --open        # http://127.0.0.1:8765   (--guard mcp|engine|stub|off)

L'interface est une application React (agents/ui/src). Ce serveur sert sa version construite (agents/ui/dist), l'API
qu'elle appelle, et les 5 boutiques elles-mêmes sous /shop/<clé>/ : on peut y acheter à la main dans un onglet.
Les photos des produits déposées dans agents/sites/images sont servies sous /sites/images/<clé>/<produit>.
Pour modifier l'interface en direct : `npm run dev` dans agents/ui, avec ce serveur lancé à côté.

Le garde est branché juste avant le paiement. Par défaut (`--guard mcp`) le serveur lance mcp_server.py en sous-processus
et appelle son outil `verify_payment` par le protocole MCP : validé, le clic sur "Payer" part ; refusé ou renvoyé à un humain,
il ne part pas. L'agent ne connaît pas le garde. L'interface montre le verdict, le score de confiance et chaque retrait ;
une décision en attente se tranche par /api/decide (outil `approve_pending`). L'interrupteur "Garde" de l'interface, ou
`--guard off`, laisse partir le paiement sans vérification, pour montrer ce qui se passe sans garde.
Le paiement est simulé, le profil et la carte de l'acheteur sont fictifs. Chaque run est enregistré dans agents/out/runs.jsonl
avec la requête `verify_payment` et le verdict complet.

En mode "finance", c'est l'agent Hermès (agents/hermes_agent.py) qui répond : il n'ouvre aucune page, il cherche des
placements (agents/assets.py), lit leur fiche et prépare un ordre. Avec le garde l'ordre lui est soumis ; sans garde il est
préparé mais jamais envoyé.

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

from agents import assets, shops, world  # noqa: E402
from agents.browser_agent import PROFILE, masked, run_browser  # noqa: E402
from agents.guard_client import GuardClient  # noqa: E402
from agents.hermes_agent import run_hermes  # noqa: E402
from agents.llm import MODEL_ID, BedrockLLM  # noqa: E402

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
IMAGE_PATH = re.compile(re.escape(shops.IMAGE_ROOT) + r"/([a-z0-9]+)/([a-z0-9-]+)")  # la photo d'un produit dans une boutique
# Les boutiques servies à un humain : formulaires vers ce serveur seulement, aucun script, aucune ressource externe (les photos viennent d'ici).
SHOP_CSP = {"Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'"}
PACE = 0  # le serveur n'attend pas entre deux gestes : c'est l'interface qui les joue à vitesse humaine
_llms: dict[str, BedrockLLM] = {}
_guard: GuardClient | None = None  # le garde devant chaque paiement, réglé au lancement (--guard)
_visitors: dict[str, shops.Session] = {}  # paniers et commandes des humains qui visitent /shop, par cookie


def public_site(key: str) -> dict:
    s = world.SITES[key]
    return {"key": key, "name": s["name"], "domain": s["domain"], "kind": s["kind"], "why": s["why"], "preview": f"/shop/{key}/",
            "color": world.COLORS[key]}


def public_asset(asset_id: str | None) -> dict | None:
    """Ce que le bac à sable sait du placement choisi par l'agent finance, et que l'agent ignore."""
    a = assets.ASSETS.get(asset_id or "")
    return a and {"id": a.id, "name": a.name, "domain": a.domain, "kind": a.kind, "why": a.why, "apy": a.apy}


def verdict_summary(v: dict, latency_ms: float | None, backend: str | None) -> dict:
    """Ce que l'interface montre de l'analyse du garde : le verdict, le score de confiance et chaque retrait avec sa preuve."""
    evidence = {s["id"]: s.get("evidence", "") for s in v.get("signals") or []}
    return {"verdict": v["verdict"], "trust_score": v.get("trust_score"), "risk_score": v.get("risk_score"), "severity": v.get("severity"),
            "deductions": [{"id": d["id"], "layer": d["layer"], "cost": d["cost"], "hard": d["hard"], "evidence": evidence.get(d["id"], "")[:240]}
                           for d in v.get("deductions") or []],
            "notes": [r[9:] for r in v.get("reasons") or [] if r.startswith("[engine] ")],
            "thresholds": v.get("trust_thresholds"), "owasp": v.get("owasp") or [], "onchain_flagged": bool(v.get("onchain_flagged")),
            "instruction_id": v.get("instruction_id"), "latency_ms": latency_ms, "backend": backend}


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
        image = IMAGE_PATH.fullmatch(path)
        if image:  # une boutique et un produit, jamais un nom de fichier : c'est world.product_image qui cherche dans le dossier des photos
            file = world.product_image(*image.groups())
            if file is None:
                return self._json(404, {"error": "not found"})
            # l'adresse porte la date du fichier (shops.picture) : la photo peut rester en cache d'un geste à l'autre
            return self._send(200, file.read_bytes(), world.IMAGE_TYPES[file.suffix.lower()], {"Cache-Control": "private, max-age=86400"})
        if path == "/api/world":
            buyer = masked(PROFILE)
            return self._json(200, {"sites": [public_site(k) for k in world.SITES], "models": MODELS, "default_model": MODEL_ID,
                                    "profile": {"name": buyer["name"], "city": buyer["city"], "card": buyer["card_number"]},
                                    "guard": _guard.backend if _guard else None})
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
        if self.path not in ("/api/run", "/api/decide") or not self.headers.get("Content-Type", "").startswith("application/json"):
            return self._json(404, {"error": "not found"})
        if self.path == "/api/decide":  # un humain tranche une décision en attente (outil approve_pending du garde)
            try:
                body = json.loads(self.rfile.read(length))
                iid, decision = str(body["instruction_id"]), body["decision"]
                assert decision in ("allow", "decline", "block") and len(iid) <= 100 and _guard is not None
            except Exception:
                return self._json(400, {"error": "bad request"})
            try:
                final = _guard.approve(iid, decision, "humain (interface de la sandbox)")
            except Exception as exc:  # décision déjà tranchée, garde arrêté...
                return self._json(409, {"error": f"{type(exc).__name__}: {str(exc)[:300]}"})
            OUT.mkdir(exist_ok=True)
            with (OUT / "decisions.jsonl").open("a", encoding="utf-8") as f:
                f.write(json.dumps({"instruction_id": iid, "decision": decision, "at": time.strftime("%Y-%m-%dT%H:%M:%S")}) + "\n")
            return self._json(200, {"instruction_id": iid, "verdict": final["verdict"], "trust_score": final.get("trust_score"),
                                    "approved_by": final.get("approved_by")})
        try:
            body = json.loads(self.rfile.read(length))
            prompt, model = body["prompt"].strip(), body.get("model") or MODEL_ID
            instructions, agent = str(body.get("instructions", "")).strip(), str(body.get("agent", "")).strip()
            mode = body.get("mode", "shop")
            guard = _guard if body.get("guard", True) else None  # l'interface peut couper le garde pour un run
            assert prompt and len(prompt) <= 2000 and len(instructions) <= 4000 and len(agent) <= 80 and model in MODELS and mode in ("shop", "finance")
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
            backend = guard.backend if guard else None
            if mode == "finance":  # sans garde l'ordre est préparé, jamais envoyé (outcome "ready") ; avec, il lui est soumis
                run = run_hermes(prompt, llm, guard=guard, instructions=instructions, emit=emit)
                run.update(agent=agent, model=model, mode=mode, started=time.strftime("%Y-%m-%dT%H:%M:%S"))
                OUT.mkdir(exist_ok=True)
                with (OUT / "runs.jsonl").open("a", encoding="utf-8") as f:
                    f.write(json.dumps(run, ensure_ascii=False) + "\n")
                request = run["request"] and {**run["request"], "source_context": f"<{len(run['request']['source_context'])} caractères lus par l'agent>"}
                emit({"type": "end", "outcome": run["outcome"], "order": run["order"], "chosen": run["asset"] or "", "why": run["why"],
                      "considered": [], "submitted": None, "confirmation": None, "expected": None, "final_text": run["final_text"],
                      "turns": run["turns"], "site": None, "request": request, "asset": public_asset(run["asset"]),
                      **({"verdict": verdict_summary(run["verdict"], run["latency_ms"], backend)} if run["verdict"] else {})})
                return
            # l'agent ne connaît pas le garde : run_browser l'appelle au clic sur "Payer" et ne paie que s'il valide
            run = run_browser(prompt, llm, guard=guard, instructions=instructions, emit=emit, pace=PACE)
            run.update(agent=agent, model=model, backend=backend, started=time.strftime("%Y-%m-%dT%H:%M:%S"))
            OUT.mkdir(exist_ok=True)
            with (OUT / "runs.jsonl").open("a", encoding="utf-8") as f:
                f.write(json.dumps(run, ensure_ascii=False) + "\n")
            request = run["request"] and {**run["request"], "source_context": f"<{len(run['request']['source_context'])} caractères de HTML lus par l'agent>"}
            keys = ("outcome", "order", "chosen", "why", "considered", "submitted", "confirmation", "expected", "final_text", "turns")
            emit({"type": "end", **{k: run[k] for k in keys}, "site": public_site(run["site"]) if run["site"] else None, "request": request,
                  **({"verdict": verdict_summary(run["verdict"], run["latency_ms"], backend)} if run["verdict"] else {})})
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
    p.add_argument("--guard", choices=["mcp", "engine", "stub", "off"], default="mcp",
                   help="le garde devant chaque paiement : mcp (serveur MCP, défaut), engine (moteur en direct), stub, off")
    a = p.parse_args()
    if a.guard != "off":
        try:
            _guard = GuardClient(a.guard)
        except Exception as exc:  # dépendances du garde absentes, serveur MCP qui ne démarre pas...
            print(f"  GARDE INDISPONIBLE ({type(exc).__name__}: {exc}) : les paiements partiront sans vérification")
    url = f"http://127.0.0.1:{a.port}/"
    server = ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    print(f"Sandbox -> {url}   boutiques : {url}search   (Ctrl+C pour arrêter)")
    print(f"  garde : {_guard.backend if _guard else 'aucun'}   Claude dans le garde : {os.environ.get('GUARD_LLM', 'off')}")
    if a.open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        if _guard:
            _guard.close()
