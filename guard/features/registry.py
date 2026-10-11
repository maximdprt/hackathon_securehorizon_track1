"""Layer: sovereign KYB. Verify the payee against the French state company registry (API Recherche d'entreprises,
data.gouv.fr / DINUM). An external, official vouch for "know your beneficiary" (AML / MiCA / DORA), attached to the
decision so it is provable on-chain.

Opt-in via GUARD_KYB=on (default off: keeps the offline baseline and its metrics untouched). The layer never fails a
payment on its own: if the registry is unreachable or no company identity is declared for the payee, it adds no penalty
(the counterparty layer already covers "unknown recipient"), so the guard stays fail-closed through the other layers.
"""
from __future__ import annotations

import json
import os
import re
import urllib.parse
import urllib.request

from guard.models import Mandate, Signal, VerifyRequest

LAYER = "registry"
API = "https://recherche-entreprises.api.gouv.fr/search"
TIMEOUT = float(os.environ.get("GUARD_KYB_TIMEOUT", "2.5"))
_cache: dict[str, dict | None] = {}


def _enabled() -> bool:
    return os.environ.get("GUARD_KYB", "off").lower() in ("1", "on", "true", "yes")


def _str(x) -> str:
    return x if isinstance(x, str) else ("" if x is None else str(x))


def _norm(s: str) -> str:
    """Loose name match: lowercase, drop accents-ish noise and legal suffixes, keep letters/digits."""
    s = _str(s).lower()
    s = re.sub(r"\b(sas|sasu|sarl|eurl|sa|sci|ei|eirl|snc|scop|gmbh|ltd|inc|llc)\b", " ", s)
    return re.sub(r"[^a-z0-9]+", "", s)


def _query_registry(q: str):
    """Top result from the state registry. Returns a dict (found), {} (looked up, nothing), or None (lookup failed).
    Cached per process. Network / parse errors map to None so they never become a penalty."""
    key = q.strip().lower()
    if key in _cache:
        return _cache[key]
    res = None
    try:
        url = API + "?" + urllib.parse.urlencode({"q": q, "per_page": 1})
        with urllib.request.urlopen(url, timeout=TIMEOUT) as r:  # noqa: S310 (fixed https host)
            payload = json.loads(r.read().decode("utf-8"))
        results = payload.get("results") or []
        res = results[0] if results else {}
    except Exception:
        res = None
    _cache[key] = res
    return res


def _payee_identity(req: VerifyRequest) -> tuple[str, str]:
    """(query, declared_name) for the payee, from what the agent's context declares. Empty query = nothing to verify."""
    ctx = req.context if isinstance(req.context, dict) else {}
    m = ctx.get("merchant")
    m = m if isinstance(m, dict) else {}
    siren = re.sub(r"\D", "", _str(m.get("siren") or m.get("siret")))
    name = _str(m.get("legal_name") or m.get("company") or m.get("name"))
    if len(siren) >= 9:
        return siren[:9], name
    if name:
        return name, name
    return "", ""


def extract(req: VerifyRequest, mandate: Mandate | None, data: dict) -> list[Signal]:
    if not _enabled():
        return []
    q, declared = _payee_identity(req)
    if not q:
        return []  # no company identity for the payee: the counterparty layer handles "unknown recipient"

    rec = _query_registry(q)

    if rec is None:
        # registry unreachable: note it, add no penalty (do not fail the payment because a government API is down)
        return [Signal("kyb_registry_unavailable", LAYER, 0.0,
                       "state company registry unreachable; payee not independently verified this time")]

    if rec == {}:
        return [Signal("kyb_entity_not_found", LAYER, 0.25,
                       f"payee identity {q!r} not found in the state company registry (data.gouv)", owasp=["ASI07"])]

    siren = _str(rec.get("siren"))
    nom = _str(rec.get("nom_complet"))
    siege = rec.get("siege") if isinstance(rec.get("siege"), dict) else {}
    etat = _str(siege.get("etat_administratif") or rec.get("etat_administratif")).upper()

    sig: list[Signal] = []
    if etat and etat != "A":
        sig.append(Signal("kyb_entity_struck_off", LAYER, 0.50,
                          f"payee {nom!r} (SIREN {siren}) is not active in the state registry (etat_administratif={etat})",
                          owasp=["ASI07"]))
    if declared and nom and _norm(declared) and _norm(declared) not in _norm(nom) and _norm(nom) not in _norm(declared):
        sig.append(Signal("kyb_name_mismatch", LAYER, 0.30,
                          f"declared payee name {declared!r} does not match the registered entity {nom!r} (SIREN {siren})"))

    if not sig:
        # verified, active, matching: no deduction, but record the official proof on the decision (weight 0)
        sig.append(Signal("kyb_verified_active", LAYER, 0.0,
                          f"payee verified in the state registry: {nom} (SIREN {siren}, active)"))
    return sig
