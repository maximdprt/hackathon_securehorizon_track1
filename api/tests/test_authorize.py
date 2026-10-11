"""api/authorize.py itself, offline: a block with or without a recipient flag. The default is the historical one (3).

The module is loaded from its file with an empty chain env (no provider call at import), then its sender is stubbed:
the test sees which contract calls would be sent, in which order, with which account nonces.
"""
import importlib.util
import inspect
import types
from pathlib import Path

import pytest
from eth_account import Account
from web3 import Web3

API = Path(__file__).resolve().parents[1]
ISSUER, RECIPIENT = "0xA11ce00000000000000000000000000000000002", "0xbad0000000000000000000000000000000000bad"
PAYMENT = {"issuer": ISSUER, "recipient": RECIPIENT, "amount": 50 * 10**18}


@pytest.fixture
def az(monkeypatch):
    for k in ("L1_RPC_URL", "REGISTRY_ADDRESS", "AUTHORIZER_KEY"):
        monkeypatch.delenv(k, raising=False)
    spec = importlib.util.spec_from_file_location("authorize_under_test", API / "authorize.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    assert m._acct is None and m._reg is None  # nothing configured, nothing built
    m._acct = Account.create()
    m._reg = m.w3.eth.contract(address=Web3.to_checksum_address("0x" + "77" * 20), abi=m.ABI)
    m.w3 = types.SimpleNamespace(eth=types.SimpleNamespace(get_transaction_count=lambda addr: 7))
    m.sent = []

    def send(fn, nonce):
        m.sent.append((fn.fn_name, fn.args, nonce))
        return f"0x{len(m.sent):064x}"

    m._send = send
    return m


def test_default_block_still_flags_the_recipient_at_3(az):
    assert inspect.signature(az.authorize).parameters["flag_severity"].default == 3
    out = az.authorize(PAYMENT, "block", reason="scam", nonce=5)
    pid = az.payment_id(ISSUER, RECIPIENT, PAYMENT["amount"], 5)
    assert az.sent == [("flagThreat", (az.address_key(RECIPIENT), 3, "scam"), 7),
                       ("recordDecision", (pid, Web3.to_checksum_address(ISSUER), "block", "scam"), 8)]
    assert set(out) == {"verdict", "payment_id", "nonce", "flag_tx", "decision_tx"} and out["payment_id"] == Web3.to_hex(pid)


@pytest.mark.parametrize("severity", [None, 0])
def test_block_without_flag_records_the_decision_alone(az, severity):
    out = az.authorize(PAYMENT, "block", reason="client word only", nonce=5, flag_severity=severity)
    assert [(name, nonce) for name, _, nonce in az.sent] == [("recordDecision", 7)]
    assert az.sent[0][1][2:] == ("block", "client word only")
    assert "flag_tx" not in out and out["decision_tx"]


def test_block_flags_at_the_given_severity(az):
    az.authorize(PAYMENT, "block", reason="x", nonce=5, flag_severity=2)
    assert az.sent[0][0] == "flagThreat" and az.sent[0][1][1] == 2


@pytest.mark.parametrize("severity", [4, -1])
def test_out_of_range_severity_sends_nothing(az, severity):
    with pytest.raises(ValueError):
        az.authorize(PAYMENT, "block", nonce=5, flag_severity=severity)
    assert az.sent == []


def test_allow_and_needs_human_ignore_the_flag_parameter(az):
    out = az.authorize(PAYMENT, "allow", reason="ok", ttl=60, nonce=5, flag_severity=None)
    assert [name for name, _, _ in az.sent] == ["grantVisa", "recordDecision"] and az.sent[0][1][4] == 60 and out["visa_tx"]
    az.sent.clear()
    az.authorize(PAYMENT, "needs_human", nonce=6, flag_severity=3)
    assert [name for name, _, _ in az.sent] == ["recordDecision"]
