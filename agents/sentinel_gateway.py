"""L'entrée de SentinelL1 : toute transaction d'agent passe ici avant d'être inscrite sur la chaîne.

L'agent ne sait rien de cette couche : il envoie sa transaction comme à n'importe quelle blockchain. C'est la
chaîne qui la vérifie. La passerelle l'analyse avec notre outil MCP verify_payment (guard/, le garde), qui dit si
elle est piégée, puis inscrit la décision on-chain via l'API authorize de Walid (sentinel_chain.py) :
    saine        -> visa à usage unique : le GuardedVault laissera passer ce paiement, et lui seul
    frauduleuse  -> refusée, destinataire flagué : la prochaine fois, refus direct
    doute        -> en attente d'un humain

La transaction porte ce que l'agent a lu pour la décider (`source_context`, `context`), comme une métadonnée de
paiement : c'est ce qui permet de reconnaître une transaction piégée par une page ou un document empoisonné.
"""
from __future__ import annotations

import threading

from agents.guard_client import GuardClient
from agents.sentinel_chain import SentinelChain, short_reason

STATUS = {"allow": "approved", "needs_approval": "pending_human", "block": "refused"}


def verdict_summary(v: dict, latency_ms: float | None, backend: str | None) -> dict:
    """Ce que l'interface montre de l'analyse."""
    return {"verdict": v["verdict"], "trust_score": v.get("trust_score"), "risk_score": v.get("risk_score"),
            "severity": v.get("severity"), "reasons": [short_reason([r], 220) for r in (v.get("reasons") or [])[:6]],
            "owasp": v.get("owasp") or [], "onchain_flagged": bool(v.get("onchain_flagged")),
            "instruction_id": v.get("instruction_id"), "latency_ms": latency_ms, "backend": backend}


class SentinelGateway:
    def __init__(self, guard: GuardClient, chain: SentinelChain | None):
        self.guard, self.chain = guard, chain
        self._lock = threading.Lock()  # le garde écrit son état (file humaine, registre menaces) : une transaction à la fois

    def submit(self, tx: dict, site: dict | None = None, item: str = "", emit=lambda ev: None) -> dict:
        """Une transaction arrive à l'entrée de la chaîne : analyse, puis décision inscrite on-chain."""
        emit({"type": "guard", "status": "checking"})
        with self._lock:
            verdict, ms = self.guard.verify(tx)
        emit({"type": "verdict", **verdict_summary(verdict, ms, self.guard.backend)})
        onchain = None
        if self.chain:
            emit({"type": "chain", "status": "writing", "api": self.chain.base})
            onchain = self.chain.authorize(verdict, site, item=item)
            emit({"type": "onchain", **onchain})
        return {"status": STATUS[verdict["verdict"]], "verdict": verdict, "latency_ms": ms, "onchain": onchain}
