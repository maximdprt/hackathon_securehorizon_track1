"""Human-in-the-loop queue for needs_approval verdicts. A JSON file, enough for the demo."""
from __future__ import annotations

import json
import threading
from pathlib import Path


class PendingQueue:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    def _load(self) -> dict:
        return json.loads(self.path.read_text()) if self.path.exists() else {}

    def _save(self, d: dict) -> None:
        self.path.write_text(json.dumps(d, indent=1, ensure_ascii=False))

    def add(self, verdict: dict) -> None:
        with self._lock:
            d = self._load()
            d[verdict["instruction_id"]] = verdict
            self._save(d)

    def list(self) -> list[dict]:
        return list(self._load().values())

    def pop(self, instruction_id: str) -> dict | None:
        with self._lock:
            d = self._load()
            v = d.pop(instruction_id, None)
            self._save(d)
            return v
