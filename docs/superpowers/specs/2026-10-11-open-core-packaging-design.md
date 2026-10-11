# Spec : Sentinel en open-core (2 repos + API hébergée durcie)

Date : 2026-10-11. Auteur : Bruno (+ Claude). Statut : approuvé par Bruno (options recommandées), en construction.
Sources : brief "packager Sentinel en open-core", cartographie du 2026-10-11 (moteur, sources, tests, agents, API, Hermès).

## 0. Décisions prises (Bruno, 2026-10-11)
1. Les 2 repos vivent dans **`oss/sentinel-guard/`** et **`oss/secure-agent-starter/`** de ce monorepo. Extraction plus tard **par copie** (pas `git subtree split` : l'historique contient des URLs d'infra et des emails d'auteurs), après le scrub. Rien de public maintenant.
2. Le starter contient **les deux** : un agent Python autonome (shopping + x402 + finance) ET un dossier `hermes/` qui branche le **vrai Hermes Agent (Nous Research)**. L'agent Python ne s'appelle **pas** "Hermès" (c'est la confusion d'aujourd'hui : `agents/hermes_agent.py` est une copie maison) : il s'appelle "reference agent", persona Jarvis.
3. API hébergée (`api/server.py`, couloir de Walid) : **clé `SENTINEL_API_KEYS` + re-screening serveur** (le client ne peut que durcir). Désactivé tant qu'aucune clé n'est posée : rien ne casse. Walid active et redéploie, pas nous.

## 1. Frontière open / closed (à respecter, vérifiée au scrub)
| Open (MIT) | Fermé / hébergé |
|---|---|
| sanitizer, 7 couches de signaux, score dégressif, seuils, file humaine locale, journal local | écritures on-chain (`ChainSource`, `ChainSink`, ABI owner, `GUARD_OWNER_KEY`), SentinelL1, AuthorityRegistry |
| client HTTP de l'API hébergée (`/authorize`, `/flagged`) | `api/` (serveur), re-screening serveur, données du registre de menaces, onboarding des émetteurs |
| config d'exemple synthétique (`0xA11ce…`, `.example`) | dashboard conformité DORA/MiCA/AML/AI Act, tout modèle tuné |
| prompt LLM optionnel (prompt d'un modèle stock, pas de modèle tuné) | toute clé, `.env`, infra (EC2, IP, NodeID, compte AWS) |

Ne JAMAIS copier dans `oss/` : `guard/sources.py:ChainSource`, `guard/sinks.py:ChainSink`, `api/*`, `contracts/*`, `deploy/*`, `CLAUDE.md`, `.env*` (sauf `.env.example` vide), `redteam/evasion.py` + `evasion_report.md` (carte de contournement), `redteam/validate_onchain.py`, `detection/research/scrape_guardio_trustpilot.json`, tout `threats*.json` non vide, tout fichier d'état (`decisions.jsonl`, `pending.json`, `nonces.json`, `spend.json`, `visas.json`, `registry_events.jsonl`).

## 2. Repo 1 : `oss/sentinel-guard` (MIT)
### 2.1 Paquet
- Nom PyPI **`sentinel-guard`** (libre au 2026-10-11), module `sentinel_guard`, console script `sentinel-guard`, aussi `python -m sentinel_guard`.
- Python `>=3.11`. Deps : `mcp>=2.3,<3`, `beautifulsoup4>=4.12`, `pycryptodome>=3.20`, `starlette>=1.0.1` (CVE-2026-48710). Extras : `anthropic` (`anthropic`), `bedrock` (`boto3>=1.34`), `dev` (`pytest`, `jsonschema`).
- Build : hatchling ou setuptools, `src/` layout, données embarquées via `importlib.resources`.
- Distribution conseillée : `uvx`/`pipx` (Hermès épingle `mcp==1.26.0` : ne jamais pip-installer dans son venv). Interop v2 serveur / v1 client vérifiée (protocole 2025-11-25).

### 2.2 Moteur vendu (copie de `guard/`, renommée)
- Copier : `models.py`, `sanitize.py` (**octet pour octet** : caractères invisibles littéraux dans les regex, l.17-18), `lexicon.py`, `scoring.py`, `queue.py`, `features/{content,mandate,authority,counterparty,transaction,tools}.py`, `engine.py`, `sinks.py` (sans `ChainSink`), `sources.py` (sans `ChainSource`/ABI/`subject_key`), `llm.py` (refait).
- `engine.py` : supprimer la branche chaîne (`from_env` l.109-120) ; plus aucun chemin relatif à `ROOT` ; seuils = `scoring.DEFAULT_THRESHOLDS` (le JSON de recherche est redondant).
- **Séparer config et état** :
  - `SENTINEL_CONFIG_DIR` (lecture seule, config opérateur) : `mandates.json`, `authorities.json` (optionnel), `allowlist.json`, `brands.json`, `domains.json`, `addresses.json`, `history.json`, `facilitators.json`, `tools_inventory.json`. Défaut : la config d'exemple embarquée dans le paquet. Un fichier absent = vide.
  - `SENTINEL_STATE_DIR` (écriture) : `threats.json`, `nonces.json`, `decisions.jsonl`, `pending.json`, `spend.json`, `visas.json`, `registry_events.jsonl`. Défaut `~/.sentinel-guard/state`. Jamais dans le CWD (Hermès lance sans cwd).
- Mode local : un émetteur présent dans `mandates.json` est une autorité active (rôle et plafond tirés du mandat) ; `authorities.json` sert seulement à révoquer (`active:false`) ou plafonner.
- Corriger : `llm.py` import paresseux hors du `try` (crash si boto3 absent), timeout non respecté (`ThreadPoolExecutor` en context manager attend la fin), `llm_available` vrai même LLM coupé, `owasp` non filtré (ne garder que `ASI03`, `ASI07`), `onchain_flagged` → vrai seulement si le drapeau vient du registre partagé, sinon champ `flagged_locally` dans les détails.
- Logs : stderr uniquement. Rien sur stdout en mode stdio.
- Canary : regex configurable `SENTINEL_CANARY` (défaut `FLAG\{team2-canary\}` pour garder les tests).

### 2.3 LLM optionnel
- `SENTINEL_LLM=off` (défaut) `| anthropic | bedrock`. `SENTINEL_LLM_MODEL` (défaut anthropic `claude-sonnet-5`, bedrock `us.anthropic.claude-sonnet-4-6`), `SENTINEL_LLM_TIMEOUT` (défaut 20 s), région = `AWS_REGION`.
- Prompt = celui de `detection/scorer.py` (ouvrable : modèle stock). Ne pas envoyer `temperature` aux modèles qui le refusent (Opus 5, Sonnet 5, 4.7+). Jamais de crash : LLM indisponible = `None`, et le moteur ne devine jamais `allow` (règle existante).

### 2.4 Mandat : resserrer seulement (OWASP ASI03)
Le mandat d'autorité vient de la config opérateur (fichier + env du process MCP, posés par un humain), jamais du modèle. Le paramètre `mandate` de l'outil ne peut que **resserrer** :
- actions : intersection ; plafonds (`max_amount`, `max_daily`) : min des valeurs > 0 (0 = sans plafond, ignoré) ; destinataires : si opérateur vide, liste de l'appelant ; si les deux non vides, intersection ; intersection vide = signal dur `recipient_outside_declared_mandate` (jamais `[]` qui voudrait dire "tous") ; devise : intersection des ensembles `A|B` ; rôle et description : toujours ceux de l'opérateur (la description de l'appelant n'entre jamais dans le prompt LLM).
- Tentative d'élargissement ignorée + signal informatif `caller_mandate_widening_ignored` (ASI03, poids 0.05).
- Provenance dans la sortie détaillée : `mandate.source = "operator" | "operator+caller" | "caller (unregistered)"`.
- Émetteur absent de la config : `SENTINEL_UNREGISTERED=review` (défaut) → le mandat de l'appelant sert de plafond, autorité synthétique `role="unregistered"`, signal `mandate_self_declared` ajouté à `FLOOR_NEEDS_APPROVAL` : **jamais `allow`**, les arnaques bloquent quand même. `block` = comportement d'aujourd'hui (`issuer_in_registry` dur).
- `SENTINEL_ISSUER` (optionnel) : lie le serveur à un émetteur ; un autre `issuer` = signal dur `issuer_mismatch`.

### 2.5 Modes
- **local-only** : aucun appel réseau, marche hors ligne. Défaut si `SENTINEL_API_KEY` absente.
- **connected** : `SENTINEL_MODE=connected`, ou automatique si `SENTINEL_API_KEY` est posée. `SENTINEL_API` défaut `https://rpc.petroi.fr` (`off` force local). Ajoute : lecture du registre partagé (`GET /flagged/{address}`) + écriture on-chain via `authorize_payment`.
- Une valeur d'env de la forme `${...}` (placeholder non résolu par Hermès) = non posée.
- Le README dit ce que le mode connecté envoie (adresses screenées ; avec `authorize_payment`, l'ordre + le contexte source pour le re-screening serveur).

### 2.6 Registre partagé (lecture)
`HostedRegistrySource(local)` : `is_flagged(key)` regarde le local d'abord ; si connecté et `key` est une adresse `0x` + 40 hex : `GET {SENTINEL_API}/flagged/{addr}` (timeout 3 s, cache 30 s, header `Authorization: Bearer` si clé). Réponse `{address, flagged, severity}` (pas de raison) → raison `"flagged in the Sentinel shared registry (severity N)"`. Erreur réseau → repli local + note `[engine] shared registry unreachable, local registry only` (pas un FLOOR : enrichissement optionnel). Domaines et ids : local seulement (l'API renvoie 500).

### 2.7 Outils MCP (`MCPServer("sentinel-guard")`, avec `instructions`)
Un verdict (y compris `block`) est **toujours un résultat réussi**, jamais `isError` (disjoncteur Hermès : 3 erreurs = tous les outils du serveur coupés 60 s). `ToolError` seulement pour une requête mal formée.
1. `screen_payment(issuer, recipient, amount, currency="USDC", source_context="", mandate=None, action="pay", task="", context_type="text", context=None)` → **objet strictement valide contre `detection/verdict.schema.json`** (copie embarquée `sentinel_guard/schema/verdict.schema.json`) : `instruction_id, issuer, action, amount, currency, recipient, verdict ∈ {allow, needs_approval, block}, risk_score, reasons, owasp, authority_check, poison_check, onchain_flagged, timestamp`. Nommage : on garde **`needs_approval`** (le schéma, le moteur, les 49 tests, le flux de la ville) ; `needs_human` n'existe qu'à la frontière de l'API hébergée.
2. `authorize_payment(...mêmes paramètres..., ttl=300)` → screen local, puis si connecté `POST {SENTINEL_API}/authorize` ; retour plat : tous les champs du verdict (`verdict` = verdict effectif, le plus strict entre local et serveur) + `tx_hash` (visa_tx | flag_tx | decision_tx) + `explorer_url` (`https://explorer.petroi.fr/tx/<hash>`, base `SENTINEL_EXPLORER`) + `onchain {status: recorded|skipped|error, verdict (nommage API), payment_id, nonce, visa_tx, flag_tx, decision_tx, rescreened, server_verdict, error}`. Local-only ou adresses non EVM → `status: skipped` + raison. Échec réseau/HTTP → `status: error`, verdict local conservé.
   - Corps envoyé : `{"payment": {"issuer", "recipient", "amount": int(Decimal(amount) * 10**SENTINEL_AMOUNT_DECIMALS (18)), "nonce": time_ns()//1000}, "verdict": allow|block|needs_human, "reason": "trust=<n>/100; <raisons courtes>"[:200], "ttl", "screen": {"order", "source_context", "context_type", "task", "context"}, "context": {"issuer_label", "recipient_label", "source": "sentinel-guard"}}`. **Pas de `full`** (republié sur le SSE public).
   - `payment_id` (clé de `/visa`) ≠ `instruction_id` (clé locale) : les deux sont renvoyés.
3. `explain_decision(instruction_id)` → l'enregistrement complet (trust_score, signals, deductions, seuils, mandat effectif). Lecture seule.
4. Outils humains (`list_pending`, `approve_pending`, `lift_flag`) : **exposés seulement si `SENTINEL_APPROVER_TOKEN` est posé** (fail-closed, l'agent ne peut pas s'auto-approuver). Sinon via la CLI (humain au terminal).
Descriptions d'outils : formulation neutre (le scanner d'Hermès signale `system:`, `ignore previous instructions`, `curl https://`, `do not tell`).

### 2.8 CLI
`sentinel-guard [serve]` (`--transport stdio|streamable-http`, `--host 127.0.0.1`, `--port 8000`, `--path /mcp` ; en HTTP, `SENTINEL_HTTP_TOKEN` optionnel = bearer exigé ; hors localhost, `TransportSecuritySettings` explicite) · `sentinel-guard init --issuer 0x… --max-amount N --actions pay,approve [--recipients …]` (écrit un `mandates.json` dans le config dir utilisateur) · `sentinel-guard screen <request.json>` (verdict sur stdout, pour tester sans agent) · `sentinel-guard pending` / `approve <id> allow|decline|block --approver NAME` · `sentinel-guard eval` (corpus embarqué → detection rate / faux positifs).

### 2.9 Tests et corpus
- Porter quasi tel quel les 118 tests (sanitize 8, scoring 8, content 12, counterparty 3, engine 12, edge 27, fuzz 47, persistence 3) ; adapter `test_mcp_protocol` (nouveaux outils, entrée `python -m sentinel_guard`, env isolé). Ne pas porter `test_chain_e2e`, `test_evasion`, `test_calibrate`.
- Nouveaux tests : validité stricte du schéma ; mandat resserrer seulement (élargir impossible, resserrer possible, non enregistré jamais allow) ; aucun appel réseau en local (réseau monkeypatché pour lever) ; registre partagé (serveur HTTP local qui simule `/flagged`) ; `authorize_payment` (serveur local qui simule `/authorize` : corps, header, wei, nonce µs, mapping, `screen` présent, `full` absent ; erreur réseau → résultat réussi `status:error`) ; `${VAR}` = non posé ; LLM coupé n'importe ni boto3 ni anthropic ; stdout propre en stdio ; outils humains absents sans token.
- Corpus d'éval : `redteam/cases` (68) + `demo/fixtures` (7) → `sentinel_guard/evals/` ; domaines/emails possiblement réels remplacés par `.example` **seulement si les verdicts ne bougent pas** (comparer avant/après) ; runner sans fichier suivi écrit, sans fuite de tmp dirs. Cible : detection 100 %, FP 0 %.

### 2.10 README (anglais, sans tiret cadratin)
Quickstart "1 ligne" : `claude mcp add sentinel -- uvx sentinel-guard` (+ forme `--from` avant PyPI), Claude Desktop (chemin absolu de uvx), Cursor, Hermès (YAML). Les 2 modes, le schéma verdict, exemples (page PromptFix → block, x402 surfacturé → block, achat légitime → allow), référence des outils, des variables d'env, modèle de mandat, vie privée, frontière open/closed, sécurité (outils humains, `SENTINEL_ISSUER`). `LICENSE` MIT, `.env.example` vide, `CHANGELOG.md`.

## 3. Repo 2 : `oss/secure-agent-starter` (MIT)
### 3.1 Agent de référence (Python, paquet `secure_agent_starter`, script `secure-agent`)
- Un agent, 3 modes = 3 scénarios jouables, chacun avec variantes : `shopping` (légit `allow` / arnaque PromptFix `block`), `x402` (légit `/weather` `allow` / surfacturation `/premium` `block`), `finance` (légit `allow` / douteux `needs_approval` / arnaque `block`).
- Le garde est **dans** le seul chemin d'argent (`pay`, `pay_x402`) : l'agent ne le connaît pas ; le verdict revient comme résultat d'outil (allow → wallet simulé exécute ; needs_approval → "parked, waiting for a human" ; block → "refused, do not retry").
- Branchement : client MCP stdio qui lance `python -m sentinel_guard` (dépendance `sentinel-guard`, source locale `../sentinel-guard` via `[tool.uv.sources]` dans le monorepo). Outil appelé : `authorize_payment` (connecté, défaut) ou `screen_payment` (`--offline`).
- Pointe sur l'hébergé par défaut (`SENTINEL_MODE=connected`, `SENTINEL_API=https://rpc.petroi.fr`, clé lue dans l'env si présente) ; `--offline` = local-only.
- LLM : `--llm anthropic` (ANTHROPIC_API_KEY, `claude-haiku-4-5`), `bedrock` (Converse, `us.anthropic.claude-haiku-4-5-20251001-v1:0`, `AWS_REGION`), `scripted` (déterministe, sans clé : joue un agent crédule qui suit l'injection ; sert à la démo hors ligne et à la CI). Défaut : anthropic si clé, sinon bedrock si creds AWS, sinon scripted. Format interne Converse, adaptateur Messages API (pas de `temperature` par défaut).
- `--guard off` montre l'acte 1 (wallet vidé), `--guard on` l'acte 2.
- **Pas de vérité terrain dans l'entrée du garde** : les faits passés au garde (âge du domaine, prix, devis x402) sont des faits observables décrits dans le fichier de scénario, jamais dérivés de l'étiquette "fraude" (défaut des agents actuels : `assets.context_for`, contexte pris dans la fixture).
- Copier/adapter : `agents/common/wallet.py`, `agents/fake_api/server.py`, `agents/common/tools.py` (rendu navigateur), `demo/fake_store/{index,checkout}.html`, page Nimbus légitime, `agents/assets.py` (fiches finance), comportement de `git show dad43cf:agents/shopping_agent.py` et `agents/x402_agent.py`. Ne pas copier `world.py`, `shops.py`, `agents/llm.py`, les deux `GuardClient`.
- `secure-agent wallet-mcp` : serveur MCP stdio exposant le wallet gardé (`search`, `research`, `open_page`, `call_api`, `pay`, `pay_x402`) pour Hermès (le garde reste dans `pay`, donc appliqué même si le LLM saute le screening).

### 3.2 `hermes/` (le vrai Hermes Agent, Nous Research)
- Distribution de profil installable : `hermes profile install ./oss/secure-agent-starter/hermes --alias` → profil isolé (`sentinel-demo`), ne touche pas au Hermès perso.
- `distribution.yaml`, `config.yaml` (`mcp_servers.sentinel` = `uvx sentinel-guard` + env `SENTINEL_API`, `SENTINEL_API_KEY: "${SENTINEL_API_KEY}"` ; `mcp_servers.wallet` = `secure-agent wallet-mcp` ; `tools.include` ; `sampling.enabled:false` ; toolsets terminal / code_execution coupés si la config le permet), `SOUL.md` (Jarvis, formulation qui passe le scanner : pas de "you are now a"), `skills/safe-payments/SKILL.md` (sans `requires_tools`, à épingler `hermes curator pin safe-payments`), `README.md` (install, `hermes mcp test sentinel`, prompts d'essai, forme `hermes mcp add`).
- Rappel : via `mcp_servers` le screening est consultatif ; l'application vient du `pay` gardé du wallet MCP.

### 3.3 Tests
ScriptedLLM : chaque scénario donne le verdict attendu, garde coupé = wallet vidé sur l'arnaque ; branchement MCP réel ; adaptateur Anthropic (traduction, sans réseau) ; YAML Hermès valide et frontmatter du skill parsable.

## 4. API hébergée (`api/server.py`, couloir de Walid : code + tests, pas de redéploiement)
- `require_key` (dépendance FastAPI) sur `POST /authorize` seulement : `SENTINEL_API_KEYS` (séparées par des virgules) ; vide = ouvert comme aujourd'hui ; sinon `Authorization: Bearer` exigé (401), comparaison `hmac.compare_digest`, `key_id` = sha256[:12] dans les logs.
- Champ optionnel `screen` (`order`, `source_context`, `context_type`, `task`, `context`) : contrôles de cohérence avec `payment` (issuer, recipient, montant en wei, nonce si présent) → 400 sinon ; re-screen avec le moteur `guard` (construit sans `GUARD_OWNER_KEY`, lecture chaîne seule si `GUARD_CONTRACT_ADDRESS`, `GUARD_LLM` explicite) ; verdict effectif = le plus strict (`allow < needs_human < block`).
- `SENTINEL_RESCREEN=off|tighten|require` (défaut `tighten` sans clés, `require` avec clés : un `allow` sans `screen` devient `needs_human`) ; `SENTINEL_TRUSTED_KEYS` exempte nos appelants (Lambda) de `require`.
- Flag on-chain du destinataire : en re-screen, seulement si le blocage serveur vient du côté destinataire (le moteur l'a marqué sévérité ≥ 3), avec cette sévérité ; un émetteur inconnu ne fait jamais flaguer un marchand. Un `block` client sans re-screen ne flague que pour une clé de confiance (quand les clés sont actives). `authorize.py` reçoit un paramètre optionnel (`flag_severity` / pas de flag), défaut = comportement actuel.
- Verrou `_CHAIN_LOCK` autour des écritures (course aux nonces), adresses invalides → 400 (pas 500), `ttl` borné (1..86400), `reason` ≤ 200.
- SSE : publier le verdict serveur si re-screen, sinon `full` avec `verdict` réécrit au verdict effectif (la voiture ne contredit jamais la chaîne).
- Réponse : clés actuelles + `client_verdict`, `server_verdict`, `rescreened`, `tightened`, `trust_score`, `key_id`.
- `api/requirements.txt`, tests FastAPI `TestClient` avec un faux module `authorize` (aucune écriture réelle), note d'activation pour Walid : donner une clé de confiance à la Lambda et faire envoyer `Authorization` par `agents/sentinel_chain.py` AVANT de poser `SENTINEL_API_KEYS`.

## 5. Critères "done" (vérifiés, preuves dans le rapport)
1. Le MCP ajouté à un agent (client MCP Python, `hermes mcp test` avec un `HERMES_HOME` jetable, appel headless Claude Code) → `screen_payment` renvoie un verdict valide.
2. `authorize_payment` en mode connecté écrit un **visa** (cas légit) et un **flag** (cas arnaque, adresse synthétique) sur SentinelL1, visibles sur explorer.petroi.fr (reçu `status 0x1`, `/visa` valide, `/flagged` vrai).
3. Scrub : `scripts/scrub_check.sh` sur une copie temporaire de chaque repo + recherche ciblée (clés, valeurs du `.env`, empreintes d'infra, état du registre) → 0 FAIL.
4. Tests verts : suite `guard/` existante intacte, `oss/sentinel-guard`, `oss/secure-agent-starter`, `api/`.
