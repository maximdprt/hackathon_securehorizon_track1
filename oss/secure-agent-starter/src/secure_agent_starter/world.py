"""The scenario world: web pages, research sheets and a local x402 API, all read from the scenario files.

Each document carries the facts its observer saw (browser layer, RDAP lookup, price comparator, block explorer). Those
facts, never the scenario's `expect` block, are what the wallet hands to the guard. Nothing here touches the internet:
an unknown URL is a 404, so a run is reproducible and the agent cannot wander off.
"""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urljoin, urlsplit

from secure_agent_starter import x402_server
from secure_agent_starter.browser import render_like_a_browser

PKG = Path(__file__).resolve().parent
SCENARIO_DIR = PKG / "scenarios"
ORDER = ("shopping", "x402", "finance")


@dataclass
class Document:
    """Something the agent read. `raw` goes to the guard (it sees hidden text); the model gets the rendered view."""
    id: str
    kind: str            # webpage | sheet | quote
    scenario: str
    title: str
    raw: str
    context_type: str    # html | tool_output
    origin: str          # webpage | document | tool_output
    facts: dict = field(default_factory=dict)


def scenario_names() -> list[str]:
    found = {p.stem for p in SCENARIO_DIR.glob("*.json")}
    return [n for n in ORDER if n in found] + sorted(found - set(ORDER))


def load_scenario(name: str) -> dict:
    p = SCENARIO_DIR / f"{name}.json"
    if not p.is_file():
        raise KeyError(f"unknown scenario {name!r} (known: {', '.join(scenario_names())})")
    return json.loads(p.read_text(encoding="utf-8"))


def _norm_url(url: str) -> str:
    s = urlsplit(url.strip())
    path = s.path or "/"
    return f"{s.scheme.lower()}://{s.netloc.lower()}{path}"


class World:
    def __init__(self, scenarios: list[dict]):
        self.scenarios = {sc["id"]: sc for sc in scenarios}
        self.pages: dict[str, Document] = {}
        self.assets: dict[str, Document] = {}
        self.meta: dict[str, dict] = {}   # search snippets (and APY) for pages and assets
        self.api: dict[str, dict] = {}
        self.api_data: dict = {}
        self.api_scenario = ""
        self._server = None
        self._base = ""
        for sc in scenarios:
            for url, p in (sc.get("pages") or {}).items():
                raw = (SCENARIO_DIR / p["file"]).read_text(encoding="utf-8")
                self.pages[_norm_url(url)] = Document(_norm_url(url), "webpage", sc["id"], render_like_a_browser(raw)["title"], raw,
                                                      "html", "webpage", p.get("facts") or {})
                self.meta[_norm_url(url)] = {"snippet": p.get("snippet", "")}
            for aid, a in (sc.get("assets") or {}).items():
                raw = (SCENARIO_DIR / a["file"]).read_text(encoding="utf-8")
                self.assets[aid] = Document(aid, "sheet", sc["id"], a["name"], raw, "html", "document", a.get("facts") or {})
                self.meta[aid] = {"apy": a.get("apy"), "snippet": a.get("snippet", "")}
            if sc.get("api"):
                self.api, self.api_data, self.api_scenario = sc["api"], sc.get("data") or {}, sc["id"]

    @classmethod
    def load(cls, names: list[str] | None = None) -> "World":
        return cls([load_scenario(n) for n in (names or scenario_names())])

    # ----- what the tools can reach -----
    def page(self, url: str, base: str = "") -> Document | None:
        target = urljoin(base, url) if base and not url.startswith(("http://", "https://")) else url
        return self.pages.get(_norm_url(target)) if target.startswith(("http://", "https://")) else None

    def asset(self, aid: str) -> Document | None:
        key = (aid or "").strip().lower()
        if key in self.assets:
            return self.assets[key]
        return next((d for d in self.assets.values() if d.title.lower() == key), None)

    def search(self, query: str) -> list[dict]:
        """Catalog order, no ranking: the agent decides. A query that matches nothing returns the whole catalog."""
        words = [w for w in re.findall(r"[a-z0-9]+", (query or "").lower()) if len(w) > 2]
        out = []
        for url, d in self.pages.items():
            hay = f"{d.title} {self.meta[url]['snippet']} {url}".lower()
            out.append(({"kind": "page", "url": url, "name": d.title, "snippet": self.meta[url]["snippet"]}, hay))
        for aid, d in self.assets.items():
            hay = f"{d.title} {self.meta[aid]['snippet']} {aid}".lower()
            out.append(({"kind": "asset", "id": aid, "name": d.title, "snippet": self.meta[aid]["snippet"]}, hay))
        hits = [r for r, hay in out if any(w in hay for w in words)]
        return hits or [r for r, _ in out]

    def api_base(self) -> str:
        if not self.api:
            raise RuntimeError("no paid API in this world")
        if self._server is None:
            self._server, self._base = x402_server.start(self.api, self.api_data)
        return self._base

    def call_api(self, resource: str, payment: dict | None = None) -> dict:
        """GET a resource on the local x402 API, with an X-PAYMENT header when a payment was made for it."""
        res = resource if resource.startswith("/") else "/" + resource
        req = urllib.request.Request(self.api_base() + res, headers={"User-Agent": "secure-agent-starter/0.1"})
        if payment:
            req.add_header("X-PAYMENT", json.dumps(payment))
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return {"status": r.status, "body": json.loads(r.read().decode() or "{}")}
        except urllib.error.HTTPError as e:
            return {"status": e.code, "body": json.loads(e.read().decode() or "{}")}

    def close(self) -> None:
        if self._server is not None:
            self._server.shutdown()
            self._server.server_close()
            self._server = None
