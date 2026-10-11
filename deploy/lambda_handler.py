"""Point d'entrée Lambda : héberge l'agent (navigateur agentique) + le garde + la chaîne, derrière une URL publique.

Sert la même expérience que `agents/app.py` en local :
  GET  /                      -> l'interface React (agents/ui/dist)
  GET  /assets/<fichier>      -> les fichiers de l'interface
  GET  /api/world             -> boutiques, modèles, profil acheteur
  POST /api/run               -> un run complet de l'agent, rendu en ndjson (un geste par ligne). Le garde juge au
                                 clic "Payer", la décision s'inscrit sur SentinelL1 (voiture dans la ville), et le
                                 verdict voyage dans l'événement final. L'interface rejoue le flux à vitesse humaine.
                                 `"guard": false` coupe le garde pour un run (le paiement part sans vérification).
  POST /api/decide            -> un humain tranche un paiement en attente (approve_pending du garde) ; la décision
                                 s'inscrit sur SentinelL1 comme les autres. La file d'attente vit dans /tmp : un autre
                                 conteneur Lambda ne la connaît pas, l'interface le dit alors (409) et on peut relancer.

API Gateway coupe à 30 s : le modèle par défaut est Haiku (rapide) et le nombre de tours est borné. Données
synthétiques uniquement. Le garde tourne en in-process (GUARD_LLM=off), la chaîne via SENTINEL_API (rpc.petroi.fr).
"""
from __future__ import annotations

import base64
import json
import os
import sys
import time
from pathlib import Path

os.environ.setdefault("AGENTS_OUT_DIR", "/tmp/agents_out")
os.environ.setdefault("GUARD_LLM", "off")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from agents import world  # noqa: E402
from agents.app import MODELS, public_asset, public_site  # noqa: E402
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
# Lambda : Haiku par défaut (rapide, pour tenir sous les 30 s d'API Gateway), le garde en moteur, Claude coupé.
DEFAULT_MODEL = os.environ.get("AGENT_MODEL_ID", "us.anthropic.claude-haiku-4-5-20251001-v1:0")
MAX_TURNS = int(os.environ.get("LAMBDA_MAX_TURNS", "18"))
# en Lambda, seul /tmp est inscriptible : le garde y copie data/ et y écrit son état jetable (mandats, file humaine, menaces)
GUARD_DATA = Path(os.environ.get("GUARD_DATA_DIR", "/tmp/guard_data"))
# le garde lit les menaces on-chain (refus direct d'une adresse déjà flaguée, même à froid)
os.environ.setdefault("GUARD_CONTRACT_ADDRESS", "0x7A7e5F80BE65F588DF975C4Aa563BA442db8bcb6")
os.environ.setdefault("AVAX_RPC_URL", "https://rpc.petroi.fr/rpc")
_llms: dict[str, BedrockLLM] = {}
_guard = None  # construits à la première requête (l'init Lambda reste légère, les erreurs remontent en 500 lisible)
_chain = None


def _guard_chain():
    global _guard, _chain
    if _guard is None:
        _guard = GuardClient(os.environ.get("GUARD_BACKEND", "engine"), GUARD_DATA)
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


def _run(body: dict, base: str | None = None):
    prompt = str(body.get("prompt", "")).strip()
    model = body.get("model") if body.get("model") in MODELS else DEFAULT_MODEL
    instructions, agent = str(body.get("instructions", "")).strip(), str(body.get("agent", "")).strip()
    mode = body.get("mode", "shop")
    if not prompt or len(prompt) > 2000 or len(instructions) > 4000 or mode not in ("shop", "finance"):
        return _resp(400, json.dumps({"error": "bad request"}))
    guard, chain = _guard_chain()
    if chain:  # la ville tranche une attente sur cette même sandbox (son /api/decide)
        chain.decide_url = base
    if not body.get("guard", True):  # l'interface peut couper le garde pour un run : rien n'est vérifié ni inscrit
        guard, chain = None, None
    backend = guard.backend if guard else None
    events: list[dict] = []
    llm = _llms.get(model) or _llms.setdefault(model, BedrockLLM(model))
    if mode == "finance":
        run = run_hermes(prompt, llm, guard=guard, chain=chain, instructions=instructions, emit=events.append, max_turns=MAX_TURNS)
        req = run["request"] and {**run["request"], "source_context": f"<{len(run['request']['source_context'])} caractères lus par l'agent>"}
        events.append({"type": "end", "outcome": run["outcome"], "order": run["order"], "chosen": run.get("asset") or "", "why": run["why"],
                       "considered": [], "submitted": None, "confirmation": None, "expected": None, "final_text": run["final_text"],
                       "turns": run["turns"], "site": None, "request": req, "asset": public_asset(run.get("asset")),
                       **({"verdict": verdict_summary(run["verdict"], run["latency_ms"], backend), "onchain": run.get("onchain")} if run["verdict"] else {})})
        return _resp(200, "\n".join(json.dumps(e, ensure_ascii=False, default=str) for e in events) + "\n", "application/x-ndjson; charset=utf-8")
    run = run_browser(prompt, llm, guard=guard, instructions=instructions, emit=events.append, pace=0.0, max_turns=MAX_TURNS)
    if run["verdict"] and chain:  # la transaction entre dans SentinelL1 : décision inscrite on-chain
        events.append({"type": "submit", "network": "SentinelL1"})
        run["onchain"] = chain.authorize(run["verdict"], public_site(run["site"]) if run["site"] else None,
                                          item=", ".join(world.PRODUCTS[p]["name"] for p in run.get("items", {})) or run.get("chosen", ""))
        events.append({"type": "onchain", **run["onchain"]})
    req = run["request"] and {**run["request"], "source_context": f"<{len(run['request']['source_context'])} caractères de HTML lus par l'agent>"}
    keys = ("outcome", "order", "chosen", "why", "considered", "submitted", "confirmation", "expected", "final_text", "turns")
    events.append({"type": "end", **{k: run[k] for k in keys}, "site": public_site(run["site"]) if run["site"] else None, "request": req,
                   **({"verdict": verdict_summary(run["verdict"], run["latency_ms"], backend), "onchain": run.get("onchain")} if run["verdict"] else {})})
    ndjson = "\n".join(json.dumps(e, ensure_ascii=False, default=str) for e in events) + "\n"
    return _resp(200, ndjson, "application/x-ndjson; charset=utf-8")


def _decide(body: dict):
    """Un humain tranche un paiement en attente (outil approve_pending), puis la décision entre dans SentinelL1."""
    try:
        iid, decision = str(body["instruction_id"]), body["decision"]
        assert decision in ("allow", "block") and len(iid) <= 100
    except Exception:
        return _resp(400, json.dumps({"error": "bad request"}))
    guard, chain = _guard_chain()
    try:
        final = guard.approve(iid, decision, "humain (interface de la sandbox)")
    except Exception as exc:  # décision déjà tranchée, ou attente gardée par un autre conteneur
        return _resp(409, json.dumps({"error": f"{type(exc).__name__}: {str(exc)[:300]}"}))
    onchain = chain.authorize(final, None, item="validation humaine") if chain else None
    return _resp(200, json.dumps({"instruction_id": iid, "verdict": final["verdict"], "trust_score": final.get("trust_score"),
                                  "approved_by": final.get("approved_by"), "onchain": onchain}, default=str))


def _body(event) -> dict:
    raw = event.get("body") or "{}"
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode()
    return json.loads(raw)


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
        if path == "/api/world":
            return _world()
        if path == "/api/run" and method == "POST":
            domain = (event.get("requestContext") or {}).get("domainName")
            return _run(_body(event), f"https://{domain}" if domain else None)
        if path == "/api/decide" and method == "POST":
            return _decide(_body(event))
        return _resp(404, json.dumps({"error": "not found"}))
    except Exception as e:  # jamais de 502 muet
        import traceback
        return _resp(500, json.dumps({"error": f"{type(e).__name__}: {e}", "trace": traceback.format_exc()[-1500:]}))
