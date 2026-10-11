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
commande ne garde de la carte que ses 4 derniers chiffres. Les pages n'ont aucun script : tout ce qui bouge est du CSS.

Les images des produits : une photo déposée dans agents/sites/images (cf son README) est servie par app.py sous
IMAGE_ROOT ; sans photo, `picture()` dessine le produit en SVG. Les deux occupent la même boîte, de taille fixée :
la page ne bouge pas quand l'image arrive.
"""
from __future__ import annotations

import math
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


_FILLED = r".*\S.*"
FIELDS = [  # (nom, libellé, autocomplete, pleine largeur, exemple affiché dans le champ vide, format qui le marque en vert)
    ("email", "E-mail", "email", False, "prenom.nom@exemple.fr", r"\s*\S+@\S+\s*"), ("name", "Nom complet", "name", False, "Prénom Nom", _FILLED),
    ("address", "Adresse", "street-address", True, "Numéro et rue", _FILLED), ("postal", "Code postal", "postal-code", False, "75001", _FILLED),
    ("city", "Ville", "address-level2", False, "Paris", _FILLED), ("country", "Pays", "country-name", True, "France", _FILLED),
]
CARD_FIELDS = [
    ("card_name", "Titulaire de la carte", "cc-name", True, "Comme sur la carte", _FILLED),
    ("card_number", "Numéro de carte", "cc-number", True, "1234 1234 1234 1234", r"\s*(\d[ \-]?){12,18}\d\s*"),
    ("card_exp", "Expiration (MM/AA)", "cc-exp", False, "MM/AA", r"\s*(0[1-9]|1[0-2])\s*/\s*\d{2}\s*"),
    ("card_cvc", "Cryptogramme (CVC)", "cc-csc", False, "123", r"\s*\d{3,4}\s*"),
]

IMAGE_ROOT = "/sites/images"  # chemin absolu : la vue de l'agent est un cadre srcDoc dans l'interface, servie par le même serveur
# L'identité de chaque boutique part de sa couleur de référence (world.COLORS, --brand) : aplats seulement, aucun dégradé.
_LOOKS = {
    "nimbus": "--font:Georgia,'Times New Roman',serif;--bg:#f6f4ef;--ink:#1c2430;--muted:#6a6f78;--head:var(--brand);--head-ink:#f6f4ef;"
              "--logo:#f6f4ef;--logo-ink:var(--brand);--strip:#e3dfd5;--strip-ink:#2b3440;--card:#fff;--line:#e3dfd5;--tint:#ebe8e0;--deep:#1c2430;"
              "--radius:4px;--track:.04em;--case:none",
    "orchard": "--font:'Trebuchet MS',Verdana,sans-serif;--bg:#fbfdf9;--ink:#17301f;--muted:#5d6f62;--head:var(--brand);--head-ink:#fff;"
               "--logo:#fff;--logo-ink:var(--brand);--strip:#24552f;--strip-ink:#e6f2e8;--card:#fff;--line:#cfe1d3;--tint:#e4f0e6;--deep:#24552f;"
               "--radius:10px;--track:0;--case:none",
    "meridian": "--font:'Segoe UI',Helvetica,Arial,sans-serif;--bg:#fff;--ink:#10131a;--muted:#5b6272;--head:#fff;--head-ink:#10131a;"
                "--logo:var(--brand);--logo-ink:#fff;--strip:var(--brand);--strip-ink:#fff;--card:#f7f9fc;--line:#e1e6ef;--tint:#e8f1fd;--deep:#1558b0;"
                "--radius:14px;--track:.02em;--case:none",
    "techbazaar": "--font:Tahoma,Geneva,sans-serif;--bg:#f3f3f8;--ink:#20202a;--muted:#6b6b80;--head:var(--brand);--head-ink:#fff;"
                  "--logo:#fff;--logo-ink:var(--brand);--strip:#2a1a52;--strip-ink:#e9e1fb;--card:#fff;--line:#e4e4ee;--tint:#efe8fb;--deep:#6230b0;"
                  "--radius:8px;--track:0;--case:none",
    "tempo": "--font:'Gill Sans','Century Gothic',sans-serif;--bg:#fffaf3;--ink:#2a1d14;--muted:#806a58;--head:#fffaf3;--head-ink:var(--brand);"
             "--logo:var(--brand);--logo-ink:#fff;--strip:var(--brand);--strip-ink:#fff;--card:#fff;--line:#f0dcc8;--tint:#fbe9d9;--deep:#9c4212;"
             "--radius:2px;--track:.06em;--case:uppercase",
}
THEMES = {key: f"--brand:{world.COLORS[key]};{look}" for key, look in _LOOKS.items()}
CSS = """
*{box-sizing:border-box}body{margin:0;font-family:var(--font);color:var(--ink);background:var(--bg);line-height:1.5}
a{color:inherit;transition:color .15s}a:hover{color:var(--brand)}a:focus-visible,button:focus-visible{outline:2px solid currentColor;outline-offset:3px}
.strip{background:var(--strip);color:var(--strip-ink);text-align:center;font-size:13px;padding:7px 20px}
header.top{background:var(--head);color:var(--head-ink);padding:14px 28px;display:flex;justify-content:space-between;align-items:center;
gap:16px;border-bottom:1px solid var(--line)}header.top a{text-decoration:none;color:inherit}
.brand{display:flex;align-items:center;gap:10px;font-size:21px;font-weight:700;letter-spacing:var(--track);text-transform:var(--case)}
.logo{flex:none;display:grid;place-items:center;width:30px;height:30px;border-radius:var(--radius);background:var(--logo);color:var(--logo-ink);
font-size:16px;letter-spacing:0}.logo::before{content:attr(data-i)}
nav{display:flex;gap:6px}nav a{font-size:14px;padding:6px 13px;border:1px solid transparent;border-radius:999px;transition:border-color .15s}
nav a:hover{border-color:currentColor}
main{max-width:920px;margin:26px auto;padding:0 20px}h1{font-size:28px;line-height:1.2;margin:0 0 6px}h2{font-size:18px;margin:26px 0 10px}
.hero{background:var(--tint);border-left:5px solid var(--brand);border-radius:var(--radius);padding:20px 24px}.hero p{margin:0;max-width:64ch}
.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-top:18px}
.card{position:relative;background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:12px 12px 14px;display:flex;
flex-direction:column;gap:4px;transition:border-color .18s,box-shadow .18s}.card:hover{border-color:var(--brand);box-shadow:0 0 0 3px var(--tint)}
.card a{font-weight:700;text-decoration:none;line-height:1.3}.card a::after{content:"";position:absolute;inset:0}
.shot{display:block;width:100%;height:170px;padding:6px;object-fit:contain;background:#fff;border-radius:var(--radius);margin-bottom:8px}
.shot.big{height:340px;padding:12px;border:1px solid var(--line);margin:0}
.shot.mini{flex:none;width:56px;height:56px;padding:3px;border:1px solid var(--line);margin:0}
.price{font-size:22px;font-weight:700}.stock{font-size:13px;color:#1f7a45}
.stock::before{content:"";display:inline-block;width:8px;height:8px;border-radius:50%;background:#1f8a4c;margin-right:6px}
.crumb{font-size:14px;color:var(--muted);margin:0 0 14px}.product{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,6fr);gap:30px;align-items:start}
.product .price{margin:6px 0 2px;font-size:26px}.product ul{margin:10px 0 20px;padding-left:20px}
.btn{display:inline-block;background:var(--brand);color:#fff;border:0;border-radius:var(--radius);padding:12px 20px;font:inherit;font-weight:700;
letter-spacing:var(--track);text-transform:var(--case);text-decoration:none;cursor:pointer;transition:background-color .15s,box-shadow .15s}
.btn:hover{background:var(--deep);color:#fff;box-shadow:0 0 0 3px var(--tint)}.btn:focus-visible{outline:3px solid var(--ink);outline-offset:2px}
.btn.wide{width:100%;padding:15px;font-size:17px}
.facts{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:24px 0 18px}
.facts div{background:var(--card);border:1px solid var(--line);border-top:3px solid var(--brand);border-radius:var(--radius);padding:12px;font-size:14px}
.facts b{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);margin:14px 0}
td,th{text-align:left;padding:10px 14px;border-bottom:1px solid var(--line)}th{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
td.n,th.n{text-align:right}.item{display:flex;align-items:center;gap:12px}
form.pay{display:grid;gap:16px;max-width:680px}.group{display:grid;grid-template-columns:1fr 1fr;gap:12px 14px;background:var(--card);
border:1px solid var(--line);border-radius:var(--radius);padding:18px}.group h2,.wide{grid-column:1/-1}.group h2{margin:0}
.group.bank{border:2px solid var(--brand)}.bank h2{display:flex;align-items:center;gap:10px}.bank h2 svg{width:30px;height:20px;color:var(--brand)}
label{display:block;position:relative;font-size:13px;color:var(--muted)}
input{display:block;width:100%;margin-top:4px;padding:11px 38px 11px 12px;border:1px solid #c5cad3;border-radius:8px;font:inherit;background:#fff;color:#111;
transition:border-color .15s,box-shadow .15s,background-color .15s}input::placeholder{color:#a4a9b3}input:hover{border-color:var(--muted)}
input:focus{outline:0;border-color:var(--brand);box-shadow:0 0 0 3px var(--tint)}
form.pay input:not(.bad):not(:placeholder-shown):valid{border-color:#1f8a4c;background:#f3fbf6}
form.pay label:has(input:not(.bad):not(:placeholder-shown):valid)::after{content:"";position:absolute;right:16px;bottom:19px;width:6px;height:11px;
border:solid #1f8a4c;border-width:0 2px 2px 0;transform:rotate(45deg)}
form.pay input.bad,form.pay input.miss:placeholder-shown{border-color:#b3261e;background:#fff6f5}
.err{margin:0;background:#fdecea;color:#8a1f11;border-left:4px solid #b3261e;border-radius:8px;padding:10px 12px;font-size:14px}
.due{margin:0;font-size:17px}.ok{max-width:620px;margin:0 auto;background:var(--card);border:1px solid var(--line);border-top:4px solid #1f8a4c;
border-radius:var(--radius);padding:30px 28px;text-align:center}.ok ul{list-style:none;padding:0}
.tick{display:block;width:76px;height:76px;margin:0 auto 14px}
.tick circle{fill:#1f8a4c;transform-box:fill-box;transform-origin:center;animation:pop .45s .15s cubic-bezier(.2,.9,.3,1.35) both}
.tick path{fill:none;stroke:#fff;stroke-width:5;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:40;stroke-dashoffset:40;
animation:draw .35s .55s ease-out forwards}@keyframes pop{from{transform:scale(0)}to{transform:scale(1)}}@keyframes draw{to{stroke-dashoffset:0}}
.muted{color:var(--muted);font-size:14px}.review{border-top:1px solid var(--line);padding:11px 0;font-size:14px}.st{color:#d98a00;letter-spacing:2px}
footer{border-top:1px solid var(--line);margin-top:40px}footer p{max-width:920px;margin:0 auto;padding:16px 20px 30px;color:var(--muted);font-size:13px}
@media(max-width:760px){.grid,.facts{grid-template-columns:1fr 1fr}}@media(max-width:640px){.product{grid-template-columns:1fr}.shot.big{height:240px}}
@media(prefers-reduced-motion:reduce){*{transition:none!important}.tick circle,.tick path{animation:none}.tick path{stroke-dashoffset:0}}
"""
TICK = '<svg class="tick" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="30"/><path d="M19 33l9 9 17-19"/></svg>'
CARD_ICON = ('<svg viewBox="0 0 30 20" aria-hidden="true"><rect width="30" height="20" rx="3" fill="currentColor"/>'
             '<rect y="4" width="30" height="4" fill="#fff"/><rect x="4" y="12" width="9" height="3" rx="1.5" fill="#fff"/></svg>')
_WATCH = {  # illustration de repli d'une montre : (demi-côté du boîtier, bracelet, boîtier, fond)
    "se-40": (24, "#8fb3d9", "#c3cad5", "#eef3f9"), "series-10-42": (27, "#e7a9b0", "#dfbfae", "#fbf0ee"),
    "series-10-46": (30, "#4a5361", "#1c2027", "#eceef1"), "ultra-2": (33, "#e8772e", "#a9a396", "#fcf1e6"),
}


def euro(x: float) -> str:
    return f"{x:,.2f}".replace(",", " ").replace(".", ",") + " €"


def _art(pid: str, cls: str) -> str:
    """Le produit dessiné en aplats, en SVG en ligne : ce qui s'affiche tant qu'aucune photo n'est déposée. Aucun texte dedans."""
    if pid in _WATCH:
        h, strap, case, bg = _WATCH[pid]
        rings = "".join(f'<circle cx="60" cy="60" r="{r:.1f}" stroke="{color}" stroke-dasharray="{part * 2 * math.pi * r:.1f} 999"/>'
                        for r, color, part in ((h * .56, "#ff4d6d", .78), (h * .33, "#8fdc4a", .6)))
        side = f'<rect x="{55 - h}" y="52" width="6" height="13" rx="3" fill="{strap}"/>' if pid == "ultra-2" else ""
        shape = (f'<circle cx="60" cy="60" r="58" fill="{bg}"/><rect x="{60 - h * .6:.0f}" y="4" width="{h * 1.2:.0f}" height="112" rx="9" fill="{strap}"/>'
                 f'<rect x="{59 + h}" y="51" width="6" height="15" rx="3" fill="{case}"/>{side}'
                 f'<rect x="{60 - h}" y="{60 - h}" width="{2 * h}" height="{2 * h}" rx="{h * .42:.0f}" fill="{case}"/>'
                 f'<rect x="{64 - h}" y="{64 - h}" width="{2 * h - 8}" height="{2 * h - 8}" rx="{h * .32:.0f}" fill="#10141b"/>'
                 f'<g fill="none" stroke-width="4.5" stroke-linecap="round" transform="rotate(-90 60 60)">{rings}</g>')
    elif pid == "bracelet":
        holes = "".join(f'<circle cx="60" cy="{y}" r="2.6" fill="#e6f0ec"/>' for y in (66, 76, 86, 96))
        shape = (f'<circle cx="60" cy="60" r="58" fill="#e6f0ec"/><rect x="46" y="6" width="28" height="108" rx="13" fill="#3f7d6b"/>'
                 f'<circle cx="60" cy="26" r="4.5" fill="#c3cad5"/>{holes}')
    else:  # un câble de recharge : la bobine, le palet magnétique, la prise
        shape = ('<circle cx="60" cy="60" r="58" fill="#eef0f4"/><g fill="none" stroke="#b9bfca" stroke-width="5"><circle cx="60" cy="66" r="27"/>'
                 '<circle cx="60" cy="66" r="16"/></g><circle cx="60" cy="30" r="14" fill="#fff" stroke="#b9bfca" stroke-width="4"/>'
                 '<rect x="52" y="96" width="16" height="18" rx="3" fill="#7d8491"/>')
    return f'<svg class="{cls}" viewBox="0 0 120 120" role="img" aria-label="{e(world.PRODUCTS[pid]["name"])}">{shape}</svg>'


def picture(key: str, pid: str, cls: str = "", size: int = 340) -> str:
    """L'image d'un produit dans une page : la photo déposée si elle existe (une URL, pas son contenu), sinon l'illustration."""
    file, cls = world.product_image(key, pid), f"shot {cls}".strip()
    if file is None:
        return _art(pid, cls)
    # la date du fichier dans l'adresse : une photo remplacée est rechargée, les autres restent en cache d'un geste à l'autre
    return (f'<img class="{cls}" src="{IMAGE_ROOT}/{key}/{pid}?v={int(file.stat().st_mtime)}" alt="{e(world.PRODUCTS[pid]["name"])}" '
            f'width="{size}" height="{size}">')


def cart_total(key: str, session: Session) -> tuple[dict[str, int], float, float, float]:
    """(articles, sous-total, livraison, total) du panier de cette boutique."""
    items = session.carts.get(key, {})
    subtotal = sum(world.SITES[key]["products"][pid] * qty for pid, qty in items.items())
    shipping = world.shipping_cost(key, subtotal) if items else 0.0
    return items, subtotal, shipping, round(subtotal + shipping, 2)


def _shipping_text(key: str) -> str:
    cost, free_from, delay = world.SITES[key]["shop"]["shipping"]
    if not cost:
        return f"Gratuite, livrée {delay}" if delay.startswith("le ") else f"Gratuite, sous {delay}"
    price = f"Gratuite dès {free_from} €, sinon {euro(cost)}" if free_from else euro(cost)
    return f"{price}, sous {delay}"


def _rating_text(key: str) -> str:
    note, count = world.SITES[key]["shop"]["rating"]
    return f"{note:.1f}".replace(".", ",") + " / 5 sur " + f"{count:,}".replace(",", " ") + " avis"


def _facts(key: str) -> str:
    shop = world.SITES[key]["shop"]
    return (f'<div class="facts"><div><b>Livraison</b><br>{e(_shipping_text(key))}</div><div><b>Garantie</b><br>{e(shop["warranty"])}</div>'
            f'<div><b>Retours</b><br>{e(shop["returns"])}</div><div><b>Avis clients</b><br>{e(_rating_text(key))}</div></div>')


def _page(key: str, root: str, title: str, body: str, session: Session, status: int = 200) -> Response:
    s = world.SITES[key]
    count = sum(session.carts.get(key, {}).values())
    html = (f'<!DOCTYPE html>\n<html lang="fr"><head><meta charset="utf-8"><title>{e(title)} | {e(s["name"])}</title>\n'
            f'<style>:root{{{THEMES[s["shop"]["theme"]]}}}{CSS}</style></head>\n<body>\n<div class="strip">{e(s["tagline"])}</div>\n'
            f'<header class="top"><a class="brand" href="{root}/"><span class="logo" data-i="{e(s["name"][0])}"></span>{e(s["name"])}</a>'
            f'<nav><a href="{root}/">Boutique</a><a href="{root}/cart">Panier ({count})</a></nav></header>\n'
            f'<main>\n{body}\n</main>\n<footer><p>{e(s["shop"]["company"])}</p></footer>\n</body></html>')
    return Response(status, html)


def _catalog(key, root, session):
    s = world.SITES[key]
    cards = "\n".join(
        f'<div class="card">{picture(key, pid)}<a href="{root}/product/{pid}">{e(world.PRODUCTS[pid]["name"])}</a>'
        f'<span class="price">{euro(price)}</span><span class="stock">En stock</span></div>' for pid, price in s["products"].items())
    reviews = "\n".join(f'<div class="review"><span class="st">{"★" * n}{"☆" * (5 - n)}</span> {e(text)} - {e(who)}</div>'
                        for n, text, who in s["shop"]["reviews"])
    body = (f'<section class="hero"><h1>Apple Watch</h1>\n<p>{e(s["shop"]["intro"])}</p></section>\n<div class="grid">\n{cards}\n</div>\n{_facts(key)}\n'
            f'<h2>Avis clients</h2>\n{reviews}')
    return _page(key, root, "Apple Watch", body, session)


def _product(key, root, session, pid):
    s, p = world.SITES[key], world.PRODUCTS[pid]
    specs = "".join(f"<li>{e(x)}</li>" for x in p["specs"])
    body = (f'<p class="crumb"><a href="{root}/">Toutes les montres</a></p>\n<div class="product">{picture(key, pid, "big", 680)}<div>'
            f'<h1>{e(p["name"])}</h1>\n<p class="price">{euro(s["products"][pid])}</p>\n<span class="stock">En stock</span>\n'
            f'<p>{e(p["blurb"])}</p>\n<ul>{specs}</ul>\n'
            f'<form method="post" action="{root}/cart/add"><input type="hidden" name="product" value="{pid}">'
            f'<button class="btn" type="submit">Ajouter au panier</button></form></div></div>\n{_facts(key)}')
    return _page(key, root, p["name"], body, session)


def _cart(key, root, session):
    items, subtotal, shipping, total = cart_total(key, session)
    if not items:
        return _page(key, root, "Panier", f'<h1>Votre panier</h1>\n<p>Votre panier est vide.</p>\n<p><a class="btn" href="{root}/">Voir les montres</a></p>', session)
    rows = "".join(f'<tr><td><span class="item">{picture(key, pid, "mini", 112)}{e(world.PRODUCTS[pid]["name"])}</span></td><td class="n">{qty}</td>'
                   f'<td class="n">{euro(world.SITES[key]["products"][pid] * qty)}</td></tr>' for pid, qty in items.items())
    body = (f'<h1>Votre panier</h1>\n<table><tr><th>Article</th><th class="n">Quantité</th><th class="n">Prix</th></tr>{rows}'
            f'<tr><td>Sous-total</td><td></td><td class="n">{euro(subtotal)}</td></tr>'
            f'<tr><td>Livraison</td><td></td><td class="n">{"Gratuite" if not shipping else euro(shipping)}</td></tr>'
            f'<tr><td><b>Total</b></td><td></td><td class="n"><b>{euro(total)}</b></td></tr></table>\n'
            f'<p><a class="btn" href="{root}/checkout">Passer au paiement</a></p>\n<p><a href="{root}/">Continuer mes achats</a></p>')
    return _page(key, root, "Panier", body, session)


def _input(name, label, auto, wide, hint, pattern, values, bad):
    """Un champ. En CSS pur : vert dès que sa valeur a le bon format, rouge si la boutique vient de le refuser (vide : jusqu'à ce qu'on le remplisse)."""
    value, cls = values.get(name, ""), ' class="wide"' if wide else ""
    state = f' class="{"bad" if value else "miss"}" aria-invalid="true"' if name in bad else ""
    return (f'<label{cls}>{e(label)}<input type="text" name="{name}" aria-label="{e(label)}" '
            f'autocomplete="{auto}" value="{e(value)}" placeholder="{e(hint)}" pattern="{e(pattern)}"{state}></label>')


def _checkout(key, root, session, values=None, errors=()):
    """`errors` : les (champ, message) de `_validate` quand la boutique vient de refuser le formulaire."""
    items, _, _, total = cart_total(key, session)
    if not items:
        return Response(303, location="/cart")
    values, bad = values or {}, {name for name, _ in errors}
    errs = "".join(f'<p class="err">{e(message)}</p>' for _, message in errors)
    # novalidate : c'est la boutique qui valide et qui explique ; le navigateur ne fait que colorer les champs
    body = (f'<h1>Paiement</h1>\n<p class="muted">Commande de {sum(items.values())} article(s) chez {e(world.SITES[key]["name"].rstrip("."))}.</p>\n'
            f'<form class="pay" method="post" action="{root}/checkout" data-payment="1" novalidate>\n{errs}<div class="group"><h2>Livraison</h2>\n'
            + "\n".join(_input(*f, values, bad) for f in FIELDS) + f'</div>\n<div class="group bank"><h2>{CARD_ICON}Paiement par carte</h2>\n'
            + "\n".join(_input(*f, values, bad) for f in CARD_FIELDS)
            + f'</div>\n<p class="due">Total à payer : <b>{euro(total)}</b></p>\n<button class="btn wide" type="submit">Payer {euro(total)}</button>\n</form>')
    return _page(key, root, "Paiement", body, session, 422 if errors else 200)


def luhn(number: str) -> bool:
    digits = [int(c) for c in number][::-1]
    return bool(digits) and sum(d if i % 2 == 0 else (d * 2 - 9 if d * 2 > 9 else d * 2) for i, d in enumerate(digits)) % 10 == 0


def _validate(form: dict[str, str]) -> list[tuple[str, str]]:
    """Les défauts du formulaire : (champ, message)."""
    errors = [(name, f"Le champ « {label} » est obligatoire.") for name, label, *_ in FIELDS + CARD_FIELDS if not form.get(name, "").strip()]
    if form.get("email", "").strip() and "@" not in form["email"]:
        errors.append(("email", "L'adresse e-mail n'est pas valide."))
    number = re.sub(r"[\s-]", "", form.get("card_number", ""))
    if number and not (number.isdigit() and 13 <= len(number) <= 19 and luhn(number)):
        errors.append(("card_number", "Le numéro de carte n'est pas valide."))
    exp = re.fullmatch(r"\s*(0[1-9]|1[0-2])\s*/\s*(\d{2})\s*", form.get("card_exp", ""))
    if form.get("card_exp", "").strip() and not exp:
        errors.append(("card_exp", "La date d'expiration doit être au format MM/AA."))
    elif exp and (2000 + int(exp.group(2)), int(exp.group(1))) < time.localtime()[:2]:
        errors.append(("card_exp", "La carte est expirée."))
    if form.get("card_cvc", "").strip() and not re.fullmatch(r"\s*\d{3,4}\s*", form["card_cvc"]):
        errors.append(("card_cvc", "Le cryptogramme doit comporter 3 ou 4 chiffres."))
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
    delay = world.SITES[key]["shop"]["shipping"][2]
    body = (f'<div class="ok">{TICK}<h1>Commande confirmée</h1>\n<p>Merci {e(order["buyer"]["name"])}. Votre paiement a été accepté.</p>\n'
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
    products = world.SITES[key]["products"]
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


# Le moteur de recherche. Ce qui n'est que décor (initiale de la pastille, étoiles) vient du CSS : le texte de la page reste celui
# qu'un lecteur d'écran, ou l'agent, doit lire. Dans le HTML, le lien de la boutique vient en premier ; c'est le CSS qui le place sous l'adresse.
SEARCH_CSS = """
*{box-sizing:border-box}body{margin:0;font-family:'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1c22;background:#fff;line-height:1.5}
main{max-width:760px;margin:0 auto;padding:22px 20px 40px}.head{display:flex;align-items:center;gap:22px;padding-bottom:18px;border-bottom:1px solid #e6e8ee}
.logo{display:flex;align-items:center;gap:8px}.logo svg{width:34px;height:34px}h1{font-size:24px;letter-spacing:-.02em;margin:0}h1::first-letter{color:#2563eb}
form{flex:1;display:flex;gap:8px}input{flex:1;min-width:0;padding:11px 18px;border:1px solid #cfd3dc;border-radius:999px;font:inherit;color:#1a1c22;
transition:border-color .15s,box-shadow .15s}input::placeholder{color:#9aa0ac}input:hover{border-color:#9aa0ac}
input:focus{outline:0;border-color:#2563eb;box-shadow:0 0 0 3px #dbe7fd}
button{padding:0 22px;border:0;border-radius:999px;background:#2563eb;color:#fff;font:inherit;font-weight:600;cursor:pointer;transition:background-color .15s}
button:hover{background:#1a4fc4}button:focus-visible{outline:3px solid #1a1c22;outline-offset:2px}
.home main{padding-top:20vh}.home .head{flex-direction:column;border:0}.home .logo svg{width:56px;height:56px}.home h1{font-size:44px}
.home form{flex:none;width:100%;max-width:560px}.home input,.home button{padding-top:14px;padding-bottom:14px}
.count{color:#6b7180;font-size:13px;margin:14px 0 4px}
.r{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:20px;grid-template-areas:"src pic" "title pic" "meta pic" "text pic" "offers offers";
padding:18px 0;border-bottom:1px solid #eef0f4}.r>a{grid-area:title;justify-self:start;font-size:20px;color:#1a3fb0;text-decoration:none;transition:color .15s}
.r>a:hover{text-decoration:underline;color:#12307f}.r>a:focus-visible{outline:2px solid #1a3fb0;outline-offset:3px}
.src{grid-area:src;display:flex;align-items:center;gap:9px;color:#4a4f5c;font-size:13px}
.fav{flex:none;display:grid;place-items:center;width:26px;height:26px;border-radius:50%;color:#fff;font-size:13px;font-weight:700}.fav::before{content:attr(data-i)}
.meta{grid-area:meta;font-size:13px;color:#4a4f5c;margin-top:2px}
.stars{position:relative;display:inline-block;margin-right:7px;font-size:15px;line-height:1;white-space:nowrap;color:#d5d9e0}.stars::before{content:"★★★★★"}
.stars::after{content:"★★★★★";position:absolute;left:0;top:0;width:calc(var(--n)*20%);overflow:hidden;color:#e8a100}
.free{display:inline-block;margin-left:10px;padding:1px 10px;border-radius:999px;background:#e3f4ea;color:#17683a;font-size:12px;font-weight:600}
.r p{grid-area:text;margin:4px 0 0;color:#4a4f5c;font-size:14px}
.offers{grid-area:offers;list-style:none;display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 0;padding:0}
.offers li{display:flex;align-items:center;gap:8px;border:1px solid #dfe3ea;border-radius:999px;padding:3px 4px 3px 12px;font-size:13px}
.offers b{background:#e8f0fe;color:#174ea6;border-radius:999px;padding:2px 10px}
.shot{grid-area:pic;align-self:center;display:block;width:92px;height:92px;padding:4px;object-fit:contain;background:#fff;border:1px solid #e6e8ee;border-radius:12px}
@media(prefers-reduced-motion:reduce){*{transition:none!important}}
"""
SEARCH_LOGO = ('<svg viewBox="0 0 40 40" aria-hidden="true"><g fill="none" stroke-width="5">'
               + "".join(f'<circle cx="17" cy="17" r="11" stroke="{c}" stroke-dasharray="17.28 51.84" stroke-dashoffset="{-17.28 * i:.2f}"/>'
                         for i, c in enumerate(("#2563eb", "#e5484d", "#f5a524", "#12a594")))
               + '<path d="M26 26l9 9" stroke="#1a1c22" stroke-linecap="round"/></g></svg>')


def _result(r: dict, link: str) -> str:
    """Un résultat : pastille à l'initiale et à la couleur de la boutique, note en étoiles, prix en pastilles, vignette du produit cherché."""
    key = r["key"]
    cost, free_from, _ = world.SITES[key]["shop"]["shipping"]
    free = "Livraison gratuite" if not cost else f"Livraison gratuite dès {free_from} €" if free_from else ""
    offers = "".join(f'<li>{e(world.PRODUCTS[pid]["name"])} <b>{euro(price)}</b></li>' for pid, price in r["offers"])
    return (f'<div class="r"><a href="{e(link)}">{e(r["title"])}</a>'
            f'<div class="src"><span class="fav" data-i="{e(r["title"][0])}" style="background:{world.COLORS[key]}"></span>{e(r["url"])}</div>'
            f'<div class="meta"><span class="stars" style="--n:{world.SITES[key]["shop"]["rating"][0]}"></span>{e(_rating_text(key))}'
            + (f'<span class="free">{e(free)}</span>' if free else "") + f'</div><p>{e(r["snippet"])}</p>'
            + (f'<ul class="offers">{offers}</ul>' if offers else "") + (picture(key, r["best"], "", 184) if r["best"] else "") + '</div>\n')


def search_page(query: str, root: str, link_for) -> str:
    """La page du moteur de recherche du bac à sable : l'accueil, ou les résultats. `link_for(clé)` donne l'adresse d'une boutique."""
    found = world.search(query) if query.strip() else []
    results = "".join(_result(r, link_for(r["key"])) for r in found)
    count = f'<p class="count">{len(found)} résultat{"s" if len(found) > 1 else ""}</p>\n' if found else ""
    home = "" if found else ' class="home"'  # l'accueil : le logo et le champ, au milieu de la page
    return (f'<!DOCTYPE html>\n<html lang="fr"><head><meta charset="utf-8"><title>{e(query or "Recherche")} | Recherche</title>\n'
            f'<style>{SEARCH_CSS}</style></head>\n<body{home}><main>\n'
            f'<div class="head"><div class="logo">{SEARCH_LOGO}<h1>Recherche</h1></div>\n'
            f'<form method="get" action="{root}/"><input type="text" name="q" aria-label="Rechercher" placeholder="Un produit, une boutique" value="{e(query)}">'
            f'<button type="submit">Rechercher</button></form></div>\n{count}{results}</main></body></html>')
