"""The agents run the guard with the sovereign KYB on: a shop that declares a French SIREN is checked against the state
registry. Meridian's invented SIREN is not found there; Nimbus declares none, so its visa is untouched."""
import importlib

from agents import world
from guard.features import registry


def test_agents_turn_kyb_on_by_default(monkeypatch):
    monkeypatch.delenv("GUARD_KYB", raising=False)
    import agents.guard_client as gc
    importlib.reload(gc)
    import os
    assert os.environ["GUARD_KYB"] == "on"


def test_meridian_declares_an_invented_siren_nimbus_none():
    m = world.merchant_context("meridian")["merchant"]
    assert m["siren"] == "912448301" and m["legal_name"] == "Meridian Watch Co. SAS"
    assert "siren" not in world.merchant_context("nimbus")["merchant"]


def test_meridian_not_found_in_the_state_registry(monkeypatch):
    monkeypatch.setenv("GUARD_KYB", "on")
    monkeypatch.setattr(registry, "_query_registry", lambda q: {} if q == "912448301" else None)
    req = type("R", (), {"context": world.merchant_context("meridian")})()
    sig = registry.extract(req, None, {})
    assert [s.id for s in sig] == ["kyb_entity_not_found"] and "912448301" in sig[0].evidence
    req = type("R", (), {"context": world.merchant_context("nimbus")})()
    assert registry.extract(req, None, {}) == []
