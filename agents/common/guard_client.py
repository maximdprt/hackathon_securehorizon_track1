"""Le garde vu depuis l'agent. Deux transports :
- inproc : importe guard.engine directement (rapide, pour les tests et la démo locale)
- mcp    : lance mcp_server.py en sous-processus stdio et appelle l'outil verify_payment (le vrai chemin de prod)

Dans les deux cas l'agent ne choisit pas : l'outil `pay` passe par ici avant de toucher au wallet.
"""
from __future__ import annotations

import asyncio
import os
import shutil
import sys
import threading
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = Path(os.environ.get("AGENTS_OUT_DIR") or ROOT / "agents" / "out")   # Lambda : AGENTS_OUT_DIR=/tmp/agents_out


class GuardClient:
    def __init__(self, transport: str = "inproc", data_dir: str | Path | None = None, llm: bool = False, isolate: bool = True):
        self.transport = transport
        self.llm = llm
        self.data_dir = self._prepare_data(data_dir, isolate)
        self.calls: list[dict] = []
        self.label: dict = {}            # {"expected": "block", "family": "E"} posé par le scénario joué
        self.payload_log = OUT_DIR / "payloads.jsonl"
        if transport == "inproc":
            sys.path.insert(0, str(ROOT))
            from guard.engine import Engine
            from guard.llm import ClaudeScorer
            self.engine = Engine.from_env(data_dir=self.data_dir, llm=ClaudeScorer(enabled=llm))
        elif transport == "mcp":
            self._start_mcp()
        else:
            raise ValueError("transport must be inproc or mcp")

    @staticmethod
    def _prepare_data(data_dir, isolate) -> Path:
        """Par défaut : copie jetable de data/ (registre menaces vierge) pour ne pas polluer l'état du garde."""
        if data_dir:
            return Path(data_dir)
        if not isolate:
            return ROOT / "data"
        tmp = OUT_DIR / "data"
        if tmp.exists():
            shutil.rmtree(tmp)
        shutil.copytree(ROOT / "data", tmp, ignore=shutil.ignore_patterns("decisions.jsonl", "pending.json", "nonces.json"))
        (tmp / "threats.mock.json").write_text("{}")
        return tmp

    # ---------- MCP stdio ----------
    def _start_mcp(self):
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client
        self._loop = asyncio.new_event_loop()
        self._ready = threading.Event()
        env = dict(os.environ, GUARD_DATA_DIR=str(self.data_dir), GUARD_LLM="on" if self.llm else "off")
        params = StdioServerParameters(command=sys.executable, args=[str(ROOT / "mcp_server.py")], env=env, cwd=str(ROOT))

        async def main():
            async with stdio_client(params) as (r, w):
                async with ClientSession(r, w) as session:
                    await session.initialize()
                    self._session = session
                    self._ready.set()
                    await self._stop.wait()

        self._stop = None

        def runner():
            asyncio.set_event_loop(self._loop)
            self._stop = asyncio.Event()
            self._loop.run_until_complete(main())

        self._thread = threading.Thread(target=runner, daemon=True)
        self._thread.start()
        if not self._ready.wait(30):
            raise RuntimeError("mcp_server.py did not start in 30s (see mcp_server.log)")

    def _mcp_call(self, name: str, args: dict) -> dict:
        async def call():
            res = await self._session.call_tool(name, args)
            for c in res.content:
                if getattr(c, "text", None):
                    import json
                    return json.loads(c.text)
            return {"error": "empty MCP response"}
        return asyncio.run_coroutine_threadsafe(call(), self._loop).result(timeout=120)

    # ---------- API commune ----------
    def verify(self, order: dict, source_context: str = "", context_type: str = "text", task: str = "", context: dict | None = None) -> dict:
        args = {"order": order, "source_context": source_context, "context_type": context_type, "task": task, "context": context or {}}
        out = self.engine.verify(args) if self.transport == "inproc" else self._mcp_call("verify_payment", args)
        self.calls.append({"order": order, "verdict": out.get("verdict"), "risk": out.get("risk_score"), "trust": out.get("trust_score"),
                           "severity": out.get("severity"), "instruction_id": out.get("instruction_id"), "reasons": out.get("reasons", [])[:8],
                           "latency_ms": out.get("latency_ms")})
        try:  # une ligne par appel, pour redteam/calibrate.py --extra agents/out/payloads.jsonl
            import json
            self.payload_log.parent.mkdir(parents=True, exist_ok=True)
            with self.payload_log.open("a") as f:
                f.write(json.dumps({"request": args, "verdict": out, "expected": self.label.get("expected"), "family": self.label.get("family"),
                                    "agent": self.label.get("agent"), "ts": __import__("time").strftime("%Y-%m-%dT%H:%M:%S")}, ensure_ascii=False, default=str) + "\n")
        except Exception:
            pass
        return out

    def pending(self) -> list[dict]:
        return self.engine.pending() if self.transport == "inproc" else self._mcp_call("list_pending", {})

    def is_flagged(self, key: str) -> bool:
        if self.transport == "inproc":
            return bool(self.engine.source.is_flagged(key)[0])
        import json
        p = self.data_dir / "threats.mock.json"
        return bool(json.loads(p.read_text()).get(key.lower(), {}).get("flagged")) if p.exists() else False

    def close(self):
        if self.transport == "mcp" and getattr(self, "_stop", None):
            self._loop.call_soon_threadsafe(self._stop.set)
            self._thread.join(timeout=5)
