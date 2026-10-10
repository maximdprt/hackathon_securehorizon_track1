"""Where authority and threat facts come from: a JSON mock, or the AuthorityRegistry contract on Fuji."""
from __future__ import annotations

import json
import os
import threading
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Protocol

from Crypto.Hash import keccak

from guard.models import norm_addr, safe_json


@dataclass
class Authority:
    active: bool
    max_amount: float
    role: str
    flagged: bool = False
    flag_severity: int = 0
    flag_reason: str = ""


class AuthoritySource(Protocol):
    def get_authority(self, issuer: str) -> Authority | None: ...
    def is_flagged(self, key: str) -> tuple[bool, int, str]: ...
    def mark_threat(self, key: str, severity: int, reason: str) -> None: ...
    def nonce_seen(self, nonce: str) -> bool: ...


def _key(s: str) -> str:
    """threats are keyed by address or by instruction id, both lowercased."""
    return (s or "").strip().lower()


class MockJsonSource:
    """Reads data/authorities.mock.json and data/threats.mock.json. Writes threats + nonces back."""

    def __init__(self, data_dir: str | Path):
        self.dir = Path(data_dir)
        self._lock = threading.Lock()
        self.authorities = self._load("authorities.mock.json")
        self.threats = self._load("threats.mock.json")
        self.nonces = set(self._load("nonces.json").get("seen", []))

    def _load(self, name: str) -> dict:
        p = self.dir / name
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}

    def _save(self, name: str, obj) -> None:
        (self.dir / name).write_text(safe_json(obj, indent=1, sort_keys=True), encoding="utf-8")

    def get_authority(self, issuer: str) -> Authority | None:
        a = self.authorities.get(norm_addr(issuer))
        if not a:
            return None
        fl, sev, reason = self.is_flagged(issuer)
        return Authority(bool(a.get("active")), float(a.get("max_amount") or 0), str(a.get("role") or ""), fl, sev, reason)

    def is_flagged(self, key: str) -> tuple[bool, int, str]:
        t = self.threats.get(_key(key))
        if t and t.get("flagged"):
            return True, int(t.get("severity") or 0), str(t.get("reason") or "")
        return False, 0, ""

    def mark_threat(self, key: str, severity: int, reason: str) -> None:
        with self._lock:
            self.threats[_key(key)] = {"flagged": True, "severity": severity, "reason": reason}
            self._save("threats.mock.json", self.threats)

    def nonce_seen(self, nonce: str) -> bool:
        with self._lock:
            seen = nonce in self.nonces
            self.nonces.add(nonce)
            self._save("nonces.json", {"seen": sorted(self.nonces)})
            return seen


ABI = json.loads("""[
 {"inputs":[{"name":"","type":"address"}],"name":"authorities","outputs":[{"name":"active","type":"bool"},{"name":"maxAmount","type":"uint256"},{"name":"role","type":"string"}],"stateMutability":"view","type":"function"},
 {"inputs":[{"name":"subject","type":"bytes32"}],"name":"isFlagged","outputs":[{"name":"","type":"bool"},{"name":"","type":"uint8"}],"stateMutability":"view","type":"function"},
 {"inputs":[{"name":"","type":"bytes32"}],"name":"threats","outputs":[{"name":"flagged","type":"bool"},{"name":"severity","type":"uint8"},{"name":"reason","type":"string"},{"name":"disputed","type":"bool"},{"name":"flaggedAt","type":"uint256"}],"stateMutability":"view","type":"function"},
 {"inputs":[{"name":"subject","type":"bytes32"},{"name":"severity","type":"uint8"},{"name":"reason","type":"string"}],"name":"flagThreat","outputs":[],"stateMutability":"nonpayable","type":"function"},
 {"inputs":[{"name":"instructionId","type":"bytes32"},{"name":"issuer","type":"address"},{"name":"amount","type":"uint256"},{"name":"verdict","type":"uint8"},{"name":"reason","type":"string"}],"name":"recordDecision","outputs":[],"stateMutability":"nonpayable","type":"function"}
]""")


def subject_key(s: str) -> bytes:
    """bytes32 key as the contract computes it: addresses are left-padded, anything else is keccak'd."""
    s = _key(s)
    if s.startswith("0x") and len(s) == 42:
        return bytes.fromhex(s[2:].rjust(64, "0"))
    if s.startswith("0x") and len(s) == 66:
        return bytes.fromhex(s[2:])
    h = keccak.new(digest_bits=256)
    h.update(s.encode())
    return h.digest()


class ChainSource:
    """Reads AuthorityRegistry on Avalanche (Fuji by default). Writes need GUARD_OWNER_KEY."""

    def __init__(self, rpc_url: str, contract_address: str, owner_key: str | None = None, fallback: MockJsonSource | None = None):
        from web3 import Web3  # optional dependency: pip install -e ".[chain]"
        self.w3 = Web3(Web3.HTTPProvider(rpc_url, request_kwargs={"timeout": 8}))
        self.contract = self.w3.eth.contract(address=Web3.to_checksum_address(contract_address), abi=ABI)
        self.owner_key = owner_key
        self.fallback = fallback
        self.decimals = int(os.environ.get("GUARD_TOKEN_DECIMALS", "6"))
        self._tx_lock = threading.Lock()  # one tx at a time: sequential nonces, receipt awaited

    def to_units(self, amount: float) -> int:
        return int(Decimal(str(amount)) * (10 ** self.decimals))

    def get_authority(self, issuer: str) -> Authority | None:
        from web3 import Web3
        active, max_amount, role = self.contract.functions.authorities(Web3.to_checksum_address(issuer)).call()
        if not active and not role:
            return None
        fl, sev, reason = self.is_flagged(issuer)
        return Authority(bool(active), float(max_amount) / 10 ** self.decimals, str(role), fl, sev, reason)

    def is_flagged(self, key: str) -> tuple[bool, int, str]:
        flagged, severity, reason, _disputed, _at = self.contract.functions.threats(subject_key(key)).call()
        if flagged:
            return True, int(severity), str(reason)
        # read-only deployments (no owner key) remember incidents locally
        return self.fallback.is_flagged(key) if self.fallback else (False, 0, "")

    def _send(self, fn) -> str:
        if not self.owner_key:
            raise RuntimeError("GUARD_OWNER_KEY not set: cannot write on-chain")
        with self._tx_lock:
            acct = self.w3.eth.account.from_key(self.owner_key)
            nonce = self.w3.eth.get_transaction_count(acct.address, "pending")
            tx = fn.build_transaction({"from": acct.address, "nonce": nonce})
            signed = acct.sign_transaction(tx)
            tx_hash = self.w3.eth.send_raw_transaction(signed.raw_transaction)
            self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=int(os.environ.get("GUARD_TX_TIMEOUT", "60")))
            return self.w3.to_hex(tx_hash)

    def mark_threat(self, key: str, severity: int, reason: str) -> None:
        if self.fallback:  # local memory first: survives a failed or read-only chain write
            self.fallback.mark_threat(key, severity, reason)
        self._send(self.contract.functions.flagThreat(subject_key(key), severity, reason[:200]))

    def nonce_seen(self, nonce: str) -> bool:
        # nonces stay local: the contract has no nonce store
        return self.fallback.nonce_seen(nonce) if self.fallback else False

    def record_decision(self, instruction_id: str, issuer: str, amount: float, verdict_code: int, reason: str) -> str:
        from web3 import Web3
        return self._send(self.contract.functions.recordDecision(
            subject_key(instruction_id), Web3.to_checksum_address(issuer), self.to_units(amount), verdict_code, reason[:200]))
