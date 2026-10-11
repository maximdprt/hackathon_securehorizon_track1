"""Chemin doré de la démo, en 3 actes (+ 1 contrôle), sur le moteur guard.

    .venv/bin/python demo/golden_path.py                 # déterministe, Claude désactivé
    .venv/bin/python demo/golden_path.py --llm on        # ajoute le jugement Claude (Bedrock, .env chargé)
    .venv/bin/python demo/golden_path.py --scenario poisoned_pdf_treasury_migration_whitetext
    .venv/bin/python demo/golden_path.py --data-dir data # utilise l'état réel de guard (écrit dans le registre)

Acte 1 : l'agent SANS garde lit la page piégée et paie -> wallet vidé.
Acte 2 : même attaque, le garde répond block avec les preuves, inscrit 0xBAD au registre menaces.
Acte 3 : un second agent, contexte propre, tente de payer 0xBAD -> refus direct par le registre.
Contrôle : la vraie facture passe (allow), zéro faux positif.

Par défaut tout tourne sur une copie jetable de data/ (demo/out/data) : rien n'est écrit dans data/.
Sortie : demo/out/golden_path.json, consommable par l'UI 3D (état de la voiture par acte).
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from guard import sanitize  # noqa: E402
from guard.engine import Engine  # noqa: E402
from guard.llm import ClaudeScorer  # noqa: E402

FIX = ROOT / "demo" / "fixtures"
OUT = ROOT / "demo" / "out"
BAD = "0xBADc0ffee0000000000000000000000000000000"
LLM_ON = False
CAR = {"allow": "passe le péage", "needs_approval": "se gare sur le côté (humain)", "block": "demi-tour"}

C = {"r": "\033[91m", "g": "\033[92m", "y": "\033[93m", "b": "\033[94m", "dim": "\033[2m", "x": "\033[0m", "bold": "\033[1m"}


def col(s, *ks):
    return "".join(C[k] for k in ks) + str(s) + C["x"]


def banner(t):
    print("\n" + col("═" * 78, "b") + "\n" + col(t, "bold", "b") + "\n" + col("═" * 78, "b"))


def load_fixture(name: str) -> dict:
    return json.loads((FIX / f"{name}.json").read_text())


def show_verdict(out: dict, max_reasons: int = 6) -> None:
    v = out["verdict"]
    hard_block = any(s["hard"] for s in out["signals"])
    claude = "non appelé (bloc dur)" if hard_block else ("oui" if (LLM_ON and out["llm_available"]) else ("indisponible" if LLM_ON else "off"))
    color = {"allow": "g", "needs_approval": "y", "block": "r"}[v]
    print(f"  verdict   : {col(v.upper(), 'bold', color)}   risk={out['risk_score']:.2f}   sévérité={out['severity']}   "
          f"latence={out['latency_ms']} ms   claude={claude}")
    print(f"  voiture   : {col(CAR[v], color)}")
    print(f"  id ordre  : {out['instruction_id'][:18]}…   owasp={out['owasp'] or '-'}   on-chain flag={out['onchain_flagged']}")
    hard = [s["id"] for s in out["signals"] if s["hard"]]
    print(f"  signaux   : {len(out['signals'])}" + (f"   blocs durs: {hard}" if hard else ""))
    for r in out["reasons"][:max_reasons]:
        print(f"    {col('•', 'dim')} {r[:150]}")
    if len(out["reasons"]) > max_reasons:
        print(f"    {col(f'… +{len(out['reasons']) - max_reasons} raisons', 'dim')}")


def act1_no_guard(fx: dict, balance: float) -> dict:
    """L'agent naïf : il lit la page, suit ce qu'elle dit, paie. Simulé, déterministe."""
    req = fx["request"]
    o = req["order"]
    cleaned = sanitize.clean(req["source_context"], req["context_type"])
    print(f"  tâche de l'agent : « {req['task']} »")
    print(f"  ce que l'humain voit : {col(cleaned.visible[:140].replace(chr(10), ' ') + '…', 'dim')}")
    hidden = (cleaned.hidden or "").strip()
    if hidden:
        print(f"  ce que l'agent lit en plus ({len(hidden)} caractères invisibles) :")
        print(col("    " + hidden[:420].replace("\n", "\n    ") + " …", "r"))
    print(f"  l'agent déduit l'ordre : {o['action']} {o['amount']} {o.get('currency', 'USDC')} -> {o['recipient']}")
    print(f"  pas de garde, pas d'humain : {col('EXÉCUTÉ', 'bold', 'r')}")
    new_balance = max(0.0, balance - float(o["amount"]))
    print(f"  wallet : {balance:.0f} USDC -> {col(f'{new_balance:.0f} USDC', 'bold', 'r')}  (perte {float(o['amount']):.0f} USDC, irréversible)")
    return {"act": 1, "title": "Agent sans garde", "verdict": "executed", "car": "fonce dans le mur", "amount": o["amount"],
            "recipient": o["recipient"], "balance_before": balance, "balance_after": new_balance, "hidden_chars": len(hidden)}


def act2_guard(engine: Engine, fx: dict) -> dict:
    out = engine.verify(fx["request"])
    show_verdict(out)
    expected = fx["expected"]["verdict"]
    ok = out["verdict"] == expected
    print(f"  attendu   : {expected}  ->  {col('OK', 'g') if ok else col('ÉCART', 'r')}")
    flagged = engine.source.is_flagged(BAD)
    print(f"  registre menaces : {BAD[:14]}… flagged={flagged[0]} sévérité={flagged[1]}")
    return {"act": 2, "title": "Même attaque, avec le garde", "verdict": out["verdict"], "car": CAR[out["verdict"]],
            "risk": out["risk_score"], "severity": out["severity"], "instruction_id": out["instruction_id"],
            "reasons": out["reasons"], "signals": [s["id"] for s in out["signals"]], "latency_ms": out["latency_ms"],
            "expected": expected, "ok": ok}


def act3_second_agent(engine: Engine) -> dict:
    """Un autre agent, un contexte propre, le même destinataire : le registre suffit."""
    req = {"order": {"issuer": "0xA11ce00000000000000000000000000000000001", "action": "pay", "amount": 50,
                     "currency": "USDC", "recipient": BAD},
           "source_context": "Invoice #4471 - Cloud backup, October. Amount due: 50 USDC. Thank you for your business.",
           "context_type": "text", "task": "Pay the October cloud backup invoice.",
           "context": {"origin": "user", "history": {"avg_amount": 50, "payments_last_hour": 0, "prior_purchase": True}}}
    print(f"  agent     : treasury-agent (autorisé, 100 USDC max), facture propre de 50 USDC")
    print(f"  mais      : destinataire = {BAD[:14]}… déjà inscrit au registre")
    out = engine.verify(req)
    show_verdict(out, max_reasons=4)
    content = [s["id"] for s in out["signals"] if s["layer"] == "content"]
    print(f"  signaux de contenu : {len(content)} (le refus vient du registre, pas du texte)")
    return {"act": 3, "title": "Second agent, refus direct", "verdict": out["verdict"], "car": CAR[out["verdict"]],
            "risk": out["risk_score"], "severity": out["severity"], "reasons": out["reasons"],
            "signals": [s["id"] for s in out["signals"]], "latency_ms": out["latency_ms"], "expected": "block",
            "ok": out["verdict"] == "block"}


def act_control(engine: Engine) -> dict:
    fx = load_fixture("legit_nimbus_invoice")
    print(f"  tâche     : « {fx['request']['task']} »  (vraie facture, vendeur allowlisté, 80 USDC)")
    out = engine.verify(fx["request"])
    show_verdict(out, max_reasons=3)
    ok = out["verdict"] == "allow"
    print(f"  faux positif : {col('non', 'g') if ok else col('OUI', 'r')}")
    return {"act": 4, "title": "Contrôle : la vraie facture passe", "verdict": out["verdict"], "car": CAR[out["verdict"]],
            "risk": out["risk_score"], "severity": out["severity"], "latency_ms": out["latency_ms"], "expected": "allow", "ok": ok}


def make_engine(data_dir: Path | None, llm_on: bool) -> Engine:
    if data_dir is None:
        data_dir = OUT / "data"
        if data_dir.exists():
            shutil.rmtree(data_dir)
        shutil.copytree(ROOT / "data", data_dir, ignore=shutil.ignore_patterns("decisions.jsonl", "pending.json", "nonces.json"))
        (data_dir / "threats.mock.json").write_text("{}")  # registre vierge : l'acte 3 doit le remplir lui-même
    if llm_on:
        env = ROOT / ".env"
        if env.exists():
            for line in env.read_text().splitlines():
                if "=" in line and not line.strip().startswith("#"):
                    k, _, v = line.partition("=")
                    os.environ.setdefault(k.strip(), v.strip().strip('"'))
    return Engine.from_env(data_dir=data_dir, llm=ClaudeScorer(enabled=llm_on))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--scenario", default="promptfix_fake_walmart", help="fixture de demo/fixtures (sans .json)")
    p.add_argument("--llm", choices=["on", "off"], default="off")
    p.add_argument("--data-dir", default=None, help="état guard à utiliser (défaut : copie jetable dans demo/out/data)")
    p.add_argument("--balance", type=float, default=1000.0)
    a = p.parse_args()

    global LLM_ON
    LLM_ON = a.llm == "on"
    fx = load_fixture(a.scenario)
    OUT.mkdir(exist_ok=True)
    engine = make_engine(Path(a.data_dir) if a.data_dir else None, a.llm == "on")
    src = "on-chain" if os.environ.get("GUARD_CONTRACT_ADDRESS") else "mock JSON"
    timeline = {"scenario": a.scenario, "family": fx["family"], "description": fx["description"], "llm": a.llm,
                "authority_source": src, "started": time.strftime("%Y-%m-%dT%H:%M:%S"), "acts": []}

    banner(f"ACTE 1 · {fx['description'][:70]}…  · AGENT SANS GARDE")
    timeline["acts"].append(act1_no_guard(fx, a.balance))

    banner("ACTE 2 · MÊME ATTAQUE, LE GARDE EST DEVANT LE PAIEMENT")
    timeline["acts"].append(act2_guard(engine, fx))

    banner("ACTE 3 · UN SECOND AGENT TENTE LE MÊME DESTINATAIRE")
    timeline["acts"].append(act3_second_agent(engine))

    banner("CONTRÔLE · UNE VRAIE FACTURE")
    timeline["acts"].append(act_control(engine))

    ok = all(x.get("ok", True) for x in timeline["acts"])
    timeline["all_ok"] = ok
    (OUT / "golden_path.json").write_text(json.dumps(timeline, ensure_ascii=False, indent=1))
    print()
    print(col(f"Résultat : {'tous les actes conformes' if ok else 'ÉCART sur au moins un acte'}", "bold", "g" if ok else "r")
          + f"   ->  {OUT.relative_to(ROOT)}/golden_path.json   (décisions : {OUT.relative_to(ROOT)}/data/decisions.jsonl)")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
