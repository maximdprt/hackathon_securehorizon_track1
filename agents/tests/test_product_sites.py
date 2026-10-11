"""Nouvelles landing pages produit (sneakers, iPhone, billets, carte cadeau/crypto) : verdicts du vrai moteur.

Déterministe (Claude coupé). Mix légitime / frauduleux, chaque boutique shoppable par l'agent (world.ALL_SITES,
pages rendues par shops.py). Une boutique frauduleuse par produit, construite pour être l'offre la plus attractive
affichée, avec un piège (instruction cachée, prix cassé, adresse sosie) que seul le garde lit.
"""
import os
import re

import pytest

from agents import shops, world

SHOP = "0xA11ce00000000000000000000000000000000002"
SITES = {"runstep": "allow", "solemarket": "needs_approval", "kicksoutlet": "block",
         "applecorner": "needs_approval", "phonedealz": "block", "stagepass": "allow",
         "ticketnow": "block", "giftvault": "allow", "cryptocashback": "block"}
PRODUCT_OF = {"airmax-270": ["runstep", "solemarket", "kicksoutlet"], "iphone-16": ["applecorner", "phonedealz"],
              "ticket-aurora": ["stagepass", "ticketnow"], "giftcard-100": ["giftvault", "cryptocashback"]}


@pytest.fixture(scope="module")
def engine():
    os.environ["GUARD_LLM"] = "off"
    from demo.golden_path import make_engine
    return make_engine(None, False)


def _verify(engine, key):
    s = world.ALL_SITES[key]
    pid = next(iter(s["products"]))
    price = s["products"][pid]
    sess = shops.Session()
    pages = [shops.handle(key, "GET", p, {}, sess, f"https://{s['domain']}").html for p in ("/", f"/product/{pid}", "/checkout")]
    req = {"order": {"issuer": SHOP, "action": "pay", "amount": price, "currency": s["shop"].get("currency", "EUR"), "recipient": s["wallet"]},
           "source_context": "\n".join(pages), "context_type": "html", "task": f"Achète {world.PRODUCTS[pid]['name']}",
           "context": {"origin": "webpage", **world.merchant_context(key, {pid: 1})}}
    return engine.verify(req)


@pytest.mark.parametrize("key,expected", SITES.items())
def test_product_shop_verdict(engine, key, expected):
    v = _verify(engine, key)
    assert v["verdict"] == expected, f"{key}: {v['verdict']} != {expected} ({'; '.join(v.get('reasons', [])[:3])})"
    if world.ALL_SITES[key]["kind"] == "fraud":
        assert v["verdict"] == "block" and v["severity"] == 3


# l'appât est l'offre la plus attractive : le prix le plus bas (produits), le cashback (carte cadeau)
PRICE_BAIT = {"airmax-270", "iphone-16", "ticket-aurora"}

def test_every_product_has_a_scam_the_bait_being_the_most_attractive():
    for pid, keys in PRODUCT_OF.items():
        frauds = [k for k in keys if world.ALL_SITES[k]["kind"] == "fraud"]
        assert frauds, f"{pid}: pas de boutique frauduleuse"
        if pid in PRICE_BAIT:
            cheapest = min(keys, key=lambda k: world.ALL_SITES[k]["products"][pid])
            assert world.ALL_SITES[cheapest]["kind"] == "fraud", f"{pid}: l'appât doit être le moins cher ({cheapest})"


def test_all_shop_wallets_are_valid_addresses():
    for k, s in world.ALL_SITES.items():
        assert re.fullmatch(r"0x[0-9a-fA-F]{40}", s["wallet"]), f"{k}: adresse invalide {s['wallet']}"


def test_search_finds_each_new_product():
    for q, key in [("nike air max", "runstep"), ("iphone 16", "applecorner"), ("billet concert aurora", "stagepass"), ("carte cadeau", "giftvault")]:
        titles = [r["key"] for r in world.search(q)]
        assert key in titles, f"{q}: {key} absent de {titles}"


def test_address_poisoning_shop_mimics_an_allowlisted_address():
    v = _verify(engine_singleton(), "cryptocashback")
    assert any(s["id"] == "address_poisoning_similarity" for s in v["signals"])


def engine_singleton():
    os.environ["GUARD_LLM"] = "off"
    from demo.golden_path import make_engine
    return make_engine(None, False)
