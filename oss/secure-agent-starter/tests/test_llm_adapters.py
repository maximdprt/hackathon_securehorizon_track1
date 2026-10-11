"""Converse <-> Anthropic Messages translation, Bedrock request shape and the auto-pick, all without network."""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from secure_agent_starter.llm import (DEFAULT_ANTHROPIC_MODEL, DEFAULT_BEDROCK_MODEL, AnthropicLLM, BedrockLLM, from_anthropic_response,
                                      resolve_kind, to_anthropic_messages, to_anthropic_tools, to_converse_messages)
from secure_agent_starter.loop import Tool, run_agent

SPEC = {"name": "pay", "description": "Pay USDC.", "inputSchema": {"json": {"type": "object", "properties": {"amount": {"type": "number"}}, "required": ["amount"]}}}


def test_tools_translate_to_input_schema():
    assert to_anthropic_tools([SPEC]) == [{"name": "pay", "description": "Pay USDC.", "input_schema": SPEC["inputSchema"]["json"]}]


def test_messages_translate_both_ways_of_a_tool_round():
    thinking = {"type": "thinking", "thinking": "", "signature": "sig"}
    conv = [
        {"role": "user", "content": [{"text": "buy it"}]},
        {"role": "assistant", "content": [{"anthropic": thinking}, {"text": "  "}, {"text": "paying"},
                                          {"toolUse": {"toolUseId": "t1", "name": "pay", "input": {"amount": 5}}}]},
        {"role": "user", "content": [{"toolResult": {"toolUseId": "t1", "content": [{"json": {"status": "refused"}}], "status": "error"}},
                                     {"toolResult": {"toolUseId": "t2", "content": [{"text": ""}], "status": "success"}}]},
    ]
    out = to_anthropic_messages(conv)
    assert out[0] == {"role": "user", "content": [{"type": "text", "text": "buy it"}]}
    assert out[1]["content"] == [thinking, {"type": "text", "text": "paying"},  # blank text dropped, thinking echoed unchanged
                                 {"type": "tool_use", "id": "t1", "name": "pay", "input": {"amount": 5}}]
    r1, r2 = out[2]["content"]
    assert r1 == {"type": "tool_result", "tool_use_id": "t1", "content": [{"type": "text", "text": '{"status": "refused"}'}], "is_error": True}
    assert r2["content"] == [{"type": "text", "text": "(empty)"}] and "is_error" not in r2


def test_response_translates_to_converse():
    class Thinking(SimpleNamespace):
        def to_dict(self):
            return {"type": "thinking", "thinking": "", "signature": "s"}
    resp = SimpleNamespace(stop_reason="tool_use", content=[
        Thinking(type="thinking"), SimpleNamespace(type="text", text="ok"),
        SimpleNamespace(type="tool_use", id="toolu_1", name="pay", input={"amount": 1})])
    reply = from_anthropic_response(resp)
    assert reply.stop_reason == "tool_use"
    assert reply.message == {"role": "assistant", "content": [{"anthropic": {"type": "thinking", "thinking": "", "signature": "s"}},
                                                              {"text": "ok"}, {"toolUse": {"toolUseId": "toolu_1", "name": "pay", "input": {"amount": 1}}}]}


class FakeMessages:
    def __init__(self, replies):
        self.replies, self.calls = list(replies), []

    def create(self, **kw):
        self.calls.append(kw)
        return self.replies.pop(0)


def test_anthropic_loop_round_trip_without_temperature():
    msgs = FakeMessages([
        SimpleNamespace(stop_reason="tool_use", content=[SimpleNamespace(type="tool_use", id="toolu_9", name="pay", input={"amount": 2})]),
        SimpleNamespace(stop_reason="end_turn", content=[SimpleNamespace(type="text", text="done")]),
    ])
    llm = AnthropicLLM(client=SimpleNamespace(messages=msgs))
    paid = []
    run = run_agent(llm, "sys", "pay 2", [Tool("pay", "Pay USDC.", SPEC["inputSchema"]["json"], lambda amount: paid.append(amount) or {"status": "executed"})])
    assert run.final_text == "done" and paid == [2] and run.error is None
    first, second = msgs.calls
    assert first["model"] == DEFAULT_ANTHROPIC_MODEL == "claude-haiku-4-5"
    assert "temperature" not in first and first["system"] == "sys" and first["tools"][0]["input_schema"]["required"] == ["amount"]
    tr = second["messages"][-1]["content"][0]
    assert tr["type"] == "tool_result" and tr["tool_use_id"] == "toolu_9" and '"executed"' in tr["content"][0]["text"]


def test_bedrock_request_shape():
    calls = []

    class Client:
        def converse(self, **kw):
            calls.append(kw)
            return {"output": {"message": {"role": "assistant", "content": [{"text": "hi"}]}}, "stopReason": "end_turn"}

    llm = BedrockLLM(client=Client(), region="us-west-2")
    reply = llm.complete("sys", [{"role": "user", "content": [{"text": "x"}]},
                                 {"role": "assistant", "content": [{"anthropic": {"type": "thinking"}}, {"text": "y"}]}], [SPEC])
    kw = calls[0]
    assert kw["modelId"] == DEFAULT_BEDROCK_MODEL and kw["system"] == [{"text": "sys"}]
    assert kw["toolConfig"] == {"tools": [{"toolSpec": SPEC}]} and kw["inferenceConfig"] == {"maxTokens": llm.max_tokens}
    assert kw["messages"][1] == {"role": "assistant", "content": [{"text": "y"}]}  # Anthropic-only blocks stripped
    assert reply.stop_reason == "end_turn"


def test_converse_strip_drops_blank_turns():
    assert to_converse_messages([{"role": "assistant", "content": [{"text": " "}]}]) == []


def test_auto_pick_order(tmp_path):
    home = {"HOME": str(tmp_path)}
    assert resolve_kind("auto", home) in ("scripted", "bedrock")
    assert resolve_kind("scripted", {"ANTHROPIC_API_KEY": "k"}) == "scripted"
    pytest.importorskip("anthropic")
    assert resolve_kind("auto", {**home, "ANTHROPIC_API_KEY": "k", "AWS_ACCESS_KEY_ID": "a"}) == "anthropic"


def test_auto_pick_without_any_credential_is_scripted(tmp_path, monkeypatch):
    import secure_agent_starter.llm as L
    monkeypatch.setattr(L, "find_spec", lambda name: object())  # pretend both SDKs are installed
    assert resolve_kind("auto", {"HOME": str(tmp_path)}) == "scripted"
    assert resolve_kind("auto", {"HOME": str(tmp_path), "AWS_PROFILE": "demo"}) == "bedrock"
