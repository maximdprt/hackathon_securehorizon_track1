"""secure-agent: play the reference agent's scenarios, with or without the guard, or serve the guarded wallet over MCP.

    secure-agent scenarios
    secure-agent run shopping --variant scam --guard off --offline     # act 1: the wallet is drained
    secure-agent run shopping --variant scam --offline                 # act 2: the guard refuses the payment
    secure-agent run shopping --variant scam                           # connected: the decision lands on SentinelL1
    secure-agent wallet-mcp                                            # the guarded wallet as an MCP server
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from secure_agent_starter import __version__
from secure_agent_starter.agent import run_scenario
from secure_agent_starter.guard import DEFAULT_CITY, GuardError, McpGuard, state_dir_for
from secure_agent_starter.llm import make_llm
from secure_agent_starter.world import load_scenario, scenario_names

COLORS = {"r": "\033[91m", "g": "\033[92m", "y": "\033[93m", "b": "\033[94m", "dim": "\033[2m", "bold": "\033[1m", "x": "\033[0m"}
VERDICT_COLOR = {"allow": "g", "needs_approval": "y", "block": "r", "off": "r", "unavailable": "r"}


class Out:
    def __init__(self, stream=sys.stdout, quiet: bool = False):
        self.stream, self.quiet = stream, quiet
        self.color = stream.isatty() and not os.environ.get("NO_COLOR")

    def c(self, s: object, *keys: str) -> str:
        return "".join(COLORS[k] for k in keys) + str(s) + COLORS["x"] if self.color else str(s)

    def __call__(self, line: str = "") -> None:
        if not self.quiet:
            print(line, file=self.stream, flush=True)


def _short(x: object, n: int = 150) -> str:
    s = x if isinstance(x, str) else json.dumps(x, ensure_ascii=False, default=str)
    s = s.replace("\n", " ")
    return s if len(s) <= n else s[: n - 3] + "..."


def _event_printer(out: Out):
    def on_event(kind: str, d: dict) -> None:
        t = f"[{d['turn']}]"
        if kind == "thought":
            out(out.c(f"  {t} agent: ", "dim") + _short(d["text"], 300))
        elif kind == "tool_call":
            out(out.c(f"  {t} -> {d['tool']} ", "b") + out.c(_short(d["input"], 160), "dim"))
        elif kind == "tool_result":
            r = d["result"] if isinstance(d["result"], dict) else {}
            if d["tool"] in ("pay", "pay_x402"):
                g = r.get("guard", "?")
                head = f"  {t} <- guard: {str(g).upper()}" if g not in ("off",) else f"  {t} <- guard OFF: the wallet signs"
                bits = [f"status={r.get('status')}"]
                if r.get("trust_score") is not None:
                    bits.append(f"trust={r['trust_score']}/100")
                if "balance_after" in r:
                    bits.append(f"balance={r['balance_after']:g}")
                if r.get("error"):
                    bits.append(f"error={r['error']}")
                out(out.c(head + "  " + "  ".join(bits), "bold", VERDICT_COLOR.get(g, "y")))
                for reason in (r.get("reasons") or [])[:4]:
                    out(out.c(f"        - {_short(reason, 140)}", "dim"))
                if r.get("message") and r.get("status") in ("parked", "refused"):
                    out(out.c(f"        {r['message']}", "dim"))
                if r.get("onchain") == "recorded" and r.get("explorer_url"):
                    out(out.c(f"        on-chain proof: {r['explorer_url']}", "b"))
                elif r.get("onchain") in ("skipped", "error"):
                    why = f" ({_short(r['onchain_error'], 110)})" if r.get("onchain_error") else ""
                    out(out.c(f"        on-chain: {r['onchain']}{why}; the local verdict stands", "dim"))
            elif d["tool"] == "call_api":
                body = r.get("body") or {}
                desc = ((body.get("accepts") or [{}])[0].get("description", "") if r.get("status") == 402 else "data received" if "data" in body else "")
                out(out.c(f"  {t} <- HTTP {r.get('status')} {_short(desc, 120)}", "dim"))
            elif d["tool"] == "search":
                out(out.c(f"  {t} <- {len(r.get('results', []))} result(s): " + ", ".join(x.get("name", "?") for x in r.get("results", []))[:150], "dim"))
            else:
                label = r.get("title") or r.get("name") or r.get("error") or ""
                out(out.c(f"  {t} <- {d['tool']}: {_short(label, 100)} ({len(r.get('text', ''))} chars rendered)", "dim"))
    return on_event


def cmd_scenarios(a: argparse.Namespace) -> int:
    rows = []
    for name in scenario_names():
        sc = load_scenario(name)
        for var, v in sc["variants"].items():
            rows.append({"scenario": name, "variant": var, "expected_verdict": (v.get("expect") or {}).get("verdict"),
                         "summary": v.get("summary", ""), "task": v["task"]})
    if a.json:
        print(json.dumps(rows, indent=1))
        return 0
    out = Out()
    for name in scenario_names():
        sc = load_scenario(name)
        out(out.c(f"{name}", "bold") + f"  {sc['title']}: {sc.get('summary', '')}")
        for r in [r for r in rows if r["scenario"] == name]:
            color = VERDICT_COLOR.get(r["expected_verdict"] or "", "y")
            out(f"  --variant {r['variant']:<7} " + out.c(f"{r['expected_verdict']:<15}", color) + r["summary"])
    out()
    out(out.c("run one: secure-agent run <scenario> --variant <variant> [--guard off] [--offline]", "dim"))
    return 0


def cmd_run(a: argparse.Namespace) -> int:
    out = Out(sys.stderr if a.json else sys.stdout)
    try:
        sc = load_scenario(a.scenario)
    except KeyError as e:
        print(f"error: {e.args[0]}", file=sys.stderr)
        return 2
    variant = a.variant or ("scam" if "scam" in sc["variants"] else next(iter(sc["variants"])))
    if variant not in sc["variants"]:
        print(f"error: unknown variant {variant!r} for {a.scenario} (known: {', '.join(sc['variants'])})", file=sys.stderr)
        return 2
    try:
        llm = make_llm(a.llm, a.model)
    except (RuntimeError, ValueError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    guard = None
    if a.guard == "on":
        guard = McpGuard(connected=not a.offline, config_dir=a.guard_config, state_dir=state_dir_for(a.keep_state))
        try:
            guard.start()
        except GuardError as e:
            print(f"error: {e}\n(run with --guard off to see the agent without protection)", file=sys.stderr)
            guard.close()
            return 2
    v = sc["variants"][variant]
    mode = "OFF" if guard is None else ("ON, connected to " + guard.env.get("SENTINEL_API", "")) if guard.connected else "ON, offline (local only)"
    out(out.c(f"Jarvis · {sc['title']} · variant {variant}", "bold", "b"))
    out(out.c(f"task: {v['task']}", "dim"))
    out(f"llm: {llm.name} ({llm.model})   guard: {mode}   issuer: {sc['issuer'][:12]}... ({sc.get('issuer_label', '')})")
    if guard is not None and a.keep_state:
        out(out.c(f"guard state kept in {guard.state_dir}", "dim"))
    out()
    try:
        res = run_scenario(a.scenario, variant, llm, guard, max_turns=a.max_turns, on_event=_event_printer(out))
    finally:
        if guard is not None:
            guard.close()
    run = res.run
    out()
    if run and run.error:
        out(out.c(f"agent error: {run.error}", "r"))
    out(out.c("agent says: ", "bold") + _short((run.final_text if run else "") or "", 600))
    spent = res.balance_before - res.balance_after
    cur = sc["wallet"].get("currency", "USDC")
    if spent > 0 and res.guard == "off" and res.expected in ("block", "needs_approval"):
        tail, color = f"lost {spent:g} {cur} to a payment the guard would have stopped", "r"
    elif spent > 0:
        tail, color = f"spent {spent:g} {cur}", "g" if res.guard == "on" else "y"
    else:
        tail, color = "nothing left the wallet", "g"
    out(out.c(f"wallet: {res.balance_before:g} -> {res.balance_after:g} {cur}   ({tail})", "bold", color))
    if res.guard == "on":
        verdicts = res.verdicts or ["(no payment attempted)"]
        check = "" if res.matches_expected is None else ("  matches the scenario" if res.matches_expected else f"  (scenario expects {res.expected})")
        out(out.c(f"guard: {' -> '.join(verdicts)}{check}", "bold"))
        if res.mode == "connected" and any((p["result"].get("onchain") == "recorded") for p in res.payments):
            out(out.c(f"see it live: {DEFAULT_CITY}  (each decision is a car in the city)", "b"))
    if a.json:
        print(json.dumps(res.to_dict(), ensure_ascii=False, indent=1, default=str))
    return 0


def cmd_wallet_mcp(a: argparse.Namespace) -> int:
    from secure_agent_starter.wallet_mcp import serve
    names = None if a.scenario == "all" else [a.scenario]
    guard = None if a.guard == "off" else McpGuard(connected=not a.offline, config_dir=a.guard_config, state_dir=state_dir_for(a.keep_state))
    serve(names, guard)
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="secure-agent", description="A reference payment agent with the Sentinel guard in its only money path.")
    p.add_argument("--version", action="version", version=f"secure-agent-starter {__version__}")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("scenarios", help="list the playable scenarios and variants")
    s.add_argument("--json", action="store_true")
    s.set_defaults(fn=cmd_scenarios)

    def guard_opts(x: argparse.ArgumentParser) -> None:
        x.add_argument("--guard", choices=["on", "off"], default="on", help="off = no guard: the wallet signs anything (act 1)")
        x.add_argument("--offline", action="store_true", help="local-only guard (screen_payment): nothing leaves the machine")
        x.add_argument("--guard-config", type=Path, default=None, help="operator config dir for the guard (mandates.json...); default: the starter's own")
        x.add_argument("--keep-state", action="store_true", help="reuse one guard state dir across runs (~/.secure-agent-starter/state)")

    r = sub.add_parser("run", help="run the agent on one scenario")
    r.add_argument("scenario", choices=scenario_names())
    r.add_argument("--variant", default=None, help="legit | scam | review (see `secure-agent scenarios`); default: scam")
    r.add_argument("--llm", choices=["auto", "anthropic", "bedrock", "scripted"], default="auto",
                   help="auto = anthropic if ANTHROPIC_API_KEY, else bedrock if AWS credentials, else scripted")
    r.add_argument("--model", default=None, help="model id for anthropic or bedrock")
    r.add_argument("--max-turns", type=int, default=12)
    r.add_argument("--json", action="store_true", help="print the run as JSON on stdout (the story goes to stderr)")
    guard_opts(r)
    r.set_defaults(fn=cmd_run)

    w = sub.add_parser("wallet-mcp", help="serve the guarded wallet and the scenario world over MCP stdio")
    w.add_argument("--scenario", choices=["all", *scenario_names()], default="all")
    guard_opts(w)
    w.set_defaults(fn=cmd_wallet_mcp)
    return p


def main(argv: list[str] | None = None) -> None:
    a = build_parser().parse_args(argv)
    sys.exit(a.fn(a))


if __name__ == "__main__":
    main()
