"""Point d'entrée Lambda : héberge l'agent (navigateur agentique) + le garde + la chaîne, derrière une URL publique.

Sert la même expérience que `agents/app.py` en local :
  GET  /                      -> l'interface React (agents/ui/dist)
  GET  /assets/<fichier>      -> les fichiers de l'interface
  GET  /api/world             -> boutiques, modèles, profil acheteur
  POST /api/run               -> un run complet de l'agent, rendu en ndjson (un geste par ligne). Le garde juge au
                                 clic "Payer", la décision s'inscrit sur SentinelL1 (voiture dans la ville), et le
                                 verdict voyage dans l'événement final. L'interface rejoue le flux à vitesse humaine.

API Gateway coupe à 30 s : le modèle par défaut est Haiku (rapide) et le nombre de tours est borné. Données
synthétiques uniquement. Le garde tourne en in-process (GUARD_LLM=off), la chaîne via SENTINEL_API (rpc.petroi.fr).
"""
from __future__ import annotations

import base64
import json
import os
import re
import sys
import time
from pathlib import Path

os.environ.setdefault("AGENTS_OUT_DIR", "/tmp/agents_out")
os.environ.setdefault("GUARD_LLM", "off")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from agents import assets, world  # noqa: E402
from agents.app import MODELS, public_site, _commit  # noqa: E402
from agents.browser_agent import PROFILE, masked, run_browser  # noqa: E402
from agents.hermes_agent import run_hermes  # noqa: E402
from agents.guard_client import GuardClient  # noqa: E402
from agents.llm import BedrockLLM  # noqa: E402
from agents.sentinel_chain import SentinelChain  # noqa: E402
from agents.sentinel_gateway import verdict_summary  # noqa: E402

import agents as _agents  # noqa: E402
DIST = Path(_agents.__file__).resolve().parent / "ui" / "dist"
ASSET_TYPES = {".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml",
               ".map": "application/json", ".woff2": "font/woff2", ".png": "image/png"}
# photo d'un produit déposée dans agents/sites/images : /sites/images/<boutique>/<produit> (cf agents/app.py)
IMAGE_PATH = re.compile(r"/sites/images/([a-z0-9]+)/([a-z0-9-]+)")
# Lambda : Haiku par défaut (rapide, pour tenir sous les 30 s d'API Gateway), le garde en moteur, Claude coupé.
DEFAULT_MODEL = os.environ.get("AGENT_MODEL_ID", "us.anthropic.claude-haiku-4-5-20251001-v1:0")
MAX_TURNS = int(os.environ.get("LAMBDA_MAX_TURNS", "18"))
# en Lambda, seul /tmp est inscriptible : le moteur du garde y écrit son état jetable
import demo.golden_path as _gp  # noqa: E402
_gp.OUT = Path("/tmp/guard_out")
# le garde lit les menaces on-chain (refus direct d'une adresse déjà flaguée, même à froid)
os.environ.setdefault("GUARD_CONTRACT_ADDRESS", "0x7A7e5F80BE65F588DF975C4Aa563BA442db8bcb6")
os.environ.setdefault("AVAX_RPC_URL", "https://rpc.petroi.fr/rpc")
_llms: dict[str, BedrockLLM] = {}
_guard = None  # construits à la première requête (l'init Lambda reste légère, les erreurs remontent en 500 lisible)
_chain = None


def _guard_chain():
    global _guard, _chain
    if _guard is None:
        # en Lambda seul /tmp est inscriptible : le garde y copie data/ et y écrit son état jetable
        _guard = GuardClient(os.environ.get("GUARD_BACKEND", "engine"), data_dir=Path("/tmp/guard_data"))
        _chain = None if os.environ.get("SENTINEL_API") == "off" else SentinelChain()
    return _guard, _chain


def _resp(code, body, ctype="application/json", b64=False):
    return {"statusCode": code, "isBase64Encoded": b64,
            "headers": {"Content-Type": ctype, "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*"},
            "body": body}


def _world():
    buyer = masked(PROFILE)
    guard, chain = _guard_chain()
    return _resp(200, json.dumps({"sites": [public_site(k) for k in world.ALL_SITES], "models": MODELS,
                                  "default_model": DEFAULT_MODEL if DEFAULT_MODEL in MODELS else next(iter(MODELS)),
                                  "profile": {"name": buyer["name"], "city": buyer["city"], "card": buyer["card_number"]},
                                  "guard": guard.backend, "chain": chain.base if chain else None}, ensure_ascii=False))


def _run(body: dict):
    prompt = str(body.get("prompt", "")).strip()
    model = body.get("model") if body.get("model") in MODELS else DEFAULT_MODEL
    instructions, agent = str(body.get("instructions", "")).strip(), str(body.get("agent", "")).strip()
    if not prompt or len(prompt) > 2000 or len(instructions) > 4000:
        return _resp(400, json.dumps({"error": "bad request"}))
    guard, chain = _guard_chain()
    events: list[dict] = []
    llm = _llms.get(model) or _llms.setdefault(model, BedrockLLM(model))
    if (body.get("mode") if body.get("mode") in ("shop", "finance") else "shop") == "finance":
        # chain=None : on ne grave pas pendant le run ; l'interface reposte à /api/authorize au paiement (voiture au bon moment)
        run = run_hermes(prompt, llm, guard=guard, chain=None, instructions=instructions, emit=events.append, max_turns=MAX_TURNS)
        req = run["request"] and {**run["request"], "source_context": f"<{len(run['request']['source_context'])} caractères lus par l'agent>"}
        if run["verdict"] and chain:  # l'ordre entre dans SentinelL1 : écriture déclenchée par l'interface
            a = assets.ASSETS.get(run.get("asset") or "")
            site = {"name": a.name, "domain": a.domain} if a else None
            events.append({"type": "submit", "network": "SentinelL1", "commit": _commit(run["verdict"], site, a.name if a else "")})
        events.append({"type": "end", "outcome": run["outcome"], "order": run["order"], "chosen": run.get("asset") or "", "why": run["why"],
                       "considered": [], "submitted": None, "confirmation": None, "expected": None, "final_text": run["final_text"],
                       "turns": run["turns"], "site": None, "request": req,
                       **({"verdict": verdict_summary(run["verdict"], run["latency_ms"], guard.backend), "onchain": None} if run["verdict"] else {})})
        return _resp(200, "\n".join(json.dumps(e, ensure_ascii=False, default=str) for e in events) + "\n", "application/x-ndjson; charset=utf-8")
    run = run_browser(prompt, llm, guard=guard, instructions=instructions, emit=events.append, pace=0.0, max_turns=MAX_TURNS)
    if run["verdict"] and chain:  # la transaction entre dans SentinelL1 ; on n'inscrit pas tout de suite :
        # l'interface reposte à /api/authorize quand le rejeu atteint le paiement, pour que la voiture parte à cet instant
        item = ", ".join(world.PRODUCTS[p]["name"] for p in run.get("items", {})) or run.get("chosen", "")
        events.append({"type": "submit", "network": "SentinelL1",
                       "commit": _commit(run["verdict"], public_site(run["site"]) if run["site"] else None, item)})
        run["onchain"] = None  # inscrit par l'appel /api/authorize de l'interface, révélé après la voiture
    req = run["request"] and {**run["request"], "source_context": f"<{len(run['request']['source_context'])} caractères de HTML lus par l'agent>"}
    keys = ("outcome", "order", "chosen", "why", "considered", "submitted", "confirmation", "expected", "final_text", "turns")
    events.append({"type": "end", **{k: run[k] for k in keys}, "site": public_site(run["site"]) if run["site"] else None, "request": req,
                   **({"verdict": verdict_summary(run["verdict"], run["latency_ms"], guard.backend), "onchain": run.get("onchain")} if run["verdict"] else {})})
    ndjson = "\n".join(json.dumps(e, ensure_ascii=False, default=str) for e in events) + "\n"
    return _resp(200, ndjson, "application/x-ndjson; charset=utf-8")


def _authorize(body: dict):
    """L'interface déclenche l'écriture on-chain au moment du paiement du rejeu : la voiture part dans la ville à cet instant."""
    guard, chain = _guard_chain()
    if chain is None or not isinstance(body.get("verdict"), dict):
        return _resp(400, json.dumps({"error": "bad request"}))
    onchain = chain.authorize(body["verdict"], body.get("site"), item=str(body.get("item", "")))
    return _resp(200, json.dumps(onchain, ensure_ascii=False, default=str))


def _asset(name: str):
    f = DIST / "assets" / Path(name).name
    if not f.is_file() or f.suffix not in ASSET_TYPES:
        return _resp(404, json.dumps({"error": "not found"}))
    data = f.read_bytes()
    text = f.suffix in (".js", ".css", ".svg", ".map")
    return _resp(200, data.decode() if text else base64.b64encode(data).decode(), ASSET_TYPES[f.suffix], b64=not text)


def handler(event, context):
    method = (event.get("requestContext", {}).get("http", {}) or {}).get("method", "GET")
    path = event.get("rawPath") or event.get("path") or "/"
    try:
        if path == "/" or path == "":
            index = DIST / "index.html"
            return _resp(200, index.read_text(encoding="utf-8"), "text/html; charset=utf-8") if index.is_file() \
                else _resp(503, "<h1>Interface non construite</h1>", "text/html; charset=utf-8")
        if path.startswith("/assets/"):
            return _asset(path[len("/assets/"):])
        img = IMAGE_PATH.fullmatch(path)
        if img:  # boutique + produit : world.product_image cherche la photo dans le dossier (jamais un nom de fichier arbitraire)
            f = world.product_image(*img.groups())
            if f is None or f.suffix.lower() not in world.IMAGE_TYPES:
                return _resp(404, json.dumps({"error": "not found"}))
            return _resp(200, base64.b64encode(f.read_bytes()).decode(), world.IMAGE_TYPES[f.suffix.lower()], b64=True)
        if path == "/api/world":
            return _world()
        if path in ("/api/run", "/api/authorize") and method == "POST":
            raw = event.get("body") or "{}"
            if event.get("isBase64Encoded"):
                raw = base64.b64decode(raw).decode()
            return _run(json.loads(raw)) if path == "/api/run" else _authorize(json.loads(raw))
        return _resp(404, json.dumps({"error": "not found"}))
    except Exception as e:  # jamais de 502 muet
        import traceback
        return _resp(500, json.dumps({"error": f"{type(e).__name__}: {e}", "trace": traceback.format_exc()[-1500:]}))
