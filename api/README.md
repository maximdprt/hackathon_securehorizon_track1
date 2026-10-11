# API SentinelL1 : activation du durcissement de `POST /authorize`

Note pour Walid (couloir on-chain). Le code est prêt et testé, **rien n'est déployé** : c'est toi qui actives et redémarres.
Référence : `docs/superpowers/specs/2026-10-11-open-core-packaging-design.md`, section 4.

## 1. Ce qui change, en bref

- **Clés d'API** (`SENTINEL_API_KEYS`) sur `POST /authorize` seulement. `/health`, `/visa`, `/flagged`, `/cars`, `/feed`, `/avaguard/events` et `/rpc` restent ouverts (la ville, MetaMask et l'explorer en ont besoin).
- **Re-screening serveur** : si l'appelant envoie le bloc optionnel `screen` (ce que l'agent a lu), le serveur rejuge l'ordre avec le moteur `guard/` et garde le verdict **le plus strict** (`allow < needs_human < block`). Le client ne peut que durcir.
- **Flag on-chain du destinataire** encadré : après re-screen, flag seulement si le serveur a lui-même condamné le destinataire (sévérité 3 du moteur). Un émetteur inconnu du serveur ne fait jamais flaguer un marchand. Sans re-screen et avec les clés actives, un `block` ne flague que pour une clé de confiance.
- **Robustesse** (actif tout de suite, ne touche que les entrées malformées) : adresse invalide = 400 (au lieu de 500), `ttl` borné de 1 à 86400 s (422 sinon), `amount` et `nonce` bornés à un uint256 (422), `reason` coupée à 200 caractères, un verrou `_CHAIN_LOCK` autour des écritures (fin des "nonce too low" en concurrence), `/flagged/<pas une adresse>` et `/visa/<pas un bytes32>` = 400, `/cars?sinceBlock=<dernier bloc>` = liste vide (au lieu de 500).
- **SSE `/avaguard/events`** : le verdict publié est toujours celui écrit on-chain (la voiture ne contredit jamais la chaîne). Après re-screen, c'est le verdict du serveur, réduit aux champs du schéma + `trust_score` + `signals` (le mandat, les déductions et le devis x402 restent sur le serveur).
- **Réponse** : toutes les clés actuelles (`status, verdict, payment_id, nonce, visa_tx | flag_tx, decision_tx`) + `client_verdict`, `server_verdict`, `rescreened`, `tightened`, `trust_score`, `instruction_id` (id du moteur), `key_id`. `rescreen_error` apparaît si un `screen` a été envoyé mais que le moteur n'a pas pu juger.

**Tant que `SENTINEL_API_KEYS` est vide et qu'aucun appelant n'envoie `screen`, le comportement est celui d'aujourd'hui** (vérifié par les tests avec la charge exacte de `agents/sentinel_chain.py` et les 3 presets de `SimPanel.svelte`).

## 2. Checklist d'activation (dans cet ordre)

### Étape 0 : déposer le code (sans clés, rien ne casse)
1. Sur l'EC2, à côté du dossier de l'API, déposer `guard/` (avec `guard/features/`) et `data/`. Le serveur ajoute le dossier parent de `api/` au `sys.path` : il faut donc `<parent>/api`, `<parent>/guard`, `<parent>/data`. (Ou poser `PYTHONPATH=<parent>` dans le service.)
   - `detection/` seulement si `GUARD_LLM=on` (voir plus bas). `detection/research/features_scoring.json` est optionnel (les seuils par défaut sont identiques).
2. Dans le venv du service : `pip install -r api/requirements.txt`.
3. Créer le dossier d'état du moteur (mémoire hébergée, **fermée**) :
   ```bash
   mkdir -p /var/lib/sentinel/guard
   cd <parent>/data && cp mandates.json authorities.mock.json allowlist.json brands.json domains.mock.json \
      addresses.mock.json history.mock.json facilitators.json tools_inventory.json /var/lib/sentinel/guard/
   echo '{}' > /var/lib/sentinel/guard/threats.mock.json
   ```
   Ne jamais y copier `decisions.jsonl`, `pending.json`, `nonces.json`, `spend.json`, `visas.json` d'une autre machine.
4. Ajouter au fichier d'environnement du service (`systemctl cat sentinel-api` pour le trouver) :
   ```
   GUARD_DATA_DIR=/var/lib/sentinel/guard
   GUARD_LLM=off
   GUARD_CONTRACT_ADDRESS=<valeur de REGISTRY_ADDRESS>
   AVAX_RPC_URL=<valeur de L1_RPC_URL, le noeud local>
   ```
   **Jamais `GUARD_OWNER_KEY` dans ce process** : le code la retire de l'environnement de toute façon (sinon le moteur écrirait lui-même `flagThreat`/`recordDecision` avec le wallet owner, en double et en course de nonces avec `authorize.py`). `GUARD_CONTRACT_ADDRESS` donne au moteur une **lecture** seule du registre (flags et autorités on-chain).
5. `systemctl restart sentinel-api`, puis `journalctl -u sentinel-api -n 50` : pas d'erreur au démarrage. Le moteur est construit au premier `screen` reçu ; s'il ne peut pas (dépendance manquante, dossier non inscriptible), le journal dit `re-screening unavailable: ...` et l'API continue de répondre.
6. Vérifier le re-screen sans visa ni flag (une seule tx `recordDecision`) : un `needs_human` avec un `screen` légitime doit répondre `"rescreened": true, "server_verdict": "allow", "verdict": "needs_human"`.
   ```bash
   curl -s https://rpc.petroi.fr/authorize -H 'content-type: application/json' -d '{
     "payment": {"issuer": "0xA11ce00000000000000000000000000000000001", "recipient": "0x5e11e40000000000000000000000000000000001",
                 "amount": "80000000000000000000"},
     "verdict": "needs_human", "reason": "activation check",
     "screen": {"order": {"issuer": "0xA11ce00000000000000000000000000000000001", "action": "pay", "amount": 80,
                          "recipient": "0x5e11e40000000000000000000000000000000001"},
                "source_context": "Monthly SaaS invoice #4471 from known vendor, 80 USDC.", "context": {"origin": "user"}}}'
   ```
   Pas de `nonce` ici : le serveur prend l'heure (secondes), et un `nonce` fixe dans `screen.order` serait vu comme un rejeu par le moteur au 2e essai.

### Étape 1 : clé de confiance pour nos appelants, AVANT d'activer les clés
1. Générer les clés (pas de virgule dedans) : `python3 -c "import secrets; print('sk_' + secrets.token_urlsafe(32))"`. Une clé de confiance pour la Lambda (et `agents/app.py` en local), une clé par partenaire ou adoptant OSS.
2. Poser `SENTINEL_TRUSTED_KEYS=<clé Lambda>` dans l'environnement du service, `systemctl restart sentinel-api`. **Seul, ça ne ferme rien** : l'API reste ouverte tant que `SENTINEL_API_KEYS` est vide, mais elle reconnaît déjà la clé (champ `key_id` non nul dans la réponse, `key=<id>` dans le journal).
3. Faire envoyer `Authorization: Bearer $SENTINEL_API_KEY` par `agents/sentinel_chain.py` quand la variable est posée (modification côté Corentin/Bruno, ce dossier n'est pas dans ce lot), puis redéployer la Lambda (`deploy/deploy_lambda.py`) avec `SENTINEL_API_KEY=<clé Lambda>`. Même chose pour `agents/app.py` en local et `redteam/validate_onchain.py` (ils passent par `SentinelChain`).
4. Vérifier qu'un run de la démo hébergée renvoie un `key_id` non nul (ou voir `key=<id>` dans `journalctl -u sentinel-api`). Tant que ce n'est pas le cas, **ne pas passer à l'étape 2** : la démo prendrait des 401.

### Étape 2 : l'explorer
`explorer/frontend/src/lib/components/SimPanel.svelte` poste depuis le navigateur, sans clé : une clé dans le front fuiterait. À décider avant l'étape 3 : le retirer, le faire passer par un proxy serveur qui détient une clé, ou accepter qu'il réponde 401.

### Étape 3 : activer
1. Poser `SENTINEL_API_KEYS=<clé partenaire 1>,<clé partenaire 2>` (la clé de confiance n'a pas besoin d'y être répétée), `systemctl restart sentinel-api`.
2. `SENTINEL_RESCREEN` passe alors par défaut à `require` : un `allow` sans `screen` devient `needs_human` (pas de visa), sauf pour une clé de confiance. `block` et `needs_human` sont toujours acceptés.
3. Vérifier :
   - sans clé : `401` avec `WWW-Authenticate: Bearer` ;
   - avec une clé partenaire, un `allow` sans `screen` : `"verdict": "needs_human", "tightened": true` ;
   - la démo hébergée (clé de confiance) donne toujours son visa sur le cas légitime.

## 3. Rollback
- **Rouvrir l'API comme avant** : retirer `SENTINEL_API_KEYS` (et `SENTINEL_RESCREEN` si posé) du fichier d'environnement, `systemctl restart sentinel-api`. Le client qui envoie encore `Authorization` n'est pas gêné (en mode ouvert, l'en-tête est ignoré s'il n'est pas reconnu).
- **Couper seulement le re-screening** : `SENTINEL_RESCREEN=off` (le bloc `screen` est alors ignoré, le verdict du client est écrit tel quel).
- **Revenir au code précédent** : reprendre `api/server.py` et `api/authorize.py` de la version d'avant dans git, redémarrer. Le dossier `GUARD_DATA_DIR` peut rester, il n'est plus lu.

## 4. Référence des variables

| Variable | Défaut | Rôle |
|---|---|---|
| `L1_RPC_URL`, `REGISTRY_ADDRESS`, `AUTHORIZER_KEY`, `VISA_TTL_SECONDS` | inchangés | exécuteur on-chain (`authorize.py`) |
| `SENTINEL_API_KEYS` | vide = ouvert | clés Bearer acceptées sur `POST /authorize`, séparées par des virgules |
| `SENTINEL_TRUSTED_KEYS` | vide | clés de nos appelants (Lambda) : acceptées même hors `SENTINEL_API_KEYS`, exemptées de `require`, leur `block` sans `screen` flague encore le destinataire (sévérité 3) |
| `SENTINEL_RESCREEN` | `tighten` sans clés, `require` avec | `off` : ignore `screen` ; `tighten` : rejuge si `screen` est là ; `require` : en plus, un `allow` sans re-screen réussi devient `needs_human` |
| `SENTINEL_AMOUNT_DECIMALS` | `18` | conversion `screen.order.amount` (unités) vers `payment.amount` (wei de SEC) pour le contrôle de cohérence |
| `GUARD_DATA_DIR` | `<parent>/data` | config + mémoire du moteur hébergé, doit être inscriptible (sinon re-screen indisponible) |
| `GUARD_LLM` | `off` (ici) | `on` : Claude sur Bedrock en plus des règles. Demande `boto3`, `detection/scorer.py` et des creds AWS sur l'EC2 ; ajoute environ 3 s et tient le verrou du moteur pendant l'appel. S'il ne charge pas, le moteur tourne sans Claude (plus strict) |
| `GUARD_CONTRACT_ADDRESS`, `AVAX_RPC_URL` | non posés | lecture seule du registre on-chain par le moteur (`AVAX_RPC_URL` = le noeud local) |
| `GUARD_TOKEN_DECIMALS` | `6` | décimales de `authorities.maxAmount` on-chain (lecture des plafonds) |
| `GUARD_OWNER_KEY` | **jamais** | retirée de l'environnement par le serveur |

## 5. Contrat de `screen` (envoyé par le client OSS `sentinel-guard`)

```json
"screen": {"order": {"issuer": "0x…", "action": "pay", "amount": 80, "currency": "USDC", "recipient": "0x…", "nonce": 1},
           "source_context": "<ce que l'agent a lu>", "context_type": "text|html|email|tool_output",
           "task": "<la tâche de l'agent>", "context": {"origin": "…", "merchant": {…}, "x402": {…}}}
```
Contrôles de cohérence avec `payment` (sinon 400) : même `issuer`, même `recipient` (comparés en checksum), même montant (`amount * 10^SENTINEL_AMOUNT_DECIMALS`, au wei près, tolérance d'un arrondi flottant de 1 sur 10^12 car `agents/sentinel_chain.py` convertit en float), même `nonce` si les deux sont présents. Un ordre que le moteur refuse (action inconnue, montant nul) = 422.

## 6. Points d'attention
- Le moteur hébergé ne connaît que les émetteurs présents dans `mandates.json` + `authorities.mock.json` de `GUARD_DATA_DIR` (ou accordés on-chain par `grantAuthority`). Un émetteur inconnu est toujours bloqué par le re-screen (sans flag sur le marchand) : un adoptant OSS doit être enrôlé avant de pouvoir obtenir un visa.
- Une approbation humaine faite sur le garde local d'un client est invisible pour le moteur hébergé (pas encore d'endpoint d'approbation côté serveur).
- `decisions.jsonl` grossit dans `GUARD_DATA_DIR` : à faire tourner (logrotate) si le trafic monte.
- Les deux transactions d'un `allow` ou d'un `block` ne sont toujours pas atomiques (si la 2e échoue, la réponse est un 500 alors que la 1re est minée).

## 7. Tests
```bash
cd <racine du repo>
uv run --no-project --python 3.12 --with fastapi --with httpx --with "web3>=7" --with beautifulsoup4 \
  --with pycryptodome --with pytest pytest api/tests -q
```
Aucun réseau, aucune chaîne : `authorize` est remplacé par un faux module dans `api/tests/test_server.py`, et `api/tests/test_authorize.py` charge le vrai `authorize.py` avec un expéditeur bouchonné. Le moteur `guard/` réel tourne sur une copie temporaire de `data/`.
