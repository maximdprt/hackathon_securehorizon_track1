"""secure-agent-starter: a reference payment agent (Jarvis) with the Sentinel guard in its only money path."""
from __future__ import annotations

__version__ = "0.1.0"

from secure_agent_starter.agent import GuardedWallet, RunResult, run_scenario  # noqa: E402
from secure_agent_starter.guard import McpGuard  # noqa: E402

__all__ = ["GuardedWallet", "McpGuard", "RunResult", "run_scenario", "__version__"]
