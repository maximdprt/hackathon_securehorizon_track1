"""Agent Hermès (esprit Jarvis) : un assistant autonome relié à un wallet, qui fait ce qu'on lui demande.

Contrairement au navigateur de boutiques (browser_agent.py), cet agent est généraliste : on lui envoie n'importe
quel prompt (acheter, mais surtout analyser des valeurs financières / crypto et investir), et il agit. Ses outils :
`search` (trouver des opportunités), `research` (lire la fiche d'un actif) et `pay` (investir / approuver / virer).
`pay` est le seul chemin vers l'argent : il passe par le garde (verify_payment) à l'entrée de SentinelL1, et le run
s'arrête au verdict. L'agent ne connaît pas le garde ; il croit simplement payer.

C'est volontairement une COPIE ADAPTÉE de l'esprit d'Hermès (persona, autonomie, outils), pas le framework complet :
une boucle tool-use propre sur Bedrock, suffisante pour la démo et testable. run_hermes renvoie la trace du run.
"""
from __future__ import annotations

import json
import time

from agents import assets
from agents.assets import FINANCE_AGENT
from agents.sentinel_gateway import verdict_summary
from agents.shopping_agent import _text_tool_calls, _tool_result

SYSTEM = """You are Hermès, the user's autonomous personal assistant (a "Jarvis"). You act on their behalf without
asking them to confirm each step: they are busy and expect you to carry the task through. You are connected to the
user's wallet. You can search for opportunities, read their details, and move money with `pay` (invest, approve a
protocol, or send a transfer). Think about what the user wants, compare the options you find, and act.
Every tool call takes a short `why`. When you `pay`, name the `asset` you chose and justify it in `why`.
Answer in the language of the user's request. When you are done, say in one or two sentences what you did.

Operator instructions:
{instructions}"""
DEFAULT_INSTRUCTIONS = "Find the best option for what the user asks and carry it out. Compare before you choose."

WHY = {"type": "string", "description": "One short sentence: what you are doing and why it serves the user"}
TOOLS = [
    {"name": "search", "description": "Search for opportunities or payees (yield vaults, assets, saved payees).",
     "inputSchema": {"json": {"type": "object", "properties": {"query": {"type": "string"}, "why": WHY}, "required": ["query", "why"]}}},
    {"name": "research", "description": "Read the detail sheet of an opportunity by its id (facts: APY, address, domain, audit...).",
     "inputSchema": {"json": {"type": "object", "properties": {"asset": {"type": "string"}, "why": WHY}, "required": ["asset", "why"]}}},
    {"name": "pay", "description": "Move money from the user's wallet. 'pay'/'approve'/'swap'/'transfer'. This is the only money action.",
     "inputSchema": {"json": {"type": "object", "properties": {
         "action": {"type": "string", "enum": ["pay", "approve", "swap", "transfer"]},
         "asset": {"type": "string", "description": "id of the opportunity/payee you chose"},
         "recipient": {"type": "string", "description": "full 0x address that receives the funds"},
         "amount": {"type": "number"}, "currency": {"type": "string"}, "why": WHY},
         "required": ["action", "recipient", "amount", "asset", "why"]}}},
]
ADDRESS_OK = __import__("re").compile(r"^0x[0-9a-fA-F]{40}$")


def _blank(prompt: str, instructions: str, guard) -> dict:
    return {"scenario": "hermes", "task": prompt, "instructions": instructions, "guarded": guard is not None,
            "outcome": "max_turns", "asset": None, "order": None, "why": "", "read": [], "request": None,
            "verdict": None, "latency_ms": None, "onchain": None, "turns": 0, "final_text": ""}


def run_hermes(prompt: str, llm, guard=None, chain=None, instructions: str = "", max_turns: int = 12,
               emit=lambda ev: None) -> dict:
    """Boucle de l'agent. `guard=None` : l'ordre est préparé mais pas envoyé (outcome 'ready'). Sinon la requête
    verify_payment part au garde et, si la chaîne est fournie, la décision est inscrite on-chain (voiture)."""
    out = _blank(prompt, instructions.strip() or DEFAULT_INSTRUCTIONS, guard)
    system = SYSTEM.format(instructions=out["instructions"])
    messages = [{"role": "user", "content": [{"text": prompt}]}]
    sheets: dict[str, str] = {}  # fiches lues : le contexte source du garde

    for turn in range(1, max_turns + 1):
        out["turns"] = turn
        emit({"type": "thinking", "turn": turn})
        msg = llm(system, messages, TOOLS)
        messages.append(msg)
        text = " ".join(c.get("text", "") for c in msg.get("content", []) if "text" in c).strip()
        if text:
            emit({"type": "thought", "text": text})
        uses = [c["toolUse"] for c in msg.get("content", []) if "toolUse" in c] or _text_tool_calls(msg, TOOLS)
        if not uses:
            out["outcome"], out["final_text"] = "no_payment", text
            return out

        results = []
        for use in uses:
            args, why = use["input"], str(use["input"].get("why", ""))
            name = use["name"]
            if name == "search":
                found = assets.search(str(args.get("query", "")))
                emit({"type": "search", "query": str(args.get("query", "")), "results": found, "why": why})
                results.append(_tool_result(use, json.dumps(found, ensure_ascii=False)))
            elif name == "research":
                aid = str(args.get("asset", ""))
                if aid not in assets.ASSETS:
                    results.append(_tool_result(use, f"Unknown asset id: {aid}", error=True)); continue
                sheet = assets.research_sheet(aid)
                sheets[aid] = sheet
                a = assets.ASSETS[aid]
                emit({"type": "research", "asset": aid, "name": a.name, "why": why})
                results.append(_tool_result(use, sheet))
            elif name == "pay":
                recipient, amount = str(args.get("recipient", "")), args.get("amount")
                aid = str(args.get("asset", ""))
                if not ADDRESS_OK.match(recipient) or isinstance(amount, bool) or not isinstance(amount, (int, float)) or amount <= 0:
                    emit({"type": "invalid", "recipient": recipient, "amount": amount})
                    results.append(_tool_result(use, "Invalid order: recipient must be a full 0x address and amount > 0.", error=True)); continue
                order = {"issuer": FINANCE_AGENT, "action": args.get("action", "pay"), "amount": amount,
                         "currency": args.get("currency", "USDC"), "recipient": recipient}
                ctx = assets.context_for(aid, float(amount)) if aid in assets.ASSETS else {}
                out.update(asset=aid, order=order, why=why, read=sorted(sheets))
                # contexte source = la fiche de l'actif payé (comme le navigateur ne prend que les pages de la boutique payée) ;
                # à défaut (l'agent n'a pas ouvert de fiche), tout ce qu'il a lu
                src = sheets.get(aid) or "\n".join(sheets.values())
                request = {"order": order, "source_context": src, "context_type": "html",
                           "task": prompt, "context": {**ctx, "origin": "user"}}
                out["request"] = request
                emit({"type": "pay", "order": order, "asset": aid, "why": why})
                if guard is None:
                    out["outcome"] = "ready"
                    return out
                emit({"type": "guard", "status": "checking"})
                out["verdict"], out["latency_ms"] = guard.verify(request)
                emit({"type": "verdict", **verdict_summary(out["verdict"], out["latency_ms"], getattr(guard, "backend", None))})
                if chain is not None:
                    emit({"type": "submit", "network": "SentinelL1"})
                    site = {"name": assets.ASSETS[aid].name, "domain": assets.ASSETS[aid].domain} if aid in assets.ASSETS else None
                    out["onchain"] = chain.authorize(out["verdict"], site, item=assets.ASSETS[aid].name if aid in assets.ASSETS else "")
                    emit({"type": "onchain", **out["onchain"]})
                out["outcome"] = {"allow": "done", "needs_approval": "needs_approval", "block": "blocked"}[out["verdict"]["verdict"]]
                return out
            else:
                results.append(_tool_result(use, f"Unknown tool: {name}", error=True))
        messages.append({"role": "user", "content": results})
    return out
