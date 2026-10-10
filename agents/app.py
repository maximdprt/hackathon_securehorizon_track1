"""Interface de chat de la sandbox, sur le principe d'un atelier d'agents : on règle les consignes de chaque
agent, puis on lui écrit une demande d'achat. Il cherche parmi les 5 boutiques d'Apple Watch, justifie
chaque étape, choisit, et s'arrête juste avant le paiement. Tout s'affiche en direct dans le navigateur.

    .venv/Scripts/python agents/app.py --open        # http://127.0.0.1:8765

Aucun garde n'est branché ici : l'ordre de paiement est préparé, jamais envoyé, et on ne connaît donc pas
le verdict. La requête `verify_payment` prête à partir est montrée dans l'interface et enregistrée dans
agents/out/runs.jsonl, pour la rejouer contre le vrai garde plus tard (voir `run_open(..., guard=...)`).

Tout reste sur la machine : le serveur n'écoute que sur 127.0.0.1 et les boutiques sont des fichiers locaux.
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
from agents.llm import MODEL_ID, BedrockLLM  # noqa: E402
from agents.shopping_agent import run_open  # noqa: E402

OUT = ROOT / "agents" / "out"
UI = ROOT / "agents" / "ui" / "chat.html"
MODELS = {  # modèles proposés pour un agent
    "us.mistral.pixtral-large-2502-v1:0": "Pixtral Large",
    "us.amazon.nova-lite-v1:0": "Nova Lite",
    "us.anthropic.claude-sonnet-4-6": "Claude Sonnet 4.6",
}
SITE_PATH = re.compile(r"/site/([a-z0-9]+)/([a-z.]*)")
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
            return self._json(200, {"sites": [public_site(k) for k in world.SITES], "models": MODELS, "default_model": MODEL_ID})
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
            run = run_open(prompt, llm, instructions=instructions, emit=emit)  # pas de garde : arrêt avant le paiement
            run.update(agent=agent, model=model, backend=None, session=SESSION, started=time.strftime("%Y-%m-%dT%H:%M:%S"))
            OUT.mkdir(exist_ok=True)
            with (OUT / "runs.jsonl").open("a", encoding="utf-8") as f:
                f.write(json.dumps(run, ensure_ascii=False) + "\n")
            request = run["request"] and {**run["request"], "source_context": f"<{len(run['request']['source_context'])} caractères de HTML lus par l'agent>"}
            emit({"type": "end", **{k: run[k] for k in ("outcome", "order", "item", "why", "considered", "final_text", "turns")},
                  "site": public_site(run["site"]) if run["site"] else None, "request": request})
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
    print(f"Chat de la sandbox -> {url}   (Ctrl+C pour arrêter)")
    if a.open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
