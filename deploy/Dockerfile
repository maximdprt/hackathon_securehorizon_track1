# Image Lambda (arm64) : les 2 agents + le garde + le décor, un seul conteneur.
#   docker build --platform linux/arm64 -f deploy/Dockerfile -t team2-agents .
#   docker run --rm -p 9000:8080 --env-file .env team2-agents   (test local : POST http://localhost:9000/2015-03-31/functions/function/invocations)
FROM public.ecr.aws/lambda/python:3.12

# dépendances runtime (mêmes bornes que pyproject.toml ; web3 non nécessaire au mock)
RUN pip install --no-cache-dir "mcp>=2.0" "beautifulsoup4>=4.12" "boto3>=1.34" "pycryptodome>=3.20"

WORKDIR ${LAMBDA_TASK_ROOT}
COPY guard/ guard/
COPY agents/ agents/
COPY demo/ demo/
COPY detection/ detection/
COPY data/ data/
COPY mcp_server.py deploy/lambda_handler.py ./
RUN rm -rf agents/out demo/out data/decisions.jsonl data/pending.json data/nonces.json \
    && echo '{}' > data/threats.mock.json

ENV AGENTS_OUT_DIR=/tmp/agents_out \
    GUARD_LLM=off \
    GUARD_BACKEND=engine \
    SENTINEL_API=https://rpc.petroi.fr \
    AGENT_MODEL_ID=us.anthropic.claude-haiku-4-5-20251001-v1:0 \
    LAMBDA_MAX_TURNS=18 \
    PYTHONUNBUFFERED=1

CMD ["lambda_handler.handler"]
