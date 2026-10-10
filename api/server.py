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
import os
from typing import Optional

import httpx
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
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
        return {"status": "ok", **out}
    except Exception as e:
        raise HTTPException(500, f"{type(e).__name__}: {e}")


@app.get("/visa/{payment_id}")
def visa(payment_id: str):
    valid = az._reg.functions.isVisaValid(Web3.to_bytes(hexstr=payment_id)).call()
    return {"paymentId": payment_id, "valid": bool(valid)}


@app.get("/flagged/{address}")
def flagged(address: str):
    key = az.address_key(address)  # left-padded address -> bytes32 (matches registry)
    is_flagged, severity = az._reg.functions.isFlagged(key).call()
    return {"address": Web3.to_checksum_address(address), "flagged": bool(is_flagged), "severity": int(severity)}


@app.post("/rpc")
async def rpc(request: Request):
    """Transparent JSON-RPC proxy (handles single + batch). One https URL for MetaMask/ethers."""
    raw = await request.body()
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(UPSTREAM, content=raw, headers={"content-type": "application/json"})
    return Response(content=r.content, media_type="application/json")
