"""Outils 'monde extérieur' des agents : lire une page, lire un document. Naïfs par design :
ils rendent à l'agent tout ce que la machine lit (DOM complet, texte blanc, champs cachés), comme un navigateur agentique.
"""
from __future__ import annotations

import email
import re
import urllib.request
from pathlib import Path

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[2]
MAX_CHARS = 14000

# prix de référence pour la feature price_deviation (ce qu'un agent sérieux irait chercher sur un comparateur)
MARKET_PRICES = {"apple watch": 429, "airpods": 249, "iphone": 999, "usb-c cable": 13, "watch band": 47}


def market_price_for(text: str) -> float | None:
    t = (text or "").lower()
    for k, v in MARKET_PRICES.items():
        if k in t:
            return v
    return None


def render_like_a_browser(html: str) -> dict:
    """Ce qu'un navigateur agentique donne au modèle : le texte rendu (innerText-like, donc y compris le texte
    hors écran ou en taille 0, mais sans scripts, styles ni commentaires), les liens, les boutons et les champs
    de formulaire visibles. Pas le code source."""
    soup = BeautifulSoup(html, "html.parser")
    for el in soup(["script", "style", "noscript", "template"]):
        el.decompose()
    for c in soup.find_all(string=lambda t: t.__class__.__name__ == "Comment"):
        c.extract()
    for el in soup.find_all(True):
        st = (el.get("style") or "").replace(" ", "").lower()
        if "display:none" in st or el.has_attr("hidden") or (el.name == "input" and (el.get("type") or "").lower() == "hidden"):
            el.decompose()
    jsonld = [t.get_text() for t in soup.find_all("script", type="application/ld+json")]
    text = soup.get_text("\n", strip=True)
    links = [{"text": a.get_text(" ", strip=True)[:60], "href": a.get("href")} for a in soup.find_all("a", href=True)][:30]
    buttons = [b.get_text(" ", strip=True)[:60] for b in soup.find_all("button")][:20]
    fields = [{"name": i.get("name"), "type": i.get("type", "text"), "placeholder": i.get("placeholder")} for i in soup.find_all(["input", "select", "textarea"])][:40]
    metas = {m.get("name") or m.get("property"): m.get("content") for m in soup.find_all("meta") if (m.get("name") or m.get("property")) and m.get("content")}
    return {"text": text, "links": links, "buttons": buttons, "form_fields": fields, "meta": metas, "structured_data": jsonld}


def open_page(url: str) -> dict:
    """Charge une URL http(s) ou un fichier local. `html` = source brute (pour le garde) ; le reste = la vue navigateur (pour l'agent)."""
    if url.startswith(("http://", "https://")):
        req = urllib.request.Request(url, headers={"User-Agent": "Team2-ShoppingAgent/0.1 (+agentic browser)"})
        with urllib.request.urlopen(req, timeout=10) as r:
            raw = r.read().decode("utf-8", "replace")
            final_url = r.geturl()
    else:
        p = Path(url)
        if not p.is_absolute():
            p = ROOT / p
        raw = p.read_text(encoding="utf-8", errors="replace")
        final_url = str(p)
    title = re.search(r"<title[^>]*>(.*?)</title>", raw, re.I | re.S)
    view = render_like_a_browser(raw)
    view["text"] = view["text"][:MAX_CHARS]
    return {"url": final_url, "title": (title.group(1).strip() if title else ""), "html": raw[:MAX_CHARS * 2],
            "chars": len(raw), **view}


def _pdf_text(data: bytes) -> str:
    """Extraction minimale : les chaînes des opérateurs Tj/TJ (suffit pour nos PDF de démo, sans dépendance)."""
    txt = data.decode("latin-1", "replace")
    parts = re.findall(r"\((?:\\.|[^\\)])*\)\s*Tj", txt)
    out = []
    for p in parts:
        s = p[1:p.rfind(")")]
        s = s.replace("\\(", "(").replace("\\)", ")").replace("\\\\", "\\")
        out.append(s)
    return "\n".join(out)


def read_document(path: str) -> dict:
    """Lit un PDF (texte extrait, y compris le texte blanc), un .eml (en-têtes + corps) ou un fichier texte."""
    p = Path(path)
    if not p.is_absolute():
        p = ROOT / p
    if not p.exists():
        return {"error": f"file not found: {path}"}
    if p.suffix.lower() == ".pdf":
        text, kind = _pdf_text(p.read_bytes()), "pdf"
    elif p.suffix.lower() == ".eml":
        m = email.message_from_string(p.read_text(encoding="utf-8", errors="replace"))
        body = m.get_payload(decode=True)
        body = body.decode("utf-8", "replace") if isinstance(body, bytes) else str(m.get_payload())
        headers = "\n".join(f"{k}: {v}" for k, v in m.items())
        text, kind = headers + "\n\n" + body, "email"
    else:
        text, kind = p.read_text(encoding="utf-8", errors="replace"), "text"
    return {"path": str(p.relative_to(ROOT)) if str(p).startswith(str(ROOT)) else str(p), "kind": kind,
            "text": text[:MAX_CHARS], "chars": len(text)}
