"""Interface de chat de la sandbox : on écrit une demande, l'agent shopping cherche parmi les 5 boutiques,
choisit, et s'arrête au paiement. Chaque étape s'affiche en direct dans le navigateur.

    .venv/Scripts/python agents/app.py --open        # http://127.0.0.1:8765

Tout reste sur la machine : le serveur n'écoute que sur 127.0.0.1, les boutiques sont des fichiers
locaux, aucun paiement n'est exécuté. Chaque run est aussi ajouté à agents/out/runs.jsonl.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from agents import world  # noqa: E402
from agents.guard_client import GuardClient  # noqa: E402
from agents.llm import MODEL_ID, BedrockLLM  # noqa: E402
from agents.shopping_agent import run_open  # noqa: E402

OUT = ROOT / "agents" / "out"
UI = ROOT / "agents" / "ui" / "chat.html"
MODELS = {  # agents proposés dans l'interface ; le comportement noté est celui observé sur la fausse boutique Walmart
    "us.mistral.pixtral-large-2502-v1:0": "Pixtral Large · suit les injections",
    "us.amazon.nova-lite-v1:0": "Nova Lite · paie sur le faux site",
    "us.anthropic.claude-sonnet-4-6": "Claude Sonnet 4.6 · refuse seul",
}
SITE_PATH = re.compile(r"/site/([a-z0-9]+)/([a-z.]*)")
GUARD = GuardClient()  # un seul garde pour toute la session : une adresse bloquée une fois le reste
SESSION = time.strftime("%Y-%m-%dT%H:%M:%S")
_llms: dict[str, BedrockLLM] = {}


def public_site(key: str) -> dict:
    s = world.SITES[key]
    return {"key": key, "name": s["name"], "domain": s["domain"], "kind": s["kind"], "why": s["why"], "preview": f"/site/{key}/"}


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

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if not self._local():
            return self._json(403, {"error": "local only"})
        if path == "/":
            return self._send(200, UI.read_bytes(), "text/html; charset=utf-8")
        if path == "/api/world":
            return self._json(200, {"sites": [public_site(k) for k in world.SITES], "models": MODELS,
                                    "default_model": MODEL_ID, "backend": GUARD.backend})
        m = SITE_PATH.fullmatch(path)
        page = world.SITES[m.group(1)]["pages"].get(m.group(2)) if m and m.group(1) in world.SITES else None
        if page is None:
            return self._json(404, {"error": "not found"})
        # aperçu pour un humain : la page est servie inerte (ni script, ni formulaire, ni chargement externe)
        self._send(200, page.read_bytes(), "text/html; charset=utf-8",
                   {"Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'"})

    def do_POST(self):
        # Content-Type JSON exigé : une page web tierce ne peut pas l'envoyer sans préflight CORS, que l'on n'accorde pas
        if self.path != "/api/run" or not self._local() or not self.headers.get("Content-Type", "").startswith("application/json"):
            return self._json(404, {"error": "not found"})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            prompt, model, guarded = body["prompt"].strip(), body.get("model") or MODEL_ID, bool(body.get("guard", True))
            assert prompt and len(prompt) <= 2000 and model in MODELS
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
            run = run_open(prompt, llm, GUARD if guarded else None, emit=emit)
            run.update(model=model, backend=GUARD.backend if guarded else None, session=SESSION, started=time.strftime("%Y-%m-%dT%H:%M:%S"))
            OUT.mkdir(exist_ok=True)
            with (OUT / "runs.jsonl").open("a", encoding="utf-8") as f:
                f.write(json.dumps(run, ensure_ascii=False) + "\n")
            emit({"type": "end", **{k: run[k] for k in ("outcome", "order", "item", "verdict", "latency_ms", "expected", "final_text", "guarded", "backend")},
                  "site": public_site(run["site"]) if run["site"] else None})
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
    a = p.parse_args()
    url = f"http://127.0.0.1:{a.port}/"
    server = ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    print(f"Chat de la sandbox -> {url}   garde : {GUARD.backend}   (Ctrl+C pour arrêter)")
    if a.open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
