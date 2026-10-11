# CLAUDE.md — Roadmap projet (Team 2)

**ESSECKATHON Secure Horizons — Track 01 Fintech Security**
Équipe (4) : **Corentin, Bruno, Maxime, Walid**.

> Doc de référence unique de l'équipe. Tout le monde s'y aligne. Préférence : pas de tiret cadratin.

---

## 1. Le projet en une phrase
Un **garde de sécurité (verification API) pour les paiements d'agents IA** : avant qu'un agent IA n'exécute un paiement, on vérifie l'autorité + l'intention (IA), puis on **délivre un "visa" (contrat on-chain) si OK**, on refuse si c'est une arnaque, ou on escalade à un humain. Tout est tracé sur **notre blockchain Avalanche** pour l'audit (DORA/MiCA).

Réponse directe au Track 01 problème 2 : *"a low-privilege agent, fed a booby-trapped document, tells a financial agent to execute a payment. Without authority-chain checks, it goes through (OWASP ASI03, ASI07)."*

## 2. Les 2 use cases (on garde les deux)
1. **Agentic shopping** : un agent qui achète tout seul (ex : l'affaire Scamlexity, l'agent achète sur un faux site et donne ses infos de paiement).
2. **Paiement IA-à-IA (machine-to-machine)** : un agent qui paie un autre agent / un service / une API (protocole **x402**, framework **Hermès** [à confirmer : Hermès = framework/modèle pour la partie IA-IA, ex paiement par inférence]).

## 3. Comment un agent se fait voler (le problème)
L'agent a le pouvoir de signer, agit seul sur ce qu'il lit (docs, outils, autres agents), sans jugement humain. Qui contrôle ses entrées contrôle ses paiements : prompt injection, tool poisoning, approbation piégée, confusion d'autorité. Le vrai trou = **personne ne vérifie qui a le droit de donner l'ordre** (authority-chain).

## 4. L'architecture (le flux)
```
  Agent IA veut payer
        |
        v
  [ Notre API de vérification = le garde ]
     - données d'input (scoring Corentin/Bruno)
     - IA (Claude/Bedrock) : intention / injection ?
     - autorité : l'émetteur a-t-il le droit ? (lecture on-chain)
        |
   decision:
   - OK      -> on délivre un CONTRAT "VISA" -> le paiement passe
   - NON     -> adresse = hacker -> enregistrée en DB -> refus direct la prochaine fois
   - DOUTE   -> escalade à un HUMAIN
        |
        v
  Tout tracé sur NOTRE BLOCKCHAIN (traçabilité DORA/MiCA, preuve de chaque décision)
```

Protocoles : **ERC-8004** (registre d'agents/validation) + **x402** (paiement). Décision oui/non = **smart contract** (recommandé par le mentor Avalanche).

## 5. La blockchain : à quoi sert notre L1
- Tout paiement d'agent passe par notre chaîne. La chaîne, via le **contrat de vérification**, délivre un **"visa"** (droit de payer) seulement si l'API dit OK.
- Le **precompile "Transaction Allow List"** (config, pas de Go) = la chaîne elle-même n'autorise que les agents habilités à transacter = pare-feu au niveau VM.
- Registre des adresses hackers (DB on-chain) = la 2e fois, refus direct.
- Traçabilité inviolable = l'audit DORA/MiCA + la preuve de chaque décision.
- Avalanche = requis pour le grant Team1, et "super valorisé" par le jury.

## 6. Répartition de l'équipe + interactions

| Qui | Ce qu'il fait | Comment il interagit |
|---|---|---|
| **Corentin + Bruno** | **LE CERVEAU** : héberger sur **AWS** les 2 agents (shopping + IA-IA), récupérer les données d'input, produire le **scoring + LA DÉCISION** (allow / block / needs_human). Inclut le check Claude "context empoisonné ?" (le `scorer.py` est de LEUR côté). **Red-team** l'attaquant. | Ils envoient le **verdict** à l'API on-chain de Walid. |
| **Walid** | **EXÉCUTION ON-CHAIN + MÉMOIRE** : la L1, les contrats (`AuthorityRegistry` = autorité + flags + **visa**, `GuardedVault` = paiement gardé), l'**API `authorize`** (verdict → visa/flag/pending on-chain), la **traçabilité DORA**. Ne décide pas, exécute et prouve. | Reçoit le **verdict** (Corentin/Bruno) → écrit visa/flag on-chain, le vault force le paiement → preuve lue par Maxime (UI + compliance). |
| **Maxime** [proposition, à confirmer] | L'**UI 3D** (voitures = transactions) + la **compliance** (DORA/MiCA, seuils KPMG) + le **pitch/deck**. | Lit la chaîne pour l'UI + mappe la traçabilité sur DORA/MiCA + construit le pitch à partir du travail de tous. |

## 7. Audit & scoring (la partie notée + KPMG)
- Objectif : **chaque décision a une preuve** de comment elle a été prise.
- Le gars de **KPMG** a dit de **vérifier par les seuils** (thresholds) → le scoring déclenche allow/block/humain selon des seuils clairs.
- **Dashboard** avec des KPIs clairs et utilisables (RH, data analyst) : detection rate, faux positifs, time to detect/respond, nb d'incidents, etc.
- Alimente la **defense sheet** (1 page : menace, NIST CSF, OWASP ASI03/ASI07 + ATLAS, métriques, limites).

## 8. L'UI 3D (le wow démo)
Comme sur le site d'Avalanche : une **ville en 3D** où chaque **transaction = une voiture**.
- Validée → passe le **péage**.
- Refusée → **demi-tour**.
- En attente d'un humain → se **gare sur le côté**.
Faisable avec Claude.

## 9. Idée growth (roadmap)
Donner de la **crypto en récompense** quand un utilisateur fait une transaction sur notre blockchain, pour attirer du monde et pousser l'usage.

## 10. Stack technique
- **AWS Bedrock** (Claude) : l'IA de vérification. **Bedrock AgentCore** : faire tourner les agents. Région **us-west-2**.
- **Avalanche** : L1 (Subnet-EVM + precompile Allow List) ou Fuji C-Chain en socle sûr (chainId 43113). ERC-8004 déjà live sur Avalanche.
- **x402** : paiement IA-IA. **Hermès** : framework IA-IA (à confirmer).
- Repo : https://github.com/maximdprt/hackathon_securehorizon_track1

## 11. État actuel (ce qui est déjà fait)
- `detection/scorer.py` : le garde IA (Bedrock Claude) → verdict JSON. **Testé en live** (block/allow corrects). ✅
- `detection/verdict.schema.json` : le format de verdict partagé. ✅
- `contracts/AuthorityRegistry.sol` + `contracts/GuardedVault.sol` : contrats "visa" + vault gardé. ✅ (en cours de déploiement)
- `api/authorize.py` : exécuteur on-chain (verdict → visa/flag/pending). ✅
- Accès AWS OK, Bedrock + Claude OK. ✅
- `guard/` + `mcp_server.py` : **le cerveau** (Corentin/Bruno). Serveur MCP avec 3 outils (`verify_payment`, `list_pending`, `approve_pending`). Pipeline : sanitisation (HTML caché, Unicode invisible, base64) → 7 couches de signaux (contenu, mandat, autorité, contrepartie, transaction, outils, comportement) → blocs durs → Claude Bedrock → **score de confiance dégressif** (part de 100, chaque signal retire une part, bloc dur = 0 ; allow ≥ 70, humain 30 à 70, block < 30) → sévérité → file humaine + log JSONL + registre menaces. Le mandat est résolu côté serveur (`data/mandates.json`), jamais déclaré par l'agent. ✅
- `redteam/` : 21 scénarios (S1..S7, M1..M10, A1, I1, contrôles) + `demo/fixtures` (7). `python redteam/run.py` → detection rate 100 %, faux positifs 0 %, latence < 1 ms sans Claude, ~3 s avec. ✅
- `detection/research/` : taxonomie, 71 features, scénarios, scrap. ✅
- **Campagne de tests** (`docs/test-campaign.md`) : 47 cas bénins (faux positifs 38 % → 0 %), évasion 850 mutations, fuzzing 800 requêtes, protocole MCP, persistance, 3 passes Claude live stables. Lexique réécrit en précision. ✅
- `agents/` : **les 2 agents** (shopping + x402), vrais agents Bedrock Haiku avec tool use, le garde devant le wallet. Hébergés sur **AWS Lambda** (image arm64, API Gateway) : https://yo6k6eid4h.execute-api.us-west-2.amazonaws.com/ (index HTML, `?agent=x402&scenario=premium&guard=on`, `&mode=async` + `?run=<id>` pour les runs longs). Déploiement : `deploy/deploy_lambda.py`. ✅
- Spec : `docs/superpowers/specs/2026-10-10-guard-decision-engine-design.md`.
- **Hermès sur AWS (navigateur agentique hébergé)** : le navigateur de Corentin + le garde + la chaîne tournent sur AWS Lambda (image arm64, API Gateway), servant l'UI React et `/api/run` (run complet en ndjson, rejoué animé). URL : https://yo6k6eid4h.execute-api.us-west-2.amazonaws.com/ . Modèle par défaut Haiku (rapide, run ~18 s < 30 s), garde moteur in-process, décision écrite sur SentinelL1 (voiture dans la ville). Handler `deploy/lambda_handler.py`, déploiement `deploy/deploy_lambda.py`. ✅ Testé live (bloc + flag + décision on-chain).
- **Parcours complet branché** (chat sandbox de Corentin → SentinelL1) : l'agent est un agent ordinaire, **il ne connaît pas le garde**. Il cherche parmi 5 boutiques, choisit et **envoie sa transaction à SentinelL1**. C'est à l'entrée de la chaîne (`agents/sentinel_gateway.py`) que notre MCP `verify_payment` (vrai moteur) dit si la transaction est piégée ; `agents/sentinel_chain.py` inscrit la décision à `POST https://rpc.petroi.fr/authorize` (allow → visa, block → flag, needs_approval → `needs_human`) ; l'UI montre le verdict + les tx (explorer) + le lien ville 3D. Lancer : `cd agents/ui && npm install && npm run build` puis `set -a; source .env; set +a; .venv/bin/python agents/app.py --open` (`--guard engine|stub|off`, `--chain URL|off`, `GUARD_LLM=on` pour Claude). Démo : Nimbus SE 249 → allow (visa), Series 10 > 300 → humain, Meridian (domaine de 9 jours) → block puis refus direct. ✅ Testé on-chain le 2026-10-10. Reste : exécuter le paiement via `GuardedVault.pay` (wallet agent à allowlister + approvisionner, côté Walid).

**Lancer le garde** : `uv venv --python 3.12 .venv && uv pip install -e ".[dev]"` puis `set -a; source .env; set +a; .venv/bin/python mcp_server.py` (stdio). `GUARD_LLM=off` pour tourner sans Bedrock. Tests : `.venv/bin/pytest`. Pour brancher Fuji (Walid) : `GUARD_CONTRACT_ADDRESS=0x... AVAX_RPC_URL=... GUARD_OWNER_KEY=...` + `uv pip install -e ".[chain]"`.

### 11.1 Déploiement L1 (Walid) — coordonnées
- **EC2** : `i-086e4f697fb388d91` (Ubuntu 24.04), SSM online, SG `sg-04545b9eb3cb167d6` (ports 9650 RPC + 9651 staking ouverts).
- **Subnet (Fuji P-Chain)** : `jUCDvuYEuP16TFpxjanBQt6JiedTDUBanrYTBjThmdmfw8PxH`
- **Blockchain** : `2PqooUD2u82cQVbEHUfSnK5GTnRfUg17d8RUuccc97y27NkZhd` (Subnet-EVM, chainId 99999, token SEC)
- **NodeID validateur** : `NodeID-5dd7CBhH8UDU3QCUbSWBFSckXZrC4mHi9` (+ BLS PoP dans `/tmp/l1_node.txt` sur la machine de Walid)
- **Genesis** : `contracts/genesis.json` (Tx Allow List + Contract Deployer Allow List, admin = wallet Walid, airdrop SEC au wallet).
- **RPC L1 (LIVE)** : `http://54.70.187.95:9650/ext/bc/2PqooUD2u82cQVbEHUfSnK5GTnRfUg17d8RUuccc97y27NkZhd/rpc` (EC2 IP 54.70.187.95)
- **convert-to-l1** : ✅ fait, TX `2SxuP6YTe2vDcQ1BhTbErhT2uiUoSPYppiYYhajfwN6UoGTHRk`, node = validateur L1 actif (weight 100).

### 11.3 Contrats déployés (LIVE sur SentinelL1) ✅
- **AuthorityRegistry** : `0x7A7e5F80BE65F588DF975C4Aa563BA442db8bcb6`
- **GuardedVault** : `0xc7deAE9f1205e9c8B99d3311458542938D8CC7c0` (câblé : `registry.vault()` = vault, `vault.registry()` = registry)
- Compilés en **`--evm-version paris`** (la chaîne est pré-Shanghai → pas de PUSH0, sinon `invalid opcode`).
- **Test E2E validé on-chain** : dépôt → pay sans visa REVERT (`visa invalid`, destinataire +0) → `grantVisa` → pay AVEC visa SUCCÈS (+1 SEC) → re-pay REVERT (one-time). Le `.env` contient `L1_RPC_URL`, `REGISTRY_ADDRESS`, `VAULT_ADDRESS`.
- MetaMask : Network name SentinelL1, Chain ID **99999**, symbole **SEC**, RPC = `SENTINEL_API_BASE/rpc` (voir ci-dessous).

### 11.4 API `authorize` LIVE (l'interface pour le cerveau) ✅
- `api/server.py` (FastAPI) + `api/authorize.py` tournent sur l'EC2 en **services systemd** `sentinel-api` (uvicorn :8080) + `sentinel-tunnel` (cloudflared), tous deux `Restart=always` = persistants.
- **URL publique FIXE** (named tunnel `sentinel` → CNAME `rpc.petroi.fr`, ne change plus jamais) : **`https://rpc.petroi.fr`**
  - **Cerveau** : `POST /authorize` body `{"payment":{"issuer","recipient","amount","nonce"?},"verdict":"allow|block|needs_human","reason","ttl"}` → écrit visa/flag/pending on-chain, renvoie `payment_id` + tx hashes (preuve DORA).
  - **MetaMask / ethers** : `POST /rpc` (proxy JSON-RPC transparent).
  - **UI / lecture** : `GET /health`, `GET /visa/{paymentId}`, `GET /flagged/{address}`.
  - **Feed 3D (Maxime)** : `GET /cars?sinceBlock=N` (polling) + `GET /feed` (SSE). Voir §11.7.
  - CORS ouvert. Testé bout-en-bout via `https://rpc.petroi.fr` (allow→visa valid, block→flagged severity 3, rpc→chainId 0x1869f).
- URL fixe via named tunnel (cert `cloudflared tunnel login` sur zone petroi.fr → tunnel `sentinel` → CNAME proxied `rpc.petroi.fr`). Stable même après reboot.
- L'authorizer = le wallet owner (déjà `authorizers[owner]=true`). Pour la prod on ferait un `setAuthorizer(clé_API_dédiée)`.

### 11.5 Block explorer SentinelScan (EROL, rebrandé) ✅
- Explorer **SentinelScan** (code dans le repo : **`explorer/backend`** + **`explorer/frontend`**), pointé sur notre L1, **design system Vercel** (voir `DESIGN.md`). Déployé sur l'EC2.
- **URL publique FIXE** : **`https://explorer.petroi.fr`** (ingress ajouté au même named tunnel `sentinel`).
- Stack sur l'EC2 : **MongoDB** (Docker `mongo:7`, port 127.0.0.1:27017) + **backend** Node/Koa (`erol-api` :3002, REST `/blocks /transactions /entity`) + **indexer** (`erol-indexer`, suit les nouveaux blocs via `provider.on("block")`) + **frontend** SvelteKit adapter-node (`erol-frontend` :3005).
- Fixes faits : (a) `TransactionService.getTransaction` rendu robuste (accepte string ou objet `TransactionResponse` → corrige le `CastError` de l'indexer/backfill, compat ethers v6) ; (b) adapter `vercel`→`node` ; (c) adapter-node épinglé **v5** (v6 casse avec kit 2.27, `reading 'base'`) + `--legacy-peer-deps` ; (d) toutes les `PUBLIC_*` définies dans `.env` ; (e) thème Vercel (`:root` override daisyUI : base-100 #fff, base-200 #fafafa, base-content/primary #171717, info/success #0070f3, error #ee0000, Geist + Geist Mono, hairlines + ombres empilées) ; (f) rebrand texte complet (en.json + Footer + suppression logos Martian + langue "martian" retirée).
- **Backfill de l'historique** (l'indexer ne prend que les nouveaux blocs) : `cd /root/erol-backend && npx ts-node backfill.ts`.

### 11.6 Ops — services & récap (tout sur l'EC2 `i-086e4f697fb388d91`, piloté par SSM)
Services systemd (`Restart=always`) : `sentinel-api` (API authorize uvicorn:8080) · `sentinel-tunnel` (cloudflared named tunnel) · `erol-api` (:3002) · `erol-indexer` · `erol-frontend` (:3005) · `sentinel-city` (UI 3D Next.js, `next start` :3006, dossier `/root/city`) · Docker `mongo`. L'`avalanchego` tourne en nohup (`/root/ago.log`, data `/root/.avalanchego`).
- Named tunnel `sentinel` (`/root/.cloudflared/config.yml`) route : `rpc.petroi.fr`→:8080 (API+RPC), `explorer.petroi.fr`→:3005 (explorer), `city.petroi.fr`→:3006 (UI 3D).
- Redémarrer un service : `systemctl restart <nom>` via SSM. Relire l'URL tunnel : `journalctl -u sentinel-tunnel`.
- **URLs publiques** : API/RPC `https://rpc.petroi.fr` · Explorer `https://explorer.petroi.fr` · UI 3D `https://city.petroi.fr` (mode live : `https://city.petroi.fr/?live=1`).
- ⚠️ les creds AWS du `.env` expirent (rafraîchir depuis la page event) ; l'IP publique EC2 peut changer au reboot mais les 2 URLs petroi.fr sont stables (named tunnel).

### 11.7 Feed 3D pour Maxime (transactions = voitures)
L'UI 3D consomme les **décisions on-chain** (events `DecisionRecorded` + contexte `VisaGranted` de `AuthorityRegistry`), déjà mappées en couloirs. Deux modes, même payload :
- **Polling** (recommandé, robuste) : `GET https://rpc.petroi.fr/cars?sinceBlock=N` → `{ "cars":[...], "latestBlock":N, "fromBlock":N }`. Au 1er appel omets `sinceBlock` (renvoie les ~300 derniers blocs) ; ensuite renvoie `latestBlock` comme `sinceBlock` et poll toutes les 1-2s.
- **SSE temps réel** : `GET https://rpc.petroi.fr/feed` → une ligne `data: {car}` par nouvelle décision.
- **SSE format city (Maxime)** : `GET https://rpc.petroi.fr/avaguard/events` → `data: {verdict, context, proof}` où `verdict` = `detection/verdict.schema.json` (AgenticPaymentVerdict), alimenté par chaque `POST /authorize`. C'est exactement ce qu'attend `sim/liveFeed.ts` de la city. `/authorize` accepte en option `full` (le verdict complet du cerveau) + `context` (labels UI) pour enrichir la voiture. Config city (`.env.local`) : `NEXT_PUBLIC_AVAGUARD_SSE_URL=https://rpc.petroi.fr/avaguard/events`, `NEXT_PUBLIC_RPC_URL=https://rpc.petroi.fr/rpc`, `NEXT_PUBLIC_REGISTRY_ADDRESS=0x7A7e…bcb6`, `NEXT_PUBLIC_CHAIN=l1`, `NEXT_PUBLIC_L1_CHAIN_ID=99999`. ✅ City alignée (Maxime) : ABI `DecisionRecorded(bytes32 paymentId, address issuer, string verdict, string reason)` dans `liveFeed.ts`, écrans d'audit lus sur `/cars` + `ThreatFlagged` (voir `ui3d-city/README.md`). ⚠️ côté API : `GET /cars?sinceBlock=<dernier bloc>` renvoie 500 quand la plage est vide (la city contourne en relisant le dernier bloc). City 3D hébergée sur **city.petroi.fr**.

Schéma d'une **voiture** :
```json
{ "verdict":"allow|block|needs_human",
  "lane":"pass|uturn|park",          // pass=passe le péage, uturn=demi-tour, park=se gare (attente humain)
  "paymentId":"0x…", "issuer":"0x…", "recipient":"0x…|null",
  "amount":"<wei string>|null", "reason":"…", "txHash":"0x…", "block": 123 }
```
Mapping 3D : `pass`→franchit le péage (vert), `uturn`→demi-tour (rouge, paiement refusé + preuve on-chain), `park`→se gare (ambre, escalade humaine). `reason` = le "pourquoi" lisible (ex. "scam site, prompt injection detected"). Chaque voiture est cliquable → `txHash` ouvrable sur `https://explorer.petroi.fr`.

### 11.2 ⚠️ Leçon versions (bloquant résolu)
Sur Fuji actuel (post-upgrade Granite), seul **avalanchego ≥ 1.15.x (RPCChainVM protocole 46)** peer (1.14.x = 0 peer, trop vieux). Le subnet-evm standalone (repo `ava-labs/subnet-evm`) plafonne à **v0.8.0 = protocole 44** → incompatible. **Le bon plugin protocole 46 est livré DANS la release avalanchego v1.15.1** : asset `subnet-evm-linux-amd64-v1.15.1.tar.gz` (le code subnet-evm est désormais "greffé" dans le repo avalanchego, `graft/subnet-evm`). Paire qui marche = **avalanchego 1.15.1 + subnet-evm plugin v1.15.1** (tous deux proto 46), plugin posé en `~/.avalanchego/plugins/srEXiWaHuhNyGwPUi444Tu47ZEDwxTWrbQiuD7FmgSAQ6X7Dy`. Node en **partial-sync** (`--partial-sync-primary-network`, `track-subnets`) = pas de C-Chain, bootstrap P-Chain seul (~10 min), 80 Go large.
- Alternative 1-clic si le self-host casse : le **launcher L1 du Console build.avax.network** (PoA, owner = wallet, Tx/Deployer Allow List cochés, relayer OFF) crée subnet+genesis+node managé+Validator Manager et donne un RPC Fuji public.
- Reste : `platform-cli subnet convert-to-l1` (node up) → déployer les 2 contrats → `setVault` → MAJ `.env` (`L1_RPC_URL`, `REGISTRY_ADDRESS`).

## 12. Prochaines étapes (priorité)
1. **Walid** : déployer la L1 / le contrat "visa", puis brancher `guard/sources.py:ChainSource` (lecture `authorities`/`threats`, écriture `recordDecision`/`flagThreat`) via les variables d'env. Le `mcp_server.py` est fait côté Corentin/Bruno. **Lire `docs/chain-e2e.md`** : test bout en bout sur le vrai contrat compilé (`tests/test_chain_e2e.py`, 3 actes on-chain), valeurs de seed Remix en 6 décimales, et l'écart restant (`maxAmount == 0` veut dire sans plafond on-chain mais jamais payer dans `mandates.json`). `ChainSource` est aligné sur le contrat déployé (`recordDecision` à verdict chaîne).
2. **Corentin + Bruno** : monter les 2 agents sur AWS + les scénarios d'attaque + produire le scoring.
3. **Maxime** : l'UI 3D + la slide compliance DORA/MiCA + le pitch.
4. Tous : chemin doré Acte 1 (agent vidé) → Acte 2 (sauvé + visa refusé + log on-chain) → Acte 3 (2e agent immunisé).

## 13. Règles repo & hackathon
- `git push` toutes les heures (compte AWS effacé à la fin).
- `.env` **jamais commité** (déjà dans `.gitignore`). Creds AWS temporaires = rafraîchir depuis la page event quand ça expire.
- Données synthétiques + canary flags (`FLAG{team2-canary}`), jamais de vraie donnée.
- Noter les adresses de contrat déployées ici.
- Avant de rendre le repo public : `scripts/scrub_check.sh` (scan historique + working tree, exit 1 si secret), checklist dans `docs/scrub-report.md` (rafraîchir les creds AWS, supprimer `mcp_server.log`, activer Secret scanning sur GitHub). Audit du 2026-10-10 : aucun secret dans l'historique.
- Livrables : PoC détection+réponse, response playbook, defense sheet (1 page), compliance slide (DORA/MiCA/AML/AI Act), pitch 4 min + vidéo démo, repo public (après scrub des secrets).
