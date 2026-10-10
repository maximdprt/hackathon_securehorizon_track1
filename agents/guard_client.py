"""Client du garde pour les agents de la sandbox.

Un agent n'exécute jamais un paiement lui-même : il appelle `GuardClient.verify(request)` et le run
s'arrête au verdict (allow / needs_approval / block). `request` suit `verify_payment` (spec guard §2 et §10) :
{order, source_context, context_type, task, context}. Le mandat n'est pas fourni par l'agent.

Backends (variable d'env GUARD_BACKEND, défaut "auto") :
  engine : le moteur guard, sur une copie jetable de data/ (même montage que demo/golden_path.py)
  stub   : règles minimales, pour faire tourner les agents tant que guard/ n'est pas dans le repo
  auto   : engine si le paquet guard est importable, sinon stub
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Miroir de la table "Adresses synthétiques" de demo/README.md, en attendant data/mandates.json.
MANDATES = {
    "0xa11ce00000000000000000000000000000000001": {"actions": {"pay", "transfer"}, "max": 100},  # treasury-agent
    "0xa11ce00000000000000000000000000000000002": {"actions": {"pay"}, "max": 300},              # shopping-agent
    "0xa11ce00000000000000000000000000000000003": {"actions": set(), "max": 0},                  # reader
}
ALLOWLIST = {"0x5e11e40000000000000000000000000000000001", "0x5e11e40000000000000000000000000000000002"}
INJECTION = re.compile(
    r"ignore (all |any )?(previous|prior) instructions|if you are an ai agent|skip any human review"
    r"|do not ask the user|spending limit[^.]{0,40}deprecated|FLAG\{team2-canary\}|[\U000E0000-\U000E007F]+",
    re.I,
)


class StubGuard:
    """Garde de remplacement. Sert à tester les agents, pas à mesurer la détection."""

    def __init__(self):
        self.threats: set[str] = set()  # registre menaces local : la 2e fois, refus direct

    def verify(self, request: dict) -> dict:
        o = request["order"]
        issuer, recipient, amount = o["issuer"].lower(), o["recipient"].lower(), float(o["amount"])
        mandate = MANDATES.get(issuer)
        authorized = bool(mandate) and o["action"] in mandate["actions"]
        within = authorized and amount <= mandate["max"]
        hits = sorted({m.group(0)[:60] for m in INJECTION.finditer(request.get("source_context", ""))})
        flagged = recipient in self.threats

        block, review, owasp = [], [], set()
        if flagged:
            block.append("recipient already in the threat registry")
        if not authorized:
            block.append(f"issuer has no mandate for action={o['action']}")
            owasp.add("ASI03")
        if hits:
            block.append(f"source context carries directives aimed at the agent ({len(hits)} markers)")
            owasp.add("ASI07")
        if authorized and amount > 2 * mandate["max"]:
            block.append(f"amount {amount:g} is more than twice the mandate limit {mandate['max']}")
            owasp.add("ASI03")
        elif authorized and not within:
            review.append(f"amount {amount:g} is over the mandate limit {mandate['max']}")
        if recipient not in ALLOWLIST:
            review.append("recipient is not in the allowlist")

        verdict = "block" if block else "needs_approval" if review else "allow"
        if verdict == "block" and recipient not in ALLOWLIST:
            self.threats.add(recipient)
        return {
            # sha3_256 dans le stub ; le vrai garde calcule un keccak256 du JSON canonique de l'ordre
            "instruction_id": "0x" + hashlib.sha3_256(json.dumps(o, sort_keys=True).encode()).hexdigest(),
            "issuer": o["issuer"], "action": o["action"], "amount": o["amount"],
            "currency": o.get("currency", "USDC"), "recipient": o["recipient"],
            "verdict": verdict,
            "risk_score": {"block": 0.95, "needs_approval": 0.5, "allow": 0.05}[verdict],
            "reasons": block + review,
            "owasp": sorted(owasp),
            "authority_check": {"authorized": authorized, "within_limit": within, "source": "stub"},
            "poison_check": {"is_poisoned": bool(hits), "confidence": 0.9 if hits else 0.0, "evidence": hits},
            "onchain_flagged": flagged,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }


class EngineGuard:
    """Le moteur guard, état jetable dans demo/out/data, registre menaces vierge au départ."""

    def __init__(self):
        from demo.golden_path import make_engine
        self.engine = make_engine(None, os.environ.get("GUARD_LLM", "off") == "on")

    def verify(self, request: dict) -> dict:
        return self.engine.verify(request)


class GuardClient:
    def __init__(self, backend: str | None = None):
        backend = backend or os.environ.get("GUARD_BACKEND", "auto")
        if backend == "auto":
            backend = "engine" if importlib.util.find_spec("guard") else "stub"
        self.backend = backend
        self._impl = {"engine": EngineGuard, "stub": StubGuard}[backend]()

    def verify(self, request: dict) -> tuple[dict, float]:
        """Renvoie (verdict, latence en ms)."""
        t = time.perf_counter()
        verdict = self._impl.verify(request)
        return verdict, round((time.perf_counter() - t) * 1000, 2)
