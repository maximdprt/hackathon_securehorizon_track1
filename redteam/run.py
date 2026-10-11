"""Play every red-team case through the engine and print the KPIs the dashboard needs.

Usage: .venv/bin/python redteam/run.py            (Claude off, deterministic)
       GUARD_LLM=on .venv/bin/python redteam/run.py   (Claude on Bedrock, needs .env)
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault("GUARD_LLM", "off")

from guard.engine import Engine  # noqa: E402
from guard.llm import ClaudeScorer  # noqa: E402

ORDER: list[str] = []


def fresh_data_dir() -> Path:
    tmp = Path(tempfile.mkdtemp(prefix="guard-redteam-"))
    for f in (ROOT / "data").glob("*.json"):
        if f.name not in ("threats.mock.json", "nonces.json", "pending.json"):
            shutil.copy(f, tmp / f.name)
    (tmp / "threats.mock.json").write_text("{}")
    return tmp


def main() -> int:
    files = sorted((ROOT / "redteam" / "cases").glob("*.json")) + sorted((ROOT / "demo" / "fixtures").glob("*.json"))
    cases = {}
    for p in files:
        c = json.loads(p.read_text(encoding="utf-8"))
        if "request" not in c or "expected" not in c:
            continue
        if isinstance(c["expected"], dict):  # demo fixture format
            c["expected"] = [c["expected"]["verdict"]]
            c["family"] = "control" if c["expected"] == ["allow"] else c.get("family", "demo")
        cases[p.stem if p.parent.name == "cases" else "demo_" + p.stem] = c
    names = ORDER + [n for n in cases if n not in ORDER]
    llm = ClaudeScorer(enabled=os.environ["GUARD_LLM"].lower() not in ("off", "0", "false"))

    rows, attacks, controls = [], [], []
    for n in names:
        c = cases[n]
        engine = Engine.from_env(fresh_data_dir(), llm=llm)  # isolated registry per case
        req = json.loads(json.dumps(c["request"]))
        replay = req.get("context", {}).pop("_replay", 1)
        after = req.get("context", {}).pop("_after", None)
        if after:  # golden path act 3: the registry already holds the incident from the earlier case
            engine.verify(json.loads(json.dumps(cases[after]["request"])))
        out = None
        for _ in range(replay):
            out = engine.verify(req)
        ok = out["verdict"] in c["expected"]
        rows.append((n, c["family"], "/".join(c["expected"]), out["verdict"], out["trust_score"], out["severity"], out["latency_ms"], ok,
                     [s["id"] for s in out["signals"]], out["risk_score"]))
        (controls if c["family"] == "control" else attacks).append(ok)

    w = max(len(r[0]) for r in rows)
    print(f"{'case':<{w}}  {'fam':<8} {'expected':<22} {'got':<15} {'trust':>5} {'sev':>3} {'ms':>6}  ok  signals")
    for r in rows:
        print(f"{r[0]:<{w}}  {r[1]:<8} {r[2]:<22} {r[3]:<15} {r[4]:>5d} {r[5]:>3} {r[6]:>6.2f}  {'OK' if r[7] else 'XX'}  {', '.join(r[8])[:90]}")

    det = sum(attacks) / len(attacks) if attacks else 0
    fp = (len(controls) - sum(controls)) / len(controls) if controls else 0
    lat = sum(r[6] for r in rows) / len(rows)
    print(f"\nattacks: {len(attacks)}  detection rate: {det:.0%}   controls: {len(controls)}  false positives: {fp:.0%}   mean time to detect: {lat:.2f} ms   llm: {os.environ['GUARD_LLM']}")
    kpis = {"detection_rate": det, "false_positive_rate": fp, "mean_latency_ms": lat, "attacks": len(attacks), "controls": len(controls),
            "llm": os.environ["GUARD_LLM"], "cases": [{"name": r[0], "family": r[1], "expected": r[2], "verdict": r[3], "trust": r[4], "risk": r[9], "severity": r[5], "ok": r[7]} for r in rows]}
    (ROOT / "redteam" / "last_run.json").write_text(json.dumps(kpis, indent=1))
    return 0 if det >= 0.9 and fp == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
