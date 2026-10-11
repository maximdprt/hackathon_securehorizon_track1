"""
Walid's lane - on-chain authorization executor.

The brain (Corentin/Bruno: agents + scoring) decides verdict = allow | block | needs_human.
This module takes that verdict + the payment and EXECUTES it on-chain on SentinelL1:
  - allow       -> registry.grantVisa(...)  (the GuardedVault will then let the payment through)
  - block       -> registry.flagThreat(recipient)  (next time = instant on-chain block), unless the caller
                   passes flag_severity=None: then only the decision is recorded (the recipient is not condemned)
  - needs_human -> record a pending decision (human approval happens, then call authorize(..., "allow"))
Every decision is also recorded on-chain = DORA audit trail.

Env (set after the L1 + contract are deployed):
  L1_RPC_URL           RPC of SentinelL1
  REGISTRY_ADDRESS     deployed AuthorityRegistry address
  AUTHORIZER_KEY       private key of an address registered via setAuthorizer()

Usage:
  from api.authorize import authorize
  authorize({"issuer":"0x..","recipient":"0x..","amount":5000}, "allow", reason="authorized by brain")
"""
import os
import time
from typing import Optional

from web3 import Web3
from eth_account import Account

RPC_URL = os.environ.get("L1_RPC_URL", "http://127.0.0.1:9650/ext/bc/C/rpc")
REGISTRY_ADDRESS = os.environ.get("REGISTRY_ADDRESS", "")
AUTHORIZER_KEY = os.environ.get("AUTHORIZER_KEY", "")
DEFAULT_TTL = int(os.environ.get("VISA_TTL_SECONDS", "300"))

# minimal ABI (only what the executor calls)
ABI = [
    {"name": "grantVisa", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "paymentId", "type": "bytes32"}, {"name": "issuer", "type": "address"},
                {"name": "recipient", "type": "address"}, {"name": "amount", "type": "uint256"},
                {"name": "ttlSeconds", "type": "uint256"}], "outputs": []},
    {"name": "flagThreat", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "subject", "type": "bytes32"}, {"name": "severity", "type": "uint8"},
                {"name": "reason", "type": "string"}], "outputs": []},
    {"name": "recordDecision", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "paymentId", "type": "bytes32"}, {"name": "issuer", "type": "address"},
                {"name": "verdict", "type": "string"}, {"name": "reason", "type": "string"}], "outputs": []},
    {"name": "isVisaValid", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "paymentId", "type": "bytes32"}], "outputs": [{"name": "", "type": "bool"}]},
    {"name": "isFlagged", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "subject", "type": "bytes32"}],
     "outputs": [{"name": "", "type": "bool"}, {"name": "", "type": "uint8"}]},
    {"name": "isAuthorized", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "issuer", "type": "address"}, {"name": "amount", "type": "uint256"}],
     "outputs": [{"name": "", "type": "bool"}]},
    # events (decoded for the 3D feed / audit)
    {"name": "DecisionRecorded", "type": "event", "anonymous": False, "inputs": [
        {"indexed": True, "name": "paymentId", "type": "bytes32"},
        {"indexed": True, "name": "issuer", "type": "address"},
        {"indexed": False, "name": "verdict", "type": "string"},
        {"indexed": False, "name": "reason", "type": "string"}]},
    {"name": "VisaGranted", "type": "event", "anonymous": False, "inputs": [
        {"indexed": True, "name": "paymentId", "type": "bytes32"},
        {"indexed": True, "name": "issuer", "type": "address"},
        {"indexed": False, "name": "recipient", "type": "address"},
        {"indexed": False, "name": "amount", "type": "uint256"},
        {"indexed": False, "name": "expiry", "type": "uint256"}]},
    {"name": "ThreatFlagged", "type": "event", "anonymous": False, "inputs": [
        {"indexed": True, "name": "subject", "type": "bytes32"},
        {"indexed": False, "name": "severity", "type": "uint8"},
        {"indexed": False, "name": "reason", "type": "string"}]},
]

w3 = Web3(Web3.HTTPProvider(RPC_URL))
_acct = Account.from_key(AUTHORIZER_KEY) if AUTHORIZER_KEY else None
_reg = w3.eth.contract(address=Web3.to_checksum_address(REGISTRY_ADDRESS), abi=ABI) if REGISTRY_ADDRESS else None


def payment_id(issuer: str, recipient: str, amount: int, nonce: int) -> bytes:
    """Deterministic id for a payment order (matches keccak256(abi.encodePacked(...)))."""
    return Web3.solidity_keccak(
        ["address", "address", "uint256", "uint256"],
        [Web3.to_checksum_address(issuer), Web3.to_checksum_address(recipient), int(amount), int(nonce)],
    )


def address_key(addr: str) -> bytes:
    """address -> bytes32 (left-padded), matching registry.addressKey()."""
    return bytes(12) + bytes.fromhex(Web3.to_checksum_address(addr)[2:])


def _send(fn, nonce):
    tx = fn.build_transaction({
        "from": _acct.address,
        "nonce": nonce,
        "gas": 300000,
        "gasPrice": w3.eth.gas_price,
        "chainId": w3.eth.chain_id,
    })
    signed = _acct.sign_transaction(tx)
    h = w3.eth.send_raw_transaction(signed.raw_transaction)
    w3.eth.wait_for_transaction_receipt(h, timeout=30)
    return w3.to_hex(h)


def authorize(payment: dict, verdict: str, reason: str = "", ttl: int = DEFAULT_TTL, nonce: int = None,
              flag_severity: Optional[int] = 3) -> dict:
    """verdict in -> on-chain execution out. Returns the on-chain proof.

    flag_severity only matters for a block: 1..3 flags the recipient at that severity (default 3, the historical
    behaviour), None or 0 records the block decision alone. The hosted API passes None when the refusal says nothing
    against the recipient (an unknown issuer, a client's word it could not check), so one caller cannot ban a merchant."""
    assert _acct and _reg, "set L1_RPC_URL, REGISTRY_ADDRESS, AUTHORIZER_KEY"
    if flag_severity and not 1 <= int(flag_severity) <= 3:
        raise ValueError(f"flag_severity must be 1..3 or None, got {flag_severity!r}")
    issuer = Web3.to_checksum_address(payment["issuer"])
    recipient = Web3.to_checksum_address(payment["recipient"])
    amount = int(payment["amount"])
    nonce = nonce if nonce is not None else int(time.time())
    pid = payment_id(issuer, recipient, amount, nonce)

    txn = w3.eth.get_transaction_count(_acct.address)  # account nonce
    out = {"verdict": verdict, "payment_id": Web3.to_hex(pid), "nonce": nonce}

    if verdict == "allow":
        out["visa_tx"] = _send(_reg.functions.grantVisa(pid, issuer, recipient, amount, ttl), txn)
        out["decision_tx"] = _send(_reg.functions.recordDecision(pid, issuer, "allow", reason), txn + 1)
    elif verdict == "block" and flag_severity:
        out["flag_tx"] = _send(_reg.functions.flagThreat(address_key(recipient), int(flag_severity), reason), txn)
        out["decision_tx"] = _send(_reg.functions.recordDecision(pid, issuer, "block", reason), txn + 1)
    elif verdict == "block":  # refused, recipient not flagged: the decision alone is the audit trail
        out["decision_tx"] = _send(_reg.functions.recordDecision(pid, issuer, "block", reason), txn)
    else:  # needs_human
        out["decision_tx"] = _send(_reg.functions.recordDecision(pid, issuer, "needs_human", reason), txn)
    return out


if __name__ == "__main__":
    # smoke test (needs a deployed registry + funded authorizer)
    demo = {"issuer": "0xaF11630142CF1f829B87c586C0a6C980B61A855d",
            "recipient": "0x000000000000000000000000000000000000dEaD", "amount": 80}
    print(authorize(demo, "allow", reason="brain: within mandate, not poisoned"))
