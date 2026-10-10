"""The brain: sanitize -> signals -> hard blocks -> Claude -> thresholds -> effects."""
from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from guard import sanitize, scoring
from guard.features import authority as f_auth, content as f_content, counterparty as f_cp, mandate as f_mandate, tools as f_tools, transaction as f_tx
from guard.llm import ClaudeScorer, build_payload
from guard.models import Mandate, Signal, Verdict, VerifyRequest, norm_addr
from guard.queue import PendingQueue
from guard.sinks import CompositeSink, DecisionSink, JsonlSink
from guard.sources import AuthoritySource, MockJsonSource

log = logging.getLogger("guard.engine")
ROOT = Path(__file__).resolve().parent.parent


def load_data(data_dir: Path) -> dict:
    def j(name, default):
        p = data_dir / name
        return json.loads(p.read_text()) if p.exists() else default
    return {
        "mandates": {norm_addr(k): v for k, v in j("mandates.json", {}).items()},
        "allowlist": [norm_addr(x) for x in j("allowlist.json", [])],
        "brands": j("brands.json", []),
        "domains": {k.lower(): v for k, v in j("domains.mock.json", {}).items()},
        "addresses": {norm_addr(k): v for k, v in j("addresses.mock.json", {}).items()},
        "facilitators": j("facilitators.json", []),
        "tools_inventory": j("tools_inventory.json", {}),
    }


class Engine:
    def __init__(self, source: AuthoritySource, sink: DecisionSink, queue: PendingQueue, llm: ClaudeScorer,
                 data: dict, thresholds: dict | None = None):
        self.source, self.sink, self.queue, self.llm, self.data = source, sink, queue, llm, data
        self.thresholds = thresholds or scoring.DEFAULT_THRESHOLDS

    @classmethod
    def from_env(cls, data_dir: str | Path | None = None, llm: ClaudeScorer | None = None) -> "Engine":
        data_dir = Path(data_dir or os.environ.get("GUARD_DATA_DIR") or ROOT / "data")
        mock = MockJsonSource(data_dir)
        source: AuthoritySource = mock
        sinks: list[DecisionSink] = [JsonlSink(data_dir / "decisions.jsonl")]
        addr, rpc = os.environ.get("GUARD_CONTRACT_ADDRESS"), os.environ.get("AVAX_RPC_URL", "https://api.avax-test.network/ext/bc/C/rpc")
        if addr:
            try:
                from guard.sinks import ChainSink
                from guard.sources import ChainSource
                chain = ChainSource(rpc, addr, os.environ.get("GUARD_OWNER_KEY"), fallback=mock)
                source = chain
                if os.environ.get("GUARD_OWNER_KEY"):
                    sinks.append(ChainSink(chain))
                log.info("chain source enabled: %s", addr)
            except Exception as e:
                log.error("chain source disabled (%s), using mock", e)
        thresholds = scoring.load_thresholds(ROOT / "detection" / "research" / "features_scoring.json")
        return cls(source, CompositeSink(*sinks), PendingQueue(data_dir / "pending.json"), llm or ClaudeScorer(), load_data(data_dir), thresholds)

    # ----- mandate resolution: never trusted from the agent -----
    def resolve_mandate(self, issuer: str, auth) -> Mandate | None:
        m = self.data["mandates"].get(norm_addr(issuer))
        if not m and auth is None:
            return None
        mandate = Mandate(issuer=issuer, **(m or {"role": auth.role, "allowed_actions": ["pay"], "max_amount": auth.max_amount}))
        if auth is not None and auth.max_amount:
            mandate.max_amount = min(mandate.max_amount, auth.max_amount) if mandate.max_amount else auth.max_amount
        if auth is not None and auth.role and not m:
            mandate.role = auth.role
        return mandate

    def _authority(self, issuer: str):
        try:
            return self.source.get_authority(issuer), True
        except Exception as e:
            log.error("authority source failed: %s", e)
            if isinstance(self.source, MockJsonSource):
                return None, False
            fb = getattr(self.source, "fallback", None)
            return (fb.get_authority(issuer) if fb else None), False

    def verify(self, request: dict[str, Any] | VerifyRequest) -> dict:
        t0 = time.perf_counter()
        req = request if isinstance(request, VerifyRequest) else VerifyRequest.from_dict(request)
        o = req.order

        cleaned = sanitize.clean(req.source_context, req.context_type)
        auth, source_ok = self._authority(o.issuer)
        mandate = self.resolve_mandate(o.issuer, auth)

        signals: list[Signal] = []
        signals += f_content.extract(req, cleaned)
        signals += f_mandate.extract(req, mandate)
        signals += f_auth.extract(req, auth, source_ok)
        signals += f_cp.extract(req, mandate, self.source, self.data)
        signals += f_tx.extract(req, mandate, self.source, self.data)
        signals += f_tools.extract(req, self.data)
        # dedupe by id, keep the strongest
        best: dict[str, Signal] = {}
        for s in signals:
            if s.id not in best or s.weight > best[s.id].weight or (s.hard and not best[s.id].hard):
                best[s.id] = s
        signals = list(best.values())

        rec_flag = self.source.is_flagged(o.recipient)[0] if o.recipient else False
        iss_flag = bool(auth and auth.flagged)
        hard = any(s.hard for s in signals)

        llm_result = None
        llm_available = True
        if not hard and self.llm.enabled:
            llm_result = self.llm.score(build_payload(req, cleaned, mandate, auth, {"issuer_flagged": iss_flag, "recipient_flagged": rec_flag}))
            llm_available = llm_result is not None

        repeat = rec_flag or iss_flag
        llm_for_scoring = {"risk_score": 1.0, "reasons": ["hard block"]} if hard else llm_result
        res = scoring.combine(signals, llm_for_scoring, o.amount, mandate.max_amount if mandate else 0.0,
                              self.thresholds, repeat_offender=repeat)

        ded = scoring.deductions(signals)
        cost = {d["id"]: d["cost"] for d in ded}
        reasons = [f"[{s.layer}] {s.id} (-{cost[s.id]:g}): {s.evidence}" for s in sorted(signals, key=lambda s: (-s.hard, -s.weight))]
        if res.risk_llm is not None and res.risk_llm > res.risk_heuristic:
            reasons.append(f"[claude] trust lowered to {res.trust} by Claude's judgement (risk {res.risk_llm})")
        reasons += [f"[claude] {r}" for r in (llm_result or {}).get("reasons", [])[:5]]
        reasons += [f"[engine] {n}" for n in res.notes]
        owasp = sorted({x for s in signals for x in s.owasp} | set((llm_result or {}).get("owasp", [])))
        poison = (llm_result or {}).get("poison_check") or {}
        poison_signals = [s for s in signals if s.layer == "content"]
        if not poison:
            poison = {"is_poisoned": bool(poison_signals), "confidence": round(scoring.noisy_or([s.weight for s in poison_signals]), 2),
                      "evidence": [s.evidence for s in poison_signals][:5]}

        v = Verdict(
            instruction_id=o.instruction_id(), issuer=o.issuer, action=o.action, amount=o.amount, currency=o.currency,
            recipient=o.recipient, verdict=res.verdict, risk_score=res.risk, trust_score=res.trust, reasons=reasons, owasp=owasp,
            authority_check={"authorized": bool(auth and auth.active), "within_limit": bool(mandate and (not mandate.max_amount or o.amount <= mandate.max_amount)),
                             "source": "onchain" if source_ok and not isinstance(self.source, MockJsonSource) else "mock"},
            poison_check=poison, onchain_flagged=bool(rec_flag or iss_flag), severity=res.severity,
            signals=[s.to_dict() for s in signals], deductions=ded, risk_heuristic=res.risk_heuristic, risk_llm=res.risk_llm,
            llm_available=llm_available, latency_ms=round((time.perf_counter() - t0) * 1000, 2),
        )
        out = v.to_dict()
        out["mandate"] = {"role": mandate.role, "max_amount": mandate.max_amount, "allowed_actions": mandate.allowed_actions} if mandate else None
        out["thresholds"] = list(res.thresholds)
        out["x402"] = req.context.get("x402") or None
        out["trust_thresholds"] = {"allow_at_or_above": scoring.trust_from_risk(res.thresholds[0]), "block_below": scoring.trust_from_risk(res.thresholds[1])}
        self._effects(out)
        return out

    # hard blocks that say nothing against the recipient itself: protocol or issuer-side failures
    PROTOCOL_BLOCKS = {"nonce_replay", "amount_matches_402_quote", "facilitator_endorsed", "issuer_in_registry",
                       "inter_agent_message_signed", "issuer_signature_invalid", "canary_in_outbound", "amount_within_mandate",
                       "disable_logs_or_confirmation_attempt"}

    def _effects(self, out: dict) -> None:
        if out["verdict"] == "block":
            reason = out["reasons"][0][:120] if out["reasons"] else "blocked by guard"
            hard_ids = {s["id"] for s in out.get("signals", []) if s.get("hard")}
            recipient_to_blame = bool(hard_ids - self.PROTOCOL_BLOCKS) or not hard_ids  # soft-score block: the whole picture pointed at this counterparty
            try:
                self.source.mark_threat(out["instruction_id"], 3, reason)
                if out["recipient"]:
                    # severity 3 = direct refusal next time; severity 1 = a trace in the registry, informational next time
                    self.source.mark_threat(out["recipient"], 3 if recipient_to_blame else 1, reason)
                fac = (out.get("x402") or {}).get("facilitator")
                if "facilitator_endorsed" in hard_ids and fac:
                    self.source.mark_threat(fac, 3, "non-endorsed facilitator: " + reason)
                if not out["authority_check"]["authorized"]:
                    self.source.mark_threat(out["issuer"], 2, "issued an unauthorized order: " + reason)
            except Exception as e:
                out.setdefault("sink_errors", []).append(f"mark_threat: {e}")
        if out["verdict"] == "needs_approval":
            self.queue.add(out)
        self.sink.record(out)

    def approve(self, instruction_id: str, decision: str, approver: str, note: str = "") -> dict:
        if decision not in ("allow", "block"):
            raise ValueError("decision must be allow or block")
        pending = self.queue.pop(instruction_id)
        if pending is None:
            raise KeyError(f"no pending decision {instruction_id}")
        pending["verdict"] = decision
        pending["trust_score"] = 0 if decision == "block" else pending.get("trust_score", 0)
        pending["approved_by"] = approver
        pending["reasons"].append(f"[human] {approver}: {decision} ({note or 'no note'})")
        pending["timestamp"] = datetime.now(timezone.utc).isoformat()
        pending["severity"] = 3 if decision == "block" else pending.get("severity", 2)
        if decision == "block":
            self._effects(pending)
        else:
            self.sink.record(pending)
        return pending

    def pending(self) -> list[dict]:
        return self.queue.list()
