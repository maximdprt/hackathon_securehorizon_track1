"""Lance l'agent shopping sur les scénarios, sans garde puis avec garde, et s'arrête au verdict.

    .venv/Scripts/python agents/run_shopping.py                          # tous les scénarios, garde off puis on
    .venv/Scripts/python agents/run_shopping.py --scenario legit_store --guard on
    .venv/Scripts/python agents/run_shopping.py --model us.anthropic.claude-sonnet-4-6   # un agent qui résiste seul
    GUARD_BACKEND=stub .venv/Scripts/python agents/run_shopping.py       # force le garde de remplacement

Chaque run ajoute une ligne à agents/out/runs.jsonl (ordre produit par l'agent, requête envoyée au
garde, verdict, attendu, latence). Code de sortie 1 si un verdict obtenu diffère de l'attendu.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from agents.guard_client import GuardClient  # noqa: E402
from agents.llm import BedrockLLM  # noqa: E402
from agents.shopping_agent import SCENARIOS, run_agent  # noqa: E402

OUT = ROOT / "agents" / "out"


def show(run: dict) -> None:
    print(f"  pages lues : {run['pages'] or '-'}   tours : {run['turns']}")
    o = run["order"]
    if o:
        print(f"  ordre de l'agent : {o['action']} {o['amount']} {o['currency']} -> {o['recipient']}")
    if run["outcome"] == "executed":
        print("  pas de garde : EXÉCUTÉ (simulé)")
    elif run["outcome"] == "verdict":
        v = run["verdict"]
        print(f"  verdict : {v['verdict'].upper()}   risk={v['risk_score']:.2f}   latence={run['latency_ms']} ms   attendu={run['expected']}")
        for r in v["reasons"][:6]:
            print(f"    - {r[:150]}")
    elif run["outcome"] == "no_payment":
        print(f"  l'agent n'a pas payé : {run['final_text'][:300]}")
    else:
        print("  l'agent n'a ni payé ni conclu dans la limite de tours")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--scenario", default="all", choices=["all", *sorted(SCENARIOS)])
    p.add_argument("--guard", choices=["off", "on", "both"], default="both")
    p.add_argument("--model", default=None, help="ID Bedrock de l'agent (défaut : AGENT_MODEL_ID ou Pixtral Large)")
    a = p.parse_args()

    llm = BedrockLLM(a.model)
    OUT.mkdir(exist_ok=True)
    mismatch = False
    for scenario in SCENARIOS if a.scenario == "all" else [a.scenario]:
        for guarded in {"off": [False], "on": [True], "both": [False, True]}[a.guard]:
            guard = GuardClient() if guarded else None
            print(f"\n=== {scenario} · garde {'ON (' + guard.backend + ')' if guard else 'OFF'} · agent {llm.model_id}")
            run = run_agent(scenario, llm, guard)
            run.update(model=llm.model_id, backend=guard.backend if guard else None, started=time.strftime("%Y-%m-%dT%H:%M:%S"))
            if run["outcome"] == "verdict":
                run["ok"] = run["verdict"]["verdict"] == run["expected"]
                mismatch |= not run["ok"]
            show(run)
            with (OUT / "runs.jsonl").open("a", encoding="utf-8") as f:
                f.write(json.dumps(run, ensure_ascii=False) + "\n")
    print(f"\n-> {(OUT / 'runs.jsonl').relative_to(ROOT)}")
    sys.exit(1 if mismatch else 0)


if __name__ == "__main__":
    main()
