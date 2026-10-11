"""
SentinelL1 Authority API (Walid's lane = on-chain execution).

The brain (Corentin/Bruno: agents + scoring) decides verdict = allow | block | needs_human,
then POSTs it here. This service writes the decision on-chain on SentinelL1 and returns the proof.
It also proxies the L1 JSON-RPC (so MetaMask / the UI only need ONE https URL).

Endpoints:
  GET  /health                 -> chain + registry status
  POST /authorize              -> {payment, verdict, reason, ttl, screen?} -> on-chain visa/flag/pending + tx proof
  GET  /visa/{payment_id}      -> is this payment's visa currently valid?
  GET  /flagged/{address}      -> is this address flagged as a threat?
  POST /rpc                    -> transparent JSON-RPC proxy to the L1 (for MetaMask / ethers)

Env (EnvironmentFile on the EC2):
  L1_RPC_URL  REGISTRY_ADDRESS  AUTHORIZER_KEY  [VISA_TTL_SECONDS]
Hardening of POST /authorize (spec 2026-10-11 section 4). Nothing changes until it is configured:
  SENTINEL_API_KEYS         comma separated bearer keys. Empty = open, exactly as before.
  SENTINEL_TRUSTED_KEYS     first-party keys (our Lambda), accepted without being repeated in SENTINEL_API_KEYS:
                            exempt from 'require', and their unscreened block still flags the recipient.
  SENTINEL_RESCREEN         off | tighten | require. Default: tighten without keys, require with keys
                            (require: an allow that brings no `screen` becomes needs_human).
  SENTINEL_AMOUNT_DECIMALS  decimals from screen.order.amount to payment.amount (default 18, SEC wei).
  Re-screening runs the repo's guard engine (guard/ + data/ next to api/): GUARD_DATA_DIR (writable),
  GUARD_LLM (default off here), GUARD_CONTRACT_ADDRESS + AVAX_RPC_URL (read-only chain source).
  GUARD_OWNER_KEY is dropped from the environment: this process writes on chain through authorize.py only.
Run:  uvicorn server:app --host 0.0.0.0 --port 8080
"""
import asyncio
import hashlib
import hmac
import json
import logging
import os
import re
import sys
import threading
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, NamedTuple, Optional

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from web3 import Web3

import authorize as az  # reuses the on-chain executor (same dir on the EC2)

UPSTREAM = os.environ.get("L1_RPC_URL", "http://127.0.0.1:9650/ext/bc/C/rpc")
ROOT = Path(__file__).resolve().parent.parent  # guard/, data/ and detection/ are shipped next to api/
log = logging.getLogger("uvicorn.error.sentinel")  # a child of uvicorn's logger: lands in journalctl with the rest

app = FastAPI(title="SentinelL1 Authority API", version="1.1")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class Payment(BaseModel):
    issuer: str
    recipient: str
    amount: int = Field(ge=0, lt=2**256)  # uint256 on chain: a negative or oversized value is a 422, not a 500
    nonce: Optional[int] = Field(None, ge=0, lt=2**256)


class Screen(BaseModel):
    """What the agent read when it decided to pay (guard VerifyRequest shape), so the server judges the order itself.
    Nested under `screen` because the top-level `context` already means UI labels."""
    order: dict[str, Any]  # {issuer, action, amount (human units), currency, recipient, nonce?, calldata?, memo?}
    source_context: str = Field("", max_length=1_000_000)
    context_type: str = "text"  # text | html | email | tool_output
    task: str = Field("", max_length=100_000)
    context: Optional[dict[str, Any]] = None  # facts: origin, merchant, x402, tools, history, ...


class AuthorizeReq(BaseModel):
    payment: Payment
    verdict: str            # allow | block | needs_human (the brain's decision)
    reason: str = ""        # cut to 200 chars before it goes on chain (fixed gas per tx)
    ttl: int = Field(300, ge=1, le=86400)  # visa lifetime: a day at most, never a visa that does not expire
    full: Optional[dict] = None     # optional: the complete AgenticPaymentVerdict (detection/verdict.schema.json)
    context: Optional[dict] = None  # optional: UI labels (issuer_label, recipient_label, source_excerpt, ...)
    screen: Optional[Screen] = None  # optional: the screening inputs, for the server's own verdict


# ---- in-memory event bus: every decision is re-broadcast to the 3D city (SSE) ----
_events: list[str] = []
_EVENTS_MAX = 500
# verdict naming: our API uses needs_human, the shared schema uses needs_approval
_SCHEMA_VERDICT = {"allow": "allow", "block": "block", "needs_human": "needs_approval"}


def _publish(message: dict):
    _events.append(json.dumps(message, default=str))
    if len(_events) > _EVENTS_MAX:
        del _events[: len(_events) - _EVENTS_MAX]


@app.get("/health")
def health():
    return {
        "ok": True,
        "chainId": az.w3.eth.chain_id,
        "block": az.w3.eth.block_number,
        "registry": az.REGISTRY_ADDRESS,
        "authorizer": az._acct.address if az._acct else None,
    }


# ---- API keys: POST /authorize only (the city, MetaMask and the explorer read the other routes) ----
class Caller(NamedTuple):
    key_id: Optional[str]  # sha256(key)[:12]: names the caller in logs and responses, never the key itself
    trusted: bool          # a SENTINEL_TRUSTED_KEYS key (our own Lambda)
    keys_active: bool      # SENTINEL_API_KEYS is set: anonymous callers are refused


def _keys(name: str) -> list[str]:
    return [k.strip() for k in os.environ.get(name, "").split(",") if k.strip()]


def _match(token: str, keys: list[str]) -> bool:
    hit = False
    for k in keys:  # every key is compared, no early exit
        hit |= hmac.compare_digest(token.encode(), k.encode())
    return hit


def require_key(authorization: Optional[str] = Header(None)) -> Caller:
    """Bearer auth. No SENTINEL_API_KEYS = open as before (a known key is still recognised, for its key_id and trust)."""
    api, trusted = _keys("SENTINEL_API_KEYS"), _keys("SENTINEL_TRUSTED_KEYS")
    scheme, _, token = (authorization or "").strip().partition(" ")
    token = token.strip() if scheme.lower() == "bearer" else ""
    is_trusted = bool(token) and _match(token, trusted)
    known = is_trusted or (bool(token) and _match(token, api))
    if api and not token:
        raise HTTPException(401, "missing bearer token", headers={"WWW-Authenticate": "Bearer"})
    if api and not known:
        raise HTTPException(401, "invalid api key", headers={"WWW-Authenticate": "Bearer"})
    return Caller(hashlib.sha256(token.encode()).hexdigest()[:12] if known else None, is_trusted, bool(api))


def _rescreen_mode(keys_active: bool) -> str:
    mode = os.environ.get("SENTINEL_RESCREEN", "").strip().lower()
    return mode if mode in ("off", "tighten", "require") else ("require" if keys_active else "tighten")


# ---- server-side re-screening: the guard engine judges the order itself, the client can only tighten ----
_ENGINE_LOCK = threading.Lock()  # the engine keeps state in memory (spend, visas, queue): one verify at a time
_CHAIN_LOCK = threading.Lock()   # authorize.py reads the account nonce then sends 1-2 txs: concurrent calls collided
_engine_state: dict[str, Any] = {}  # {"engine": ...} or {"error": "..."}, built on first use, kept until restart
_RANK = {"allow": 0, "needs_human": 1, "block": 2}
_API_VERDICT = {"allow": "allow", "needs_approval": "needs_human", "block": "block"}
_REASON_PREFIX = re.compile(r"^\[[a-z_]+\]\s*|\s\(-[\d.]+\)")  # same short form as agents/sentinel_chain.py


def _issuer_known(v: dict) -> bool:
    """The server's own view: an active authority, not merely an address the caller names."""
    return bool((v.get("authority_check") or {}).get("authorized")) and not any(
        s.get("id") == "issuer_in_registry" for s in v.get("signals") or [])


def _build_engine():
    """The guard engine as the hosted judge. It never writes on chain (only authorize.py does, under _CHAIN_LOCK: an
    owner key here would double-write and race the nonces), never guesses the LLM setting, and keeps its memory
    (threats, spend, decisions) in a writable GUARD_DATA_DIR."""
    if str(ROOT) not in sys.path:
        sys.path.append(str(ROOT))  # appended: an installed or PYTHONPATH guard still wins
    if os.environ.pop("GUARD_OWNER_KEY", None):
        log.warning("GUARD_OWNER_KEY dropped: the API writes on chain through authorize.py only")
    from guard.engine import Engine
    from guard.llm import ClaudeScorer
    from guard.models import norm_addr

    data_dir = Path(os.environ.get("GUARD_DATA_DIR") or ROOT / "data")
    if not data_dir.is_dir() or not os.access(data_dir, os.W_OK):
        raise RuntimeError(f"GUARD_DATA_DIR {data_dir} is not a writable directory")
    llm = ClaudeScorer(enabled=False)  # the guard defaults to on; here it is on only when asked
    if os.environ.get("GUARD_LLM", "off").strip().lower() in ("on", "1", "true"):
        try:
            from detection.scorer import score_order  # boto3 + Bedrock: imported now, so a missing piece is caught here
            llm = ClaudeScorer(score_fn=score_order, enabled=True)
        except Exception as e:
            log.error("GUARD_LLM=on but the scorer cannot load (%s): re-screening without Claude, which is stricter", e)

    class HostedEngine(Engine):
        """Marks counterparties by the hosted rules: an issuer the server does not know never gets a recipient marked,
        not even locally (its report would otherwise condemn the merchant on the next, legitimate order). Tells which
        severity it gave the recipient, the only ground for an on-chain flag after a re-screen."""
        recipient_severity = 0
        _judged: Optional[dict] = None

        def screen(self, request: dict) -> tuple[dict, int]:
            self.recipient_severity, self._judged = 0, None
            return self.verify(request), self.recipient_severity

        def _effects(self, out: dict, confirmed: bool = False) -> None:
            self._judged = out
            super()._effects(out, confirmed)

        def _flag(self, key: str, severity: int, reason: str) -> None:
            out = self._judged or {}
            if not _issuer_known(out):
                return
            if norm_addr(key) == norm_addr(out.get("recipient")):
                self.recipient_severity = max(self.recipient_severity, int(severity))
            super()._flag(key, severity, reason)

    engine = HostedEngine.from_env(data_dir, llm=llm)
    if getattr(engine.source, "owner_key", None):  # read-only chain source, whatever the environment said
        engine.source.owner_key = None
    return engine


def _engine():
    """The engine, or None when it cannot run here (guard deps missing, data dir not writable). Call under _ENGINE_LOCK."""
    if not _engine_state:
        try:
            _engine_state["engine"] = _build_engine()
            log.info("re-screening engine ready (llm=%s)", _engine_state["engine"].llm.enabled)
        except Exception as e:
            _engine_state["error"] = f"{type(e).__name__}: {e}"
            log.error("re-screening unavailable: %s", _engine_state["error"])
    return _engine_state.get("engine")


def _checksum(addr: Any, field: str) -> str:
    try:
        return Web3.to_checksum_address(str(addr))
    except Exception:
        raise HTTPException(400, f"{field} is not a valid 0x address")


def _decimals() -> int:
    try:
        return int(os.environ.get("SENTINEL_AMOUNT_DECIMALS", "18"))
    except ValueError:
        return 18


def _check_screen(req: AuthorizeReq, issuer: str, recipient: str) -> None:
    """The screened order must be the paid one, or a caller screens a benign order and gets a visa for another."""
    o, p = req.screen.order, req.payment
    if _checksum(o.get("issuer"), "screen.order.issuer") != issuer:
        raise HTTPException(400, "screen.order.issuer differs from payment.issuer")
    if _checksum(o.get("recipient"), "screen.order.recipient") != recipient:
        raise HTTPException(400, "screen.order.recipient differs from payment.recipient")
    dec = _decimals()
    try:
        amount = Decimal(str(o.get("amount")))
        if isinstance(o.get("amount"), bool) or not amount.is_finite() or amount.adjusted() > 80:
            raise InvalidOperation  # "1e100000000" would build a huge int below: no real amount is past uint256
        wei = int(amount * 10**dec)
    except (InvalidOperation, ValueError, OverflowError):
        raise HTTPException(400, "screen.order.amount is not a number")
    # to the wei, up to a float client's rounding (1 part in 10^12): agents/sentinel_chain.py converts with float math
    if abs(p.amount - wei) > max(1, wei // 10**12):
        raise HTTPException(400, f"screen.order.amount ({o.get('amount')}) differs from payment.amount ({p.amount} at {dec} decimals)")
    if p.nonce is not None and o.get("nonce") not in (None, "") and str(o["nonce"]).strip() != str(p.nonce):
        raise HTTPException(400, "screen.order.nonce differs from payment.nonce")


def _rescreen(screen: Screen) -> tuple[Optional[dict], int]:
    """(server verdict, severity the engine gave the recipient), or (None, 0) when the engine cannot judge."""
    with _ENGINE_LOCK:
        engine = _engine()
        if engine is None:
            return None, 0
        try:
            return engine.screen(screen.model_dump())
        except ValueError as e:  # malformed order (action, amount, ...): the caller's error
            raise HTTPException(422, f"invalid screen: {e}")
        except Exception:
            log.exception("re-screen failed")
            return None, 0


def _flag_severity(eff: str, sv: Optional[dict], rec_sev: int, caller: Caller) -> Optional[int]:
    """Who may get a recipient flagged on chain (at 3, every client refuses it from then on)."""
    if eff != "block":
        return None
    if sv is not None:  # re-screened: only the server's own recipient-side finding counts (unknown issuers mark nothing)
        return rec_sev if sv["verdict"] == "block" and rec_sev >= 3 else None
    if caller.keys_active and not caller.trusted:  # a client's word the server could not check
        return None
    return 3  # open mode, as before, or a trusted first-party caller


_SCHEMA_KEYS = ("issuer", "action", "amount", "currency", "recipient", "risk_score", "reasons", "authority_check",
                "poison_check", "onchain_flagged", "timestamp")


def _public_verdict(sv: dict, eff: str, payment_id: Optional[str]) -> dict:
    """The server's verdict for the public SSE: schema fields, trust score and signals (what the city draws), keyed by
    the on-chain payment id. Mandate, deductions, x402 quote and engine internals stay on the server."""
    v = {k: sv[k] for k in _SCHEMA_KEYS if k in sv}
    v.update(instruction_id=payment_id, verdict=_SCHEMA_VERDICT[eff], trust_score=sv.get("trust_score"),
             owasp=[x for x in sv.get("owasp") or [] if x in ("ASI03", "ASI07")],
             signals=[{k: s.get(k) for k in ("id", "layer", "weight", "hard", "evidence")} for s in sv.get("signals") or []])
    if v["verdict"] != sv.get("verdict"):
        v["reasons"] = list(v.get("reasons") or []) + [f"[engine] the client's stricter verdict stands: {eff}"]
    return v


@app.post("/authorize")
def do_authorize(req: AuthorizeReq, caller: Caller = Depends(require_key)):
    """verdict in -> on-chain execution out (the proof the jury/DORA audit reads). The client can only tighten: with
    `screen` the server judges the order itself and the stricter verdict is the one written on chain."""
    if req.verdict not in _RANK:
        raise HTTPException(400, "verdict must be allow|block|needs_human")
    issuer = _checksum(req.payment.issuer, "payment.issuer")
    recipient = _checksum(req.payment.recipient, "payment.recipient")
    mode = _rescreen_mode(caller.keys_active)
    sv, rec_sev = None, 0
    if req.screen is not None and mode != "off":
        _check_screen(req, issuer, recipient)
        sv, rec_sev = _rescreen(req.screen)
    server_v = _API_VERDICT.get(sv["verdict"], "block") if sv else None
    eff = max(req.verdict, server_v or "allow", key=_RANK.__getitem__)  # ties keep the client's
    reason = req.reason
    if sv is not None and eff != req.verdict:
        reason = f"[server] {req.verdict}->{eff}; trust={sv.get('trust_score')}/100; " + "; ".join(
            _REASON_PREFIX.sub("", str(r)) for r in sv.get("reasons") or [])
    elif sv is None and mode == "require" and eff == "allow" and not caller.trusted:
        eff, reason = "needs_human", "; ".join(filter(None, ["[server] allow->needs_human, screening inputs required for a visa", req.reason]))
    reason = reason[:200]
    flag = _flag_severity(eff, sv, rec_sev, caller)
    payment = {"issuer": req.payment.issuer, "recipient": req.payment.recipient, "amount": req.payment.amount}
    try:
        with _CHAIN_LOCK:
            out = az.authorize(payment, eff, reason=reason, ttl=req.ttl, nonce=req.payment.nonce, flag_severity=flag)
    except Exception as e:
        raise HTTPException(500, f"{type(e).__name__}: {e}")
    log.info("authorize key=%s client=%s server=%s effective=%s mode=%s flag=%s pid=%s", caller.key_id, req.verdict,
             server_v, eff, mode, flag, out.get("payment_id"))
    # re-broadcast to the 3D city (SSE), always with the verdict written on chain: the car never contradicts the chain
    if sv is not None:
        verdict_obj = _public_verdict(sv, eff, out.get("payment_id"))
    elif req.full:
        verdict_obj = {**req.full, "verdict": _SCHEMA_VERDICT[eff]}
    else:
        verdict_obj = {
            "instruction_id": out.get("payment_id"),
            "issuer": req.payment.issuer,
            "action": "pay",
            "amount": req.payment.amount / 1e18,
            "currency": "SEC",
            "recipient": req.payment.recipient,
            "verdict": _SCHEMA_VERDICT[eff],
            "risk_score": 0.08 if eff == "allow" else (0.55 if eff == "needs_human" else 0.9),
            "reasons": [reason] if reason else [],
            "owasp": [],
            "onchain_flagged": bool(out.get("flag_tx")),
        }
    _publish({"verdict": verdict_obj, "context": req.context or {}, "proof": out})
    resp = {"status": "ok", **out, "client_verdict": req.verdict, "server_verdict": server_v, "rescreened": sv is not None,
            "tightened": eff != req.verdict, "trust_score": sv.get("trust_score") if sv else None,
            "instruction_id": sv.get("instruction_id") if sv else None, "key_id": caller.key_id}
    if req.screen is not None and mode != "off" and sv is None:
        resp["rescreen_error"] = "re-screening unavailable on this server"  # details in the server log only
    return resp


@app.get("/visa/{payment_id}")
def visa(payment_id: str):
    if not re.fullmatch(r"0x[0-9a-fA-F]{64}", payment_id):
        raise HTTPException(400, "paymentId must be 0x + 64 hex")
    valid = az._reg.functions.isVisaValid(Web3.to_bytes(hexstr=payment_id)).call()
    return {"paymentId": payment_id, "valid": bool(valid)}


@app.get("/flagged/{address}")
def flagged(address: str):
    checksummed = _checksum(address, "address")
    key = az.address_key(checksummed)  # left-padded address -> bytes32 (matches registry)
    is_flagged, severity = az._reg.functions.isFlagged(key).call()
    return {"address": checksummed, "flagged": bool(is_flagged), "severity": int(severity)}


# ---- 3D UI feed (Maxime) : each on-chain decision = one car ----
# lane mapping: allow -> passes the toll, block -> u-turn, needs_human -> parks
LANE = {"allow": "pass", "block": "uturn", "needs_human": "park"}


def _collect_cars(from_block: int, to_block: int):
    """Decode AuthorityRegistry.DecisionRecorded (+ VisaGranted context) into car events."""
    reg = az._reg
    visas = {}
    try:
        for ev in reg.events.VisaGranted().get_logs(from_block=from_block, to_block=to_block):
            visas["0x" + ev.args.paymentId.hex()] = ev
    except Exception:
        pass
    cars = []
    for ev in reg.events.DecisionRecorded().get_logs(from_block=from_block, to_block=to_block):
        pid = "0x" + ev.args.paymentId.hex()
        vg = visas.get(pid)
        verdict = ev.args.verdict
        cars.append({
            "verdict": verdict,
            "lane": LANE.get(verdict, "park"),
            "paymentId": pid,
            "issuer": ev.args.issuer,
            "recipient": (vg.args.recipient if vg else None),
            "amount": (str(vg.args.amount) if vg else None),
            "reason": ev.args.reason,
            "txHash": az.w3.to_hex(ev.transactionHash),
            "block": ev.blockNumber,
        })
    cars.sort(key=lambda c: c["block"])
    return cars


@app.get("/cars")
def cars(sinceBlock: int = -1, lookback: int = 300):
    """Polling feed for the 3D UI. Pass the returned latestBlock back as sinceBlock next time.
    First call (sinceBlock omitted) returns the last `lookback` blocks of cars."""
    latest = az.w3.eth.block_number
    frm = (sinceBlock + 1) if sinceBlock >= 0 else max(0, latest - lookback)
    if frm > latest:  # nothing new since the last poll
        return {"cars": [], "latestBlock": latest, "fromBlock": frm}
    return {"cars": _collect_cars(frm, latest), "latestBlock": latest, "fromBlock": frm}


@app.get("/feed")
async def feed():
    """Server-Sent Events stream: one `data:` line per new car as decisions land on-chain."""
    async def gen():
        last = az.w3.eth.block_number
        yield "retry: 2000\n\n"
        while True:
            try:
                latest = az.w3.eth.block_number
                if latest > last:
                    for car in _collect_cars(last + 1, latest):
                        yield f"data: {json.dumps(car)}\n\n"
                    last = latest
                else:
                    yield ": ping\n\n"
            except Exception as e:  # keep the stream alive on transient RPC errors
                yield f": err {type(e).__name__}\n\n"
            await asyncio.sleep(2)
    return StreamingResponse(gen(), media_type="text/event-stream")


@app.get("/avaguard/events")
async def avaguard_events():
    """SSE verdict stream for the 3D city (sim/liveFeed.ts). Emits `{verdict, context, proof}`
    in the shared detection/verdict.schema.json shape, one per decision POSTed to /authorize."""
    async def gen():
        idx = len(_events)  # only new decisions from now on
        yield "retry: 2000\n\n: connected\n\n"
        while True:
            while idx < len(_events):
                yield f"data: {_events[idx]}\n\n"
                idx += 1
            await asyncio.sleep(1)
    return StreamingResponse(gen(), media_type="text/event-stream")


@app.post("/rpc")
async def rpc(request: Request):
    """Transparent JSON-RPC proxy (handles single + batch). One https URL for MetaMask/ethers."""
    raw = await request.body()
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(UPSTREAM, content=raw, headers={"content-type": "application/json"})
    return Response(content=r.content, media_type="application/json")
