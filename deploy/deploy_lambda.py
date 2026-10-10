"""Déploie les agents sur AWS Lambda (image conteneur arm64) avec une URL publique. Tout en boto3, pas d'aws cli.

    set -a; source .env; set +a
    .venv/bin/python deploy/deploy_lambda.py            # build + push + rôle + fonction + URL
    .venv/bin/python deploy/deploy_lambda.py --no-build # redéploie l'image déjà poussée
    .venv/bin/python deploy/deploy_lambda.py --destroy  # supprime fonction, URL, rôle, dépôt

Ce qu'il crée (région us-west-2) : dépôt ECR team2-agents, rôle IAM team2-agents-lambda-role (logs + bedrock + s3 + self-invoke),
fonction team2-agents (arm64, 2048 MB, 300 s), bucket S3 des résultats async, API Gateway HTTP API publique devant la
fonction (la Function URL renvoie 403 sur le compte hackathon, probablement une SCP). Démo, données synthétiques uniquement.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import boto3
import botocore

ROOT = Path(__file__).resolve().parents[1]
REGION = os.environ.get("AWS_REGION", "us-west-2")
NAME = os.environ.get("TEAM2_FUNCTION_NAME", "team2-agents")
ACCOUNT = boto3.client("sts", region_name=os.environ.get("AWS_REGION", "us-west-2")).get_caller_identity()["Account"]
BUCKET = os.environ.get("TEAM2_RUNS_BUCKET", f"{NAME}-runs-{ACCOUNT}")
ROLE = f"{NAME}-lambda-role"
TAG = os.environ.get("TEAM2_IMAGE_TAG", time.strftime("%Y%m%d-%H%M%S"))

ecr = boto3.client("ecr", region_name=REGION)
apigw = boto3.client("apigatewayv2", region_name=REGION)
s3 = boto3.client("s3", region_name=REGION)
lam = boto3.client("lambda", region_name=REGION)
iam = boto3.client("iam")
sts = boto3.client("sts", region_name=REGION)


def sh(cmd: list[str], **kw):
    print("$", " ".join(c if len(c) < 80 else c[:40] + "…" for c in cmd))
    subprocess.run(cmd, check=True, cwd=ROOT, **kw)


def ensure_repo() -> str:
    try:
        return ecr.describe_repositories(repositoryNames=[NAME])["repositories"][0]["repositoryUri"]
    except ecr.exceptions.RepositoryNotFoundException:
        r = ecr.create_repository(repositoryName=NAME, imageScanningConfiguration={"scanOnPush": False})
        print("ecr: created", r["repository"]["repositoryUri"])
        return r["repository"]["repositoryUri"]


def build_and_push(uri: str) -> str:
    auth = ecr.get_authorization_token()["authorizationData"][0]
    user, pwd = base64.b64decode(auth["authorizationToken"]).decode().split(":", 1)
    registry = auth["proxyEndpoint"]
    sh(["docker", "login", "--username", user, "--password-stdin", registry], input=pwd.encode())
    image = f"{uri}:{TAG}"
    sh(["docker", "build", "--platform", "linux/arm64", "--provenance=false", "-f", "deploy/Dockerfile", "-t", image, "."])
    sh(["docker", "push", image])
    digest = ecr.describe_images(repositoryName=NAME, imageIds=[{"imageTag": TAG}])["imageDetails"][0]["imageDigest"]
    return f"{uri}@{digest}"


def ensure_role() -> str:
    trust = {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Principal": {"Service": "lambda.amazonaws.com"}, "Action": "sts:AssumeRole"}]}
    try:
        arn = iam.get_role(RoleName=ROLE)["Role"]["Arn"]
    except iam.exceptions.NoSuchEntityException:
        arn = iam.create_role(RoleName=ROLE, AssumeRolePolicyDocument=json.dumps(trust), Description="Team 2 demo agents (Bedrock + logs)")["Role"]["Arn"]
        print("iam: created role", ROLE)
    policy = {"Version": "2012-10-17", "Statement": [
        {"Effect": "Allow", "Action": ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"], "Resource": "*"},
        {"Effect": "Allow", "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream", "bedrock:Converse", "bedrock:ConverseStream"], "Resource": "*"},
        {"Effect": "Allow", "Action": ["s3:PutObject", "s3:GetObject"], "Resource": f"arn:aws:s3:::{BUCKET}/*"},
        {"Effect": "Allow", "Action": ["lambda:InvokeFunction"], "Resource": f"arn:aws:lambda:{REGION}:{ACCOUNT}:function:{NAME}"},
    ]}
    iam.put_role_policy(RoleName=ROLE, PolicyName="team2-agents-inline", PolicyDocument=json.dumps(policy))
    return arn


def ensure_function(image_uri: str, role_arn: str) -> str:
    cfg = dict(FunctionName=NAME, Role=role_arn, PackageType="Image", Code={"ImageUri": image_uri}, Architectures=["arm64"],
               Timeout=300, MemorySize=2048, Description="Team 2 demo agents (shopping + x402) in front of the payment guard",
               Environment={"Variables": {"AGENTS_OUT_DIR": "/tmp/agents_out", "GUARD_LLM": "off", "RUNS_BUCKET": BUCKET}})
    for attempt in range(8):  # le rôle met quelques secondes à se propager
        try:
            try:
                lam.get_function(FunctionName=NAME)
                lam.update_function_code(FunctionName=NAME, ImageUri=image_uri, Architectures=["arm64"])
                _wait_updated()
                lam.update_function_configuration(FunctionName=NAME, Role=role_arn, Timeout=300, MemorySize=2048,
                                                  Environment=cfg["Environment"])
                print("lambda: updated", NAME)
            except lam.exceptions.ResourceNotFoundException:
                lam.create_function(**cfg)
                print("lambda: created", NAME)
            break
        except botocore.exceptions.ClientError as e:
            if "role" in str(e).lower() and attempt < 7:
                time.sleep(5)
                continue
            raise
    _wait_updated()
    return lam.get_function(FunctionName=NAME)["Configuration"]["FunctionArn"]


def _wait_updated():
    for _ in range(60):
        c = lam.get_function(FunctionName=NAME)["Configuration"]
        if c.get("State") in ("Active",) and c.get("LastUpdateStatus") in ("Successful", None):
            return
        if c.get("LastUpdateStatus") == "Failed":
            raise RuntimeError(c.get("LastUpdateStatusReason"))
        time.sleep(3)


def ensure_bucket() -> str:
    try:
        s3.create_bucket(Bucket=BUCKET, CreateBucketConfiguration={"LocationConstraint": REGION})
        print("s3: created", BUCKET)
    except botocore.exceptions.ClientError as e:
        if e.response["Error"]["Code"] not in ("BucketAlreadyOwnedByYou", "BucketAlreadyExists"):
            raise
    return BUCKET


def ensure_api(function_arn: str) -> str:
    """HTTP API (payload v2 = même format d'événement que la Function URL), route $default -> Lambda, public."""
    apis = [a for a in apigw.get_apis()["Items"] if a["Name"] == NAME]
    if apis:
        api = apis[0]
    else:
        api = apigw.create_api(Name=NAME, ProtocolType="HTTP", Target=function_arn, CorsConfiguration={"AllowOrigins": ["*"], "AllowMethods": ["*"], "AllowHeaders": ["*"]})
        print("apigw: created", api["ApiId"])
    try:
        lam.add_permission(FunctionName=NAME, StatementId="apigw-invoke", Action="lambda:InvokeFunction", Principal="apigateway.amazonaws.com",
                           SourceArn=f"arn:aws:execute-api:{REGION}:{ACCOUNT}:{api['ApiId']}/*")
    except lam.exceptions.ResourceConflictException:
        pass
    return api["ApiEndpoint"] + "/"


def ensure_url() -> str:
    try:
        url = lam.get_function_url_config(FunctionName=NAME)["FunctionUrl"]
    except lam.exceptions.ResourceNotFoundException:
        url = lam.create_function_url_config(FunctionName=NAME, AuthType="NONE", Cors={"AllowOrigins": ["*"], "AllowMethods": ["*"]})["FunctionUrl"]
    try:
        lam.add_permission(FunctionName=NAME, StatementId="public-url", Action="lambda:InvokeFunctionUrl", Principal="*", FunctionUrlAuthType="NONE")
    except lam.exceptions.ResourceConflictException:
        pass
    return url


def destroy():
    for a in [a for a in apigw.get_apis()["Items"] if a["Name"] == NAME]:
        apigw.delete_api(ApiId=a["ApiId"]); print("deleted api", a["ApiId"])
    for fn, kw in ((lam.delete_function_url_config, {"FunctionName": NAME}), (lam.delete_function, {"FunctionName": NAME}),
                   (iam.delete_role_policy, {"RoleName": ROLE, "PolicyName": "team2-agents-inline"}), (iam.delete_role, {"RoleName": ROLE}),
                   (ecr.delete_repository, {"repositoryName": NAME, "force": True})):
        try:
            fn(**kw); print("deleted", kw)
        except botocore.exceptions.ClientError as e:
            print("skip", kw, e.response["Error"]["Code"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-build", action="store_true")
    ap.add_argument("--destroy", action="store_true")
    a = ap.parse_args()
    print("account:", sts.get_caller_identity()["Account"], "region:", REGION)
    if a.destroy:
        return destroy()
    uri = ensure_repo()
    if a.no_build:
        imgs = ecr.describe_images(repositoryName=NAME)["imageDetails"]
        latest = max(imgs, key=lambda i: i["imagePushedAt"])
        image = f"{uri}@{latest['imageDigest']}"
    else:
        image = build_and_push(uri)
    ensure_bucket()
    role = ensure_role()
    arn = ensure_function(image, role)
    api_url = ensure_api(arn)
    try:
        fn_url = ensure_url()   # bloquée (403) sur le compte hackathon, gardée au cas où un autre compte l'autorise
    except botocore.exceptions.ClientError as e:
        fn_url = f"unavailable ({e.response['Error']['Code']})"
    url = api_url
    info = {"function": NAME, "arn": arn, "image": image, "url": url, "function_url": fn_url, "runs_bucket": BUCKET, "region": REGION,
            "deployed": time.strftime("%Y-%m-%dT%H:%M:%S")}
    (ROOT / "deploy" / "deployed.json").write_text(json.dumps(info, indent=1))
    print(json.dumps(info, indent=1))
    print(f"\nTest : curl '{url}?agent=x402&scenario=premium&guard=on'")


if __name__ == "__main__":
    main()
