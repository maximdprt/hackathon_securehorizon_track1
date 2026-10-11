"""Human-in-the-loop queue for needs_approval verdicts. A JSON file, enough for the demo."""
from __future__ import annotations

import json
import threading
from pathlib import Path

from guard.models import safe_json


class PendingQueue:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    def _load(self) -> dict:
        return json.loads(self.path.read_text(encoding="utf-8")) if self.path.exists() else {}

    def _save(self, d: dict) -> None:
        self.path.write_text(safe_json(d, indent=1), encoding="utf-8")

    def add(self, verdict: dict) -> None:
        with self._lock:
            d = self._load()
            d[verdict["instruction_id"]] = verdict
            self._save(d)

    def list(self) -> list[dict]:
        return list(self._load().values())

    def get(self, instruction_id: str) -> dict | None:
        return self._load().get(instruction_id)

    def pop(self, instruction_id: str) -> dict | None:
        with self._lock:
            d = self._load()
            v = d.pop(instruction_id, None)
            if v is not None:
                self._save(d)
            return v
