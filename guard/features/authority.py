"""Layer 3: who gave the order, read from the authority registry (on-chain or mock)."""
from __future__ import annotations

from guard.models import Signal, VerifyRequest
from guard.sources import Authority, AuthoritySource

LAYER = "authority"
LOW_PRIV_ROLES = ("reader", "document-reader", "doc-reader", "viewer", "low-priv", "low-privilege", "summarizer", "researcher", "scraper")
PAY_ACTIONS = ("pay", "transfer", "approve", "swap")


def extract(req: VerifyRequest, auth: Authority | None, source_ok: bool) -> list[Signal]:
    sig: list[Signal] = []
    o = req.order

    if not source_ok:
        sig.append(Signal("authority_source_unavailable", LAYER, 0.30, "authority registry unreachable, fell back to local mock"))

    if auth is None or not auth.active:
        sig.append(Signal("issuer_in_registry", LAYER, 1.0, f"issuer {o.issuer} not active in AuthorityRegistry", hard=True, owasp=["ASI03"]))
    else:
        if auth.role.lower() in LOW_PRIV_ROLES and o.action in PAY_ACTIONS:
            sig.append(Signal("issuer_role_mismatch", LAYER, 0.60, f"role {auth.role!r} is not allowed to order {o.action!r}", owasp=["ASI03"]))
        if auth.max_amount and o.amount > auth.max_amount:
            sig.append(Signal("amount_over_onchain_cap", LAYER, 0.50, f"amount {o.amount} > on-chain cap {auth.max_amount}", owasp=["ASI03"]))

    if auth is not None and auth.flagged:
        sig.append(Signal("issuer_flagged_onchain", LAYER, 1.0, f"issuer flagged in incident registry (severity {auth.flag_severity}): {auth.flag_reason}", hard=True))

    if req.origin == "agent" and req.context.get("signed") is False:
        sig.append(Signal("inter_agent_message_signed", LAYER, 1.0, "order relayed by another agent without a verifiable signature", hard=True, owasp=["ASI07"]))
    if req.context.get("signature_valid") is False:
        sig.append(Signal("issuer_signature_invalid", LAYER, 1.0, "issuer signature missing or invalid", hard=True, owasp=["ASI07"]))

    return sig
