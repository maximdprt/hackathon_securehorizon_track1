"""Sovereign KYB layer (guard/features/registry.py): verify the payee against the French state company registry.
Network is mocked so the test is deterministic and offline. Covers: opt-in flag, active match, struck-off, not-found,
name mismatch, no-identity, and registry-unreachable (must not penalize)."""
import os

import pytest

from guard.features import registry as rg
from guard.models import PaymentOrder, VerifyRequest


def _req(merchant):
    return VerifyRequest(
        order=PaymentOrder(issuer="0xA11ce00000000000000000000000000000000001", action="pay",
                           amount=20, currency="USDC", recipient="0x5e11e40000000000000000000000000000000001"),
        source_context="invoice", context_type="text", task="pay invoice",
        context={"merchant": merchant} if merchant is not None else {},
    )


@pytest.fixture
def kyb_on(monkeypatch):
    monkeypatch.setenv("GUARD_KYB", "on")
    rg._cache.clear()
    yield
    rg._cache.clear()


def _patch(monkeypatch, result):
    monkeypatch.setattr(rg, "_query_registry", lambda q: result)


def ids(sigs):
    return {s.id for s in sigs}


def test_disabled_by_default(monkeypatch):
    monkeypatch.delenv("GUARD_KYB", raising=False)
    monkeypatch.setattr(rg, "_query_registry", lambda q: (_ for _ in ()).throw(AssertionError("must not call API when off")))
    assert rg.extract(_req({"siren": "991959107", "legal_name": "BW CAPITAL"}), None, {}) == []


def test_active_match_is_proof_no_penalty(kyb_on, monkeypatch):
    _patch(monkeypatch, {"siren": "991959107", "nom_complet": "WALID BOUZIDANE (BW CAPITAL)",
                         "siege": {"etat_administratif": "A"}})
    sigs = rg.extract(_req({"siren": "991959107", "legal_name": "BW CAPITAL"}), None, {})
    assert ids(sigs) == {"kyb_verified_active"}
    assert sigs[0].weight == 0.0  # recorded as proof, costs no trust


def test_struck_off_penalizes(kyb_on, monkeypatch):
    _patch(monkeypatch, {"siren": "111222333", "nom_complet": "DEFUNCT CO",
                         "siege": {"etat_administratif": "C"}})
    sigs = rg.extract(_req({"siren": "111222333", "legal_name": "DEFUNCT CO"}), None, {})
    assert "kyb_entity_struck_off" in ids(sigs)
    assert any(s.weight >= 0.5 for s in sigs if s.id == "kyb_entity_struck_off")


def test_not_found_penalizes(kyb_on, monkeypatch):
    _patch(monkeypatch, {})  # looked up, nothing found
    sigs = rg.extract(_req({"legal_name": "Zzqxwv Fake Scam Entity"}), None, {})
    assert ids(sigs) == {"kyb_entity_not_found"}


def test_name_mismatch_penalizes(kyb_on, monkeypatch):
    _patch(monkeypatch, {"siren": "991959107", "nom_complet": "WALID BOUZIDANE (BW CAPITAL)",
                         "siege": {"etat_administratif": "A"}})
    sigs = rg.extract(_req({"siren": "991959107", "legal_name": "ACME Global Payments Ltd"}), None, {})
    assert "kyb_name_mismatch" in ids(sigs)


def test_no_identity_is_noop(kyb_on, monkeypatch):
    monkeypatch.setattr(rg, "_query_registry", lambda q: (_ for _ in ()).throw(AssertionError("no query without identity")))
    assert rg.extract(_req(None), None, {}) == []


def test_registry_unreachable_does_not_penalize(kyb_on, monkeypatch):
    _patch(monkeypatch, None)  # lookup failed (network/parse)
    sigs = rg.extract(_req({"legal_name": "Some Vendor"}), None, {})
    assert ids(sigs) == {"kyb_registry_unavailable"}
    assert sigs[0].weight == 0.0  # a down government API must never block a payment on its own
