# Durcissement pré-public — constat

**Verdict : l'historique git ne contient aucun secret réel → le repo est publiable côté secrets.**

Vérifié le 2026-10-11 :
- La clé AWS du `.env` local **n'apparaît pas** dans l'historique git (`git log --all -S`). `.env` **non suivi** (gitignore OK).
- Les seules chaînes de forme « clé AWS » dans l'historique sont des **placeholders** : `AKIAIOSFODNN7EXAMPLE` (exemple officiel des docs AWS) et `ASIAXXXXXXXXXXXXXXXX`.

## `scripts/scrub_check.sh` : 260 FAIL / 290 WARN = faux positifs
Le scan est volontairement paranoïaque ; après triage, **aucun n'est un secret** :
- **250 « cle_privee_hex64 »** → `blockchainId` Avalanche dans `ui3d-city/constants/l1-chains.json` (hash publics 32 octets, pas des clés).
- **8 « mnemonic »** → phrases de test anglaises (ex. `"the side plate and the fixed wall hold the car between them"`), pas des seed phrases.
- **2 « token_api » `sk-p…`** → l'URL de blog `avax.network/about/blog/sk-planet-…` (SK Planet), pas une clé OpenAI.
- **~290 WARN** → emails de vendeurs **synthétiques** (`billing@nimbus-cloud.io`, `compta@atelier-dubois.fr`…), **carte de test** `4242 4242 4242 4241`, une IP publique dans un fichier de données.

## Actions avant de rendre public (checklist)
1. **Rafraîchir / révoquer les creds AWS temporaires** du `.env` en fin d'event (ils expirent déjà ; rotation par principe).
2. **Allowlist du scrub** : ajouter `blockchainId`, les chaînes de test et les placeholders AWS au script pour que `scrub_check.sh` sorte propre (cosmétique, pas bloquant).
3. **Hors repo** : sur l'EC2, les scripts `citybuild.sh` historiques portaient des URL S3 présignées avec un token temporaire — **ne pas les committer** ; le nouveau `deploy/cityredeploy.sh` n'en a plus (lecture via le rôle de l'instance).
4. Activer **Secret scanning** sur GitHub au passage en public, et supprimer `mcp_server.log` s'il existe.

Référence : `docs/scrub-report.md` (audit du 2026-10-10 : historique propre).
