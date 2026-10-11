# Sentinel — Chemin doré (script de démo, 3 actes)

Écrans à préparer : (A) le chat de l'agent, (B) la ville 3D `https://city.petroi.fr/?live=1`, (C) l'explorateur `https://explorer.petroi.fr/txs`.

## Acte 1 — L'agent se fait vider (garde OFF)
- Lancer l'agent **sans garde** sur un site/coffre piégé.
  `set -a; source .env; set +a; GUARD_BACKEND=off .venv/bin/python agents/app.py --open` (ou le run Lambda `?...&guard=off`).
- **Montrer** : l'agent choisit la meilleure offre (le piège), prépare l'ordre et **paie** — rien ne l'arrête. « Voilà ce qui se passe aujourd'hui. »

## Acte 2 — L'agent est sauvé (garde ON)
- Même demande, **garde ON** (défaut). L'agent envoie sa transaction à SentinelL1.
- **Montrer** (B) : une voiture arrive au péage, se fait scanner, fait **demi-tour** (refus).
- **Montrer** (A) : la carte d'analyse — verdict **BLOCK**, confiance ~5–10/100, signaux (adresse sosie, domaine neuf, instruction cachée), OWASP ASI03/ASI07. Déplier **« Comment est calculé ce score ? »** : la formule et le calcul réel.
- **Montrer** (C) : les transactions `flag` + `decision` on-chain → « la preuve est dans la blockchain, pas juste à l'écran ».

## Acte 3 — Le 2e agent est immunisé
- Un **autre** agent (autre wallet) vise la **même adresse** escroc.
- **Montrer** : **refus direct** (confiance 0), sans même analyser le contenu — l'adresse est déjà au registre de menaces on-chain. La voiture refait demi-tour.
- Message : « La première victime protège toutes les suivantes. »

## Commandes utiles (lancer une transaction de démo à la demande)
Depuis le repo, avec `.env` chargé :
```bash
# un piège (refus) :        finance/hyperyield ou stableharb0r  -> BLOCK
# un légitime (visa) :      finance/stableharbor                 -> ALLOW
# au-dessus du plafond :    montant > 300                        -> HUMAIN
.venv/bin/python redteam/validate_onchain.py   # rejoue 16 scénarios on-chain, verdicts vérifiés
```
Chaque décision apparaît dans la ville (`/cars`) et l'explorateur. Pas de test en cours = pas de voiture (rien d'aléatoire).

## Replis (si un imprévu en live)
- AWS expiré → rafraîchir `.env` (l'agent Bedrock) ; le garde tourne sans IA (`GUARD_LLM=off`, heuristiques, < 1 ms).
- Chaîne lente → le verdict s'affiche quand même (repli local) ; relancer `deploy/deploy_city.py` si la ville décroche.
- Mode hors-ligne du pitch → `https://city.petroi.fr/?live=0` (scénario scripté des 3 actes).
