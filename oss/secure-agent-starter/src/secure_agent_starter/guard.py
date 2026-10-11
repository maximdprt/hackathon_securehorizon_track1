"""The wallet's only link to the guard: an MCP stdio client to `python -m sentinel_guard`.

The guard is its own process, launched with the starter's operator config (SENTINEL_CONFIG_DIR) and a per-run state dir
(SENTINEL_STATE_DIR), so verdicts do not depend on the guard's bundled samples or on what an earlier run left behind.
Connected (the default) calls `authorize_payment`, which also records the decision on SentinelL1 through the hosted API;
offline calls `screen_payment` and nothing leaves the machine. The MCP session lives in a background event loop, so the
synchronous agent loop and the wallet can call the guard like a plain function.
"""
from __future__ import annotations

import asyncio
import concurrent.futures
import json
import os
import shlex
import shutil
import sys
import tempfile
import threading
from pathlib import Path
from typing import Any, Protocol, TextIO

PKG = Path(__file__).resolve().parent
CONFIG_DIR = PKG / "guard_config"
DEFAULT_API = "https://rpc.petroi.fr"
DEFAULT_CITY = "https://city.petroi.fr/?live=1"
KEPT_STATE = Path("~/.secure-agent-starter/state").expanduser()
# what the user may set for the guard; config dir, state dir and mode are always set by the starter
PASS_THROUGH = ("SENTINEL_API", "SENTINEL_API_KEY", "SENTINEL_EXPLORER", "SENTINEL_LLM", "SENTINEL_LLM_MODEL",
                "SENTINEL_LLM_TIMEOUT", "SENTINEL_AMOUNT_DECIMALS", "SENTINEL_CANARY")
LLM_CREDENTIALS = ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY",
                   "AWS_SESSION_TOKEN", "AWS_REGION", "AWS_DEFAULT_REGION", "AWS_PROFILE")


class GuardError(RuntimeError):
    pass


class Guard(Protocol):
    connected: bool
    tool: str

    def check(self, args: dict[str, Any]) -> dict: ...

    def close(self) -> None: ...


def _set(v: str | None) -> bool:
    """An empty value, or a `${VAR}` placeholder some MCP hosts leave unresolved, counts as unset."""
    return bool(v) and not (v.startswith("${") and v.endswith("}"))


def guard_command(environ: dict | None = None) -> list[str]:
    env = os.environ if environ is None else environ
    custom = env.get("SENTINEL_GUARD_COMMAND", "")
    return shlex.split(custom) if _set(custom) else [sys.executable, "-m", "sentinel_guard"]


def guard_env(connected: bool, config_dir: Path, state_dir: Path, environ: dict | None = None) -> dict[str, str]:
    src = os.environ if environ is None else environ
    env = {k: src[k] for k in PASS_THROUGH if _set(src.get(k))}
    if env.get("SENTINEL_LLM", "off").lower() not in ("", "off", "0", "false"):
        env.update({k: src[k] for k in LLM_CREDENTIALS if _set(src.get(k))})
    env["SENTINEL_CONFIG_DIR"], env["SENTINEL_STATE_DIR"] = str(config_dir), str(state_dir)
    if connected:
        env["SENTINEL_MODE"] = "connected"
        env.setdefault("SENTINEL_API", DEFAULT_API)
    else:  # SENTINEL_API=off forces local-only whatever else is set: nothing leaves the machine
        env["SENTINEL_MODE"], env["SENTINEL_API"] = "local", "off"
        env.pop("SENTINEL_API_KEY", None)
    return env


def parse_result(res: Any) -> dict:
    """A verdict is a successful tool result (block included). is_error only means a malformed request or a crash."""
    text = " ".join(getattr(c, "text", "") for c in (getattr(res, "content", None) or []) if getattr(c, "text", None))
    if getattr(res, "is_error", False):
        raise GuardError(text or "the guard returned an error")
    sc = getattr(res, "structured_content", None)
    if isinstance(sc, dict) and set(sc) == {"result"} and isinstance(sc["result"], dict):
        sc = sc["result"]
    if not isinstance(sc, dict) or "verdict" not in sc:
        try:
            sc = json.loads(text)
        except ValueError as e:
            raise GuardError(f"unreadable guard result: {text[:200]!r}") from e
    if not isinstance(sc, dict) or sc.get("verdict") not in ("allow", "needs_approval", "block"):
        raise GuardError(f"guard result has no valid verdict: {str(sc)[:200]}")
    return sc


class McpGuard:
    """One guard process for the whole run: replay protection and the local registry hold across payments."""

    def __init__(self, connected: bool = True, config_dir: str | Path | None = None, state_dir: str | Path | None = None,
                 command: list[str] | None = None, timeout: float = 90.0, environ: dict | None = None):
        self.connected = connected
        self.tool = "authorize_payment" if connected else "screen_payment"
        self.config_dir = Path(config_dir or CONFIG_DIR).resolve()
        self._own_state = state_dir is None
        self.state_dir = Path(state_dir).expanduser().resolve() if state_dir else Path(tempfile.mkdtemp(prefix="secure-agent-state-"))
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.command = command or guard_command(environ)
        self.env = guard_env(connected, self.config_dir, self.state_dir, environ)
        self.timeout = timeout
        self.log_path = self.state_dir / "guard-stderr.log"
        self._thread: threading.Thread | None = None
        self._ready = threading.Event()
        self._start_lock = threading.Lock()  # wallet-mcp tools run in worker threads: start the process once
        self._loop: asyncio.AbstractEventLoop | None = None
        self._queue: asyncio.Queue | None = None
        self._error: BaseException | None = None
        self._log: TextIO | None = None
        self.tools: list[str] = []

    # ----- lifecycle -----
    def start(self) -> "McpGuard":
        with self._start_lock:
            if self._thread is None:
                self._log = self.log_path.open("a", encoding="utf-8")
                self._thread = threading.Thread(target=lambda: asyncio.run(self._main()), name="sentinel-guard-client", daemon=True)
                self._thread.start()
            if not self._ready.wait(self.timeout):
                self._error = self._error or GuardError(f"the guard did not start within {self.timeout:g} s")
        if self._error:
            raise GuardError(self._describe(self._error))
        return self

    async def _main(self) -> None:
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client
        params = StdioServerParameters(command=self.command[0], args=self.command[1:], env=self.env)
        try:
            async with stdio_client(params, errlog=self._log) as (read, write), ClientSession(read, write) as session:
                await session.initialize()
                self.tools = [t.name for t in (await session.list_tools()).tools]
                if self.tool not in self.tools:
                    raise GuardError(f"the guard does not expose {self.tool} (it has: {', '.join(self.tools) or 'nothing'})")
                self._loop, self._queue = asyncio.get_running_loop(), asyncio.Queue()
                self._ready.set()
                while (item := await self._queue.get()) is not None:
                    args, fut = item
                    try:
                        res = await session.call_tool(self.tool, args, read_timeout_seconds=self.timeout)
                    except Exception as e:  # handed to the caller's thread; the session may go on
                        fut.set_exception(e)
                        continue
                    except BaseException:  # cancellation: the session is ending, never swallow it
                        fut.set_exception(GuardError("the guard session ended"))
                        raise
                    fut.set_result(res)
        except BaseException as e:  # noqa: BLE001 (spawn failure, crash, exception group: reported on start/check)
            self._error = e
        finally:
            self._ready.set()
            while self._queue is not None and not self._queue.empty():  # calls queued as the guard died fail now
                item = self._queue.get_nowait()
                if item is not None and not item[1].done():
                    item[1].set_exception(GuardError("the guard process stopped"))

    def _describe(self, e: BaseException) -> str:
        msg = str(e) or type(e).__name__
        if isinstance(e, BaseExceptionGroup):
            msg = "; ".join(str(x) or type(x).__name__ for x in e.exceptions)
        tail = ""
        try:
            tail = "\n".join(self.log_path.read_text(encoding="utf-8", errors="replace").splitlines()[-8:])
        except OSError:
            pass
        hint = "" if "sentinel_guard" not in " ".join(self.command) else " (is sentinel-guard installed? pip install sentinel-guard)"
        return f"guard unavailable: {msg}{hint}" + (f"\n--- guard stderr ---\n{tail}" if tail else "")

    def close(self) -> None:
        if self._loop is not None and self._queue is not None and self._thread and self._thread.is_alive():
            self._loop.call_soon_threadsafe(self._queue.put_nowait, None)
            self._thread.join(timeout=10)
        if self._log:
            self._log.close()
            self._log = None
        if self._own_state:
            shutil.rmtree(self.state_dir, ignore_errors=True)

    def __enter__(self) -> "McpGuard":
        return self.start()

    def __exit__(self, *exc) -> None:
        self.close()

    # ----- the one call -----
    def check(self, args: dict[str, Any]) -> dict:
        self.start()
        if self._error or self._loop is None or self._queue is None or not (self._thread and self._thread.is_alive()):
            raise GuardError(self._describe(self._error or RuntimeError("the guard process stopped")))
        fut: concurrent.futures.Future = concurrent.futures.Future()
        self._loop.call_soon_threadsafe(self._queue.put_nowait, (args, fut))
        try:
            res = fut.result(timeout=self.timeout + 5)
        except concurrent.futures.TimeoutError as e:
            raise GuardError(f"the guard did not answer within {self.timeout:g} s") from e
        except Exception as e:
            raise GuardError(f"guard call failed: {e}") from e
        return parse_result(res)


def state_dir_for(keep_state: bool) -> Path | None:
    """None = a fresh temp dir removed after the run; --keep-state = one dir reused across runs (the registry remembers)."""
    if not keep_state:
        return None
    custom = os.environ.get("SECURE_AGENT_STATE_DIR")
    return Path(custom).expanduser() if _set(custom) else KEPT_STATE
