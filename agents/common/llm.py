"""Boucle d'agent Bedrock (Converse API + tool use). Générique : les agents déclarent leurs outils, la boucle fait le reste.

Un agent = un system prompt + une tâche + des outils Python. Chaque appel d'outil est journalisé dans `trace`.
"""
from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any, Callable

import boto3

log = logging.getLogger("agents.llm")
REGION = os.environ.get("AWS_REGION", "us-west-2")
DEFAULT_MODEL = os.environ.get("AGENT_MODEL_ID", "us.anthropic.claude-haiku-4-5-20251001-v1:0")


@dataclass
class Tool:
    name: str
    description: str
    schema: dict[str, Any]          # JSON schema de l'input
    fn: Callable[..., Any]          # fn(**input) -> résultat sérialisable

    def spec(self) -> dict:
        return {"toolSpec": {"name": self.name, "description": self.description, "inputSchema": {"json": self.schema}}}


@dataclass
class AgentRun:
    model: str
    system: str
    task: str
    trace: list[dict] = field(default_factory=list)   # tool calls + résultats, dans l'ordre
    turns: int = 0
    final_text: str = ""
    stop_reason: str = ""
    elapsed_s: float = 0.0
    error: str | None = None

    def to_dict(self) -> dict:
        return {"model": self.model, "task": self.task, "turns": self.turns, "stop_reason": self.stop_reason,
                "elapsed_s": round(self.elapsed_s, 2), "final_text": self.final_text, "trace": self.trace, "error": self.error}


def _short(x: Any, n: int = 300) -> str:
    s = x if isinstance(x, str) else json.dumps(x, ensure_ascii=False, default=str)
    return s if len(s) <= n else s[:n] + "…"


def run_agent(system: str, task: str, tools: list[Tool], model: str = DEFAULT_MODEL, max_turns: int = 12,
              on_event: Callable[[str, dict], None] | None = None, max_tokens: int = 1200) -> AgentRun:
    """Fait tourner l'agent jusqu'à ce qu'il réponde sans outil, ou max_turns. Ne lève jamais : `error` est rempli."""
    client = boto3.client("bedrock-runtime", region_name=REGION)
    by_name = {t.name: t for t in tools}
    run = AgentRun(model=model, system=system, task=task)
    messages: list[dict] = [{"role": "user", "content": [{"text": task}]}]
    emit = on_event or (lambda kind, data: None)
    t0 = time.perf_counter()
    try:
        for turn in range(1, max_turns + 1):
            run.turns = turn
            resp = client.converse(modelId=model, system=[{"text": system}], messages=messages,
                                   toolConfig={"tools": [t.spec() for t in tools]},
                                   inferenceConfig={"maxTokens": max_tokens, "temperature": 0.2})
            msg = resp["output"]["message"]
            messages.append(msg)
            run.stop_reason = resp.get("stopReason", "")
            texts = [c["text"] for c in msg["content"] if "text" in c]
            for t in texts:
                emit("thought", {"turn": turn, "text": t})
            if run.stop_reason != "tool_use":
                run.final_text = "\n".join(texts)
                break
            results = []
            for c in msg["content"]:
                if "toolUse" not in c:
                    continue
                tu = c["toolUse"]
                name, inp = tu["name"], tu.get("input") or {}
                emit("tool_call", {"turn": turn, "tool": name, "input": inp})
                try:
                    out = by_name[name].fn(**inp) if name in by_name else {"error": f"unknown tool {name}"}
                    status = "success"
                except Exception as e:  # l'outil a planté : l'agent doit le savoir, pas la boucle
                    out, status = {"error": f"{type(e).__name__}: {e}"}, "error"
                emit("tool_result", {"turn": turn, "tool": name, "result": out, "status": status})
                run.trace.append({"turn": turn, "tool": name, "input": inp, "result": out, "status": status})
                content = [{"json": out}] if isinstance(out, (dict, list)) else [{"text": str(out)}]
                results.append({"toolResult": {"toolUseId": tu["toolUseId"], "content": content, "status": status}})
            messages.append({"role": "user", "content": results})
        else:
            run.final_text = "(max_turns atteint)"
    except Exception as e:
        run.error = f"{type(e).__name__}: {e}"
        log.error("agent loop failed: %s", run.error)
    run.elapsed_s = time.perf_counter() - t0
    return run
