"""Construit l'image Lambda des agents (deploy/Dockerfile, arm64) sur AWS CodeBuild, sans Docker sur la machine.

Pour qui n'a pas Docker : le code de HEAD (git archive) + l'interface construite (agents/ui/dist, hors git) partent
dans le bucket des runs, une machine CodeBuild ARM construit l'image en natif et la pousse sur le dépôt ECR
team2-agents. Ensuite `deploy_lambda.py --no-build` branche la fonction sur cette image (la plus récente du dépôt).

    cd agents/ui && npm run build && cd ../..
    set -a; source .env; set +a
    .venv/bin/python deploy/build_lambda_image.py      # ~5 min
    .venv/bin/python deploy/deploy_lambda.py --no-build

Ce qu'il crée (région us-west-2), réutilisé aux lancements suivants : le rôle IAM team2-agents-codebuild-role (journaux,
lecture du bucket, poussée sur le dépôt ECR) et le projet CodeBuild team2-agents-image. Rien ne touche la L1.
"""
from __future__ import annotations

import io
import json
import os
import subprocess
import tarfile
import time
import zipfile
from pathlib import Path

import boto3
import botocore

ROOT = Path(__file__).resolve().parents[1]
REGION = os.environ.get("AWS_REGION", "us-west-2")
NAME = os.environ.get("TEAM2_FUNCTION_NAME", "team2-agents")
ACCOUNT = boto3.client("sts", region_name=REGION).get_caller_identity()["Account"]
BUCKET = os.environ.get("TEAM2_RUNS_BUCKET", f"{NAME}-runs-{ACCOUNT}")
PROJECT = f"{NAME}-image"
ROLE = f"{NAME}-codebuild-role"
KEY = "build/agents-src.zip"
TAG = os.environ.get("TEAM2_IMAGE_TAG", time.strftime("%Y%m%d-%H%M%S"))
REPO_URI = f"{ACCOUNT}.dkr.ecr.{REGION}.amazonaws.com/{NAME}"

BUILDSPEC = f"""version: 0.2
phases:
  pre_build:
    commands:
      - aws ecr get-login-password --region {REGION} | docker login --username AWS --password-stdin {ACCOUNT}.dkr.ecr.{REGION}.amazonaws.com
  build:
    commands:
      - docker build --provenance=false -f deploy/Dockerfile -t {REPO_URI}:$IMAGE_TAG .
  post_build:
    commands:
      - docker push {REPO_URI}:$IMAGE_TAG
"""


def source_zip() -> bytes:
    """Le code de HEAD tel que git le connaît, plus agents/ui/dist (construit, hors git) que l'image sert."""
    dist = ROOT / "agents" / "ui" / "dist"
    if not (dist / "index.html").is_file():
        raise SystemExit("agents/ui/dist manque : cd agents/ui && npm run build")
    tar = subprocess.run(["git", "archive", "--format=tar", "HEAD"], cwd=ROOT, check=True, capture_output=True).stdout
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z, tarfile.open(fileobj=io.BytesIO(tar)) as t:
        for m in t.getmembers():
            if m.isfile():
                z.writestr(m.name, t.extractfile(m).read())
        for f in dist.rglob("*"):
            if f.is_file():
                z.write(f, f.relative_to(ROOT).as_posix())
    return out.getvalue()


def ensure_role(iam) -> str:
    trust = {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Principal": {"Service": "codebuild.amazonaws.com"}, "Action": "sts:AssumeRole"}]}
    try:
        arn = iam.get_role(RoleName=ROLE)["Role"]["Arn"]
    except iam.exceptions.NoSuchEntityException:
        arn = iam.create_role(RoleName=ROLE, AssumeRolePolicyDocument=json.dumps(trust), Description="Team 2: builds the agents' Lambda image")["Role"]["Arn"]
        print("iam: created role", ROLE)
    policy = {"Version": "2012-10-17", "Statement": [
        {"Effect": "Allow", "Action": ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"], "Resource": "*"},
        {"Effect": "Allow", "Action": ["s3:GetObject", "s3:GetObjectVersion"], "Resource": f"arn:aws:s3:::{BUCKET}/*"},
        {"Effect": "Allow", "Action": ["ecr:GetAuthorizationToken"], "Resource": "*"},
        {"Effect": "Allow", "Action": ["ecr:BatchCheckLayerAvailability", "ecr:InitiateLayerUpload", "ecr:UploadLayerPart", "ecr:CompleteLayerUpload",
                                       "ecr:PutImage", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"],
         "Resource": f"arn:aws:ecr:{REGION}:{ACCOUNT}:repository/{NAME}"},
    ]}
    iam.put_role_policy(RoleName=ROLE, PolicyName=f"{ROLE}-inline", PolicyDocument=json.dumps(policy))
    return arn


def ensure_project(cb, role_arn: str) -> None:
    cfg = dict(name=PROJECT, source={"type": "S3", "location": f"{BUCKET}/{KEY}", "buildspec": BUILDSPEC},
               artifacts={"type": "NO_ARTIFACTS"}, serviceRole=role_arn, timeoutInMinutes=30,
               environment={"type": "ARM_CONTAINER", "image": "aws/codebuild/amazonlinux2-aarch64-standard:3.0",
                            "computeType": "BUILD_GENERAL1_LARGE", "privilegedMode": True})
    for attempt in range(10):  # le rôle met quelques secondes à se propager
        try:
            if cb.batch_get_projects(names=[PROJECT])["projects"]:
                cb.update_project(**cfg)
            else:
                cb.create_project(**cfg)
                print("codebuild: created", PROJECT)
            return
        except botocore.exceptions.ClientError as e:
            if "role" in str(e).lower() and attempt < 9:
                time.sleep(6)
                continue
            raise


def main() -> None:
    s3, iam = boto3.client("s3", region_name=REGION), boto3.client("iam")
    cb, ecr = boto3.client("codebuild", region_name=REGION), boto3.client("ecr", region_name=REGION)
    head = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, check=True, capture_output=True, text=True).stdout.strip()
    data = source_zip()
    print(f">> source HEAD {head} + agents/ui/dist ({len(data) // 1024} KB) -> s3://{BUCKET}/{KEY}")
    s3.put_object(Bucket=BUCKET, Key=KEY, Body=data)
    ensure_project(cb, ensure_role(iam))
    build = cb.start_build(projectName=PROJECT, environmentVariablesOverride=[{"name": "IMAGE_TAG", "value": TAG, "type": "PLAINTEXT"}])["build"]
    print(f">> codebuild {build['id']} (image {NAME}:{TAG})")
    while True:
        time.sleep(15)
        b = cb.batch_get_builds(ids=[build["id"]])["builds"][0]
        print(f"   {b['currentPhase']:<14} {b['buildStatus']}")
        if b["buildStatus"] != "IN_PROGRESS":
            break
    if b["buildStatus"] != "SUCCEEDED":
        logs = b.get("logs", {})
        raise SystemExit(f"build {b['buildStatus']} : {logs.get('deepLink', '')}")
    digest = ecr.describe_images(repositoryName=NAME, imageIds=[{"imageTag": TAG}])["imageDetails"][0]["imageDigest"]
    print(f"IMAGE_OK {REPO_URI}@{digest}  (git {head})")


if __name__ == "__main__":
    main()
