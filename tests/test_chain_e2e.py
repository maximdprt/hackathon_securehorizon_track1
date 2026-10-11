"""End-to-end: the guard engine against the REAL AuthorityRegistry.sol, on an in-process EVM.

Compiles contracts/AuthorityRegistry.sol with py-solc-x, deploys it on web3's EthereumTesterProvider
(py-evm, auto-mined blocks) and runs the golden path (acts 1 to 3) through ChainSource + ChainSink,
asserting the on-chain state and events after each act. No Fuji, no network (solc is cached after the
first download). Skipped cleanly when the optional `chain` deps are missing.
"""
from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

import pytest

web3 = pytest.importorskip("web3", reason="pip install -e '.[chain]' for the on-chain e2e test")
solcx = pytest.importorskip("solcx", reason="pip install -e '.[chain]' for the on-chain e2e test")
pytest.importorskip("eth_tester", reason="pip install -e '.[chain]' for the on-chain e2e test")

from web3 import EthereumTesterProvider, Web3  # noqa: E402

from guard.engine import Engine, load_data  # noqa: E402
from guard.llm import ClaudeScorer  # noqa: E402
from guard.models import VerifyRequest  # noqa: E402
from guard.queue import PendingQueue  # noqa: E402
from guard.sinks import ChainSink, CompositeSink, JsonlSink  # noqa: E402
from guard.sources import ABI as GUARD_ABI, ChainSource, MockJsonSource, subject_key  # noqa: E402
from tests.conftest import BAD, R, T, VENDOR  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SOL = ROOT / "contracts" / "AuthorityRegistry.sol"
SOLC_VERSION = "0.8.20"
DECIMALS = 6  # USDC; must equal GUARD_TOKEN_DECIMALS (default 6 in ChainSource)

# golden path acts (mirrors redteam/cases/M1_* and M7_*)
ACT1 = json.loads((ROOT / "redteam" / "cases" / "M1_low_priv_agent_to_treasury.json").read_text())["request"]
ACT2 = {"order": {"issuer": T, "action": "pay", "amount": 80, "recipient": VENDOR},
        "source_context": "Monthly SaaS invoice #4471 from known vendor, 80 USDC.", "context": {"origin": "user"}}
ACT3 = json.loads((ROOT / "redteam" / "cases" / "M7_already_flagged_recipient_act3.json").read_text())["request"]
ACT3["context"].pop("_after", None)  # we run act 1 ourselves on the same chain


# ----------------------------------------------------------------------------- fixtures
@pytest.fixture(scope="module")
def compiled() -> dict:
    """{'abi': [...], 'bin': '...'} for AuthorityRegistry, compiled from the real .sol."""
    try:
        if SOLC_VERSION not in [str(v) for v in solcx.get_installed_solc_versions()]:
            solcx.install_solc(SOLC_VERSION)
    except Exception as e:  # no network and no cached solc
        pytest.skip(f"solc {SOLC_VERSION} unavailable: {e}")
    out = solcx.compile_source(SOL.read_text(), output_values=["abi", "bin"], solc_version=SOLC_VERSION)
    key = next(k for k in out if k.endswith(":AuthorityRegistry"))
    return out[key]


@pytest.fixture
def w3() -> Web3:
    return Web3(EthereumTesterProvider())


@pytest.fixture
def owner_key(w3) -> str:
    return w3.provider.ethereum_tester.backend.account_keys[0].to_hex()


@pytest.fixture
def registry(w3, compiled):
    """Deployed contract (full ABI, for assertions) with the authority chain seeded like data/authorities.mock.json."""
    owner = w3.eth.accounts[0]
    factory = w3.eth.contract(abi=compiled["abi"], bytecode=compiled["bin"])
    receipt = w3.eth.wait_for_transaction_receipt(factory.constructor().transact({"from": owner}))
    c = w3.eth.contract(address=receipt.contractAddress, abi=compiled["abi"])
    assert c.functions.owner().call() == owner
    c.functions.grantAuthority(Web3.to_checksum_address(T), 100 * 10 ** DECIMALS, "treasury-agent").transact({"from": owner})
    c.functions.grantAuthority(Web3.to_checksum_address(R), 0, "reader").transact({"from": owner})
    # BAD is deliberately unknown to the registry
    return c


@pytest.fixture
def chain_dir(tmp_path) -> Path:
    for f in (ROOT / "data").glob("*.json"):
        if f.name not in ("threats.mock.json", "nonces.json", "pending.json"):
            shutil.copy(f, tmp_path / f.name)
    (tmp_path / "threats.mock.json").write_text("{}")
    (tmp_path / "nonces.json").write_text(json.dumps({"seen": []}))
    return tmp_path


@pytest.fixture
def chain_source(w3, registry, owner_key, chain_dir) -> ChainSource:
    """ChainSource wired to the tester chain, without touching guard/sources.py.

    The constructor only builds an HTTPProvider (no connection), so we swap .w3 and .contract afterwards.
    The contract handle uses the guard's own ABI subset, so the ABI in guard/sources.py is what gets exercised.
    """
    src = ChainSource("http://127.0.0.1:1", registry.address, owner_key=owner_key, fallback=MockJsonSource(chain_dir))
    src.w3 = w3
    src.contract = w3.eth.contract(address=registry.address, abi=GUARD_ABI)
    assert src.decimals == DECIMALS
    return src


@pytest.fixture
def engine(chain_source, chain_dir) -> Engine:
    return Engine(
        source=chain_source,
        sink=CompositeSink(JsonlSink(chain_dir / "decisions.jsonl"), ChainSink(chain_source)),
        queue=PendingQueue(chain_dir / "pending.json"),
        llm=ClaudeScorer(enabled=False),
        data=load_data(chain_dir),
    )


# ----------------------------------------------------------------------------- helpers
def decisions(registry) -> list:
    return registry.events.DecisionRecorded().get_logs(from_block=0)


def threat(registry, key: str) -> tuple[bool, int, str]:
    flagged, sev, reason, _disputed, _at = registry.functions.threats(subject_key(key)).call()
    return flagged, sev, reason


def amt(x: float) -> int:
    return int(x * 10 ** DECIMALS)


def tx_hex(h: str) -> str:
    """ChainSource._send returns HexBytes.hex(): '0x...' on web3 v6, bare hex on v7+ (see docs/chain-e2e.md)."""
    h = (h or "").removeprefix("0x").lower()
    assert re.fullmatch(r"[0-9a-f]{64}", h), f"not a tx hash: {h!r}"
    return h


# ----------------------------------------------------------------------------- tests
def test_guard_abi_is_a_subset_of_the_compiled_contract(compiled):
    """ABI drift guard: every function guard/sources.py declares must exist in the .sol with identical types."""
    real = {f["name"]: f for f in compiled["abi"] if f.get("type") == "function"}
    for f in GUARD_ABI:
        assert f["name"] in real, f"{f['name']} missing from AuthorityRegistry.sol"
        r = real[f["name"]]
        assert [i["type"] for i in f["inputs"]] == [i["type"] for i in r["inputs"]], f["name"]
        assert [o["type"] for o in f["outputs"]] == [o["type"] for o in r["outputs"]], f["name"]
        assert [o["name"] for o in f["outputs"]] == [o["name"] for o in r["outputs"]], f["name"]
        assert f["stateMutability"] == r["stateMutability"], f["name"]


def test_subject_key_matches_contract_addressKey(registry):
    for a in (T, R, BAD, VENDOR):
        assert subject_key(a) == registry.functions.addressKey(Web3.to_checksum_address(a)).call()
    # a domain has no on-chain helper: off-chain convention = keccak256(utf8(lowercased domain))
    assert subject_key("Evil.SHOP") == Web3.keccak(text="evil.shop")


def test_chain_source_reads_authorities_in_token_units(chain_source):
    t = chain_source.get_authority(T)
    assert t.active and t.role == "treasury-agent" and t.max_amount == 100.0  # 100_000_000 / 10**6
    r = chain_source.get_authority(R)
    assert r.active and r.role == "reader" and r.max_amount == 0.0
    assert chain_source.get_authority(BAD) is None
    assert chain_source.is_flagged(BAD) == (False, 0, "")


def test_golden_path_on_the_real_contract(engine, registry, chain_source):
    owner = Web3.to_checksum_address(chain_source.w3.eth.accounts[0])
    reader, treasury, bad = (Web3.to_checksum_address(x) for x in (R, T, BAD))

    # ---- Act 1: the reader relays a poisoned "treasury migration" order of 5000 USDC to 0xBAD
    act1_id = subject_key(VerifyRequest.from_dict(ACT1).order.instruction_id())
    # before the guard speaks, the contract alone would let it through: maxAmount 0 = no cap, and isAuthorized() knows no roles
    assert registry.functions.isAuthorized(reader, amt(5000)).call() is True
    assert list(registry.functions.isFlagged(act1_id).call()) == [False, 0]

    v1 = engine.verify(ACT1)
    assert v1["verdict"] == "block" and v1["severity"] == 3
    assert v1["authority_check"]["source"] == "onchain"
    assert "sink_errors" not in v1, v1.get("sink_errors")
    tx_hex(v1.get("onchain_tx"))

    # on-chain state: recipient + instruction hash flagged at severity 3 (block)
    flagged, sev, reason = threat(registry, BAD)
    assert flagged and sev == 3 and reason
    assert list(registry.functions.isFlagged(registry.functions.addressKey(bad).call()).call()) == [True, 3]
    assert threat(registry, v1["instruction_id"])[:2] == (True, 3)
    # the reader stays active on-chain: it is authorized (active) but its role forbids paying, the engine blocks on role + signature
    assert registry.functions.authorities(reader).call()[0] is True
    assert threat(registry, R) == (False, 0, "")

    # DORA trail: one DecisionRecorded, verdict "block", right issuer / instruction id (the event carries no amount)
    logs = decisions(registry)
    assert len(logs) == 1
    ev = logs[0]["args"]
    assert ev["verdict"] == "block" and ev["issuer"] == reader
    assert ev["paymentId"] == subject_key(v1["instruction_id"]) and ev["reason"]
    assert logs[0]["transactionHash"].hex().removeprefix("0x") == tx_hex(v1["onchain_tx"])  # the sink's tx is the event's tx
    assert Web3.to_checksum_address(chain_source.w3.eth.get_transaction(logs[0]["transactionHash"])["from"]) == owner

    # the contract now remembers the engine's verdict: the instruction hash is flagged at severity 3
    assert list(registry.functions.isFlagged(act1_id).call()) == [True, 3]

    # ---- Act 2: legit treasury invoice, 80 USDC to an allowlisted vendor, ordered by the user
    v2 = engine.verify(ACT2)
    assert v2["verdict"] == "allow" and v2["authority_check"] == {"authorized": True, "within_limit": True, "source": "onchain"}
    assert "sink_errors" not in v2
    logs = decisions(registry)
    assert len(logs) == 2
    ev = logs[1]["args"]
    assert ev["verdict"] == "allow" and ev["issuer"] == treasury
    assert registry.functions.isAuthorized(treasury, amt(80)).call() is True
    assert list(registry.functions.isFlagged(subject_key(v2["instruction_id"])).call()) == [False, 0]
    assert threat(registry, VENDOR) == (False, 0, "")

    # ---- Act 3: a different, fully authorized agent (treasury) pays 10 USDC to 0xBAD: immune via the registry
    v3 = engine.verify(ACT3)
    assert v3["verdict"] == "block" and v3["onchain_flagged"] is True
    assert v3["authority_check"]["source"] == "onchain" and v3["authority_check"]["authorized"] is True
    sig = {s["id"]: s for s in v3["signals"]}
    assert sig["recipient_flagged_onchain"]["hard"] is True and sig["recipient_flagged_onchain"]["weight"] == 1.0
    assert "severity 3" in sig["recipient_flagged_onchain"]["evidence"]
    assert "sink_errors" not in v3
    logs = decisions(registry)
    assert len(logs) == 3 and logs[2]["args"]["verdict"] == "block" and logs[2]["args"]["issuer"] == treasury
    # the treasury agent itself is not flagged (it was authorized, the recipient was the problem)
    assert threat(registry, T) == (False, 0, "")
    # isAuthorized() takes no recipient, so on-chain alone act 3 would still pass; the engine (or a visa) is the stricter layer
    assert registry.functions.isAuthorized(treasury, amt(10)).call() is True
    assert list(registry.functions.isFlagged(subject_key(v3["instruction_id"])).call()) == [True, 3]  # its own hash got flagged

    # ---- the in-memory verdicts carry the 3 tx hashes, in the order the events were mined
    assert [tx_hex(v["onchain_tx"]) for v in (v1, v2, v3)] == [l["transactionHash"].hex().removeprefix("0x") for l in logs]
    # the local JSONL mirror has the 3 decisions, but WITHOUT onchain_tx: JsonlSink runs before ChainSink in the
    # CompositeSink (same order as Engine.from_env), so the tx hash is set after the line is written (docs/chain-e2e.md, bug 3)
    local = JsonlSink(engine.queue.path.parent / "decisions.jsonl").read_all()
    assert [d["verdict"] for d in local] == ["block", "allow", "block"]
    assert all("onchain_tx" not in d for d in local)
    assert engine.pending() == []


def test_read_only_chain_source_reads_onchain_writes_locally(w3, registry, chain_dir):
    """Without GUARD_OWNER_KEY the engine reads on-chain threats but never writes on-chain (the authorize API does
    that). A block is remembered in the local fallback, so a second time blocks in-session; the chain stays untouched."""
    src = ChainSource("http://127.0.0.1:1", registry.address, owner_key=None, fallback=MockJsonSource(chain_dir))
    src.w3, src.contract = w3, w3.eth.contract(address=registry.address, abi=GUARD_ABI)
    eng = Engine(src, CompositeSink(JsonlSink(chain_dir / "d.jsonl")), PendingQueue(chain_dir / "p.json"),
                 ClaudeScorer(enabled=False), load_data(chain_dir))
    v = eng.verify(ACT1)
    assert v["verdict"] == "block"
    assert not v.get("sink_errors")  # read-only: no on-chain write attempted, so no loud failure
    assert threat(registry, BAD) == (False, 0, "")  # the chain is NOT written by the guard (authorize API does it)
    assert src.fallback.is_flagged(BAD)[0] is True  # but the recipient is remembered locally: 2nd time = instant block


def test_flags_survive_when_blocks_are_not_mined_instantly(engine, registry, chain_source, monkeypatch):
    """Same act 1, but the chain behaves like Fuji: txs sit in the mempool until the next block (~2s).
    A background miner produces a block every 0.2s while the engine sends its 3 txs sequentially."""
    import threading, time
    monkeypatch.setenv("GUARD_TX_TIMEOUT", "20")
    tester = chain_source.w3.provider.ethereum_tester
    tester.disable_auto_mine_transactions()
    stop = threading.Event()

    def miner():
        while not stop.is_set():
            time.sleep(0.2)
            try:
                tester.mine_block()
            except Exception:
                pass

    t = threading.Thread(target=miner, daemon=True)
    t.start()
    try:
        v1 = engine.verify(ACT1)
    finally:
        stop.set()
        t.join(timeout=2)
        tester.enable_auto_mine_transactions()
    assert v1["verdict"] == "block"
    assert not v1.get("sink_errors"), v1.get("sink_errors")
    # the recipient flag, the instruction flag AND the decision all land on-chain, in order, no nonce collision
    assert threat(registry, BAD)[:2] == (True, 3)
    assert threat(registry, v1["instruction_id"])[:2] == (True, 3)
    assert len(decisions(registry)) == 1
