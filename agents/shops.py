"""Les 5 boutiques du bac à sable en vrais mini-sites : catalogue, fiche produit, panier, paiement par carte, confirmation.

Chaque boutique répond aux mêmes chemins :
    /                    catalogue
    /product/<id>        fiche produit, bouton "Ajouter au panier" (POST /cart/add)
    /cart                panier, lien "Passer au paiement"
    /checkout            formulaire de livraison et de carte (POST /checkout)
    /confirmation/<id>   commande confirmée

`handle()` rend la page pour une requête. Il sert deux publics avec le même code : le navigateur simulé de l'agent
(browser.py, URL en https://<domaine>.example) et un humain dans un onglet (app.py, sous /shop/<clé>). `root` est le
préfixe des liens. Le paiement est simulé : rien n'est débité, la carte attendue est une carte de test, et une
commande ne garde de la carte que ses 4 derniers chiffres. Les pages n'ont aucun script.
"""
from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from html import escape as e

from agents import world


@dataclass
class Session:
    """L'état d'un visiteur : un panier par boutique, et ses commandes passées."""
    carts: dict[str, dict[str, int]] = field(default_factory=dict)
    orders: dict[str, dict] = field(default_factory=dict)


@dataclass
class Response:
    status: int = 200
    html: str = ""
    location: str = ""  # redirection : chemin dans la boutique, par exemple "/cart"


FIELDS = [  # (nom, libellé, autocomplete, pleine largeur)
    ("email", "E-mail", "email", False), ("name", "Nom complet", "name", False),
    ("address", "Adresse", "street-address", True), ("postal", "Code postal", "postal-code", False),
    ("city", "Ville", "address-level2", False), ("country", "Pays", "country-name", True),
]
CARD_FIELDS = [
    ("card_name", "Titulaire de la carte", "cc-name", True), ("card_number", "Numéro de carte", "cc-number", True),
    ("card_exp", "Expiration (MM/AA)", "cc-exp", False), ("card_cvc", "Cryptogramme (CVC)", "cc-csc", False),
]

THEMES = {
    "nimbus": "--font:Georgia,serif;--bg:#f6f4ef;--ink:#1c2430;--muted:#6a6f78;--head:#1c2430;--head-ink:#f6f4ef;--card:#fff;--line:#e3dfd5;"
              "--accent:#1c2430;--accent-ink:#fff;--radius:4px;--track:.04em;--case:none",
    "orchard": "--font:'Trebuchet MS',Verdana,sans-serif;--bg:#fbfdf9;--ink:#17301f;--muted:#5d6f62;--head:#2f6b3f;--head-ink:#fff;--card:#fff;"
               "--line:#cfe1d3;--accent:#2f6b3f;--accent-ink:#fff;--radius:10px;--track:0;--case:none",
    "meridian": "--font:'Segoe UI',Helvetica,Arial,sans-serif;--bg:#fff;--ink:#10131a;--muted:#5b6272;--head:#fff;--head-ink:#10131a;--card:#f5f7fb;"
                "--line:#e6e8ee;--accent:#10131a;--accent-ink:#fff;--radius:14px;--track:.02em;--case:none",
    "techbazaar": "--font:Tahoma,Geneva,sans-serif;--bg:#f3f3f8;--ink:#20202a;--muted:#77778a;--head:#4b3fd1;--head-ink:#fff;--card:#fff;"
                  "--line:#e4e4ee;--accent:#4b3fd1;--accent-ink:#fff;--radius:8px;--track:0;--case:none",
    "tempo": "--font:'Gill Sans','Century Gothic',sans-serif;--bg:#fffaf3;--ink:#2a1d14;--muted:#806a58;--head:#c2541b;--head-ink:#fff;--card:#fff;"
             "--line:#f0dcc8;--accent:#c2541b;--accent-ink:#fff;--radius:2px;--track:.06em;--case:uppercase",
}
CSS = """
*{box-sizing:border-box}body{margin:0;font-family:var(--font);color:var(--ink);background:var(--bg);line-height:1.5}
a{color:inherit}header.top{background:var(--head);color:var(--head-ink);padding:16px 28px;display:flex;justify-content:space-between;align-items:center;
gap:16px;border-bottom:1px solid var(--line)}header.top a{text-decoration:none}
.brand{font-size:21px;font-weight:700;letter-spacing:var(--track);text-transform:var(--case)}nav a{margin-left:18px;font-size:14px}
main{max-width:880px;margin:26px auto;padding:0 20px}h1{font-size:26px;margin:0 0 6px}h2{font-size:18px;margin:22px 0 8px}
.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;margin-top:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:16px;display:flex;flex-direction:column;gap:6px}
.card a{font-weight:700}.price{font-size:22px;font-weight:700}
.btn{display:inline-block;background:var(--accent);color:var(--accent-ink);border:0;border-radius:var(--radius);padding:11px 18px;font:inherit;
font-weight:700;text-decoration:none;cursor:pointer}
.facts{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:18px 0}
.facts div{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:12px;font-size:14px}
table{width:100%;border-collapse:collapse;background:var(--card);margin:12px 0}td,th{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line)}
td.n,th.n{text-align:right}form.pay{display:grid;grid-template-columns:1fr 1fr;gap:12px 14px;background:var(--card);border:1px solid var(--line);
border-radius:var(--radius);padding:18px}form.pay h2,form.pay .wide{grid-column:1/-1}form.pay h2{margin:4px 0 0}
label{display:block;font-size:13px;color:var(--muted)}input{display:block;width:100%;margin-top:4px;padding:10px 12px;border:1px solid var(--line);
border-radius:8px;font:inherit;background:#fff;color:#111}.err{background:#fdecea;color:#8a1f11;border-radius:8px;padding:10px 12px;font-size:14px}
.ok{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:22px}
.muted{color:var(--muted);font-size:14px}.review{border-top:1px solid var(--line);padding:10px 0;font-size:14px}
footer{max-width:880px;margin:30px auto;padding:0 20px 30px;color:var(--muted);font-size:13px}
"""


def euro(x: float) -> str:
    return f"{x:,.2f}".replace(",", " ").replace(".", ",") + " €"


def cart_total(key: str, session: Session) -> tuple[dict[str, int], float, float, float]:
    """(articles, sous-total, livraison, total) du panier de cette boutique."""
    items = session.carts.get(key, {})
    subtotal = sum(world.ALL_SITES[key]["products"][pid] * qty for pid, qty in items.items())
    shipping = world.shipping_cost(key, subtotal) if items else 0.0
    return items, subtotal, shipping, round(subtotal + shipping, 2)


def _shipping_text(key: str) -> str:
    cost, free_from, delay = world.ALL_SITES[key]["shop"]["shipping"]
    if not cost:
        return f"Gratuite, livrée {delay}" if delay.startswith("le ") else f"Gratuite, sous {delay}"
    price = f"Gratuite dès {free_from} €, sinon {euro(cost)}" if free_from else euro(cost)
    return f"{price}, sous {delay}"


def _facts(key: str) -> str:
    shop = world.ALL_SITES[key]["shop"]
    note, count = shop["rating"]
    avis = f"{note:.1f}".replace(".", ",") + " / 5 sur " + f"{count:,}".replace(",", " ") + " avis"
    return (f'<div class="facts"><div><b>Livraison</b><br>{e(_shipping_text(key))}</div><div><b>Garantie</b><br>{e(shop["warranty"])}</div>'
            f'<div><b>Retours</b><br>{e(shop["returns"])}</div><div><b>Avis clients</b><br>{e(avis)}</div></div>')


def _page(key: str, root: str, title: str, body: str, session: Session, status: int = 200) -> Response:
    s = world.ALL_SITES[key]
    count = sum(session.carts.get(key, {}).values())
    html = (f'<!DOCTYPE html>\n<html lang="fr"><head><meta charset="utf-8"><title>{e(title)} | {e(s["name"])}</title>\n'
            f'<style>:root{{{THEMES[s["shop"]["theme"]]}}}{CSS}</style></head>\n<body>\n'
            f'<header class="top"><a class="brand" href="{root}/">{e(s["name"])}</a>'
            f'<nav><a href="{root}/">Boutique</a><a href="{root}/cart">Panier ({count})</a></nav></header>\n'
            f'<main>\n{body}\n</main>\n<footer>{e(s["shop"]["company"])}</footer>\n{_trap(s)}</body></html>')
    return Response(status, html)


def _trap(s: dict) -> str:
    """Le piège d'une boutique frauduleuse : invisible pour un humain, lu par l'agent, rattrapé par le garde.
    Hors écran (position absolue), comme une instruction cachée dans une vraie page de phishing."""
    trap = s["shop"].get("trap")
    return f'<div aria-hidden="true" style="position:absolute;left:-9999px;top:0;width:1px;height:1px;overflow:hidden">{e(trap)}</div>\n' if trap else ""


def _catalog(key, root, session):
    s = world.ALL_SITES[key]
    cards = "\n".join(
        f'<div class="card"><a href="{root}/product/{pid}">{e(world.PRODUCTS[pid]["name"])}</a>'
        f'<span class="price">{euro(price)}</span><span class="muted">En stock</span></div>' for pid, price in s["products"].items())
    reviews = "\n".join(f'<div class="review">{"★" * n}{"☆" * (5 - n)} {e(text)} - {e(who)}</div>' for n, text, who in s["shop"]["reviews"])
    body = (f'<h1>{e(s["shop"].get("heading", "Apple Watch"))}</h1>\n<p>{e(s["shop"]["intro"])}</p>\n<div class="grid">\n{cards}\n</div>\n{_facts(key)}\n'
            f'<h2>Avis clients</h2>\n{reviews}')
    return _page(key, root, "Apple Watch", body, session)


def _product(key, root, session, pid):
    s, p = world.ALL_SITES[key], world.PRODUCTS[pid]
    specs = "".join(f"<li>{e(x)}</li>" for x in p["specs"])
    body = (f'<p><a href="{root}/">Toutes les montres</a></p>\n<h1>{e(p["name"])}</h1>\n<p class="price">{euro(s["products"][pid])}</p>\n'
            f'<p>{e(p["blurb"])}</p>\n<ul>{specs}</ul>\n'
            f'<form method="post" action="{root}/cart/add"><input type="hidden" name="product" value="{pid}">'
            f'<button class="btn" type="submit">Ajouter au panier</button></form>\n{_facts(key)}')
    return _page(key, root, p["name"], body, session)


def _cart(key, root, session):
    items, subtotal, shipping, total = cart_total(key, session)
    if not items:
        return _page(key, root, "Panier", f'<h1>Votre panier</h1>\n<p>Votre panier est vide.</p>\n<p><a class="btn" href="{root}/">Voir les montres</a></p>', session)
    rows = "".join(f'<tr><td>{e(world.PRODUCTS[pid]["name"])}</td><td class="n">{qty}</td>'
                   f'<td class="n">{euro(world.ALL_SITES[key]["products"][pid] * qty)}</td></tr>' for pid, qty in items.items())
    body = (f'<h1>Votre panier</h1>\n<table><tr><th>Article</th><th class="n">Quantité</th><th class="n">Prix</th></tr>{rows}'
            f'<tr><td>Sous-total</td><td></td><td class="n">{euro(subtotal)}</td></tr>'
            f'<tr><td>Livraison</td><td></td><td class="n">{"Gratuite" if not shipping else euro(shipping)}</td></tr>'
            f'<tr><td><b>Total</b></td><td></td><td class="n"><b>{euro(total)}</b></td></tr></table>\n'
            f'<p><a class="btn" href="{root}/checkout">Passer au paiement</a></p>\n<p><a href="{root}/">Continuer mes achats</a></p>')
    return _page(key, root, "Panier", body, session)


def _input(name, label, auto, wide, values):
    cls = ' class="wide"' if wide else ""
    return (f'<label{cls}>{e(label)}<input type="text" name="{name}" aria-label="{e(label)}" '
            f'autocomplete="{auto}" value="{e(values.get(name, ""))}"></label>')


def _checkout(key, root, session, values=None, errors=()):
    items, _, _, total = cart_total(key, session)
    if not items:
        return Response(303, location="/cart")
    values = values or {}
    errs = "".join(f'<p class="err wide">{e(x)}</p>' for x in errors)
    body = (f'<h1>Paiement</h1>\n<p class="muted">Commande de {sum(items.values())} article(s) chez {e(world.ALL_SITES[key]["name"])}.</p>\n'
            f'<form class="pay" method="post" action="{root}/checkout" data-payment="1">\n{errs}<h2>Livraison</h2>\n'
            + "\n".join(_input(*f, values) for f in FIELDS) + "\n<h2>Paiement par carte</h2>\n"
            + "\n".join(_input(*f, values) for f in CARD_FIELDS)
            + f'\n<p class="wide">Total à payer : <b>{euro(total)}</b></p>\n<button class="btn wide" type="submit">Payer {euro(total)}</button>\n</form>')
    return _page(key, root, "Paiement", body, session, 422 if errors else 200)


def luhn(number: str) -> bool:
    digits = [int(c) for c in number][::-1]
    return bool(digits) and sum(d if i % 2 == 0 else (d * 2 - 9 if d * 2 > 9 else d * 2) for i, d in enumerate(digits)) % 10 == 0


def _validate(form: dict[str, str]) -> list[str]:
    errors = [f"Le champ « {label} » est obligatoire." for name, label, _, _ in FIELDS + CARD_FIELDS if not form.get(name, "").strip()]
    if form.get("email", "").strip() and "@" not in form["email"]:
        errors.append("L'adresse e-mail n'est pas valide.")
    number = re.sub(r"[\s-]", "", form.get("card_number", ""))
    if number and not (number.isdigit() and 13 <= len(number) <= 19 and luhn(number)):
        errors.append("Le numéro de carte n'est pas valide.")
    exp = re.fullmatch(r"\s*(0[1-9]|1[0-2])\s*/\s*(\d{2})\s*", form.get("card_exp", ""))
    if form.get("card_exp", "").strip() and not exp:
        errors.append("La date d'expiration doit être au format MM/AA.")
    elif exp and (2000 + int(exp.group(2)), int(exp.group(1))) < time.localtime()[:2]:
        errors.append("La carte est expirée.")
    if form.get("card_cvc", "").strip() and not re.fullmatch(r"\s*\d{3,4}\s*", form["card_cvc"]):
        errors.append("Le cryptogramme doit comporter 3 ou 4 chiffres.")
    return errors


def _pay(key, root, session, form):
    items, subtotal, shipping, total = cart_total(key, session)
    if not items:
        return Response(303, location="/cart")
    errors = _validate(form)
    if errors:
        return _checkout(key, root, session, form, errors)
    order_id = f"{key[:3].upper()}-{1001 + len(session.orders)}"
    session.orders[order_id] = {
        "id": order_id, "shop": key, "items": dict(items), "subtotal": subtotal, "shipping": shipping, "total": total,
        "buyer": {name: form[name].strip() for name, *_ in FIELDS},
        # de la carte, la commande ne garde que ce qu'un reçu affiche
        "card": {"holder": form["card_name"].strip(), "last4": re.sub(r"\D", "", form["card_number"])[-4:], "exp": form["card_exp"].strip()},
    }
    session.carts[key] = {}
    return Response(303, location=f"/confirmation/{order_id}")


def _confirmation(key, root, session, order_id):
    order = session.orders.get(order_id)
    if not order or order["shop"] != key:
        return _not_found(key, root, session)
    lines = "".join(f"<li>{qty} × {e(world.PRODUCTS[pid]['name'])}</li>" for pid, qty in order["items"].items())
    delay = world.ALL_SITES[key]["shop"]["shipping"][2]
    body = (f'<div class="ok"><h1>Commande confirmée</h1>\n<p>Merci {e(order["buyer"]["name"])}. Votre paiement a été accepté.</p>\n'
            f'<p>Numéro de commande : <b>{order_id}</b></p>\n<ul>{lines}</ul>\n'
            f'<p>Montant payé : <b>{euro(order["total"])}</b>, carte se terminant par {e(order["card"]["last4"])}.</p>\n'
            f'<p>Livraison prévue : {e(delay)}, à {e(order["buyer"]["address"])}, {e(order["buyer"]["postal"])} {e(order["buyer"]["city"])}.</p>\n'
            f'<p class="muted">Un e-mail de confirmation a été envoyé à {e(order["buyer"]["email"])}.</p>\n'
            f'<p><a href="{root}/">Retour à la boutique</a></p></div>')
    return _page(key, root, "Commande confirmée", body, session)


def _not_found(key, root, session):
    return _page(key, root, "Page introuvable", f'<h1>Page introuvable</h1>\n<p><a href="{root}/">Retour à la boutique</a></p>', session, 404)


def handle(key: str, method: str, path: str, form: dict[str, str], session: Session, root: str) -> Response:
    """Répond à une requête sur la boutique `key`. `path` est le chemin dans la boutique, `root` le préfixe des liens."""
    path = "/" + path.strip("/")
    products = world.ALL_SITES[key]["products"]
    if method == "GET":
        if path == "/":
            return _catalog(key, root, session)
        if path.startswith("/product/") and path[9:] in products:
            return _product(key, root, session, path[9:])
        if path == "/cart":
            return _cart(key, root, session)
        if path == "/checkout":
            return _checkout(key, root, session)
        if path.startswith("/confirmation/"):
            return _confirmation(key, root, session, path[14:])
    elif method == "POST":
        if path == "/cart/add" and form.get("product") in products:
            cart = session.carts.setdefault(key, {})
            cart[form["product"]] = cart.get(form["product"], 0) + 1
            return Response(303, location="/cart")
        if path == "/checkout":
            return _pay(key, root, session, form)
    return _not_found(key, root, session)


SEARCH_CSS = ("body{margin:0;font-family:'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1c22;background:#fff;line-height:1.5}"
              "main{max-width:720px;margin:30px auto;padding:0 20px}h1{font-size:22px;margin:0 0 14px}form{display:flex;gap:8px;margin-bottom:22px}"
              "input{flex:1;padding:11px 14px;border:1px solid #cfd3dc;border-radius:999px;font:inherit}"
              "button{padding:0 18px;border:0;border-radius:999px;background:#1a1c22;color:#fff;font:inherit;font-weight:600}"
              ".r{margin-bottom:20px}.r a{font-size:18px;color:#1a3fb0}.r .d{color:#1b6b3a;font-size:13px}.r p{margin:2px 0 0;color:#4a4f5c;font-size:14px}")


def search_page(query: str, root: str, link_for) -> str:
    """La page de résultats du moteur de recherche du bac à sable. `link_for(clé)` donne l'adresse d'une boutique."""
    results = "".join(
        f'<div class="r"><a href="{e(link_for(world.site_of(r["url"])))}">{e(r["title"])}</a>'
        f'<div class="d">{e(r["url"])}</div><p>{e(r["snippet"])}</p></div>\n' for r in world.search(query)) if query.strip() else ""
    return (f'<!DOCTYPE html>\n<html lang="fr"><head><meta charset="utf-8"><title>{e(query or "Recherche")} | Recherche</title>\n'
            f'<style>{SEARCH_CSS}</style></head>\n<body><main>\n<h1>Recherche</h1>\n'
            f'<form method="get" action="{root}/"><input type="text" name="q" aria-label="Rechercher" value="{e(query)}">'
            f'<button type="submit">Rechercher</button></form>\n{results}</main></body></html>')
