"""Layer 5: the transaction itself (calldata, velocity, x402 facts)."""
from __future__ import annotations

from guard.models import Mandate, Signal, VerifyRequest
from guard.sources import AuthoritySource

LAYER = "transaction"
MAX_UINT = (1 << 256) - 1
SELECTORS = {
    "095ea7b3": "approve(address,uint256)",
    "a22cb465": "setApprovalForAll(address,bool)",
    "d505accf": "permit(...)",
    "a9059cbb": "transfer(address,uint256)",
    "23b872dd": "transferFrom(address,address,uint256)",
    "39509351": "increaseAllowance(address,uint256)",
}


def decode_calldata(calldata: str) -> dict | None:
    cd = (calldata or "").lower().removeprefix("0x")
    if len(cd) < 8 or any(c not in "0123456789abcdef" for c in cd):
        return None
    sel = cd[:8]
    if sel not in SELECTORS:
        return None
    words = [cd[8 + i * 64: 8 + (i + 1) * 64] for i in range((len(cd) - 8) // 64)]
    out = {"selector": sel, "fn": SELECTORS[sel], "args": words}
    if sel in ("095ea7b3", "39509351", "d505accf") and len(words) >= 2:
        out["spender"] = "0x" + words[0][-40:]
        out["value"] = int(words[1], 16)
    if sel == "a22cb465" and len(words) >= 2:
        out["spender"] = "0x" + words[0][-40:]
        out["approved"] = int(words[1], 16) == 1
    return out


def extract(req: VerifyRequest, mandate: Mandate | None, source: AuthoritySource, data: dict) -> list[Signal]:
    sig: list[Signal] = []
    o = req.order

    if o.calldata:
        dec = decode_calldata(o.calldata)
        if dec is None:
            sig.append(Signal("calldata_undecodable", LAYER, 0.50, "calldata cannot be decoded: refusing blind signing"))
        else:
            if dec.get("fn", "").startswith("approve") and dec.get("value", 0) >= (1 << 255):
                sig.append(Signal("approve_unlimited", LAYER, 0.45, f"unlimited ERC-20 approval to {dec.get('spender')}", owasp=["ASI07"]))
            if dec.get("fn", "").startswith("setApprovalForAll") and dec.get("approved"):
                sig.append(Signal("approve_unlimited", LAYER, 0.45, f"setApprovalForAll(true) to {dec.get('spender')}", owasp=["ASI07"]))
            if dec.get("fn", "").startswith("permit"):
                sig.append(Signal("permit_signature", LAYER, 0.30, "permit() signature grants an allowance off-chain"))
            if o.action in ("pay", "transfer") and dec["fn"].startswith(("approve", "setApprovalForAll", "permit", "increaseAllowance")):
                sig.append(Signal("signature_contains_arbitrary_call", LAYER, 1.0, f"a {o.action} order carries an allowance call {dec['fn']}", hard=True, owasp=["ASI07"]))

    if o.nonce:
        if source.nonce_seen(o.nonce):
            sig.append(Signal("nonce_replay", LAYER, 1.0, f"nonce {o.nonce} already used (replay)", hard=True))

    x = req.context.get("x402") or {}
    if x:
        q = x.get("quote_amount")
        if q is not None and o.amount > float(q) * 1.01:
            sig.append(Signal("amount_matches_402_quote", LAYER, 1.0, f"order amount {o.amount} exceeds the 402 quote {q}", hard=True))
        fac = (x.get("facilitator") or "").lower()
        endorsed = [f.lower() for f in data.get("facilitators", [])]
        if fac and endorsed and fac not in endorsed:
            sig.append(Signal("facilitator_endorsed", LAYER, 1.0, f"settlement submitted by non-endorsed facilitator {fac}", hard=True))
        elif fac and source.is_flagged(fac)[0]:
            sig.append(Signal("facilitator_endorsed", LAYER, 1.0, f"facilitator {fac} is flagged in the incident registry", hard=True))
        if x.get("sybil_score", 0) > 0.5:
            sig.append(Signal("server_metadata_sybil_score", LAYER, 0.30, f"service metadata duplicated across endpoints (sybil score {x['sybil_score']})"))
        if x.get("confirmations_met") is False:
            sig.append(Signal("confirmations_required_met", LAYER, 0.20, "settlement delivered before the required block confirmations"))

    h = req.context.get("history") or {}
    if h:
        avg = h.get("avg_amount")
        if avg and o.amount > 3 * float(avg):
            sig.append(Signal("amount_vs_history_zscore", LAYER, 0.35, f"amount {o.amount} is {o.amount / float(avg):.1f}x this agent's average {avg}"))
        if h.get("payments_last_hour", 0) > 3:
            sig.append(Signal("velocity_1h", LAYER, 0.30, f"{h['payments_last_hour']} payments in the last hour"))
        bal = h.get("balance")
        if bal and o.amount > 0.5 * float(bal):
            sig.append(Signal("amount_vs_balance_ratio", LAYER, 0.30, f"amount is {round(100 * o.amount / float(bal))}% of the balance"))
        if h.get("bank_detail_change_recent"):
            sig.append(Signal("bank_detail_change_recent", LAYER, 0.35, "beneficiary details changed recently (call-back verification needed)"))
        if h.get("geo_mismatch"):
            sig.append(Signal("geo_mismatch", LAYER, 0.15, "IP / billing / card countries disagree"))

    return sig
