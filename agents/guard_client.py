"""Client du garde pour les agents de la sandbox.

Un agent n'exécute jamais un paiement lui-même : il appelle `GuardClient.verify(request)` et le run
s'arrête au verdict (allow / needs_approval / block). `request` suit `verify_payment` (spec guard §2 et §10) :
{order, source_context, context_type, task, context}. Le mandat n'est pas fourni par l'agent.

Backends (variable d'env GUARD_BACKEND, défaut "auto") :
  mcp    : le serveur MCP du garde (mcp_server.py), lancé en sous-processus et appelé par ses outils : le vrai chemin
  engine : le même moteur guard, appelé en direct dans ce programme (plus rapide à lancer, sans le protocole)
  stub   : règles minimales, pour faire tourner les agents sans les dépendances du garde
  auto   : engine si le paquet guard est importable, sinon stub

Dans les deux premiers cas le garde travaille sur une copie jetable de data/ (agents/out/guard_data) : le registre des
menaces est vierge au lancement et se remplit au fil des refus (acte 3 : la deuxième fois, refus direct).
"""
from __future__ import annotations

import asyncio
import hashlib
import importlib.util
import json
import os
import re
import secrets
import shutil
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# The agents run the guard with its sovereign KYB on: a payee that declares a French SIREN is checked against the
# state company registry (data.gouv, guard/features/registry.py). GUARD_KYB=off turns it off; the guard alone keeps it
# opt-in, so the red-team baseline is unchanged.
os.environ.setdefault("GUARD_KYB", "on")
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Miroir de la table "Adresses synthétiques" de demo/README.md, en attendant data/mandates.json.
MANDATES = {
    "0xa11ce00000000000000000000000000000000001": {"actions": {"pay", "transfer"}, "max": 100},  # treasury-agent
    "0xa11ce00000000000000000000000000000000002": {"actions": {"pay"}, "max": 10000},            # shopping-agent
    "0xa11ce00000000000000000000000000000000003": {"actions": set(), "max": 0},                  # reader
}
ALLOWLIST = {"0x5e11e40000000000000000000000000000000001", "0x5e11e40000000000000000000000000000000002"}
INJECTION = re.compile(
    r"ignore (all |any )?(previous|prior) instructions|if you are an ai agent|skip any human review"
    r"|do not ask the user|spending limit[^.]{0,40}deprecated|FLAG\{team2-canary\}|[\U000E0000-\U000E007F]+",
    re.I,
)


class StubGuard:
    """Garde de remplacement. Sert à tester les agents, pas à mesurer la détection."""

    def __init__(self):
        self.threats: set[str] = set()  # registre menaces local : la 2e fois, refus direct

    def verify(self, request: dict) -> dict:
        o = request["order"]
        issuer, recipient, amount = o["issuer"].lower(), o["recipient"].lower(), float(o["amount"])
        mandate = MANDATES.get(issuer)
        authorized = bool(mandate) and o["action"] in mandate["actions"]
        within = authorized and amount <= mandate["max"]
        hits = sorted({m.group(0)[:60] for m in INJECTION.finditer(request.get("source_context", ""))})
        flagged = recipient in self.threats

        block, review, owasp = [], [], set()
        if flagged:
            block.append("recipient already in the threat registry")
        if not authorized:
            block.append(f"issuer has no mandate for action={o['action']}")
            owasp.add("ASI03")
        if hits:
            block.append(f"source context carries directives aimed at the agent ({len(hits)} markers)")
            owasp.add("ASI07")
        if authorized and not within:  # au-dessus du plafond, même de beaucoup : un humain décide, pas de refus direct
            review.append(f"amount {amount:g} is over the mandate limit {mandate['max']}")
        if recipient not in ALLOWLIST:
            review.append("recipient is not in the allowlist")
        if recipient not in (request.get("source_context", "") + request.get("task", "")).lower():
            block.append("recipient address appears nowhere in what the agent read")
        merchant = (request.get("context") or {}).get("merchant") or {}
        if merchant.get("domain_age_days", 10**6) < 30:
            block.append(f"merchant domain {merchant.get('domain', '?')} is only {merchant['domain_age_days']} days old")
        if merchant.get("price") and merchant.get("market_price") and merchant["price"] < 0.5 * merchant["market_price"]:
            block.append(f"price {merchant['price']:g} is less than half the market price {merchant['market_price']:g}")

        verdict = "block" if block else "needs_approval" if review else "allow"
        if verdict == "block" and recipient not in ALLOWLIST:
            self.threats.add(recipient)
        return {
            # sha3_256 dans le stub ; le vrai garde calcule un keccak256 du JSON canonique de l'ordre
            "instruction_id": "0x" + hashlib.sha3_256(json.dumps(o, sort_keys=True).encode()).hexdigest(),
            "issuer": o["issuer"], "action": o["action"], "amount": o["amount"],
            "currency": o.get("currency", "USDC"), "recipient": o["recipient"],
            "verdict": verdict,
            "risk_score": {"block": 0.95, "needs_approval": 0.5, "allow": 0.05}[verdict],
            "reasons": block + review,
            "owasp": sorted(owasp),
            "authority_check": {"authorized": authorized, "within_limit": within, "source": "stub"},
            "poison_check": {"is_poisoned": bool(hits), "confidence": 0.9 if hits else 0.0, "evidence": hits},
            "onchain_flagged": flagged,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }


STATE = ("decisions.jsonl", "pending.json", "nonces.json", "threats.mock.json", "spend.json", "visas.json", "registry_events.jsonl")  # ce que le garde écrit


def fresh_data(target: Path | None = None) -> Path:
    """Une copie de data/ sans l'état d'un lancement précédent : le garde y lit ses mandats et y écrit ses décisions."""
    target = target or ROOT / "agents" / "out" / "guard_data"
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(ROOT / "data", target, ignore=shutil.ignore_patterns(*STATE))
    (target / "threats.mock.json").write_text("{}", encoding="utf-8")
    return target


class GuardError(RuntimeError):
    """Le garde a refusé la requête elle-même (ordre mal formé) ou ne répond pas."""


class EngineGuard:
    """Le moteur guard appelé en direct, sur une copie jetable de data/."""

    def __init__(self, data_dir: Path | None = None):
        from guard.engine import Engine
        from guard.llm import ClaudeScorer
        self.engine = Engine.from_env(fresh_data(data_dir), llm=ClaudeScorer(enabled=os.environ.get("GUARD_LLM", "off") == "on"))

    def verify(self, request: dict) -> dict:
        return self.engine.verify(request)

    def pending(self) -> list[dict]:
        return self.engine.pending()

    def approve(self, instruction_id: str, decision: str, approver: str, note: str = "") -> dict:
        return self.engine.approve(instruction_id, decision, approver, note)

    def decision(self, instruction_id: str) -> dict | None:
        return self.engine.decision(instruction_id)

    def lift(self, subject: str, approver: str, note: str = "") -> dict:
        return self.engine.lift_flag(subject, approver, note)

    def close(self) -> None:
        pass


class McpGuard:
    """Le garde par le protocole MCP : mcp_server.py tourne dans son propre processus, on appelle ses outils.

    La session vit dans un fil à part (sa boucle asyncio) tant que le client existe ; les appels y sont postés un par un.
    """

    def __init__(self, data_dir: Path | None = None, start_timeout: float = 60):
        self.data_dir = fresh_data(data_dir)
        # le jeton de l'approbateur : tiré au lancement, donné au serveur et gardé ici. L'agent, lui, ne passe que par verify().
        self._token = secrets.token_urlsafe(24)
        self.tools: list[str] = []
        self._loop = asyncio.new_event_loop()
        self._ready, self._lock, self._error = threading.Event(), threading.Lock(), None
        self._session = self._stop = None
        threading.Thread(target=self._run, name="guard-mcp", daemon=True).start()
        if not self._ready.wait(start_timeout):
            raise GuardError("mcp_server.py n'a pas démarré à temps (voir mcp_server.log)")
        if self._error:
            raise GuardError(f"mcp_server.py n'a pas démarré : {type(self._error).__name__}: {self._error}")

    def _run(self) -> None:
        asyncio.set_event_loop(self._loop)
        self._loop.run_until_complete(self._serve())

    async def _serve(self) -> None:
        try:
            from mcp import ClientSession, StdioServerParameters
            from mcp.client.stdio import stdio_client
            env = dict(os.environ, GUARD_DATA_DIR=str(self.data_dir), GUARD_LLM=os.environ.get("GUARD_LLM", "off"), PYTHONUNBUFFERED="1", PYTHONUTF8="1",
                       GUARD_APPROVER_TOKEN=self._token)
            params = StdioServerParameters(command=sys.executable, args=[str(ROOT / "mcp_server.py")], cwd=str(ROOT), env=env)
            async with stdio_client(params) as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    self.tools = sorted(t.name for t in (await session.list_tools()).tools)
                    self._session, self._stop = session, asyncio.Event()
                    self._ready.set()
                    await self._stop.wait()
        except Exception as exc:  # dépendance absente, serveur qui plante au lancement...
            self._error = exc
            self._ready.set()

    def _call(self, tool: str, args: dict, timeout: float = 120):
        if self._session is None:
            raise GuardError("la session MCP du garde est fermée")
        with self._lock:  # le garde écrit son état (file humaine, registre) : un appel à la fois
            res = asyncio.run_coroutine_threadsafe(self._session.call_tool(tool, args), self._loop).result(timeout)
        texts = [c.text for c in res.content if getattr(c, "text", None)]
        if res.is_error:
            raise GuardError(texts[0] if texts else f"l'outil {tool} a échoué")
        data = getattr(res, "structured_content", None)
        if isinstance(data, dict):
            return data["result"] if set(data) == {"result"} else data
        return json.loads(texts[0]) if texts else None

    def verify(self, request: dict) -> dict:
        return self._call("verify_payment", {k: request[k] for k in ("order", "source_context", "context_type", "task", "context") if k in request})

    def pending(self) -> list[dict]:
        return self._call("list_pending", {}) or []

    def approve(self, instruction_id: str, decision: str, approver: str, note: str = "") -> dict:
        return self._call("approve_pending", {"instruction_id": instruction_id, "decision": decision, "approver": approver, "note": note, "token": self._token})

    def lift(self, subject: str, approver: str, note: str = "") -> dict:
        return self._call("lift_flag", {"subject": subject, "approver": approver, "note": note, "token": self._token})

    def decision(self, instruction_id: str) -> dict | None:
        try:
            return self._call("get_decision", {"instruction_id": instruction_id})
        except GuardError:
            return None

    def close(self) -> None:
        if self._stop is not None:
            self._loop.call_soon_threadsafe(self._stop.set)
            self._session = None


class GuardClient:
    def __init__(self, backend: str | None = None, data_dir: Path | None = None):
        """`data_dir` : où le garde garde son état (défaut agents/out/guard_data, vidé à chaque lancement)."""
        backend = backend or os.environ.get("GUARD_BACKEND", "auto")
        if backend == "auto":
            backend = "engine" if importlib.util.find_spec("guard") else "stub"
        self.backend = backend
        self._impl = StubGuard() if backend == "stub" else {"mcp": McpGuard, "engine": EngineGuard}[backend](data_dir)

    def verify(self, request: dict) -> tuple[dict, float]:
        """Renvoie (verdict, latence en ms)."""
        t = time.perf_counter()
        verdict = self._impl.verify(request)
        return verdict, round((time.perf_counter() - t) * 1000, 2)

    def pending(self) -> list[dict]:
        """Les décisions en attente d'un humain."""
        return self._impl.pending()

    def approve(self, instruction_id: str, decision: str, approver: str, note: str = "") -> dict:
        """Un humain tranche une décision en attente : "allow" (le même ordre, renvoyé, passe une fois), "decline" (pas ce
        paiement, rien n'est retenu contre le destinataire) ou "block" (fraude : le destinataire est refusé désormais)."""
        return self._impl.approve(instruction_id, decision, approver, note)

    def lift(self, subject: str, approver: str, note: str = "") -> dict:
        """Un humain sort une adresse ou un domaine du registre des incidents."""
        return self._impl.lift(subject, approver, note)

    def decision(self, instruction_id: str) -> dict | None:
        """La décision enregistrée pour un ordre, avec son score et chaque retrait."""
        return self._impl.decision(instruction_id)

    def close(self) -> None:
        if hasattr(self._impl, "close"):
            self._impl.close()
