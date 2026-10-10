"""Le verdict du garde, inscrit sur SentinelL1 par l'API authorize de Walid (api/server.py).

    allow           -> visa à usage unique (grantVisa) : le GuardedVault laissera passer CE paiement, et lui seul
    block           -> destinataire flagué (flagThreat, sévérité 3) : la prochaine fois, refus direct
    needs_approval  -> décision "needs_human" enregistrée : la voiture se gare, un humain tranche
Chaque décision est aussi écrite en event DecisionRecorded (piste d'audit DORA), puis rediffusée à la ville 3D.

Le client ne lève jamais : si la chaîne ne répond pas, le verdict du garde tient, mais sans visa le paiement
ne peut pas passer le GuardedVault (échec fermé).

Env : SENTINEL_API (défaut https://rpc.petroi.fr, "off" pour couper), SENTINEL_EXPLORER, SENTINEL_CITY.
"""
from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.request

API = os.environ.get("SENTINEL_API", "https://rpc.petroi.fr")
EXPLORER = os.environ.get("SENTINEL_EXPLORER", "https://explorer.petroi.fr")
CITY = os.environ.get("SENTINEL_CITY", "https://city.petroi.fr/?live=1")
ONCHAIN_VERDICT = {"allow": "allow", "block": "block", "needs_approval": "needs_human"}  # noms de api/server.py
DECIMALS = 18  # montant en wei de SEC, l'unité que GuardedVault.pay compare au visa
TX_KINDS = (("visa_tx", "visa"), ("flag_tx", "flag"), ("decision_tx", "decision"))
REASON_PREFIX = re.compile(r"^\[[a-z_]+\]\s*|\s\(-[\d.]+\)")


def short_reason(reasons: list[str], limit: int = 200) -> str:
    """Les raisons du garde sans leur couche ni leur coût, assez courtes pour un event on-chain."""
    return "; ".join(REASON_PREFIX.sub("", r) for r in reasons)[:limit]


class SentinelChain:
    def __init__(self, base: str = API, explorer: str = EXPLORER, city: str = CITY, timeout: float = 60):
        self.base, self.explorer, self.city, self.timeout = base.rstrip("/"), explorer.rstrip("/"), city, timeout

    def authorize(self, verdict: dict, site: dict | None, item: str = "", ttl: int = 300) -> dict:
        """Envoie le verdict à POST /authorize. Rend la preuve on-chain, ou {"ok": False, "error"} sans lever."""
        body = {
            "payment": {"issuer": verdict["issuer"], "recipient": verdict["recipient"],
                        "amount": int(round(float(verdict["amount"]) * 10**DECIMALS)), "nonce": time.time_ns() // 1000},
            "verdict": ONCHAIN_VERDICT[verdict["verdict"]],
            "reason": short_reason(verdict.get("reasons") or []),
            "ttl": ttl,
            "full": json.loads(json.dumps(verdict, default=str)),
            "context": {"issuer_label": "shopping-agent", "recipient_label": (site or {}).get("name") or verdict["recipient"],
                        "merchant_domain": (site or {}).get("domain"), "item": item, "source": "sandbox-chat"},
        }
        req = urllib.request.Request(f"{self.base}/authorize", data=json.dumps(body).encode(), method="POST",
                                     headers={"Content-Type": "application/json", "User-Agent": "sentinel-sandbox/1.0"})
        t = time.perf_counter()
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as res:
                out = json.loads(res.read())
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")[:300]
            return {"ok": False, "error": f"API authorize {e.code} : {detail}", "verdict": body["verdict"]}
        except Exception as e:  # réseau coupé, DNS, timeout
            return {"ok": False, "error": f"{type(e).__name__} : {str(e)[:300]}", "verdict": body["verdict"]}
        txs = [{"kind": kind, "hash": out[key], "url": f"{self.explorer}/tx/{out[key]}"} for key, kind in TX_KINDS if out.get(key)]
        return {"ok": True, "verdict": body["verdict"], "payment_id": out.get("payment_id"), "nonce": out.get("nonce"),
                "txs": txs, "city": self.city, "latency_ms": round((time.perf_counter() - t) * 1000)}
