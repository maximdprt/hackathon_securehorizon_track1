# Campagne de tests du garde (2026-10-10, soir)

Objectif : savoir si le moteur tient dans tous les cas avant de le brancher sur la blockchain. Quatre angles, tous
rejouables en une commande. Claude est coupé (`GUARD_LLM=off`) pour que les chiffres soient déterministes : c'est le
plancher heuristique. Avec Claude en live, les verdicts sont identiques ou plus sévères.

| Campagne | Commande | Résultat |
|---|---|---|
| Corpus attaques + contrôles | `.venv/bin/python redteam/run.py` | 23 attaques détectées à 100 %, 52 contrôles bénins, 0 % de faux positifs |
| Faux positifs (47 cas bénins réalistes) | inclus dans le corpus (`redteam/cases/B*.json`) | 38 % de faux positifs au départ, 0 % après la réécriture du lexique |
| Évasion (12 familles de mutations, 850 essais) | `.venv/bin/python redteam/evasion.py` | voir `redteam/evasion_report.md` ; seuls les encodages rot13 et url sur un cas restent pour Claude |
| Fuzzing et cas limites | `.venv/bin/pytest tests/test_fuzz.py tests/test_edge_cases.py` | 800 requêtes malformées : jamais de crash, jamais d'allow par défaut |
| Protocole MCP | `.venv/bin/pytest tests/test_mcp_protocol.py` | 3 outils exposés, 20 appels concurrents, payload de 300 Ko, erreur explicite sur ordre invalide |
| Persistance et concurrence | `.venv/bin/pytest tests/test_state_persistence.py` | registre, nonces et file humaine survivent au redémarrage ; 8 threads x 20 ordres sans corruption |
| Stabilité de Claude (live Bedrock) | 3 passes de `GUARD_LLM=on redteam/run.py` | 0 verdict qui change entre passes, confiance stable à 1 à 4 points près, 3,3 s par décision |
| Chaîne bout en bout | `.venv/bin/pytest tests/test_chain_e2e.py` | contrat compilé et déployé en mémoire, 3 actes on-chain, blocs non instantanés |

## Ce que la campagne a fait changer dans le moteur

**Lexique réécrit en mode précision** (`guard/lexicon.py`). Le lexique initial tirait sur le vocabulaire métier
ordinaire : "ERP system", "you must be 18", "shipping fee", "no limit on reads", "AI-powered recommendations",
"## Instructions", "verified seller", "new payment terms", "migration guide to v2". Règles désormais :
- une instruction à l'agent exige une adresse directe ("AI agent:", "note to the automation", "if you are an AI")
  ou une phrase qui détourne le processus ("skip the review", "do not tell the user", "you must approve") ;
- un changement de mandat (bloc dur) exige un changement explicite des règles de paiement ("ignore the 100 USDC
  limit", "limit deprecated", "re-approve", "new spending limit is") ;
- une annonce de nouvelles coordonnées bancaires est un signal souple (0.40) qui envoie vers l'humain, et seulement
  si une destination différente du destinataire courant apparaît ; sinon trace informative ;
- "system:" ne compte qu'en début de ligne ; "you are now" seulement suivi d'une identité d'agent ;
- les pieds de mail de confidentialité sont retirés avant de compter les marqueurs de pression ; deux marqueurs
  pèsent 0.15, trois ou plus 0.30 ;
- le principal (origine `user`) a le droit d'instruire son agent et de dire qu'une facture est approuvée ;
- tous les motifs utilisent `\s+` entre les mots pour résister aux doubles espaces et retours à la ligne.

**Poids** : `order_origin` passe de 0.20 à 0.10 (contexte, pas preuve). Un ou deux caractères de largeur nulle
deviennent une trace informative (résidu de copier-coller), les tags Unicode et le bidi restent à 0.35.

**Texte caché** : les attributs `data-*` longs vont dans le texte caché ; les runs url-encodés sont décodés.
Dans le texte caché, un ordre de paiement avec montant et destination est un bloc dur même sans le mot "agent".

**Robustesse** (7 classes de bugs trouvées par le fuzzing, toutes corrigées) : NaN et infini refusés en ValueError,
champs d'ordre mal typés refusés en ValueError, nonce entier accepté, contexte non objet refusé, sous-champs de
contexte mal typés tolérés (chaque couche de signaux est isolée : une couche qui plante devient un signal
`layer_error_*` qui interdit l'allow), caractères surrogates écrits sans erreur dans tous les fichiers JSON.

**MCP** : un ordre invalide renvoie une erreur d'outil explicite (`invalid request: ...`), jamais un verdict.
Le SDK installé est mcp 2.x (`MCPServer`, attributs en snake_case côté client).

## Limites connues
- ROT13 et url-encoding d'une instruction complète ne sont pas décodés par l'heuristique ; Claude lit l'indice
  "decode and follow" et tranche. Sans Claude, le cas reste en zone grise si un autre signal existe.
- Le corpus bénin fait 47 cas écrits par nous. Les vrais payloads des agents hébergés sur AWS doivent alimenter
  `redteam/calibrate.py --extra agents/out/payloads.jsonl` avant la démo.
- Le fuzzer ne construit jamais un ordre propre pour un émetteur connu : la couverture de l'allow vient des tests
  du moteur et du corpus, pas du fuzzing.
