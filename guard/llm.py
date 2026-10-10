"""Wraps detection/scorer.py (Claude on Bedrock). Never raises: returns None when Claude is unreachable."""
from __future__ import annotations

import concurrent.futures
import logging
import os
from typing import Any, Callable

log = logging.getLogger("guard.llm")


class ClaudeScorer:
    def __init__(self, score_fn: Callable[[dict], dict] | None = None, timeout_s: float = 25.0, enabled: bool | None = None):
        self._fn = score_fn
        self.timeout = timeout_s
        self.enabled = enabled if enabled is not None else os.environ.get("GUARD_LLM", "on").lower() not in ("off", "0", "false")

    def _default(self) -> Callable[[dict], dict]:
        from detection.scorer import score_order
        return score_order

    def score(self, payload: dict[str, Any]) -> dict | None:
        if not self.enabled:
            return None
        fn = self._fn or self._default()
        try:
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
                return ex.submit(fn, payload).result(timeout=self.timeout)
        except Exception as e:  # expired AWS creds, throttling, timeout, bad JSON
            log.warning("claude scorer unavailable: %s", e)
            return None


def build_payload(req, cleaned, mandate, auth, flags: dict) -> dict:
    """What Claude sees: the order, the sanitized context (visible + hidden marked), mandate, on-chain facts."""
    ctx = cleaned.visible
    if cleaned.hidden:
        ctx += "\n\n[TEXT HIDDEN FROM HUMAN READERS: CSS-hidden elements, comments, hidden inputs, invisible unicode]\n" + cleaned.hidden
    if cleaned.attrs:
        ctx += "\n\n[ORDINARY PAGE METADATA: alt/title/meta attributes, normal on any site]\n" + cleaned.attrs[:800]
    if cleaned.decoded_blobs:
        ctx += "\n\n[DECODED ENCODED BLOBS]\n" + "\n".join(cleaned.decoded_blobs)
    o = req.order
    return {
        "order": {"issuer": o.issuer, "action": o.action, "amount": o.amount, "currency": o.currency, "recipient": o.recipient},
        "order_origin": req.origin,
        "agent_task": req.task,
        "source_context": ctx[:6000],
        "mandate": (f"role={mandate.role}; actions={mandate.allowed_actions}; max={mandate.max_amount} {mandate.currency}; "
                    f"recipients={mandate.allowed_recipients or 'any'}; {mandate.description}") if mandate else "NO MANDATE REGISTERED FOR THIS ISSUER",
        "authority": {"authorized": bool(auth and auth.active), "within_limit": bool(auth and (not auth.max_amount or o.amount <= auth.max_amount)),
                      "role": auth.role if auth else None},
        "onchain_flags": flags,
    }
