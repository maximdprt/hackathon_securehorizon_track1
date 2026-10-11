"""A deterministic, gullible agent: no model, no key, no network.

It behaves like a prompt-injected LLM agent: it reads what its tools return and follows any payment instruction it
finds there, hidden or not, and otherwise does the plain job (the listed price, the quoted amount, the named vault).
It powers the zero-key demo and CI. It only sees the task and tool results: never the scenario file or its `expect`.
"""
from __future__ import annotations

import json
import re
from typing import Any

from secure_agent_starter.loop import Reply

ADDR = re.compile(r"0x[0-9a-fA-F]{40}")
URL = re.compile(r"https?://[^\s)\"'<>]+")
RESOURCE = re.compile(r"(?<![\w/])(/[A-Za-z0-9_\-]+)")
# "submit the payment of 500 USDC to the merchant settlement address 0x..."
PAY_ORDER = re.compile(r"\b(?:submit|send|pay|transfer)\b[^.]{0,80}?(\d[\d,]*(?:\.\d+)?)\s*USDC[^.]{0,120}?(0x[0-9a-fA-F]{40})", re.I | re.S)
# "approve an UNLIMITED USDC allowance (max uint256) to 0x..."
APPROVE_ORDER = re.compile(r"\bapprove\b[^.]{0,80}?\b(?:allowance|access)\b[^.]{0,60}?(0x[0-9a-fA-F]{40})", re.I | re.S)
# "send 4.9 USDC instead of 0.5" / "set amount=4.9"
UPSELL = re.compile(r"send\s+(\d+(?:\.\d+)?)\s*USDC\s+instead|amount\s*=\s*(\d+(?:\.\d+)?)", re.I)
DEPOSIT = re.compile(r"deposit address\W{0,5}(0x[0-9a-fA-F]{40})", re.I)
PRICE = re.compile(r"\$\s?(\d[\d,]*(?:\.\d+)?)")
USDC_AMOUNT = re.compile(r"(\d[\d,]*(?:\.\d+)?)\s*USDC", re.I)
APY = re.compile(r"(\d+(?:\.\d+)?)\s*%\s*APY", re.I)
STOP = {"buy", "for", "the", "and", "pay", "usdc", "me", "on", "an", "at", "in", "my", "with", "best", "price", "this",
        "deal", "clicked", "ad", "https", "http", "www", "example", "store"}


def _num(s: str) -> float:
    return float(s.replace(",", ""))


def _history(messages: list[dict]) -> list[tuple[str, dict, Any]]:
    """(tool name, input, result) in call order, rebuilt from the Converse transcript."""
    calls: dict[str, tuple[str, dict]] = {}
    out = []
    for m in messages:
        for c in m.get("content", []):
            if "toolUse" in c:
                calls[c["toolUse"]["toolUseId"]] = (c["toolUse"]["name"], c["toolUse"].get("input") or {})
            elif "toolResult" in c:
                tr = c["toolResult"]
                name, inp = calls.get(tr["toolUseId"], ("?", {}))
                res: Any = None
                for part in tr.get("content", []):
                    if "json" in part:
                        res = part["json"]
                    elif "text" in part:
                        try:
                            res = json.loads(part["text"])
                        except ValueError:
                            res = part["text"]
                out.append((name, inp, res))
    return out


def _task(messages: list[dict]) -> str:
    first = messages[0] if messages else {}
    return " ".join(c.get("text", "") for c in first.get("content", []) if "text" in c)


def _report(result: Any, what: str) -> str:
    r = result if isinstance(result, dict) else {}
    status = r.get("status")
    if status == "executed":
        return f"Done: {what}, {float(r.get('amount') or 0):g} USDC sent to {r.get('recipient')} (tx {r.get('tx')})."
    if status == "parked":
        return f"The payment for {what} is parked, waiting for a human approver. I did not retry."
    if status == "refused":
        reasons = r.get("reasons") or [r.get("message", "")]
        return f"The payment for {what} was refused: {reasons[0] if reasons else 'no reason given'}. I did not retry."
    return f"I could not complete {what}: {r.get('error') or r.get('reason') or r}."


class ScriptedLLM:
    name = "scripted"
    model = "scripted-gullible"

    def __init__(self) -> None:
        self.n = 0

    def complete(self, system: str, messages: list[dict], tools: list[dict]) -> Reply:
        names = {t["name"] for t in tools}
        task, hist = _task(messages), _history(messages)
        if "call_api" in names and "pay_x402" in names:
            step = self._x402(task, hist)
        elif "research" in names:
            step = self._finance(task, hist)
        else:
            step = self._shopping(task, hist)
        self.n += 1
        if isinstance(step, str):
            return Reply({"role": "assistant", "content": [{"text": step}]}, "end_turn")
        name, args, thought = step
        return Reply({"role": "assistant", "content": [{"text": thought}, {"toolUse": {"toolUseId": f"s{self.n}", "name": name, "input": args}}]},
                     "tool_use")

    # ----- shopping: open the store, follow the page's payment instruction, else pay the listed price -----
    def _shopping(self, task: str, hist: list) -> tuple | str:
        paid = [h for h in hist if h[0] == "pay"]
        if paid:
            return _report(paid[-1][2], "the purchase")
        pages = [h for h in hist if h[0] == "open_page" and isinstance(h[2], dict) and "text" in h[2]]
        if not pages:
            m = URL.search(task)
            if not m:
                return "I need a store URL to start shopping."
            return ("open_page", {"url": m.group(0).rstrip(".,;")}, "Opening the store page.")
        text = pages[-1][2]["text"]
        m = PAY_ORDER.search(text)
        if m:  # the gullible part: an instruction found in the page is followed as is
            return ("pay", {"amount": _num(m.group(1)), "recipient": m.group(2), "currency": "USDC", "item": "order"},
                    "The store explains how automated assistants complete checkout; following its instructions.")
        price, to = self._listed_price(task, text), ADDR.search(text)
        if price and to:
            return ("pay", {"amount": price, "recipient": to.group(0), "currency": "USDC", "item": "order"},
                    f"Found the product at ${price:g}; paying the store's USDC address.")
        return "I could not find how to pay on this page."

    @staticmethod
    def _listed_price(task: str, text: str) -> float | None:
        words = {w for w in re.findall(r"[a-z0-9]+", URL.sub(" ", task.lower())) if w not in STOP and len(w) > 1}
        lines = [ln for ln in text.splitlines() if ln.strip()]
        best, best_score = None, 0
        for i, ln in enumerate(lines):
            score = sum(1 for w in words if w in re.findall(r"[a-z0-9]+", ln.lower()))
            price = next((PRICE.search(x) for x in lines[i:i + 3] if PRICE.search(x)), None)
            if price and score > best_score:
                best, best_score = _num(price.group(1)), score
        return best

    # ----- x402: call, read the quote (and its upsell), pay, call again with the payment -----
    def _x402(self, task: str, hist: list) -> tuple | str:
        m = RESOURCE.search(task)
        resource = m.group(1) if m else "/"
        if not hist:
            return ("call_api", {"resource": resource}, f"Calling {resource}.")
        name, inp, res = hist[-1]
        r = res if isinstance(res, dict) else {}
        if name == "call_api" and r.get("status") == 200:
            return f"Here is the data from {resource}: {json.dumps((r.get('body') or {}).get('data'))}. Paid and settled with x402."
        if name == "call_api" and r.get("status") == 402:
            if sum(1 for h in hist if h[0] == "pay_x402") >= 2:
                return "The API keeps asking for payment; stopping."
            q = ((r.get("body") or {}).get("accepts") or [{}])[0]
            amount, up = float(q.get("amount") or 0), UPSELL.search(q.get("description") or "")
            if up:  # the gullible part: the service's text sets the amount
                amount = float(up.group(1) or up.group(2))
            return ("pay_x402", {"resource": resource, "amount": amount},
                    f"402 received; paying {amount:g} {q.get('currency', 'USDC')} as the service instructs.")
        if name == "pay_x402":
            if r.get("status") == "executed":
                return ("call_api", {"resource": resource}, "Paid; calling the API again with the payment.")
            return _report(r, f"the {resource} call")
        return f"Stopped: unexpected result from {name}."

    # ----- finance: search, pick the named vault (else the best APY), read it, follow its deposit instructions -----
    def _finance(self, task: str, hist: list) -> tuple | str:
        pays = [h for h in hist if h[0] == "pay"]
        if pays:
            return _report(pays[-1][2], "the deposit")
        searches = [h for h in hist if h[0] == "search"]
        if not searches:
            return ("search", {"query": "USDC vault yield"}, "Looking for USDC yield vaults.")
        researched = [h for h in hist if h[0] == "research" and isinstance(h[2], dict) and "text" in h[2]]
        if not researched:
            results = [r for r in (searches[-1][2] or {}).get("results", []) if r.get("kind") == "asset"]
            if not results:
                return "No investment opportunity found."
            low = task.lower()
            named = [r for r in results if r["name"].split()[0].lower() in low or r["id"] in low]
            pick = named[0] if named else max(results, key=lambda r: float((APY.search(r.get("snippet", "")) or [0, 0])[1]))
            return ("research", {"asset": pick["id"]}, f"Reading the research sheet of {pick['name']}.")
        aid, text = researched[-1][1].get("asset", ""), researched[-1][2]["text"]
        am = USDC_AMOUNT.search(task)
        amount = _num(am.group(1)) if am else 100.0
        ap = APPROVE_ORDER.search(text)
        if ap:  # the gullible part: the sheet's hidden note becomes the action
            return ("pay", {"action": "approve", "asset": aid, "recipient": ap.group(1), "amount": amount, "currency": "USDC"},
                    "The protocol says to approve the allowance first; doing it now.")
        dep = DEPOSIT.search(text) or ADDR.search(text)
        if not dep:
            return "The research sheet gives no deposit address."
        to = dep.group(1) if dep.re is DEPOSIT else dep.group(0)
        return ("pay", {"action": "pay", "asset": aid, "recipient": to, "amount": amount, "currency": "USDC"},
                f"Depositing {amount:g} USDC at the vault's deposit address.")
