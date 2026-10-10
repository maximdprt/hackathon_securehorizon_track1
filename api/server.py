"""
SentinelL1 Authority API (Walid's lane = on-chain execution).

The brain (Corentin/Bruno: agents + scoring) decides verdict = allow | block | needs_human,
then POSTs it here. This service writes the decision on-chain on SentinelL1 and returns the proof.
It also proxies the L1 JSON-RPC (so MetaMask / the UI only need ONE https URL).

Endpoints:
  GET  /health                 -> chain + registry status
  POST /authorize              -> {payment, verdict, reason, ttl} -> on-chain visa/flag/pending + tx proof
  GET  /visa/{payment_id}      -> is this payment's visa currently valid?
  GET  /flagged/{address}      -> is this address flagged as a threat?
  POST /rpc                    -> transparent JSON-RPC proxy to the L1 (for MetaMask / ethers)

Env (EnvironmentFile on the EC2):
  L1_RPC_URL  REGISTRY_ADDRESS  AUTHORIZER_KEY  [VISA_TTL_SECONDS]
Run:  uvicorn server:app --host 0.0.0.0 --port 8080
"""
import asyncio
import json
import os
from typing import Optional

import httpx
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from web3 import Web3

import authorize as az  # reuses the on-chain executor (same dir on the EC2)

UPSTREAM = os.environ.get("L1_RPC_URL", "http://127.0.0.1:9650/ext/bc/C/rpc")

app = FastAPI(title="SentinelL1 Authority API", version="1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class Payment(BaseModel):
    issuer: str
    recipient: str
    amount: int
    nonce: Optional[int] = None


class AuthorizeReq(BaseModel):
    payment: Payment
    verdict: str            # allow | block | needs_human (the brain's decision)
    reason: str = ""
    ttl: int = 300
    full: Optional[dict] = None     # optional: the complete AgenticPaymentVerdict (detection/verdict.schema.json)
    context: Optional[dict] = None  # optional: UI labels (issuer_label, recipient_label, source_excerpt, ...)


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


@app.post("/authorize")
def do_authorize(req: AuthorizeReq):
    """verdict in -> on-chain execution out (the proof the jury/DORA audit reads)."""
    if req.verdict not in ("allow", "block", "needs_human"):
        raise HTTPException(400, "verdict must be allow|block|needs_human")
    payment = {"issuer": req.payment.issuer, "recipient": req.payment.recipient, "amount": req.payment.amount}
    try:
        out = az.authorize(payment, req.verdict, reason=req.reason, ttl=req.ttl, nonce=req.payment.nonce)
    except Exception as e:
        raise HTTPException(500, f"{type(e).__name__}: {e}")
    # re-broadcast to the 3D city (SSE): full AgenticPaymentVerdict if the brain sent one, else a minimal one
    verdict_obj = req.full or {
        "instruction_id": out.get("payment_id"),
        "issuer": req.payment.issuer,
        "action": "pay",
        "amount": req.payment.amount / 1e18,
        "currency": "SEC",
        "recipient": req.payment.recipient,
        "verdict": _SCHEMA_VERDICT[req.verdict],
        "risk_score": 0.08 if req.verdict == "allow" else (0.55 if req.verdict == "needs_human" else 0.9),
        "reasons": [req.reason] if req.reason else [],
        "owasp": [],
        "onchain_flagged": req.verdict == "block",
    }
    _publish({"verdict": verdict_obj, "context": req.context or {}, "proof": out})
    return {"status": "ok", **out}


@app.get("/visa/{payment_id}")
def visa(payment_id: str):
    valid = az._reg.functions.isVisaValid(Web3.to_bytes(hexstr=payment_id)).call()
    return {"paymentId": payment_id, "valid": bool(valid)}


@app.get("/flagged/{address}")
def flagged(address: str):
    key = az.address_key(address)  # left-padded address -> bytes32 (matches registry)
    is_flagged, severity = az._reg.functions.isFlagged(key).call()
    return {"address": Web3.to_checksum_address(address), "flagged": bool(is_flagged), "severity": int(severity)}


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
