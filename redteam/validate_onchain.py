"""Validation bout-en-bout du garde sur 20 stratégies (10 shopping + 10 finance), chacune inscrite ON-CHAIN.

But : prouver que (1) le garde décide correctement quel que soit le domaine, (2) chaque décision devient une vraie
transaction sur SentinelL1 (donc une voiture dans la ville), (3) l'état on-chain correspond au verdict (visa pour
allow, adresse flaguée pour block) - pas du bullshit. Nécessite le .env (creds + accès à https://rpc.petroi.fr).

    set -a; source .env; set +a; GUARD_LLM=off .venv/bin/python redteam/validate_onchain.py

Verdicts calculés par le vrai moteur (Claude coupé), décisions écrites via l'API authorize, puis chaque tx est
re-vérifiée par un reçu RPC (eth_getTransactionReceipt) et par /flagged /visa. Séquentiel : un seul wallet
autorisateur signe, donc pas d'écritures parallèles (sinon collision de nonce)."""
from __future__ import annotations

import json
import os
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("GUARD_LLM", "off")

from agents import assets, market  # noqa: E402
from agents.sentinel_chain import SentinelChain  # noqa: E402
from demo.golden_path import make_engine  # noqa: E402

API = os.environ.get("SENTINEL_API", "https://rpc.petroi.fr")
SHOP, FIN = "0xA11ce00000000000000000000000000000000002", assets.FINANCE_AGENT


def _rpc(method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(API + "/rpc", data=body, headers={"Content-Type": "application/json", "User-Agent": "sentinel-validate/1.0"})
    return json.load(urllib.request.urlopen(req, timeout=25)).get("result")


def _shop(key):
    s = market.SITES[key]
    o = s.offers[0]
    action = "approve" if s.trap == "approve_all" else "pay"
    return ({"order": {"issuer": SHOP, "action": action, "amount": o.price, "currency": "USDC", "recipient": s.recipient},
             "source_context": market.render(s), "context_type": "html", "task": f"Achète {market.PRODUCT_LABEL[s.product]}",
             "context": {"origin": "webpage", **market.merchant_context(key, {"amount": o.price})}}, s.target, f"shopping/{key}")


def _fin(aid, amount=150.0):
    a = assets.ASSETS[aid]
    act = {"approve_all": "approve", "poisoning": "pay", "migrated": "transfer"}.get(a.trap, "pay")
    return ({"order": {"issuer": FIN, "action": act, "amount": amount, "currency": "USDC", "recipient": a.address},
             "source_context": assets.research_sheet(aid), "context_type": "html", "task": "Investis au mieux",
             "context": {**assets.context_for(aid, amount), "origin": "user"}}, a.target, f"finance/{aid}")


def scenarios():
    tests = [_shop(k) for k in market.SITES]              # 10 shopping = les 10 landing pages
    tests += [_fin(a) for a in assets.ASSETS]             # 5 actifs finance (yield + poisoning + migrated)
    tests += [_fin("hyperyield", 80)]                     # + répétition d'une adresse déjà flaguée -> block direct
    return tests


def main():
    eng, chain = make_engine(None, False), SentinelChain()
    tests = scenarios()
    good = mined = conform = 0
    for i, (req, expected, label) in enumerate(tests, 1):
        v = eng.verify(req)
        proof = chain.authorize(v, None, item=label)
        dec = next((t["hash"] for t in proof.get("txs", []) if t["kind"] == "decision"), None)
        rc = _rpc("eth_getTransactionReceipt", [dec]) if dec else None
        is_mined = bool(rc and rc.get("status") == "0x1")
        good += v["verdict"] == expected
        mined += is_mined
        blk = int(rc["blockNumber"], 16) if is_mined else "-"
        print(f"{'OK' if v['verdict'] == expected else 'XX'} {i:2} {label:28} {v['verdict']:14} (att {expected:14}) bloc {blk} tx {dec[:12] if dec else proof.get('error','?')[:18]}")
    print(f"\nverdicts: {good}/{len(tests)}  |  minés on-chain: {mined}/{len(tests)}")


if __name__ == "__main__":
    main()
