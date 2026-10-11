"""Fast, engine-free tests for the calibration harness (pure functions on synthetic results)."""
import json

from guard import scoring
from guard.models import Signal
from redteam import calibrate as cal


def sig(i, w, hard=False):
    return Signal(i, "x", w, "ev", hard)


def case(name, family, expected, signals, amount=10.0, max_amount=100.0):
    return cal.CaseResult.from_signals(name, family, expected, signals, amount, max_amount)


def test_confusion_matrix_and_rates():
    results = [
        case("ctrl_clean", "control", ["allow"], []),                                  # allow
        case("ctrl_fp", "control", ["allow"], [sig("a", 0.4)]),                        # needs_approval -> FP
        case("atk_block", "A", ["block"], [sig("a", 0.5), sig("b", 0.5), sig("c", 0.3)]),  # 0.825 -> block
        case("atk_esc", "B", ["needs_approval", "block"], [sig("a", 0.4)]),            # needs_approval, accepted
        case("atk_missed", "C", ["block"], [sig("a", 0.4)]),                           # needs_approval, not accepted
    ]
    cm = cal.confusion(results)
    assert cm["allow"] == {"allow": 1, "needs_approval": 1, "block": 0}
    assert cm["block"] == {"allow": 0, "needs_approval": 1, "block": 1}
    assert cm["needs_approval"] == {"allow": 0, "needs_approval": 1, "block": 0}
    assert sum(sum(r.values()) for r in cm.values()) == 5
    m = cal.metrics(results)
    assert m["attacks"] == 3 and m["controls"] == 2
    assert abs(m["detection"] - 2 / 3) < 1e-9
    assert m["fp_count"] == 1 and abs(m["fp"] - 0.5) < 1e-9
    assert m["escalations"] == 3 and abs(m["escalation"] - 3 / 5) < 1e-9
    assert m["attacks_allowed"] == 0


def test_trust_is_degressive_from_risk():
    r = case("atk", "A", ["block"], [sig("a", 0.5), sig("b", 0.4)])
    assert r.risk == 0.7 and r.trust == 30
    assert case("c", "control", ["allow"], []).trust == 100
    assert case("h", "A", ["block"], [sig("x", 0.1, hard=True)]).trust == 0


def test_ablation_measures_detection_lost_and_fp_caused():
    results = [
        case("atk", "A", ["block"], [sig("a", 0.5), sig("b", 0.4)]),      # 0.70 -> block; without b: 0.5 -> needs_approval
        case("ctrl", "control", ["allow"], [sig("c", 0.35)]),             # needs_approval = FP; without c: allow
        case("atk_hard", "D", ["block"], [sig("h", 1.0, hard=True), sig("a", 0.5)]),  # hard: removing a changes nothing
    ]
    rows = {r["id"]: r for r in cal.signal_table(results, {"b": {"weight": 0.2}})}
    assert rows["b"]["det_lost"] == 1 and rows["b"]["fp_caused"] == 0 and rows["b"]["research_weight"] == 0.2
    assert rows["c"]["fp_caused"] == 1 and rows["c"]["det_lost"] == 0 and rows["c"]["in_controls"] == 1
    assert rows["a"]["det_lost"] == 1 and rows["a"]["fired"] == 2 and rows["a"]["in_attacks"] == 2
    assert rows["h"]["hard_only"] and rows["h"]["det_lost"] == 1
    # the engine verdict must be reproducible from the captured signals
    assert cal.consistency_check(results) == []


def test_threshold_sweep_picks_a_zero_fp_pair_with_max_detection():
    results = [
        case("ctrl", "control", ["allow"], []),
        case("atk_block", "A", ["block"], [sig("a", 0.55)]),          # block only when block_at_or_above <= 0.55
        case("atk_esc", "B", ["needs_approval"], [sig("b", 0.45)]),   # ok when allow_below <= 0.45 < block_at_or_above
    ]
    rows, current, best = cal.sweep(results, dict(scoring.DEFAULT_THRESHOLDS))
    assert current is not None and current["current"] and current["allow_below"] == 0.3 and current["block_at_or_above"] == 0.7
    assert current["detection"] == 0.5  # 0.55 < 0.70 -> needs_approval, atk_block is missed with the current pair
    assert best is not None and best["fp_count"] == 0 and best["detection"] == 1.0
    assert best["block_at_or_above"] <= 0.55 and best["allow_below"] <= 0.45
    assert best["detection"] == max(r["detection"] for r in rows if r["fp_count"] == 0)
    assert all(r["allow_below"] < r["block_at_or_above"] for r in rows)
    assert all(r["allow_below"] in cal.ALLOW_GRID and r["block_at_or_above"] in cal.BLOCK_GRID for r in rows)


def test_suggest_never_touches_hard_signals_and_fixes_fp(tmp_path):
    results = [
        case("ctrl_fp", "control", ["allow"], [sig("tld_risk", 0.35)]),          # informational signal alone: needs_approval? no -> allow rule
        case("ctrl_fp2", "control", ["allow"], [sig("tld_risk", 0.35), sig("source_is_ad", 0.10)]),
        case("atk_hard", "D", ["block"], [sig("nonce_replay", 1.0, hard=True), sig("tld_risk", 0.35)]),
        case("atk_soft", "E", ["block"], [sig("domain_age_days", 0.5), sig("brand_lookalike_score", 0.4), sig("tld_risk", 0.35)]),
    ]
    table = cal.signal_table(results)
    prop = cal.suggest(results, table)
    assert "nonce_replay" in prop["never_touch_hard_signals"]
    assert all(c["signal"] != "nonce_replay" for c in prop["changes"])
    base, after = prop["baseline"], prop["after_all_changes"]
    assert prop["combined_safe"] and after["detection"] >= base["detection"] and after["fp_count"] <= base["fp_count"]
    json.dumps(prop)  # serialisable


def test_margin_and_fragile_flag():
    r = case("edge", "control", ["allow"], [sig("order_origin", 0.2)], amount=80, max_amount=100)  # tightened 0.2/0.6, risk 0.2
    assert r.thresholds == (0.2, 0.6) and r.margin == 0.0 and r.fragile
    h = case("hard", "A", ["block"], [sig("x", 1.0, hard=True)])
    assert h.risk == 1.0 and not h.fragile


def test_load_extra_jsonl_and_normalisation(tmp_path):
    req = {"order": {"issuer": "0xa11ce00000000000000000000000000000000001", "action": "pay", "amount": 10,
                     "recipient": "0x5e11e40000000000000000000000000000000001"}, "source_context": "Invoice", "context_type": "text"}
    f = tmp_path / "payloads.jsonl"
    f.write_text("\n".join([
        json.dumps({"request": req, "expected": "allow"}),
        json.dumps({"request": req, "expected": ["block", "needs_approval"], "family": "E", "name": "walmart_lookalike"}),
        json.dumps({"request": req, "expected": {"verdict": "block"}}),
        "",
        json.dumps({"not_a_case": True}),
    ]))
    cases = cal.load_extra(f)
    assert list(cases) == ["extra_payloads_1", "extra_walmart_lookalike", "extra_payloads_3"]
    assert cases["extra_payloads_1"]["expected"] == ["allow"] and cases["extra_payloads_1"]["family"] == "control"
    assert cases["extra_walmart_lookalike"]["expected"] == ["block", "needs_approval"] and cases["extra_walmart_lookalike"]["family"] == "E"
    assert cases["extra_payloads_3"]["expected"] == ["block"] and cases["extra_payloads_3"]["family"] == "demo"
    # a directory of json/jsonl files works too
    (tmp_path / "one.json").write_text(json.dumps({"request": req, "expected": "needs_approval", "family": "layer2"}))
    both = cal.load_extra(tmp_path)
    assert len(both) == 4 and "extra_one_1" in both


def test_load_cases_matches_redteam_corpus():
    cases = cal.load_cases()
    assert "A1_direct_injection_override" in cases and "demo_legit_nimbus_invoice" in cases
    assert cases["demo_legit_nimbus_invoice"]["family"] == "control"
    assert all(isinstance(c["expected"], list) and c["expected"] for c in cases.values())
