"""The brain: sanitize -> signals -> hard blocks -> Claude -> thresholds -> effects."""
from __future__ import annotations

import json
import logging
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from guard import sanitize, scoring
from guard.features import authority as f_auth, content as f_content, counterparty as f_cp, mandate as f_mandate, registry as f_registry, tools as f_tools, transaction as f_tx
from guard.llm import ClaudeScorer, build_payload
from guard.models import Mandate, Signal, Verdict, VerifyRequest, norm_addr
from guard.queue import PendingQueue
from guard.sinks import CompositeSink, DecisionSink, JsonlSink
from guard.sources import AuthoritySource, MockJsonSource

log = logging.getLogger("guard.engine")
ROOT = Path(__file__).resolve().parent.parent
VISA_TTL = 3600  # a human's approval lets the exact same order through once, within the hour
CARD = re.compile(r"(?<![\w.])(?:\d[ -]?){12,18}\d(?![\w.])")
CVV = re.compile(r"\b(cvv2?|cvc2?|cryptogramme)\b(\W{0,3})\d{3,4}\b", re.I)


def _luhn(digits: str) -> bool:
    total = 0
    for i, ch in enumerate(reversed(digits)):
        d = int(ch)
        if i % 2:
            d = d * 2 - 9 if d > 4 else d * 2
        total += d
    return total % 10 == 0


def redact(text: str) -> str:
    """Evidence quotes what the agent read: a card number or a CVV found there never enters the audit trail."""
    def card(m):
        digits = re.sub(r"\D", "", m.group(0))
        return "[card number redacted]" if _luhn(digits) else m.group(0)
    return CVV.sub(r"\1\2[redacted]", CARD.sub(card, text or ""))


def load_data(data_dir: Path) -> dict:
    def j(name, default):
        p = data_dir / name
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default
    return {
        "mandates": {norm_addr(k): v for k, v in j("mandates.json", {}).items()},
        "allowlist": [norm_addr(x) for x in j("allowlist.json", [])],
        "brands": j("brands.json", []),
        "domains": {k.lower(): v for k, v in j("domains.mock.json", {}).items()},
        "addresses": {norm_addr(k): v for k, v in j("addresses.mock.json", {}).items()},
        "facilitators": j("facilitators.json", []),
        "tools_inventory": j("tools_inventory.json", {}),
        # who each issuer is known to have paid before the guard started counting (the guard's own record, never the caller's word)
        "history": {norm_addr(k): [norm_addr(x) for x in v] for k, v in j("history.mock.json", {}).items()},
    }


class Engine:
    def __init__(self, source: AuthoritySource, sink: DecisionSink, queue: PendingQueue, llm: ClaudeScorer,
                 data: dict, thresholds: dict | None = None, spend_path: Path | None = None, visas_path: Path | None = None,
                 events_path: Path | None = None):
        self.source, self.sink, self.queue, self.llm, self.data = source, sink, queue, llm, data
        self.thresholds = thresholds or scoring.DEFAULT_THRESHOLDS
        self.spend_path = spend_path  # what each issuer was allowed to pay, kept by the guard itself
        self._spend: list[dict] = json.loads(spend_path.read_text(encoding="utf-8")) if spend_path and spend_path.exists() else []
        self.visas_path = visas_path  # orders a human approved and that have not come back yet
        self._visas: dict[str, dict] = json.loads(visas_path.read_text(encoding="utf-8")) if visas_path and visas_path.exists() else {}
        self.events_path = events_path  # flags lifted by a human

    def _save_visas(self) -> None:
        if self.visas_path:
            self.visas_path.write_text(json.dumps(self._visas), encoding="utf-8")

    def _paid_before(self, issuer: str, recipient: str) -> bool:
        """Has the guard already let this issuer pay this recipient? Its own journal, plus the history it was seeded with."""
        i, r = norm_addr(issuer), norm_addr(recipient)
        return bool(r) and (r in self.data.get("history", {}).get(i, []) or any(e["issuer"] == i and e.get("recipient") == r for e in self._spend))

    # ----- cumulative cap: the guard counts what it let through, the caller cannot under-declare it -----
    def _spent_24h(self, issuer: str) -> float:
        since = time.time() - 86400
        return sum(e["amount"] for e in self._spend if e["issuer"] == norm_addr(issuer) and e["ts"] >= since)

    def _record_spend(self, out: dict) -> None:
        self._spend.append({"issuer": norm_addr(out["issuer"]), "recipient": norm_addr(out.get("recipient")), "amount": float(out["amount"]), "ts": time.time()})
        if self.spend_path:
            self.spend_path.write_text(json.dumps(self._spend), encoding="utf-8")

    def decision(self, instruction_id: str) -> dict | None:
        """The recorded decision for one order (latest), with its trust score and every deduction. For audit."""
        for sink in getattr(self.sink, "sinks", [self.sink]):
            if hasattr(sink, "read_all"):
                found = [d for d in sink.read_all() if d.get("instruction_id") == instruction_id]
                if found:
                    return found[-1]
        return None

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
                    sinks.insert(0, ChainSink(chain))  # chain first, so the local log carries onchain_tx
                log.info("chain source enabled: %s", addr)
            except Exception as e:
                log.error("chain source disabled (%s), using mock", e)
        thresholds = scoring.load_thresholds(ROOT / "detection" / "research" / "features_scoring.json")
        return cls(source, CompositeSink(*sinks), PendingQueue(data_dir / "pending.json"), llm or ClaudeScorer(), load_data(data_dir), thresholds,
                   spend_path=data_dir / "spend.json", visas_path=data_dir / "visas.json", events_path=data_dir / "registry_events.jsonl")

    def _facts(self, req: VerifyRequest, signals: list[Signal]) -> dict:
        """What the guard knows by itself about who is being paid, for Claude: registry, journal, and what the checks found."""
        o = req.order
        merchant = req.context.get("merchant") if isinstance(req.context.get("merchant"), dict) else {}
        domain = str(merchant.get("domain") or "").lower().strip()
        known = self.data.get("domains", {}).get(domain) if domain else None
        wallets = f_cp._wallets(known) if isinstance(known, dict) else []
        return {
            "merchant_domain": domain or None,
            "merchant_domain_in_guard_registry": isinstance(known, dict),
            "merchant_domain_age_days": known.get("age_days") if isinstance(known, dict) else None,
            "recipient_is_registered_wallet_of_merchant": bool(wallets and o.recipient in wallets) if wallets else None,
            "recipient_long_standing_for_guard": f_cp.established(o.recipient, self.data),
            "recipient_in_issuer_allowlist": bool(self.data["mandates"].get(norm_addr(o.issuer), {}).get("allowed_recipients")
                                                  and o.recipient in [norm_addr(r) for r in self.data["mandates"][norm_addr(o.issuer)]["allowed_recipients"]]),
            "issuer_paid_recipient_before": self._paid_before(o.issuer, o.recipient),
            "deterministic_findings": [f"{s.id}: {s.evidence}"[:200] for s in signals][:8] or "none",
        }

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
        # before anything quotes the page: a card number in it reaches neither the evidence, nor the journal, nor Claude
        cleaned.visible, cleaned.hidden, cleaned.attrs = redact(cleaned.visible), redact(cleaned.hidden), redact(cleaned.attrs)
        cleaned.decoded_blobs, cleaned.code = [redact(b) for b in cleaned.decoded_blobs], [redact(c) for c in cleaned.code]
        auth, source_ok = self._authority(o.issuer)
        mandate = self.resolve_mandate(o.issuer, auth)

        signals: list[Signal] = []
        layers = [
            ("content", lambda: f_content.extract(req, cleaned)),
            ("mandate", lambda: f_mandate.extract(req, mandate)),
            ("authority", lambda: f_auth.extract(req, auth, source_ok, self.source, self.data["mandates"])),
            ("counterparty", lambda: f_cp.extract(req, mandate, self.source, self.data, prior=self._paid_before(o.issuer, o.recipient))),
            ("transaction", lambda: f_tx.extract(req, mandate, self.source, self.data)),
            ("tools", lambda: f_tools.extract(req, self.data)),
            ("registry", lambda: f_registry.extract(req, mandate, self.data)),  # sovereign KYB, opt-in GUARD_KYB=on
        ]
        for name, fn in layers:
            try:
                signals += fn()
            except Exception as e:  # malformed context facts: fail closed, never crash
                log.warning("layer %s failed: %s", name, e)
                signals.append(Signal(f"layer_error_{name}", name, 0.30, f"could not evaluate this layer ({type(e).__name__}: {str(e)[:80]}): treated as unverifiable"))
        if mandate and mandate.max_daily:
            spent = self._spent_24h(o.issuer)
            if spent + o.amount > mandate.max_daily:
                signals.append(Signal("daily_cap_exceeded", "mandate", 0.0,
                                      f"{spent:g} already allowed in the last 24 h + {o.amount:g} exceeds the daily cap {mandate.max_daily:g}", owasp=["ASI03"]))
        # dedupe by id, keep the strongest
        best: dict[str, Signal] = {}
        for s in signals:
            if s.id not in best or s.weight > best[s.id].weight or (s.hard and not best[s.id].hard):
                best[s.id] = s
        # same fact twice: the mandate cap and the on-chain cap both say "over the limit", count it once
        if "amount_within_mandate" in best and "amount_over_onchain_cap" in best:
            del best["amount_over_onchain_cap"]
        signals = list(best.values())
        for s in signals:
            s.evidence = redact(s.evidence)

        try:
            rec_flag = self.source.is_flagged(o.recipient)[0] if o.recipient else False
        except Exception as e:  # une source chaîne injoignable ne doit jamais casser un verdict
            log.warning("is_flagged failed: %s", e); rec_flag = False
        iss_flag = bool(auth and auth.flagged)
        hard = any(s.hard for s in signals)

        llm_result = None
        llm_available = True
        if not hard and self.llm.enabled:
            llm_result = self.llm.score(build_payload(req, cleaned, mandate, auth, {"issuer_flagged": iss_flag, "recipient_flagged": rec_flag},
                                                      self._facts(req, signals)))
            llm_available = llm_result is not None

        repeat = rec_flag or iss_flag
        llm_for_scoring = {"risk_score": 1.0, "reasons": ["hard block"]} if hard else llm_result
        res = scoring.combine(signals, llm_for_scoring, o.amount, mandate.max_amount if mandate else 0.0,
                              self.thresholds, repeat_offender=repeat)

        iid, approved_by = o.instruction_id(), None
        visa = self._visas.get(iid)
        if res.verdict == "needs_approval" and visa and time.time() - visa["ts"] <= VISA_TTL:
            # the visa: a human approved this exact order, it passes once. A block stays a block.
            res.verdict, res.severity, approved_by = "allow", 2 if repeat else 1, visa["approver"]
            res.notes.append(f"approved by {visa['approver']}: this exact order passes once")
        if res.verdict == "allow" and o.nonce and self.source.nonce_seen(f_tx.nonce_key(o.issuer, o.nonce)):
            return self.verify(req)  # the nonce was spent while this order was being examined: the second look sees the replay
        if approved_by:
            self._visas.pop(iid, None)
            self._save_visas()

        ded = scoring.deductions(signals)
        cost = {d["id"]: d["cost"] for d in ded}
        reasons = [f"[{s.layer}] {s.id} (-{cost[s.id]:g}): {s.evidence}" for s in sorted(signals, key=lambda s: (-s.hard, -s.weight))]
        if res.risk_llm is not None and res.risk_llm > res.risk_heuristic:
            reasons.append(f"[claude] trust lowered to {res.trust} by Claude's judgement (risk {res.risk_llm})")
        reasons += [redact(f"[claude] {r}") for r in (llm_result or {}).get("reasons", [])[:5]]
        reasons += [f"[engine] {n}" for n in res.notes]
        owasp = sorted({x for s in signals for x in s.owasp} | set((llm_result or {}).get("owasp", [])))
        poison = (llm_result or {}).get("poison_check") or {}
        poison_signals = [s for s in signals if s.layer == "content"]
        if not poison:
            poison = {"is_poisoned": bool(poison_signals), "confidence": round(scoring.noisy_or([s.weight for s in poison_signals]), 2),
                      "evidence": [s.evidence for s in poison_signals][:5]}
        elif isinstance(poison.get("evidence"), list):
            poison = {**poison, "evidence": [redact(str(e)) for e in poison["evidence"]]}

        v = Verdict(
            instruction_id=o.instruction_id(), issuer=o.issuer, action=o.action, amount=o.amount, currency=o.currency,
            recipient=o.recipient, verdict=res.verdict, risk_score=res.risk, trust_score=res.trust, reasons=reasons, owasp=owasp,
            authority_check={"authorized": bool(auth and auth.active), "within_limit": bool(mandate and (not mandate.max_amount or o.amount <= mandate.max_amount)),
                             "source": "onchain" if source_ok and not isinstance(self.source, MockJsonSource) else "mock"},
            poison_check=poison, onchain_flagged=bool(rec_flag or iss_flag), severity=res.severity,
            signals=[s.to_dict() for s in signals], deductions=ded, risk_heuristic=res.risk_heuristic, risk_llm=res.risk_llm,
            llm_available=llm_available, latency_ms=round((time.perf_counter() - t0) * 1000, 2), approved_by=approved_by,
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
                       "disable_logs_or_confirmation_attempt", "amount_implausible", "task_order_mismatch"}
    # layers that judge the issuer (its mandate, its authority chain): what they find says nothing against the recipient
    ISSUER_LAYERS = {"mandate", "authority"}

    def _flag(self, key: str, severity: int, reason: str) -> None:
        """Flag a subject, never lowering what the registry already holds."""
        try:
            _, current, _ = self.source.is_flagged(key)
        except Exception:
            current = 0
        if severity > current:
            self.source.mark_threat(key, severity, reason)

    def _effects(self, out: dict, confirmed: bool = False) -> None:
        if out["verdict"] == "block":
            reason = out["reasons"][0][:120] if out["reasons"] else "blocked by guard"
            sigs = out.get("signals", [])
            hard_ids = {s["id"] for s in sigs if s.get("hard")}
            against = [s for s in sigs if s.get("layer") not in self.ISSUER_LAYERS and s["id"] not in self.PROTOCOL_BLOCKS
                       and s["id"] not in scoring.INFORMATIONAL and (s.get("hard") or s.get("weight", 0) > 0)]
            # severity 3 = direct refusal next time, kept for proof (a hard signal against this counterparty) or a human's confirmation;
            # severity 2 = clues only (soft-score block): weighs on the next order without closing the door for good;
            # severity 1 = a protocol or issuer-side hard failure: a trace, it says nothing against the recipient;
            # no flag at all when nothing found is about the recipient (an issuer without the right, Claude's judgement alone).
            # A recipient that is long-standing for the guard only ever gets a trace: one caller's report never bans it, a human does.
            if confirmed:
                severity = 3
            else:
                severity = 3 if any(s.get("hard") for s in against) else 1 if hard_ids else 2 if against else 0
                if f_cp.established(out["recipient"], self.data):
                    severity = min(severity, 1)
            try:
                self.source.mark_threat(out["instruction_id"], 3, reason)
                if out["recipient"] and severity:
                    self._flag(out["recipient"], severity, reason)
                fac = (out.get("x402") or {}).get("facilitator")
                if "facilitator_endorsed" in hard_ids and fac:
                    self.source.mark_threat(fac, 3, "non-endorsed facilitator: " + reason)
                if not out["authority_check"]["authorized"]:
                    self.source.mark_threat(out["issuer"], 2, "issued an unauthorized order: " + reason)
            except Exception as e:
                out.setdefault("sink_errors", []).append(f"mark_threat: {e}")
        if out["verdict"] == "needs_approval":
            self.queue.add(out)
        elif not confirmed:
            self.queue.pop(out["instruction_id"])  # the same order was held earlier and is now settled by its own merits
        if out["verdict"] == "allow":
            self._record_spend(out)
        self.sink.record(out)

    def approve(self, instruction_id: str, decision: str, approver: str, note: str = "") -> dict:
        """allow = the order may pass; decline = not this payment, nothing held against the recipient; block = this is a fraud,
        the recipient is refused from now on."""
        if decision not in ("allow", "block", "decline"):
            raise ValueError("decision must be allow, block or decline")
        if self.queue.get(instruction_id) is None:
            raise KeyError(f"no pending decision {instruction_id}")
        pending = self.queue.pop(instruction_id)
        pending["verdict"] = "allow" if decision == "allow" else "block"
        pending["trust_score"] = pending.get("trust_score", 0) if decision == "allow" else 0
        pending["approved_by"] = approver
        pending["reasons"].append(f"[human] {approver}: {decision} ({note or 'no note'})")
        pending["timestamp"] = datetime.now(timezone.utc).isoformat()
        pending["severity"] = 3 if decision == "block" else pending.get("severity", 2)
        if decision == "block":
            self._effects(pending, confirmed=True)
        else:
            if decision == "allow":
                # nothing is paid yet: the agent sends the same order again and the visa lets it through, once.
                # Spend and nonce are counted then, when the payment really leaves.
                self._visas[instruction_id] = {"approver": approver, "ts": time.time()}
                self._save_visas()
            self.sink.record(pending)
        return pending

    def lift_flag(self, subject: str, approver: str, note: str = "") -> dict:
        """A human takes a subject (address, domain) out of the incident registry. Kept in the registry's own journal."""
        event = {"event": "flag_lifted", "subject": norm_addr(subject), "lifted": self.source.clear_threat(subject), "by": approver,
                 "note": note, "timestamp": datetime.now(timezone.utc).isoformat()}
        if self.events_path:
            with self.events_path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(event, ensure_ascii=False) + "\n")
        return event

    def pending(self) -> list[dict]:
        return self.queue.list()
