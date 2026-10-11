"""What an agentic browser hands the model: the rendered page, not the source.

Naive by design, like real agent browsers: off-screen and zero-size text stays in the rendered text (innerText keeps
it), which is exactly how a hidden instruction reaches the model. The raw source is kept for the guard."""
from __future__ import annotations

from bs4 import BeautifulSoup, Comment

MAX_CHARS = 14000


def render_like_a_browser(html: str) -> dict:
    """Rendered text, links, buttons and visible form fields. Scripts, styles, comments and display:none are dropped."""
    soup = BeautifulSoup(html, "html.parser")
    jsonld = [t.get_text() for t in soup.find_all("script", type="application/ld+json")]
    for el in soup(["script", "style", "noscript", "template"]):
        el.decompose()
    for c in soup.find_all(string=lambda t: isinstance(t, Comment)):
        c.extract()
    for el in soup.find_all(True):
        if el.decomposed:
            continue
        st = (el.get("style") or "").replace(" ", "").lower()
        if "display:none" in st or el.has_attr("hidden") or (el.name == "input" and (el.get("type") or "").lower() == "hidden"):
            el.decompose()
    title = soup.title.get_text(strip=True) if soup.title else ""
    text = soup.get_text("\n", strip=True)
    links = [{"text": a.get_text(" ", strip=True)[:60], "href": a.get("href")} for a in soup.find_all("a", href=True)][:30]
    buttons = [b.get_text(" ", strip=True)[:60] for b in soup.find_all("button")][:20]
    fields = [{"name": i.get("name"), "type": i.get("type", "text"), "placeholder": i.get("placeholder")}
              for i in soup.find_all(["input", "select", "textarea"])][:40]
    metas = {m.get("name") or m.get("property"): m.get("content") for m in soup.find_all("meta")
             if (m.get("name") or m.get("property")) and m.get("content")}
    return {"title": title, "text": text[:MAX_CHARS], "links": links, "buttons": buttons, "form_fields": fields,
            "meta": metas, "structured_data": jsonld}
