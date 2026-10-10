# Rapport de scrub des secrets (avant passage du repo en public)

Date : 2026-10-10. Auteur : Bruno (audit en lecture seule, aucun fichier suivi modifie, aucun historique reecrit).
Repo : `maximdprt/hackathon_securehorizon_track1`, branches auditees : `main`, `Bruno`, `corentin`, `maxim-iu_score`, `walid-l1` (tout `git rev-list --all`).

Regle CLAUDE.md : `.env` jamais commite, creds AWS temporaires, donnees synthetiques uniquement avec le canary `FLAG{team2-canary}`.

## 1. Methode

- Historique complet : `git log -p --all` (toutes branches, 20+ commits, 97 fichiers ayant existe) passe au crible par regex : cles AWS (`AKIA`/`ASIA` + 16), secrets AWS (40 car. base64), session tokens (`IQoJb3JpZ2luX2Vj...`), blocs PEM, cles privees EVM (0x + 64 hex et 64 hex nus), mnemonics (12/24 mots), tokens `Bearer`, `sk-`, `ghp_`, JWT, URLs RPC avec cle (infura/alchemy/ankr...), emails, IBAN, numeros de carte, litteraux `password=`/`secret=`, chemins locaux `/Users/...`, IP publiques.
- Fichiers interdits dans l'historique : `git log --all --full-history -- .env '*.env' '*.pem' '*.key' credentials secrets.json`.
- Working tree : fichiers suivis + non suivis non ignores (`git ls-files` + `git ls-files --others --exclude-standard`), memes regex. Le `.venv/` et les caches sont ignores par git donc hors scope.
- Comparaison des valeurs reelles du `.env` local (cle `ASIA...`, secret 40 car., session token 744 car.) avec l'historique complet et le working tree, par recherche exacte (sans jamais afficher les valeurs).
- gitleaks / trufflehog ne sont pas installes : tout est fait avec `git` + `grep`, et le script `scripts/scrub_check.sh` rejoue exactement le meme scan.

## 2. Constats

| Severite | Ou | Quoi | Action |
|---|---|---|---|
| **OK (aucun secret)** | historique complet, 5 branches | Aucune cle AWS, aucun secret 40 car., aucun session token, aucun bloc PEM, aucune cle privee 0x+64hex, aucun mnemonic, aucun token API/Bearer/JWT, aucune URL RPC avec cle. Les 3 valeurs reelles du `.env` local n'apparaissent dans aucun commit ni dans aucun fichier hors `.env`. | Rien a purger. |
| **OK** | historique complet | Aucun fichier `.env`, `*.env`, `*.pem`, `*.key`, `credentials`, `secrets.json`, `.aws/` n'a jamais ete suivi sur aucune branche. | Rien. |
| **OK** | index git (HEAD) | `.env`, `mcp_server.log`, `data/decisions.jsonl`, `data/pending.json`, `data/nonces.json`, `data/threats.mock.json`, `agents/out/*`, `demo/out/data/*` ne sont pas suivis et sont tous couverts par `.gitignore` (verifie avec `git check-ignore -v`). | Rien. |
| INFO | `demo/out/golden_path.json`, `redteam/last_run.json` (suivis, modifies localement) | Sorties de demo volontairement versionnees (timeline pour l'UI 3D). Contenu 100 % synthetique : adresses `0xA11ce...`/`0xBADc0ffee...`, `instruction_id` = sha256 (0x + 64 hex, ce sont des hashes, pas des cles), scores. Aucun identifiant AWS, aucun chemin local. | Garder. Le script les rescanne a chaque run. |
| INFO | `agents/out/*.json`, `demo/out/data/decisions.jsonl` (non suivis, ignores) | Contiennent le chemin local `/Users/brunodasilvalopes/...` et l'ID de modele Bedrock `anthropic.claude-haiku-4-5-20251001-v1:0`. Pas sensible, mais inutile en public. | Rester ignores (deja le cas via `agents/out/` et `demo/out/data/`). Ne jamais `git add -f`. |
| INFO (public par design) | commit `74cb25a` `CLAUDE.md` (branche `walid-l1`), lignes 23, 27, 28 | URL RPC du noeud L1 sur EC2 `http://54.70.187.95:9650/ext/bc/2Pqoo.../rpc` + adresses des contrats deployes `AuthorityRegistry 0x7A7e5F80BE65F588DF975C4Aa563BA442db8bcb6` et `GuardedVault 0xc7deAE9f1205e9c8B99d3311458542938D8CC7c0`. | Ce sont des adresses/endpoints publics, pas des secrets. L'EC2 disparait avec le compte AWS a la fin du hackathon. Aucune action requise ; optionnel : noter dans le README que l'endpoint est eteint. |
| INFO (public par design) | commit `d72eac3` `contracts/genesis.json`, commit `87bd44b` `api/authorize.py` (branche `walid-l1`) | Adresse admin/prefinancee de la L1 `0xaF11630142CF1f829B87c586C0a6C980B61A855d` (`adminAddresses` du precompile Allow List + `alloc`). C'est une adresse publique. Sa cle privee (`AUTHORIZER_KEY`) est lue via `os.environ` et n'est nulle part dans le repo. | Aucune. Garder `AUTHORIZER_KEY` / `L1_RPC_URL` / `REGISTRY_ADDRESS` uniquement dans le `.env` local. |
| INFO (synthetique) | `demo/fixtures/*`, `demo/poisoned_docs/*`, `redteam/cases/*`, `data/*.json` | Emails fictifs (`laura.bennett@team2-labs-corp.com`, `support@walmart-deals-shop.online`, `wf-support@secure-wellsfargo-login.com`, `billing@acme-saas.io`...), carte de test Stripe `4242 4242 4242 4242`, IBAN `AD00...0`, hash d'outil MCP `8f0ab1a4...c0d`, calldata `approve()` de test `0x095ea7b3...dead...beef`. Tous conformes a la regle "donnees synthetiques". | Aucune. Deja dans l'allowlist du script. |
| INFO | metadonnees git (auteurs) | Les commits portent les emails `bda@eugeniaschool.com`, `cballonad@eugeniaschool.com`, `mduprat@eugeniaschool.com`, `wbouzidane@eugenia`. Visibles publiquement avec le repo (comportement normal de GitHub). | Acceptable. Si quelqu'un veut les masquer il faut reecrire l'historique (voir section 4), a decider en equipe, pas recommande. |
| BAS (hygiene) | `.gitignore` ligne 4 `.env.*` | La regle ignore aussi `.env.example`, qui est donc impossible a commiter alors que c'est le template a partager aux coequipiers (il ne contient que des cles vides). | Ajouter une ligne `!.env.example` sous `.env.*` dans `.gitignore`, puis `git add .env.example`. A faire par la session qui gere le working tree (non fait ici, audit en lecture seule). |
| BAS (hygiene) | `mcp_server.log` (racine, 0 octet, ignore via `*.log`) | Fichier de log local vide. | Supprimer avant publication (`rm mcp_server.log`), par simple proprete. |

Conclusion : **aucun secret reel n'a jamais ete commite**. Rien a purger de l'historique. Le repo peut passer en public une fois la checklist de la section 5 cochee.

## 3. Ce qui est deja sain

- `.gitignore` present des le 2e commit (`4810cde` puis `cb909bb`) avec `.env`, `*.env`, `.env.*`, `credentials`, `*.pem`, `*.key`, `*.keystore`, `secrets.json`, `.aws/`, `*.log`, et depuis `d1cddfa`/`f41b6a6` l'etat runtime du guard (`data/decisions.jsonl`, `data/pending.json`, `data/nonces.json`, `data/threats.mock.json`, `demo/out/data/`) et `agents/out/` (modif locale en attente de commit).
- Tout le code lit ses secrets dans l'environnement : `detection/scorer.py` et `agents/common/llm.py` (boto3, region via `AWS_REGION`), `api/authorize.py` et `api/server.py` sur `walid-l1` (`L1_RPC_URL`, `REGISTRY_ADDRESS`, `AUTHORIZER_KEY` via `os.environ`), `tests/test_chain_e2e.py` (cle `owner_key` generee en test, RPC `127.0.0.1`).
- Toutes les adresses de test suivent des prefixes parlants (`0xA11ce`, `0xBAD`, `0xBADc0ffee`, `0xdead...beef`, `0x5e11e4`, `0x5e12e4`, `0xfac1`/`0xfac9`), donc impossibles a confondre avec un vrai wallet.
- Canary `FLAG{team2-canary}` present dans les fixtures, aucune donnee reelle (noms, IBAN, cartes) trouvee.
- Les creds AWS sont temporaires (`ASIA...` + session token), donc meme une fuite future aurait une duree de vie limitee a la session.

## 4. Remediation si un secret finit par entrer dans l'historique

Aucun cas trouve aujourd'hui. Procedure a appliquer si `scripts/scrub_check.sh` renvoie un `[FAIL]` un jour (ou si quelqu'un commit un `.env` par erreur).

### 4.1 Revoquer d'abord, purger ensuite

1. **Creds AWS du hackathon** : aller sur la page de l'event AWS, regenerer les credentials temporaires (le `ASIA...` + session token precedents deviennent inutilisables), puis recoller le nouveau triplet dans `.env` local. Si la cle fuitee est une vraie cle IAM `AKIA...` : IAM > Users > Security credentials > Deactivate puis Delete.
2. **Cle privee EVM** (`AUTHORIZER_KEY`, admin L1, wallet d'agent) : considerer l'adresse comme compromise. Generer une nouvelle paire, transferer les fonds/roles (`setAuthorizer`, admin de l'Allow List), re-deployer si l'adresse est codee en dur dans `genesis.json`.
3. **Token API** (Anthropic, GitHub, Infura...) : revoquer dans la console du fournisseur.

La rotation est obligatoire meme si on purge l'historique : GitHub garde des caches, les forks et clones existants gardent les objets.

### 4.2 Purger l'historique avec git filter-repo

`git filter-repo` n'est pas installe par defaut : `brew install git-filter-repo` (ou `pip install git-filter-repo`).

ATTENTION : cette operation **reecrit tous les SHA** de l'historique. Toute l'equipe doit **re-cloner** le repo apres le push force (pas de `git pull`, ca recreerait les anciens commits). Faire une sauvegarde avant (`git clone --mirror` ailleurs). Prevenir Corentin, Maxime et Walid et s'assurer que personne n'a de travail non pousse.

```bash
# 0. sauvegarde
git clone --mirror https://github.com/maximdprt/hackathon_securehorizon_track1.git ../backup-mirror.git

# 1. clone frais (filter-repo refuse de tourner sur un clone non frais)
git clone https://github.com/maximdprt/hackathon_securehorizon_track1.git scrub && cd scrub

# 2a. supprimer un fichier de tout l'historique (ex: un .env commite par erreur)
git filter-repo --invert-paths --path .env --path mcp_server.log

# 2b. et/ou remplacer des valeurs precises partout (une regle par ligne dans expressions.txt)
#   format : literal:VALEUR_A_REMPLACER==>REMPLACEMENT   (ou regex:...)
#   ex :   literal:ASIAXXXXXXXXXXXXXXXX==>AWS_KEY_REDACTED
git filter-repo --replace-text expressions.txt

# 3. re-ajouter le remote (filter-repo le retire volontairement) et pousser en force sur TOUTES les branches et tags
git remote add origin https://github.com/maximdprt/hackathon_securehorizon_track1.git
git push --force --all origin
git push --force --tags origin

# 4. verifier
scripts/scrub_check.sh
```

Ensuite : chaque coequipier supprime son clone local et re-clone. Si le repo etait deja public, demander a GitHub Support de purger les caches des commits detaches (les anciens SHA restent accessibles par URL directe tant que ce n'est pas fait).

## 5. Checklist avant de passer le repo en public

- [ ] **Rotation des creds temporaires** : regenerer les creds AWS sur la page event (de toute facon le compte est efface a la fin), ne pas laisser un `.env` valide trainer sur une machine partagee.
- [ ] **`.env` non suivi** : `git ls-files --error-unmatch .env` doit echouer ; `git log --all --full-history -- .env` doit etre vide.
- [ ] **Lancer `scripts/scrub_check.sh`** sur la branche finale (apres le dernier merge dans `main`) : il doit afficher `0 FAIL` et sortir avec le code 0. Relire les eventuels `[WARN]` (adresses/emails/IP inconnus).
- [ ] **Supprimer `mcp_server.log`** et verifier qu'aucun autre `*.log`, `agents/out/`, `demo/out/data/` n'est suivi (`git ls-files | grep -E 'log$|agents/out|demo/out/data'` vide).
- [ ] **Corriger `.gitignore`** : ajouter `!.env.example` pour que le template soit commitable, et commiter `.env.example` (cles vides).
- [ ] **Merger / supprimer les branches de travail** : tout ce qui est sur `corentin`, `maxim-iu_score`, `walid-l1`, `Bruno` devient public aussi. Verifier que le script tourne bien avec `--all` (c'est le cas par defaut).
- [ ] **Parametres GitHub** : Settings > General > Danger zone > Change visibility > Public. Avant : Settings > Code security > activer **Secret scanning** et **Push protection** (gratuit sur les repos publics), et verifier Settings > Collaborators (retirer les acces inutiles). Verifier aussi qu'aucune GitHub Action n'utilise un secret en clair.
- [ ] **Scrub humain** : relire `CLAUDE.md`, `README.md`, `docs/` pour les URLs d'infra encore vivantes (EC2, tunnels `*.petroi.fr`) et noter qu'elles sont eteintes apres le hackathon.
- [ ] **Apres publication** : re-lancer `scripts/scrub_check.sh` une derniere fois sur un clone frais du repo public.

## 6. Utilisation du script

```bash
scripts/scrub_check.sh              # historique complet + working tree (environ 2 s)
scripts/scrub_check.sh --no-history # working tree seul (pre-commit rapide)
scripts/scrub_check.sh --quiet      # uniquement les constats et le resume
```

Codes de sortie : `0` rien de sensible, `1` au moins un `[FAIL]` (ne pas publier), `2` erreur d'usage.
Les valeurs synthetiques connues (prefixes d'adresses de test, emails des fixtures, hash fictifs, carte Stripe 4242, adresses publiques deployees, IP EC2) sont dans les variables `ALLOW_*` en tete du script : ajouter une ligne la-bas quand une nouvelle fixture declenche un faux positif, jamais en desactivant un pattern.

Resultat de l'execution du 2026-10-10 sur la branche `Bruno` (29 commits, toutes branches, environ 2 s) : `0 FAIL, 0 WARN`, code de sortie 0. Le script a aussi ete valide sur un depot jetable contenant de faux secrets plantes (cle `AKIA`, secret 40 car., session token, cle privee 0x+64hex, mnemonic, URL infura avec cle, bloc PEM, token `ghp_`, IBAN, `.env` supprime mais present dans l'historique) : chaque categorie remonte en `[FAIL]` avec la valeur masquee.
