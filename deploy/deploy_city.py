"""Déploie la ville 3D (ui3d-city) depuis le CODE À JOUR de main sur l'EC2 SentinelL1 — durable, reproductible.

Le déploiement historique tirait un tarball S3 via une URL présignée (qui expire) ; il était déconnecté du repo.
Ce script rebranche la ville sur le repo :
  1. `git archive` de ui3d-city (HEAD) -> tarball propre (sans node_modules/.next) ;
  2. upload vers s3://team2-agents-runs-<acct>/city-main.tgz (notre bucket) ;
  3. SSM : lance /root/cityredeploy.sh sur l'EC2, qui télécharge ce tarball via le rôle de l'instance
     (plus d'URL présignée), fait npm install + build, et ne redémarre sentinel-city que si le build réussit.

`deploy/cityredeploy.sh` est la version installée sur l'EC2 (l'originale de Walid y est gardée en .bak-walid).

    set -a; source .env; set +a; .venv/bin/python deploy/deploy_city.py
"""
from __future__ import annotations

import os
import subprocess
import time
from pathlib import Path

import boto3

ROOT = Path(__file__).resolve().parents[1]
REGION = os.environ.get("AWS_REGION", "us-west-2")
INSTANCE = os.environ.get("CITY_INSTANCE_ID", "i-086e4f697fb388d91")
ACCT = boto3.client("sts", region_name=REGION).get_caller_identity()["Account"]
BUCKET = os.environ.get("TEAM2_RUNS_BUCKET", f"team2-agents-runs-{ACCT}")
KEY = "city-main.tgz"
REF = os.environ.get("CITY_REF", "HEAD")  # la version de ui3d-city à déployer


def main() -> None:
    tgz = ROOT / "deploy" / "_city-main.tgz"
    print(f">> git archive {REF}:ui3d-city -> {tgz.name}")
    subprocess.run(["git", "archive", f"{REF}:ui3d-city", "-o", str(tgz), "--format=tar.gz"], cwd=ROOT, check=True)
    print(f">> upload s3://{BUCKET}/{KEY}")
    boto3.client("s3", region_name=REGION).upload_file(str(tgz), BUCKET, KEY)
    tgz.unlink(missing_ok=True)
    print(f">> SSM: /root/cityredeploy.sh sur {INSTANCE} (backup + install + build + restart si OK)")
    ssm = boto3.client("ssm", region_name=REGION)
    cid = ssm.send_command(InstanceIds=[INSTANCE], DocumentName="AWS-RunShellScript",
                           Parameters={"commands": ["bash /root/cityredeploy.sh 2>&1 | tail -15"]},
                           TimeoutSeconds=600)["Command"]["CommandId"]
    for _ in range(120):
        time.sleep(5)
        o = ssm.get_command_invocation(CommandId=cid, InstanceId=INSTANCE)
        if o["Status"] in ("Success", "Failed", "Cancelled", "TimedOut"):
            break
    print("status:", o["Status"])
    print(o.get("StandardOutputContent", "")[-1200:])
    if o.get("StandardErrorContent"):
        print("ERR:", o["StandardErrorContent"][-400:])


if __name__ == "__main__":
    main()
