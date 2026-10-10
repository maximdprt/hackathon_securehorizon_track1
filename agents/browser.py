"""Le navigateur simulé de l'agent.

Il charge les pages des boutiques (shops.py) et du moteur de recherche, sans réseau. À chaque page il numérote les
éléments sur lesquels on peut agir (liens, boutons, champs) : e1, e2, e3... L'agent reçoit la page en texte, avec ces
repères, et agit avec `goto`, `click` et `fill`. L'interface, elle, reçoit le vrai HTML (`view`) pour l'afficher.

    b = Browser(); b.goto("https://recherche.example/?q=apple+watch"); print(b.snapshot()); b.click("e3")

Un bouton qui envoie le formulaire de paiement n'est pas cliqué en douce : `payment(ref)` permet à l'appelant de le
repérer avant, c'est là que le garde se branche.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from html import escape, unescape
from html.parser import HTMLParser
from urllib.parse import parse_qs, urlencode, urljoin, urlsplit

from agents import shops, world

SEARCH_ROOT = f"https://{world.SEARCH_HOST}"
_ACTIONABLE = re.compile(r"<(a|button|input)\b([^>]*)>", re.I)
_BLOCKS = {"p", "div", "li", "h1", "h2", "h3", "tr", "section", "header", "footer", "form", "table", "ul", "main", "nav", "label", "br"}
# Ajouté à la page affichée dans l'interface : l'élément visé est encadré, et rien n'est cliquable (c'est un écran de contrôle).
VIEW_CSS = ("<style>[data-hl]{outline:3px solid #0F9D8A!important;outline-offset:3px;border-radius:6px;scroll-margin:120px}"
            "a,button,input{pointer-events:none}</style>")


@dataclass
class Element:
    ref: str
    kind: str  # link | button | input
    label: str = ""
    href: str = ""
    form: int = -1
    name: str = ""
    value: str = ""


def _annotate(html: str) -> str:
    """Pose data-ref="eN" sur chaque lien, bouton et champ visible, dans l'ordre du document."""
    count = 0

    def mark(m: re.Match) -> str:
        nonlocal count
        tag, attrs = m.group(1).lower(), m.group(2)
        if (tag == "a" and "href=" not in attrs) or (tag == "input" and 'type="hidden"' in attrs):
            return m.group(0)
        count += 1
        return f'<{tag} data-ref="e{count}"{attrs}>'

    return _ACTIONABLE.sub(mark, html)


class _Reader(HTMLParser):
    """Lit une page annotée : son texte avec les repères, ses éléments, ses formulaires."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.title, self.out, self.elements, self.forms = "", [], {}, []
        self._skip, self._in_title, self._form, self._open = 0, False, -1, None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ("style", "script"):
            self._skip += 1
        elif tag == "title":
            self._in_title = True
        elif tag == "form":
            self.forms.append({"action": a.get("action", ""), "method": (a.get("method") or "get").upper(), "payment": "data-payment" in a, "fields": []})
            self._form = len(self.forms) - 1
        if tag in _BLOCKS:
            self.out.append("\n")
        if tag in ("td", "th"):
            self.out.append(" | ")
        if tag == "input" and a.get("type") == "hidden" and self._form >= 0:
            self.forms[self._form]["fields"].append((a.get("name", ""), None, a.get("value", "")))
        ref = a.get("data-ref")
        if not ref:
            return
        self._space()
        if tag == "a":
            self._open = self.elements[ref] = Element(ref, "link", href=a.get("href", ""))
            self.out.append(f"[{ref} link] ")
        elif tag == "button":
            self._open = self.elements[ref] = Element(ref, "button", form=self._form)
            self.out.append(f"[{ref} button] ")
        else:
            el = self.elements[ref] = Element(ref, "input", label=a.get("aria-label", a.get("name", "")), form=self._form, name=a.get("name", ""), value=a.get("value", ""))
            if self._form >= 0:
                self.forms[self._form]["fields"].append((el.name, ref, el.value))
            self.out.append(f'[{ref} input "{el.label}"] ')

    def _space(self):
        """Sépare deux morceaux de texte collés dans le HTML (deux <span> voisins, un lien après un autre)."""
        if self.out and not self.out[-1].endswith((" ", "\n")):
            self.out.append(" ")

    def handle_endtag(self, tag):
        if tag in ("style", "script"):
            self._skip -= 1
        elif tag == "title":
            self._in_title = False
        elif tag == "form":
            self._form = -1
        elif tag in ("a", "button"):
            self._open = None
        if tag in _BLOCKS:
            self.out.append("\n")

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        elif not self._skip and data.strip():
            text = re.sub(r"\s+", " ", data)
            self._space()
            self.out.append(text.lstrip())
            if self._open is not None:
                self._open.label = (self._open.label + " " + text.strip()).strip()


class Browser:
    def __init__(self, session: shops.Session | None = None):
        self.session = session or shops.Session()
        self.url = self.title = self.html = ""
        self.elements: dict[str, Element] = {}
        self.forms: list[dict] = []
        self.values: dict[str, str] = {}  # ce que l'agent a saisi dans la page courante, par repère
        self.status = 0
        self.visited: list[tuple[str, str]] = []  # (url, html) de chaque page chargée, dans l'ordre
        self._text = ""

    # ---- chargement ----
    def _fetch(self, method: str, url: str, form: dict[str, str]) -> tuple[int, str, str]:
        """(statut, html, redirection). Les adresses hors du bac à sable n'existent pas."""
        parts = urlsplit(url)
        if parts.hostname == world.SEARCH_HOST:
            query = parse_qs(parts.query).get("q", [""])[0] if method == "GET" else form.get("q", "")
            return 200, shops.search_page(query, SEARCH_ROOT, world.url_of), ""
        key = world.site_of(url)
        if key not in world.SITES or parts.scheme not in ("http", "https"):
            page = (f'<!DOCTYPE html>\n<html lang="fr"><head><meta charset="utf-8"><title>Site introuvable</title></head>\n'
                    f'<body><main><h1>Site introuvable</h1><p>{escape(url)} ne répond pas.</p></main></body></html>')
            return 404, page, ""
        root = f"https://{world.SITES[key]['domain']}"
        res = shops.handle(key, method, parts.path, form, self.session, root)
        return res.status, res.html, root + res.location if res.location else ""

    def _load(self, method: str, url: str, form: dict[str, str] | None = None) -> None:
        for _ in range(6):  # suit les redirections (après un ajout au panier, après un paiement)
            status, html, location = self._fetch(method, url, form or {})
            if not location:
                break
            method, url, form = "GET", location, None
        reader = _Reader()
        self.html = _annotate(html)
        reader.feed(self.html)
        self.url, self.status, self.title = url, status, reader.title.strip()
        self.elements, self.forms, self.values = reader.elements, reader.forms, {}
        self._text = re.sub(r"[ \t]*\n\s*", "\n", "".join(reader.out)).strip()
        self.visited.append((url, html))

    def goto(self, url: str) -> None:
        url = url.strip()
        if "://" not in url:  # domaine seul, ou lien relatif à la page courante
            url = urljoin(self.url, url) if self.url and not re.match(r"^[\w.-]+\.[a-z]{2,}(/|$)", url) else "https://" + url.lstrip("/")
        self._load("GET", url)

    def search(self, query: str) -> None:
        self._load("GET", f"{SEARCH_ROOT}/?{urlencode({'q': query})}")

    # ---- actions ----
    def fill(self, ref: str, value: str) -> Element:
        el = self.elements.get(ref)
        if el is None or el.kind != "input":
            raise ValueError(f"{ref} is not an input on this page")
        self.values[ref] = value
        return el

    def _form_data(self, form: dict) -> dict[str, str]:
        return {name: self.values.get(ref, default) if ref else default for name, ref, default in form["fields"] if name}

    def payment(self, ref: str) -> dict | None:
        """Si cliquer `ref` envoie le formulaire de paiement : la boutique, le panier et ce que le formulaire va transmettre."""
        el = self.elements.get(ref)
        if el is None or el.kind != "button" or el.form < 0 or not self.forms[el.form]["payment"]:
            return None
        key = world.site_of(self.url)
        items, subtotal, shipping, total = shops.cart_total(key, self.session)
        return {"site": key, "items": dict(items), "subtotal": subtotal, "shipping": shipping, "total": total, "form": self._form_data(self.forms[el.form])}

    def click(self, ref: str) -> Element:
        el = self.elements.get(ref)
        if el is None:
            raise ValueError(f"no element {ref} on this page")
        if el.kind == "link":
            self._load("GET", urljoin(self.url, el.href))
        elif el.kind == "button" and el.form >= 0:
            form = self.forms[el.form]
            data, action = self._form_data(form), urljoin(self.url, form["action"])
            if form["method"] == "GET":
                self._load("GET", f"{action.split('?')[0]}?{urlencode(data)}")
            else:
                self._load("POST", action, data)
        else:
            raise ValueError(f"{ref} cannot be clicked")
        return el

    # ---- ce que voient l'agent et l'interface ----
    def snapshot(self, limit: int = 6000) -> str:
        """La page en texte pour l'agent : chaque élément actionnable est précédé de son repère, les champs montrent leur valeur."""
        text = self._text
        for ref, el in self.elements.items():
            if el.kind == "input":
                text = text.replace(f'[{ref} input "{el.label}"]', f'[{ref} input "{el.label}" value="{self.values.get(ref, el.value)}"]')
        return f"URL: {self.url}\nTitle: {self.title}\n\n{text[:limit]}"

    def view(self, highlight: str | None = None) -> dict:
        """La page telle que l'interface l'affiche : le vrai HTML, les champs remplis, l'élément visé encadré."""
        html = self.html
        for ref, value in self.values.items():
            html = re.sub(rf'(<input data-ref="{ref}"[^>]*?\svalue=")[^"]*(")', lambda m: m.group(1) + escape(value) + m.group(2), html, count=1)
        if highlight in self.elements:
            html = html.replace(f'data-ref="{highlight}"', f'data-ref="{highlight}" data-hl="1"', 1)
        html = html.replace("</head>", VIEW_CSS + "</head>", 1)
        return {"url": self.url, "title": unescape(self.title), "status": self.status, "html": html}
