# Hébergement AWS des agents (Corentin + Bruno)

Les 2 agents (`agents/`), le garde (`guard/`) et le décor (`demo/`) tournent dans une seule **Lambda en image conteneur
arm64**, exposée par une **API Gateway HTTP** publique. Un appel HTTP = un run réel de l'agent sur Bedrock (Haiku 4.5
par défaut), la trace JSON en retour. Tout en boto3 : pas besoin de l'aws cli.

| Ressource | Nom | Pourquoi |
|---|---|---|
| ECR | `team2-agents` | l'image (base `public.ecr.aws/lambda/python:3.12`, ~850 MB) |
| IAM role | `team2-agents-lambda-role` | logs + `bedrock:Invoke*`/`Converse*` + `s3:Put/GetObject` sur le bucket + self-invoke |
| Lambda | `team2-agents` | arm64, 2048 MB, 300 s, env `AGENTS_OUT_DIR=/tmp/agents_out`, `GUARD_LLM=off`, `RUNS_BUCKET` |
| S3 | `team2-agents-runs-<account>` | résultats des runs async (`runs/<run_id>.json`) |
| API Gateway HTTP | `team2-agents` | route `$default` → Lambda, CORS `*`, payload v2 (même événement que la Function URL) |

Pourquoi pas AgentCore ni la Function URL : `bedrock-agentcore` et App Runner répondent `AccessDenied` avec le rôle
participant, et la Function URL renvoie 403 même avec une policy publique correcte et même en SigV4 (SCP du compte
Workshop Studio). L'API Gateway, elle, passe. Sa limite : **30 s par requête**, d'où le mode async.

## Déployer / redéployer

```bash
set -a; source .env; set +a                       # creds AWS temporaires du hackathon (us-west-2)
.venv/bin/python deploy/deploy_lambda.py          # build arm64, push ECR, rôle, fonction, bucket, API ; écrit deploy/deployed.json
.venv/bin/python deploy/deploy_lambda.py --no-build   # redéploie la dernière image poussée
.venv/bin/python deploy/deploy_lambda.py --destroy    # supprime tout (API, fonction, URL, rôle, dépôt)
```

Prérequis : Docker qui tourne (build `--platform linux/arm64`, natif sur Mac Apple Silicon). Build complet ~3 min la
première fois (pull de l'image de base), ~30 s ensuite (couches en cache).

## Appeler

```bash
U=$(python3 -c "import json;print(json.load(open('deploy/deployed.json'))['url'])")
curl "$U"                                                        # index HTML, un lien par scénario
curl "$U?agent=x402&scenario=premium&guard=on"                   # sync (< 30 s) : JSON complet
curl -X POST "$U" -H 'content-type: application/json' -d '{"agent":"shopping","scenario":"promptfix","guard":"off","mode":"async"}'
#   -> {"status":"running","run_id":"...","poll":"?run=..."}
curl "$U?run=<run_id>"                                           # {"status":"running"} puis le JSON complet avec "status":"done"
```

Paramètres : `agent` (shopping | x402), `scenario` (shopping : promptfix, checkout, poisoned_pdf, ceo_email,
flagged_recipient, legit_invoice ; x402 : weather, premium, partner, replay, migrated), `guard` (on | off),
`guard_llm` (on = Claude dans le garde, plus lent), `model` (id Bedrock), `calls` (x402), `data=keep` (enchaîner
les actes sur le même registre dans un conteneur chaud), `mode=async`.

Réponse : `guard_calls[]` (verdict, risk, trust, raisons, instruction_id), `balance_before/after`, `drained` ou
`spent`, `run.trace[]` (chaque appel d'outil de l'agent), `log[]` (le récit lisible), `hosted` (région, fonction).

## Tester l'image en local avant de pousser

```bash
docker build --platform linux/arm64 --provenance=false -f deploy/Dockerfile -t team2-agents .
docker run --rm -p 9009:8080 --env-file .env team2-agents
curl -X POST http://localhost:9009/2015-03-31/functions/function/invocations \
  -d '{"requestContext":{"http":{"method":"GET"}},"queryStringParameters":{"agent":"x402","scenario":"partner","guard":"on"}}'
```

## Limites connues

- Creds du compte hackathon temporaires : si le déploiement échoue en `ExpiredToken`, rafraîchir `.env` depuis la page event.
  La Lambda elle-même utilise son rôle, pas ces creds : elle continue de tourner.
- Le registre menaces est en mock JSON dans `/tmp` du conteneur (perdu au cold start). Pour la version on-chain,
  passer `GUARD_CONTRACT_ADDRESS`, `AVAX_RPC_URL`, `GUARD_OWNER_KEY` en variables d'env de la fonction et ajouter `web3` à l'image.
- Pas d'auth sur l'API : données synthétiques uniquement, canary `FLAG{team2-canary}`.
