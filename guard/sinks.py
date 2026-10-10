"""Where decisions get recorded: local JSONL always, the chain when configured."""
from __future__ import annotations

import json
import logging
import threading
from pathlib import Path
from typing import Protocol

log = logging.getLogger("guard.sinks")
VERDICT_CODE = {"allow": 0, "needs_approval": 1, "block": 2}


class DecisionSink(Protocol):
    def record(self, verdict: dict) -> None: ...


class JsonlSink:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    def record(self, verdict: dict) -> None:
        with self._lock, self.path.open("a") as f:
            f.write(json.dumps(verdict, ensure_ascii=False) + "\n")

    def read_all(self) -> list[dict]:
        if not self.path.exists():
            return []
        return [json.loads(l) for l in self.path.read_text().splitlines() if l.strip()]


class ChainSink:
    """Emits DecisionRecorded on AuthorityRegistry. Needs a ChainSource with an owner key."""

    def __init__(self, chain):
        self.chain = chain

    def record(self, verdict: dict) -> None:
        reason = "; ".join(verdict.get("reasons", []))[:200]
        tx = self.chain.record_decision(verdict["instruction_id"], verdict["issuer"], float(verdict["amount"]),
                                        VERDICT_CODE[verdict["verdict"]], reason)
        verdict["onchain_tx"] = tx


class CompositeSink:
    def __init__(self, *sinks: DecisionSink):
        self.sinks = sinks

    def record(self, verdict: dict) -> None:
        for s in self.sinks:
            try:
                s.record(verdict)
            except Exception as e:
                log.error("sink %s failed: %s", type(s).__name__, e)
                verdict.setdefault("sink_errors", []).append(f"{type(s).__name__}: {e}")
