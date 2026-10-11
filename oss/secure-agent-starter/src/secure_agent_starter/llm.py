"""LLM adapters for the tool loop. The loop speaks Converse; each adapter translates at the edge.

No `temperature` is sent: recent Claude models reject sampling parameters, and the defaults are fine for an agent.
Provider SDKs are optional extras, imported only when that adapter is built.
"""
from __future__ import annotations

import json
import os
from importlib.util import find_spec
from pathlib import Path
from typing import Any

from secure_agent_starter.loop import LLM, Reply

DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5"
DEFAULT_BEDROCK_MODEL = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
MAX_TOKENS = 16000


# ----- Converse <-> Anthropic Messages API (pure functions, unit-tested without network) -----
def to_anthropic_tools(specs: list[dict]) -> list[dict]:
    return [{"name": s["name"], "description": s.get("description", ""), "input_schema": s["inputSchema"]["json"]} for s in specs]


def _result_content(content: list[dict]) -> list[dict]:
    """The Messages API has no json block: a Converse {"json": x} becomes text. Empty text is rejected, so never send it."""
    out = []
    for c in content:
        if "json" in c:
            out.append({"type": "text", "text": json.dumps(c["json"], ensure_ascii=False, default=str)})
        elif isinstance(c.get("text"), str) and c["text"]:
            out.append({"type": "text", "text": c["text"]})
    return out or [{"type": "text", "text": "(empty)"}]


def to_anthropic_messages(messages: list[dict]) -> list[dict]:
    out = []
    for m in messages:
        blocks: list[dict] = []
        for c in m.get("content", []):
            if "toolUse" in c:
                tu = c["toolUse"]
                blocks.append({"type": "tool_use", "id": tu["toolUseId"], "name": tu["name"], "input": tu.get("input") or {}})
            elif "toolResult" in c:
                tr = c["toolResult"]
                b = {"type": "tool_result", "tool_use_id": tr["toolUseId"], "content": _result_content(tr.get("content", []))}
                if tr.get("status") == "error":
                    b["is_error"] = True
                blocks.append(b)
            elif "anthropic" in c:
                blocks.append(c["anthropic"])  # thinking blocks go back unchanged, as the API requires
            elif isinstance(c.get("text"), str) and c["text"].strip():
                blocks.append({"type": "text", "text": c["text"]})
        if blocks:
            out.append({"role": m["role"], "content": blocks})
    return out


def _dump(block: Any) -> dict:
    for attr in ("to_dict", "model_dump"):
        fn = getattr(block, attr, None)
        if callable(fn):
            return fn()
    return dict(block) if isinstance(block, dict) else {"type": getattr(block, "type", "unknown")}


def from_anthropic_response(resp: Any) -> Reply:
    content: list[dict] = []
    for b in resp.content:
        kind = getattr(b, "type", None)
        if kind == "text":
            content.append({"text": b.text})
        elif kind == "tool_use":
            content.append({"toolUse": {"toolUseId": b.id, "name": b.name, "input": dict(b.input or {})}})
        else:  # thinking, redacted_thinking...: kept opaque so the next request can echo them
            content.append({"anthropic": _dump(b)})
    return Reply({"role": "assistant", "content": content}, getattr(resp, "stop_reason", "") or "")


def to_converse_messages(messages: list[dict]) -> list[dict]:
    """Strip what Bedrock Converse does not accept: Anthropic-only blocks and blank text."""
    out = []
    for m in messages:
        blocks = [c for c in m.get("content", []) if "anthropic" not in c and not ("text" in c and not str(c["text"]).strip())]
        if blocks:
            out.append({"role": m["role"], "content": blocks})
    return out


# ----- adapters -----
class AnthropicLLM:
    name = "anthropic"

    def __init__(self, model: str | None = None, max_tokens: int = MAX_TOKENS, client: Any = None):
        if client is None:
            try:
                import anthropic
            except ImportError as e:
                raise RuntimeError("the anthropic SDK is not installed: pip install 'secure-agent-starter[anthropic]'") from e
            client = anthropic.Anthropic()
        self.client, self.model, self.max_tokens = client, model or DEFAULT_ANTHROPIC_MODEL, max_tokens

    def complete(self, system: str, messages: list[dict], tools: list[dict]) -> Reply:
        kw: dict[str, Any] = {"model": self.model, "max_tokens": self.max_tokens, "system": system, "messages": to_anthropic_messages(messages)}
        if tools:
            kw["tools"] = to_anthropic_tools(tools)
        return from_anthropic_response(self.client.messages.create(**kw))


class BedrockLLM:
    name = "bedrock"

    def __init__(self, model: str | None = None, region: str | None = None, max_tokens: int = MAX_TOKENS, client: Any = None):
        self.model, self.max_tokens = model or DEFAULT_BEDROCK_MODEL, max_tokens
        self.region = region or os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION") or "us-west-2"
        if client is None:
            try:
                import boto3
            except ImportError as e:
                raise RuntimeError("boto3 is not installed: pip install 'secure-agent-starter[bedrock]'") from e
            client = boto3.client("bedrock-runtime", region_name=self.region)
        self.client = client

    def complete(self, system: str, messages: list[dict], tools: list[dict]) -> Reply:
        kw: dict[str, Any] = {"modelId": self.model, "system": [{"text": system}], "messages": to_converse_messages(messages),
                              "inferenceConfig": {"maxTokens": self.max_tokens}}
        if tools:
            kw["toolConfig"] = {"tools": [{"toolSpec": t} for t in tools]}
        resp = self.client.converse(**kw)
        return Reply(resp["output"]["message"], resp.get("stopReason", ""))


# ----- auto-pick: anthropic if a key is set, else bedrock if AWS credentials are visible, else scripted -----
def anthropic_ready(environ: dict | None = None) -> bool:
    env = os.environ if environ is None else environ
    return bool(env.get("ANTHROPIC_API_KEY") or env.get("ANTHROPIC_AUTH_TOKEN")) and find_spec("anthropic") is not None


def aws_ready(environ: dict | None = None) -> bool:
    env = os.environ if environ is None else environ
    if find_spec("boto3") is None:
        return False
    keys = ("AWS_ACCESS_KEY_ID", "AWS_PROFILE", "AWS_WEB_IDENTITY_TOKEN_FILE", "AWS_CONTAINER_CREDENTIALS_FULL_URI",
            "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI")
    return any(env.get(k) for k in keys) or (Path(env.get("HOME") or "~").expanduser() / ".aws" / "credentials").is_file()


def resolve_kind(kind: str = "auto", environ: dict | None = None) -> str:
    if kind != "auto":
        return kind
    return "anthropic" if anthropic_ready(environ) else "bedrock" if aws_ready(environ) else "scripted"


def make_llm(kind: str = "auto", model: str | None = None) -> LLM:
    kind = resolve_kind(kind)
    if kind == "anthropic":
        return AnthropicLLM(model)
    if kind == "bedrock":
        return BedrockLLM(model)
    if kind == "scripted":
        from secure_agent_starter.scripted import ScriptedLLM
        return ScriptedLLM()
    raise ValueError(f"unknown llm {kind!r}: auto, anthropic, bedrock or scripted")
