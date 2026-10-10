import json
import shutil
import tempfile
from pathlib import Path

import pytest

from guard.engine import Engine
from guard.llm import ClaudeScorer

ROOT = Path(__file__).resolve().parent.parent

T = "0xa11ce00000000000000000000000000000000001"
S = "0xa11ce00000000000000000000000000000000002"
R = "0xa11ce00000000000000000000000000000000003"
VENDOR = "0x5e11e40000000000000000000000000000000001"
BAD = "0xbad0000000000000000000000000000000000bad"


@pytest.fixture
def data_dir(tmp_path):
    for f in (ROOT / "data").glob("*.json"):
        if f.name not in ("threats.mock.json", "nonces.json", "pending.json"):
            shutil.copy(f, tmp_path / f.name)
    (tmp_path / "threats.mock.json").write_text("{}")
    return tmp_path


def make_engine(data_dir, llm_fn=None, enabled=False):
    return Engine.from_env(data_dir, llm=ClaudeScorer(score_fn=llm_fn, enabled=enabled))


@pytest.fixture
def engine(data_dir):
    return make_engine(data_dir)
