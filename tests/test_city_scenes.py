"""The 3D city's demo scenes show the real guard's verdicts: redteam/city_scenes.py --check reruns them through the
MCP server and fails if ui3d-city/sim/sceneVerdicts.json no longer matches (regenerate it with the script)."""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_the_city_scenes_match_the_guard():
    r = subprocess.run([sys.executable, str(ROOT / "redteam" / "city_scenes.py"), "--check"], cwd=ROOT, capture_output=True, text=True,
                       encoding="utf-8", env={**__import__("os").environ, "GUARD_LLM": "off", "PYTHONUTF8": "1"}, timeout=300)
    assert r.returncode == 0, r.stdout + r.stderr
