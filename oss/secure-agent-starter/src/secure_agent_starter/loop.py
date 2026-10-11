"""The tool loop. One message format inside (Bedrock Converse), adapters at the edge: the loop never knows which model
runs, so the same agent plays with Claude on the Anthropic API, Claude on Bedrock, or the keyless scripted agent.

Converse shapes: {"text"}, {"toolUse": {toolUseId, name, input}}, {"toolResult": {toolUseId, content, status}}.
"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Protocol

log = logging.getLogger("secure_agent_starter.loop")


@dataclass
class Tool:
    name: str
    description: str
    schema: dict[str, Any]       # JSON schema of the input
    fn: Callable[..., Any]       # fn(**input) -> JSON-serialisable result

    def spec(self) -> dict:
        """Converse toolSpec (inner shape); each adapter wraps or translates it."""
        return {"name": self.name, "description": self.description, "inputSchema": {"json": self.schema}}


@dataclass
class Reply:
    message: dict                # Converse assistant message {"role": "assistant", "content": [...]}
    stop_reason: str = ""        # tool_use | end_turn | max_tokens | refusal | ...


class LLM(Protocol):
    name: str
    model: str

    def complete(self, system: str, messages: list[dict], tools: list[dict]) -> Reply: ...


@dataclass
class AgentRun:
    llm: str
    model: str
    task: str
    trace: list[dict] = field(default_factory=list)   # tool calls and results, in order
    turns: int = 0
    final_text: str = ""
    stop_reason: str = ""
    elapsed_s: float = 0.0
    error: str | None = None

    def to_dict(self) -> dict:
        return {"llm": self.llm, "model": self.model, "task": self.task, "turns": self.turns, "stop_reason": self.stop_reason,
                "elapsed_s": round(self.elapsed_s, 2), "final_text": self.final_text, "trace": self.trace, "error": self.error}


def texts(message: dict) -> list[str]:
    return [c["text"] for c in message.get("content", []) if isinstance(c.get("text"), str) and c["text"].strip()]


def tool_uses(message: dict) -> list[dict]:
    return [c["toolUse"] for c in message.get("content", []) if "toolUse" in c]


def result_block(tool_use_id: str, out: Any, status: str = "success") -> dict:
    content = [{"json": out}] if isinstance(out, dict) else [{"text": out if isinstance(out, str) else json.dumps(out, default=str)}]
    return {"toolResult": {"toolUseId": tool_use_id, "content": content, "status": status}}


def run_agent(llm: LLM, system: str, task: str, tools: list[Tool], max_turns: int = 12,
              on_event: Callable[[str, dict], None] | None = None) -> AgentRun:
    """Run until the model answers without a tool call, or max_turns. Never raises: a failure lands in `error`."""
    by_name = {t.name: t for t in tools}
    specs = [t.spec() for t in tools]
    run = AgentRun(llm=llm.name, model=llm.model, task=task)
    messages: list[dict] = [{"role": "user", "content": [{"text": task}]}]
    emit = on_event or (lambda kind, data: None)
    t0 = time.perf_counter()
    try:
        for turn in range(1, max_turns + 1):
            run.turns = turn
            reply = llm.complete(system, messages, specs)
            msg = {"role": "assistant", "content": list(reply.message.get("content", []))}
            messages.append(msg)
            said, calls = texts(msg), tool_uses(msg)
            run.stop_reason = reply.stop_reason or ("tool_use" if calls else "end_turn")
            for t in said if calls else []:  # a turn without tool call is the final answer, reported once by the caller
                emit("thought", {"turn": turn, "text": t})
            if not calls:
                run.final_text = "\n".join(said) or ("(the model declined to continue)" if run.stop_reason == "refusal" else "")
                break
            results = []
            for tu in calls:
                name, inp = tu["name"], tu.get("input") or {}
                emit("tool_call", {"turn": turn, "tool": name, "input": inp})
                status = "success"
                try:
                    if name not in by_name:
                        out, status = {"error": f"unknown tool {name!r}"}, "error"
                    else:
                        out = by_name[name].fn(**inp)
                except TypeError as e:  # the model sent arguments the tool does not take
                    out, status = {"error": f"bad arguments for {name}: {e}"}, "error"
                except Exception as e:  # a tool crashed: the agent must know, the loop must go on
                    out, status = {"error": f"{type(e).__name__}: {e}"}, "error"
                emit("tool_result", {"turn": turn, "tool": name, "input": inp, "result": out, "status": status})
                run.trace.append({"turn": turn, "tool": name, "input": inp, "result": out, "status": status})
                results.append(result_block(tu["toolUseId"], out, status))
            messages.append({"role": "user", "content": results})
        else:
            run.final_text = "(stopped: max turns reached)"
    except Exception as e:
        run.error = f"{type(e).__name__}: {e}"
        log.error("agent loop failed: %s", run.error)
    run.elapsed_s = time.perf_counter() - t0
    return run
