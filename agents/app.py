"""Interface de chat de la sandbox, sur le principe d'un atelier d'agents : on règle les consignes de chaque
agent, puis on lui écrit une demande d'achat. Il cherche parmi les 5 boutiques d'Apple Watch, justifie
chaque étape, choisit, et s'arrête juste avant le paiement. Tout s'affiche en direct dans le navigateur.

    cd agents/ui && npm install && npm run build     # une fois, puis après chaque modification de l'interface
    .venv/Scripts/python agents/app.py --open        # http://127.0.0.1:8765

L'interface est une application React (agents/ui/src). Ce serveur sert sa version construite (agents/ui/dist) et
l'API qu'elle appelle. Pour la modifier en direct : `npm run dev` dans agents/ui, avec ce serveur lancé à côté.

Le parcours complet. L'agent est un agent ordinaire, non sécurisé, qui ne sait rien du garde : il choisit une
boutique et envoie sa transaction à SentinelL1. C'est la chaîne qui la vérifie : à son entrée
(sentinel_gateway.py), notre outil MCP verify_payment dit si la transaction est piégée, puis la décision est
inscrite on-chain par l'API authorize de Walid : saine -> visa à usage unique, frauduleuse -> refusée et
destinataire flagué, doute -> en attente d'un humain. Chaque décision apparaît dans l'explorateur et la ville 3D.

    --guard engine|stub|off     vérification à l'entrée de SentinelL1 (défaut engine) ; off = la transaction
                                est préparée mais pas envoyée
    --chain URL|off             défaut https://rpc.petroi.fr (env SENTINEL_API) ; off = décision locale seulement
    GUARD_LLM=on                l'analyse consulte aussi Claude (Bedrock), sinon heuristiques seules

Les boutiques sont des fichiers locaux et le serveur n'écoute que sur 127.0.0.1. Seule la décision (transaction,
raisons, scores) part vers l'API authorize quand la chaîne est branchée. Chaque run est enregistré dans
agents/out/runs.jsonl.
"""
from __future__ import annotations

import argparse
import json
import os
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
from agents.guard_client import GuardClient  # noqa: E402
from agents.sandbox_agent import run_open  # noqa: E402
from agents.sentinel_chain import API as CHAIN_API, SentinelChain  # noqa: E402
from agents.sentinel_gateway import SentinelGateway, verdict_summary  # noqa: E402

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
SITE_PATH = re.compile(r"/site/([a-z0-9]+)/([a-z.]*)")
_llms: dict[str, BedrockLLM] = {}
_gateway: SentinelGateway | None = None  # l'entrée de SentinelL1, réglée au lancement (--guard, --chain)


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
            return self._json(200, {"sites": [public_site(k) for k in world.SITES], "models": MODELS, "default_model": MODEL_ID,
                                    "guard": _gateway.guard.backend if _gateway else None,
                                    "chain": _gateway.chain.base if _gateway and _gateway.chain else None})
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
            # l'agent ne connaît pas le garde : il choisit, puis prépare sa transaction
            run = run_open(prompt, llm, instructions=instructions, emit=emit)
            if run["request"] and _gateway:  # il l'envoie à SentinelL1, qui la vérifie à son entrée
                emit({"type": "submit", "network": "SentinelL1"})
                receipt = _gateway.submit(run["request"], public_site(run["site"]) if run["site"] else None, run["item"], emit)
                run.update(outcome="submitted", status=receipt["status"], verdict=receipt["verdict"],
                           latency_ms=receipt["latency_ms"], onchain=receipt["onchain"])
            run.update(agent=agent, model=model, backend=_gateway.guard.backend if _gateway else None,
                       started=time.strftime("%Y-%m-%dT%H:%M:%S"))
            OUT.mkdir(exist_ok=True)
            with (OUT / "runs.jsonl").open("a", encoding="utf-8") as f:
                f.write(json.dumps(run, ensure_ascii=False) + "\n")
            request = run["request"] and {**run["request"], "source_context": f"<{len(run['request']['source_context'])} caractères de HTML lus par l'agent>"}
            emit({"type": "end", **{k: run[k] for k in ("outcome", "order", "item", "why", "chosen", "considered", "final_text", "turns")},
                  "site": public_site(run["site"]) if run["site"] else None, "request": request,
                  **({"verdict": verdict_summary(run["verdict"], run["latency_ms"], run["backend"]), "onchain": run["onchain"]}
                     if run["verdict"] else {})})
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
    p.add_argument("--guard", choices=["engine", "stub", "off"], default=os.environ.get("GUARD_BACKEND", "engine"),
                   help="vérification des transactions à l'entrée de SentinelL1 (défaut engine : le vrai moteur guard/)")
    p.add_argument("--chain", default=CHAIN_API, help="API authorize de SentinelL1, ou off")
    a = p.parse_args()
    if a.guard != "off":
        _gateway = SentinelGateway(GuardClient(a.guard), SentinelChain(a.chain) if a.chain != "off" else None)
    url = f"http://127.0.0.1:{a.port}/"
    server = ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    print(f"Chat de la sandbox -> {url}   (Ctrl+C pour arrêter)")
    print(f"  entrée SentinelL1 : garde {_gateway.guard.backend if _gateway else 'off'}, "
          f"chaîne {_gateway.chain.base if _gateway and _gateway.chain else 'off'}, "
          f"Claude dans l'analyse : {os.environ.get('GUARD_LLM', 'off')}")
    if a.open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
