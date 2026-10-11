"""Calibration harness for the guard decision engine (Claude off, deterministic).

Plays every red-team case and demo fixture (plus optional labelled payloads) through the engine, then
re-scores the captured signals with guard.scoring.combine to measure:
  - confusion matrix, detection / false-positive / escalation rates
  - per-signal value (ablation: detection lost and false positives caused when the signal is removed)
  - threshold sweep over an allow/block grid, with the best feasible pair (0 FP, max detection, min escalation)
  - per-case margin to the nearest threshold (fragile cases)
  - optional weight proposals (--suggest), never touching hard signals, written to redteam/calibration_proposal.json

Usage:
  .venv/bin/python redteam/calibrate.py
  .venv/bin/python redteam/calibrate.py --md redteam/calibration_report.md --suggest
  .venv/bin/python redteam/calibrate.py --extra agents/out/payloads.jsonl

Standard library only. Never edits guard/ or detection/research/features_scoring.json.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault("GUARD_LLM", "off")

from guard import scoring  # noqa: E402
from guard.engine import Engine  # noqa: E402
from guard.llm import ClaudeScorer  # noqa: E402
from guard.models import Signal  # noqa: E402
from redteam.run import fresh_data_dir  # noqa: E402

VERDICTS = ("allow", "needs_approval", "block")
RESEARCH = ROOT / "detection" / "research" / "features_scoring.json"
PROPOSAL_PATH = ROOT / "redteam" / "calibration_proposal.json"
FRAGILE_MARGIN = 0.05
ALLOW_GRID = [round(0.10 + 0.05 * i, 2) for i in range(9)]   # 0.10 .. 0.50
BLOCK_GRID = [round(0.50 + 0.05 * i, 2) for i in range(9)]   # 0.50 .. 0.90
MIN_WEIGHT = 0.05
STEP = 0.05


# ----------------------------------------------------------------------------- cases
def normalize_case(raw: dict, name: str, default_family: str = "extra") -> dict | None:
    """Accept the three label formats: redteam (expected list), demo fixture (expected dict), extra (expected str)."""
    if not isinstance(raw, dict) or "request" not in raw or "expected" not in raw:
        return None
    c = dict(raw)
    exp = c["expected"]
    if isinstance(exp, dict):  # demo fixture format
        exp = [exp["verdict"]]
        c["family"] = "control" if exp == ["allow"] else c.get("family", "demo")
    elif isinstance(exp, str):
        exp = [exp]
        c["family"] = "control" if exp == ["allow"] else (c.get("family") or default_family)
    else:
        exp = list(exp)
        c["family"] = c.get("family") or ("control" if exp == ["allow"] else default_family)
    bad = [e for e in exp if e not in VERDICTS]
    if bad or not exp:
        raise ValueError(f"{name}: expected must be one of {VERDICTS}, got {exp}")
    c["expected"] = exp
    c["name"] = name
    return c


def load_cases() -> dict[str, dict]:
    """Same corpus and naming as redteam/run.py: redteam/cases/*.json then demo/fixtures/*.json."""
    files = sorted((ROOT / "redteam" / "cases").glob("*.json")) + sorted((ROOT / "demo" / "fixtures").glob("*.json"))
    cases: dict[str, dict] = {}
    for p in files:
        name = p.stem if p.parent.name == "cases" else "demo_" + p.stem
        c = normalize_case(json.loads(p.read_text()), name, default_family="demo")
        if c:
            cases[name] = c
    return cases


def load_extra(path: str | Path) -> dict[str, dict]:
    """Labelled payloads logged by the agents: a JSONL file, a JSON file (record or list), or a directory of those.
    Record format: {"request": {...}, "expected": "allow|needs_approval|block" or [...], "family": "...", "name": "..."}."""
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(path)
    files = sorted(list(path.glob("*.json")) + list(path.glob("*.jsonl"))) if path.is_dir() else [path]
    out: dict[str, dict] = {}
    for f in files:
        records: list[dict] = []
        if f.suffix == ".jsonl":
            for line in f.read_text().splitlines():
                line = line.strip()
                if line:
                    records.append(json.loads(line))
        else:
            d = json.loads(f.read_text())
            records = d if isinstance(d, list) else [d]
        for i, rec in enumerate(records):
            base = rec.get("name") if isinstance(rec, dict) else None
            name = "extra_" + (base or f"{f.stem}_{i + 1}")
            while name in out:
                name += "_dup"
            c = normalize_case(rec, name)
            if c:
                out[name] = c
    return out


# ----------------------------------------------------------------------------- results
@dataclass
class CaseResult:
    name: str
    family: str
    expected: list[str]
    verdict: str
    risk: float
    trust: int
    signals: list[Signal]
    amount: float
    max_amount: float
    repeat: bool
    thresholds: tuple[float, float]
    base_thresholds: dict
    latency_ms: float = 0.0
    notes: list[str] = field(default_factory=list)

    @property
    def is_attack(self) -> bool:
        return self.family != "control"

    @property
    def ok(self) -> bool:
        return self.verdict in self.expected

    @property
    def hard(self) -> bool:
        return any(s.hard for s in self.signals)

    @property
    def margin(self) -> float:
        lo, hi = self.thresholds
        return round(min(abs(self.risk - lo), abs(self.risk - hi)), 4)

    @property
    def fragile(self) -> bool:
        return self.margin < FRAGILE_MARGIN and not self.hard

    @classmethod
    def from_signals(cls, name: str, family: str, expected: list[str], signals: list[Signal], amount: float = 10.0,
                     max_amount: float = 100.0, base_thresholds: dict | None = None, repeat: bool = False) -> "CaseResult":
        """Build a result without the engine (tests, synthetic what-ifs): the verdict comes from scoring.combine."""
        th = base_thresholds or dict(scoring.DEFAULT_THRESHOLDS)
        res = score(signals, amount, max_amount, th, repeat)
        return cls(name, family, list(expected), res.verdict, res.risk, trust_from_risk(res.risk), list(signals), amount,
                   max_amount, repeat, res.thresholds, th, 0.0, list(res.notes))


def trust_from_risk(risk: float) -> int:
    return int(round(100 * (1 - risk)))


def score(signals: list[Signal], amount: float, max_amount: float, thresholds: dict, repeat: bool = False) -> scoring.ScoreResult:
    """Re-score exactly like Engine.verify does with the LLM off: hard signal -> llm stub at 1.0, else no llm."""
    hard = any(s.hard for s in signals)
    llm = {"risk_score": 1.0, "reasons": ["hard block"]} if hard else None
    return scoring.combine(signals, llm, amount, max_amount, thresholds, repeat_offender=repeat)


def rescore(cr: CaseResult, signals: list[Signal] | None = None, thresholds: dict | None = None,
            weights: dict[str, float] | None = None) -> scoring.ScoreResult:
    """Re-score a case with optional signal removal (ablation), threshold change, or soft-weight overrides."""
    sigs = list(cr.signals if signals is None else signals)
    if weights:
        sigs = [Signal(s.id, s.layer, weights[s.id], s.evidence, s.hard, list(s.owasp)) if (s.id in weights and not s.hard) else s
                for s in sigs]
    return score(sigs, cr.amount, cr.max_amount, thresholds or cr.base_thresholds, cr.repeat)


def run_cases(cases: dict[str, dict], base_thresholds: dict) -> list[CaseResult]:
    """Same protocol as redteam/run.py: fresh data dir per case, `_after` pre-plays another case, `_replay` repeats."""
    llm = ClaudeScorer(enabled=False)
    results: list[CaseResult] = []
    for name, c in cases.items():
        engine = Engine.from_env(fresh_data_dir(), llm=llm)
        req = json.loads(json.dumps(c["request"]))
        ctx = req.setdefault("context", {})
        replay = ctx.pop("_replay", 1)
        after = ctx.pop("_after", None)
        if after:
            if after not in cases:
                raise KeyError(f"{name}: _after refers to unknown case {after!r}")
            engine.verify(json.loads(json.dumps(cases[after]["request"])))
        out = None
        for _ in range(int(replay)):
            out = engine.verify(req)
        assert out is not None
        signals = [Signal(**{k: s[k] for k in ("id", "layer", "weight", "evidence", "hard", "owasp") if k in s}) for s in out["signals"]]
        mandate = out.get("mandate") or {}
        risk = float(out["risk_score"])
        trust = int(out["trust_score"]) if "trust_score" in out else trust_from_risk(risk)
        results.append(CaseResult(
            name=name, family=c["family"], expected=list(c["expected"]), verdict=out["verdict"], risk=risk, trust=trust,
            signals=signals, amount=float(out["amount"]), max_amount=float(mandate.get("max_amount") or 0.0),
            repeat=bool(out.get("onchain_flagged")), thresholds=tuple(out.get("thresholds") or (0.0, 0.0)),
            base_thresholds=base_thresholds, latency_ms=float(out.get("latency_ms") or 0.0),
            notes=[r for r in out.get("reasons", []) if r.startswith("[engine]")],
        ))
    return results


def consistency_check(results: list[CaseResult]) -> list[str]:
    """The engine verdict must be reproducible from its signals with combine(); otherwise ablation is meaningless."""
    bad = []
    for r in results:
        res = rescore(r)
        if res.verdict != r.verdict or abs(res.risk - r.risk) > 1e-6:
            bad.append(f"{r.name}: engine {r.verdict}/{r.risk} vs rescore {res.verdict}/{res.risk}")
    return bad


# ----------------------------------------------------------------------------- metrics
def metrics(results: list[CaseResult], verdict_of: Callable[[CaseResult], str] | None = None) -> dict:
    v = verdict_of or (lambda r: r.verdict)
    attacks = [r for r in results if r.is_attack]
    controls = [r for r in results if not r.is_attack]
    det_hits = sum(v(r) in r.expected for r in attacks)
    fp_hits = sum(v(r) != "allow" for r in controls)
    esc = sum(v(r) == "needs_approval" for r in results)
    return {
        "cases": len(results), "attacks": len(attacks), "controls": len(controls),
        "detection": det_hits / len(attacks) if attacks else 0.0,
        "attacks_allowed": sum(v(r) == "allow" for r in attacks),
        "fp": fp_hits / len(controls) if controls else 0.0,
        "fp_count": fp_hits,
        "escalation": esc / len(results) if results else 0.0,
        "escalations": esc,
    }


def confusion(results: list[CaseResult], verdict_of: Callable[[CaseResult], str] | None = None) -> dict[str, dict[str, int]]:
    """Rows: primary expected verdict (first of the accepted list). Columns: verdict obtained."""
    v = verdict_of or (lambda r: r.verdict)
    m = {e: {g: 0 for g in VERDICTS} for e in VERDICTS}
    for r in results:
        m[r.expected[0]][v(r)] += 1
    return m


def research_weights(path: Path = RESEARCH) -> dict[str, dict]:
    if not path.exists():
        return {}
    d = json.loads(path.read_text())
    out: dict[str, dict] = {}
    for block, feats in (d.get("blocks") or {}).items():
        for f in feats or []:
            if isinstance(f, dict) and f.get("name"):
                out[f["name"]] = {"weight": f.get("weight"), "block": block, "rule": f.get("rule", "")}
    return out


def signal_table(results: list[CaseResult], research: dict[str, dict] | None = None) -> list[dict]:
    """Per signal: fire counts, configured weight, and its value by ablation (remove it, re-score with combine)."""
    research = research or {}
    ids = sorted({s.id for r in results for s in r.signals})
    rows = []
    for sid in ids:
        fired = [r for r in results if any(s.id == sid for s in r.signals)]
        inst = [s for r in fired for s in r.signals if s.id == sid]
        soft_w = sorted({s.weight for s in inst if not s.hard})
        det_lost = fp_caused = esc_removed = 0
        for r in fired:
            res = rescore(r, [s for s in r.signals if s.id != sid])
            if r.is_attack and r.ok and res.verdict not in r.expected:
                det_lost += 1
            if not r.is_attack and r.verdict != "allow" and res.verdict == "allow":
                fp_caused += 1
            if r.verdict == "needs_approval" and res.verdict != "needs_approval":
                esc_removed += 1
        rows.append({
            "id": sid, "layer": inst[0].layer, "fired": len(fired),
            "in_attacks": sum(r.is_attack for r in fired), "in_controls": sum(not r.is_attack for r in fired),
            "hard_any": any(s.hard for s in inst), "hard_only": all(s.hard for s in inst),
            "informational": sid in scoring.INFORMATIONAL,
            "weights": soft_w, "research_weight": (research.get(sid) or {}).get("weight"),
            "det_lost": det_lost, "fp_caused": fp_caused, "esc_removed": esc_removed,
        })
    return rows


def thresholds_for(lo: float, hi: float, base: dict) -> dict:
    """Shift the high-amount tightening by the same offsets the current config uses (0.30/0.70 -> 0.20/0.60)."""
    adj = base.get("high_amount_adjustment") or scoring.DEFAULT_THRESHOLDS["high_amount_adjustment"]
    d_lo = base["allow_below"] - adj["allow_below"]
    d_hi = base["block_at_or_above"] - adj["block_at_or_above"]
    t_lo = round(max(MIN_WEIGHT, lo - d_lo), 2)
    return {"allow_below": lo, "block_at_or_above": hi,
            "high_amount_adjustment": {"ratio": adj.get("ratio", 0.5), "allow_below": t_lo,
                                       "block_at_or_above": round(max(t_lo + 0.05, hi - d_hi), 2)}}


def sweep(results: list[CaseResult], base: dict) -> tuple[list[dict], dict | None, dict | None]:
    """Grid over allow/block thresholds. Returns (rows, current_row, best_row).
    Best = 0 FP, then max detection, then min escalation, then current, then widest minimum margin."""
    cur = (base["allow_below"], base["block_at_or_above"])
    rows = []
    for lo in ALLOW_GRID:
        for hi in BLOCK_GRID:
            if lo >= hi:
                continue
            th = thresholds_for(lo, hi, base)
            scored = {r.name: rescore(r, thresholds=th) for r in results}
            m = metrics(results, lambda r: scored[r.name].verdict)
            min_margin = min((min(abs(s.risk - s.thresholds[0]), abs(s.risk - s.thresholds[1]))
                              for r, s in ((r, scored[r.name]) for r in results) if not r.hard), default=1.0)
            rows.append({"allow_below": lo, "block_at_or_above": hi, "current": (lo, hi) == cur, "min_margin": round(min_margin, 4), **m})
    current = next((r for r in rows if r["current"]), None)
    feasible = [r for r in rows if r["fp_count"] == 0]
    best = max(feasible, key=lambda r: (r["detection"], -r["escalation"], r["current"], r["min_margin"])) if feasible else None
    return rows, current, best


# ----------------------------------------------------------------------------- suggestions
def _apply_check(results: list[CaseResult], weights: dict[str, float]) -> dict:
    scored = {r.name: rescore(r, weights=weights) for r in results}
    return metrics(results, lambda r: scored[r.name].verdict)


def suggest(results: list[CaseResult], table: list[dict], research: dict[str, dict] | None = None) -> dict:
    """Propose lower weights for soft signals that cause false positives or whose removal costs nothing.
    Each proposal is validated alone, then all together: detection must not drop, FP must not rise. Hard signals are never touched."""
    research = research or {}
    base = metrics(results)
    changes, observations = [], []
    for row in table:
        sid = row["id"]
        if row["hard_any"]:
            continue
        if not row["weights"]:
            continue
        current_w = max(row["weights"])
        if row["fp_caused"] > 0:
            reason = f"causes {row['fp_caused']} false positive(s): the control(s) become allow without it"
        elif row["det_lost"] == 0:
            reason = "removing it loses no detection in the current corpus"
        else:
            continue
        # search the lowest weight (step 0.05, floor MIN_WEIGHT) that keeps detection and does not add FP
        best_w, best_m = None, None
        w = round(current_w - STEP, 2)
        while w >= MIN_WEIGHT:
            m = _apply_check(results, {sid: w})
            if m["detection"] >= base["detection"] and m["fp_count"] <= base["fp_count"]:
                best_w, best_m = w, m
                w = round(w - STEP, 2)
            else:
                break
        improves = best_m is not None and (best_m["fp_count"] < base["fp_count"] or best_m["escalations"] < base["escalations"])
        entry = {"signal": sid, "layer": row["layer"], "current_weight": current_w, "research_weight": row["research_weight"],
                 "fired": row["fired"], "in_attacks": row["in_attacks"], "in_controls": row["in_controls"],
                 "det_lost_if_removed": row["det_lost"], "fp_caused": row["fp_caused"], "reason": reason}
        if row["fp_caused"] > 0 and best_w is not None:
            changes.append({**entry, "proposed_weight": best_w, "after_alone": best_m})
        elif row["fp_caused"] > 0:
            observations.append({**entry, "action": "no weight in the grid removes the FP without losing detection: fix the extractor or the case"})
        elif improves:
            changes.append({**entry, "proposed_weight": best_w, "after_alone": best_m})
        else:
            observations.append({**entry, "action": "keep as is: lowering it changes no verdict; add a case that exercises it"
                                 if row["in_controls"] == 0 else "keep as is: no verdict improves when lowered"})
    combined = {c["signal"]: c["proposed_weight"] for c in changes}
    after = _apply_check(results, combined) if combined else base
    combined_ok = after["detection"] >= base["detection"] and after["fp_count"] <= base["fp_count"]
    if not combined_ok:  # drop the smallest-benefit proposals until the combination is safe
        kept = list(changes)
        while kept and not combined_ok:
            kept.sort(key=lambda c: (c["fp_caused"], base["escalations"] - c["after_alone"]["escalations"]))
            dropped = kept.pop(0)
            observations.append({**dropped, "action": "dropped: unsafe when combined with the other proposals"})
            combined = {c["signal"]: c["proposed_weight"] for c in kept}
            after = _apply_check(results, combined) if combined else base
            combined_ok = after["detection"] >= base["detection"] and after["fp_count"] <= base["fp_count"]
        changes = kept
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "llm": "off", "corpus": {"cases": base["cases"], "attacks": base["attacks"], "controls": base["controls"]},
        "baseline": base, "after_all_changes": after, "combined_safe": combined_ok,
        "changes": changes, "observations": observations,
        "never_touch_hard_signals": sorted(r["id"] for r in table if r["hard_any"]),
        "how_to_apply": "Weights live in guard/features/*.py (reference: detection/research/features_scoring.json). Apply by hand, "
                        "then re-run redteam/run.py and this harness. Never change a hard signal.",
    }


# ----------------------------------------------------------------------------- rendering
def table(headers: list[str], rows: list[list], align_right: set[int] | None = None) -> str:
    """Aligned pipe table: readable in a terminal and valid markdown."""
    align_right = align_right or set()
    cells = [[str(c) for c in r] for r in rows]
    widths = [max([len(h)] + [len(r[i]) for r in cells]) for i, h in enumerate(headers)]
    fmt = lambda r: "| " + " | ".join((c.rjust(widths[i]) if i in align_right else c.ljust(widths[i])) for i, c in enumerate(r)) + " |"
    sep = "|" + "|".join(("-" * (w + 1) + ":") if i in align_right else ("-" * (w + 2)) for i, w in enumerate(widths)) + "|"
    return "\n".join([fmt(headers), sep] + [fmt(r) for r in cells])


def pct(x: float) -> str:
    return f"{100 * x:.0f}%"


def render(results: list[CaseResult], base: dict, research: dict[str, dict], proposal: dict | None, extra_count: int,
           inconsistencies: list[str]) -> str:
    m = metrics(results)
    cm = confusion(results)
    sig_rows = signal_table(results, research)
    sw_rows, cur, best = sweep(results, base)
    lat = sum(r.latency_ms for r in results) / len(results) if results else 0.0
    out: list[str] = []
    out.append("# Guard calibration report")
    out.append("")
    out.append(f"Generated {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}, LLM off (deterministic). "
               f"Corpus: {m['cases']} cases ({m['attacks']} attacks, {m['controls']} controls"
               + (f", {extra_count} from --extra" if extra_count else "") + ").")
    out.append("")
    out.append("## 1. Summary")
    out.append("")
    out.append(table(["metric", "value"], [
        ["detection rate (attacks with verdict in expected)", pct(m["detection"])],
        ["attacks let through (allow)", str(m["attacks_allowed"])],
        ["false positive rate (controls not allowed)", f"{pct(m['fp'])} ({m['fp_count']}/{m['controls']})"],
        ["escalation rate (needs_approval / total)", f"{pct(m['escalation'])} ({m['escalations']}/{m['cases']})"],
        ["current thresholds (allow_below / block_at_or_above)", f"{base['allow_below']} / {base['block_at_or_above']}"],
        ["high-amount thresholds (>= 50% of cap)", f"{base['high_amount_adjustment']['allow_below']} / {base['high_amount_adjustment']['block_at_or_above']}"],
        ["mean latency", f"{lat:.2f} ms"],
        ["rescore consistency (engine verdict == combine on captured signals)", "OK" if not inconsistencies else f"{len(inconsistencies)} mismatch(es)"],
    ]))
    if inconsistencies:
        out.append("")
        out.extend(f"- {x}" for x in inconsistencies)
    out.append("")
    out.append("## 2. Confusion matrix (rows: primary expected verdict, columns: verdict obtained)")
    out.append("")
    out.append(table(["expected \\ got"] + list(VERDICTS) + ["total"],
                     [[e] + [cm[e][g] for g in VERDICTS] + [sum(cm[e].values())] for e in VERDICTS]
                     + [["total"] + [sum(cm[e][g] for e in VERDICTS) for g in VERDICTS] + [m["cases"]]], {1, 2, 3, 4}))
    out.append("")
    out.append("Cases accepting several verdicts (e.g. block/needs_approval) are counted on their first expected verdict; detection uses the full accepted list.")
    out.append("")
    out.append("## 3. Per case (risk, trust, margin to the nearest threshold)")
    out.append("")
    out.append(table(["case", "family", "expected", "got", "ok", "risk", "trust", "thr", "margin", "hard", "signals"],
                     [[r.name, r.family, "/".join(r.expected), r.verdict, "OK" if r.ok else "XX", f"{r.risk:.2f}", str(r.trust),
                       f"{r.thresholds[0]}/{r.thresholds[1]}", f"{r.margin:.2f}" + (" !" if r.fragile else ""), "H" if r.hard else "",
                       ", ".join(s.id for s in r.signals)[:70]] for r in results], {5, 6, 8}))
    out.append("")
    fragile = [r for r in results if r.fragile]
    out.append(f"## 4. Fragile cases (margin < {FRAGILE_MARGIN}, not hard-blocked): {len(fragile)}")
    out.append("")
    if fragile:
        out.append(table(["case", "expected", "got", "risk", "nearest threshold", "margin"],
                         [[r.name, "/".join(r.expected), r.verdict, f"{r.risk:.2f}",
                           str(min(r.thresholds, key=lambda t: abs(r.risk - t))), f"{r.margin:.3f}"] for r in fragile], {3, 4, 5}))
    else:
        out.append("None. Every soft verdict sits at least 0.05 away from a threshold.")
    out.append("")
    out.append("## 5. Per signal (fire counts, weight, value by ablation)")
    out.append("")
    out.append("`det_lost` = attacks that stop matching their expected verdict when the signal is removed; `fp_caused` = controls that become allow when it is removed; "
               "`esc_removed` = cases that leave needs_approval when it is removed. Weights are the soft weights observed from the engine (hard instances force 1.0).")
    out.append("")
    out.append(table(["signal", "layer", "kind", "fired", "attacks", "controls", "weight(engine)", "weight(research)", "det_lost", "fp_caused", "esc_removed"],
                     [[s["id"], s["layer"], ("hard" if s["hard_only"] else "hard/soft" if s["hard_any"] else "info" if s["informational"] else "soft"),
                       s["fired"], s["in_attacks"], s["in_controls"], "/".join(f"{w:.2f}" for w in s["weights"]) or "-",
                       "-" if s["research_weight"] is None else f"{s['research_weight']:.2f}", s["det_lost"], s["fp_caused"], s["esc_removed"]]
                      for s in sorted(sig_rows, key=lambda s: (-s["det_lost"], -s["fired"], s["id"]))], {3, 4, 5, 6, 7, 8, 9, 10}))
    out.append("")
    out.append("## 6. Threshold sweep (allow_below x block_at_or_above): detection / FP / escalation")
    out.append("")
    out.append("`*` = current pair, `+` = best feasible pair (0 FP, max detection, then min escalation). High-amount tightening shifts with the same offsets.")
    out.append("")
    grid = {(r["allow_below"], r["block_at_or_above"]): r for r in sw_rows}
    out.append(table(["allow \\ block"] + [f"{h:.2f}" for h in BLOCK_GRID],
                     [[f"{lo:.2f}"] + [(lambda r: (f"{pct(r['detection'])}/{pct(r['fp'])}/{pct(r['escalation'])}"
                                                   + ("*" if r["current"] else "") + ("+" if best is not None and r is best else "")) if r else "-")(grid.get((lo, hi)))
                                       for hi in BLOCK_GRID] for lo in ALLOW_GRID]))
    out.append("")
    if cur:
        out.append(f"- current {cur['allow_below']}/{cur['block_at_or_above']}: detection {pct(cur['detection'])}, FP {pct(cur['fp'])}, escalation {pct(cur['escalation'])}, min margin {cur['min_margin']:.3f}")
    if best:
        out.append(f"- best feasible {best['allow_below']}/{best['block_at_or_above']}: detection {pct(best['detection'])}, FP {pct(best['fp'])}, escalation {pct(best['escalation'])}, min margin {best['min_margin']:.3f}"
                   + (" (the current pair is already optimal)" if best["current"] else ""))
    else:
        out.append("- no pair in the grid reaches 0 FP: fix the signals before moving thresholds")
    feas = sorted((r for r in sw_rows if r["fp_count"] == 0), key=lambda r: (-r["detection"], r["escalation"], -r["min_margin"]))[:8]
    if feas:
        out.append("")
        out.append(table(["allow_below", "block_at_or_above", "detection", "FP", "escalation", "min margin", "note"],
                         [[r["allow_below"], r["block_at_or_above"], pct(r["detection"]), pct(r["fp"]), pct(r["escalation"]), f"{r['min_margin']:.3f}",
                           ("current" if r["current"] else "") + (" best" if r is best else "")] for r in feas], {0, 1, 2, 3, 4, 5}))
    out.append("")
    if proposal is not None:
        out.append("## 7. Weight proposals (--suggest)")
        out.append("")
        b, a = proposal["baseline"], proposal["after_all_changes"]
        if proposal["changes"]:
            out.append(table(["signal", "layer", "current", "proposed", "research", "fired", "controls", "fp_caused", "det_lost", "reason"],
                             [[c["signal"], c["layer"], f"{c['current_weight']:.2f}", f"{c['proposed_weight']:.2f}",
                               "-" if c["research_weight"] is None else f"{c['research_weight']:.2f}", c["fired"], c["in_controls"], c["fp_caused"],
                               c["det_lost_if_removed"], c["reason"]] for c in proposal["changes"]], {2, 3, 4, 5, 6, 7, 8}))
            out.append("")
            out.append(f"All changes together: detection {pct(b['detection'])} -> {pct(a['detection'])}, FP {b['fp_count']} -> {a['fp_count']}, "
                       f"escalations {b['escalations']} -> {a['escalations']} ({'safe' if proposal['combined_safe'] else 'UNSAFE'}).")
        else:
            out.append("No weight change proposed: no soft signal causes a false positive and no reduction improves a verdict without losing detection.")
        if proposal["observations"]:
            out.append("")
            out.append("Observations (no change proposed):")
            out.append("")
            out.append(table(["signal", "current", "fired", "attacks", "controls", "det_lost", "action"],
                             [[o["signal"], f"{o['current_weight']:.2f}", o["fired"], o["in_attacks"], o["in_controls"], o["det_lost_if_removed"], o["action"]]
                              for o in proposal["observations"]], {1, 2, 3, 4, 5}))
        out.append("")
        out.append(f"Hard signals are never proposed for change: {', '.join(proposal['never_touch_hard_signals'])}.")
        out.append("")
        out.append(f"Proposal written to `{PROPOSAL_PATH.relative_to(ROOT)}`. Apply by hand in guard/features/*.py, then re-run `redteam/run.py`.")
        out.append("")
    return "\n".join(out)


# ----------------------------------------------------------------------------- main
def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Calibrate the guard decision engine on the red-team corpus (LLM off).")
    ap.add_argument("--extra", help="directory or JSONL/JSON file of labelled requests {request, expected, family}")
    ap.add_argument("--md", help="write the markdown report to this path")
    ap.add_argument("--suggest", action="store_true", help=f"propose weight changes, written to {PROPOSAL_PATH.relative_to(ROOT)}")
    ap.add_argument("--json", help="also dump the per-case results (signals, risk, trust, margin) as JSON")
    ap.add_argument("--quiet", action="store_true", help="do not print the report to the terminal")
    args = ap.parse_args(argv)

    base = scoring.load_thresholds(RESEARCH)
    cases = load_cases()
    extra_count = 0
    if args.extra:
        extra = load_extra(args.extra)
        extra_count = len(extra)
        cases.update(extra)
    if not cases:
        print("no cases found", file=sys.stderr)
        return 2
    results = run_cases(cases, base)
    inconsistencies = consistency_check(results)
    research = research_weights()
    proposal = None
    if args.suggest:
        proposal = suggest(results, signal_table(results, research), research)
        PROPOSAL_PATH.write_text(json.dumps(proposal, indent=1))
    report = render(results, base, research, proposal, extra_count, inconsistencies)
    if args.md:
        Path(args.md).write_text(report + "\n")
    if args.json:
        Path(args.json).write_text(json.dumps([{
            "name": r.name, "family": r.family, "expected": r.expected, "verdict": r.verdict, "ok": r.ok, "risk": r.risk, "trust": r.trust,
            "thresholds": list(r.thresholds), "margin": r.margin, "fragile": r.fragile, "hard": r.hard,
            "signals": [s.to_dict() for s in r.signals]} for r in results], indent=1))
    if not args.quiet:
        print(report)
    m = metrics(results)
    return 0 if m["fp_count"] == 0 and m["detection"] >= 0.9 and not inconsistencies else 1


if __name__ == "__main__":
    sys.exit(main())
