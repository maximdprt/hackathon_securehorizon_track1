"""Shared fixtures. Tests never touch the network: the guard is the local fake MCP server unless a test opts into the
real sentinel_guard (and skips when it is not installed)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

from secure_agent_starter.guard import McpGuard
from secure_agent_starter.world import load_scenario, scenario_names

FAKE = Path(__file__).resolve().parent / "fake_guard.py"
CASES = [(s, v) for s in scenario_names() for v in load_scenario(s)["variants"]]


@pytest.fixture(autouse=True)
def _no_llm_keys(monkeypatch):
    """No test may reach a real model or the hosted API by accident."""
    for k in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "SENTINEL_API_KEY", "SENTINEL_GUARD_COMMAND", "SENTINEL_LLM"):
        monkeypatch.delenv(k, raising=False)


@pytest.fixture
def fake_log(tmp_path, monkeypatch) -> Path:
    log = tmp_path / "fake_guard.jsonl"
    monkeypatch.setenv("FAKE_GUARD_LOG", str(log))
    return log


def read_log(log: Path) -> list[dict]:
    return [json.loads(x) for x in log.read_text().splitlines()] if log.exists() else []


@pytest.fixture
def fake_guard(fake_log):
    """Factory: an McpGuard spawning the fake server, closed after the test."""
    made: list[McpGuard] = []

    def make(connected: bool = False, **kw) -> McpGuard:
        g = McpGuard(connected=connected, command=[sys.executable, str(FAKE)], timeout=30, **kw)
        g.env["FAKE_GUARD_LOG"] = str(fake_log)  # the MCP client passes only a safe env baseline plus g.env
        made.append(g)
        return g

    yield make
    for g in made:
        g.close()
