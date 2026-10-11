"""Accès Bedrock (Converse + tool use) pour les agents de la sandbox."""
from __future__ import annotations

import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REGION = "us-west-2"
# Modèle de l'agent testé, pas du garde. Pixtral Large suit l'injection de demo/fake_store (3 runs sur 3),
# alors que Claude Sonnet 4.6 la refuse seul et ne sollicite jamais le garde.
# Sur le compte du hackathon il faut le profil d'inférence "us.", l'ID nu est refusé en on-demand.
MODEL_ID = "us.mistral.pixtral-large-2502-v1:0"

_ENV_LINE = re.compile(r'^\s*(?:set\s+|export\s+|\$Env:)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$')


def load_env(path: Path = ROOT / ".env") -> None:
    """Charge .env sans écraser l'environnement. Accepte KEY=v, set KEY=v, export KEY=v, $Env:KEY="v"."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        m = _ENV_LINE.match(line)
        if m:
            os.environ.setdefault(m.group(1), m.group(2).strip().strip('"').strip("'"))


class BedrockLLM:
    """Appelable (system, messages, tools) -> message assistant au format Converse."""

    def __init__(self, model_id: str | None = None):
        import boto3
        load_env()
        self.model_id = model_id or os.environ.get("AGENT_MODEL_ID", MODEL_ID)
        self.client = boto3.client("bedrock-runtime", region_name=REGION)

    def __call__(self, system: str, messages: list, tools: list) -> dict:
        resp = self.client.converse(
            modelId=self.model_id,
            system=[{"text": system}],
            messages=messages,
            toolConfig={"tools": [{"toolSpec": t} for t in tools]},
            inferenceConfig={"maxTokens": 1024},
        )
        return resp["output"]["message"]
