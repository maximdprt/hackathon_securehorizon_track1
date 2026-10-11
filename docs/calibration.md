# Calibration du moteur de decision (redteam/calibrate.py)

Le garde combine des signaux en noisy-OR (`risk = 1 - prod(1 - w_i)`), force `risk = 1.0` des qu'un signal **hard** est present, puis applique les seuils `allow < 0.30 <= needs_approval < 0.70 <= block` (resserres a 0.20 / 0.60 quand le montant atteint 50 % du plafond du mandat). Les poids sont des points de depart issus de la recherche (`detection/research/features_scoring.json`) et codes dans `guard/features/*.py`. Ce harnais mesure, de maniere deterministe (Claude coupe), ce que chaque poids et chaque seuil apportent reellement sur le corpus red-team, et propose des ajustements sans jamais toucher au moteur.

## 1. Lancer la calibration

```bash
# rapport terminal
.venv/bin/python redteam/calibrate.py

# rapport markdown + proposition de poids
.venv/bin/python redteam/calibrate.py --md redteam/calibration_report.md --suggest

# dump JSON par cas (signaux, risque, trust, marge) pour le dashboard
.venv/bin/python redteam/calibrate.py --json redteam/calibration_cases.json --quiet
```

Le code de sortie vaut 0 si detection >= 90 %, 0 faux positif et verdicts reproductibles, 1 sinon (meme convention que `redteam/run.py`).

Le corpus charge est exactement celui de `redteam/run.py` : `redteam/cases/*.json` puis `demo/fixtures/*.json` (prefixe `demo_`), avec le meme protocole d'isolation (copie fraiche de `data/` par cas, cle `_after` pour pre-jouer un cas, cle `_replay` pour rejouer la requete). Les deux formats de label sont acceptes (`expected` liste ou `expected: {"verdict": ...}`).

## 2. Nourrir le harnais avec les vrais payloads des agents

Les agents (shopping, x402) loggent les requetes `verify_payment` qu'ils envoient au garde. Une fois ces payloads labellises, on les ajoute au corpus avec `--extra` :

```bash
.venv/bin/python redteam/calibrate.py --extra agents/out/payloads.jsonl --md redteam/calibration_report.md
```

`--extra` accepte un fichier JSONL, un fichier JSON (un enregistrement ou une liste) ou un repertoire contenant des `.json` / `.jsonl`. Chaque enregistrement :

```json
{"request": {"order": {...}, "source_context": "...", "context_type": "html", "context": {...}},
 "expected": "block",
 "family": "E",
 "name": "fake_walmart_run_12"}
```

- `request` : exactement le payload envoye a `verify_payment` (ce que l'agent a vu, rien de plus).
- `expected` : `allow`, `needs_approval`, `block`, ou une liste de verdicts acceptes.
- `family` : famille de la taxonomie (A..J). Un enregistrement attendu `allow` est automatiquement classe `control`.
- `name` : optionnel, sert au nommage (`extra_<name>`).

Regle : donnees synthetiques uniquement, jamais de vraie donnee personnelle. Les payloads non labellises ne sont pas charges (il faut un `expected`).

## 3. Lire le rapport

1. **Summary** : taux de detection (attaques dont le verdict est dans la liste attendue), attaques laissees passer (`allow`), taux de faux positifs (controles non `allow`), taux d'escalade (`needs_approval` / total), seuils en vigueur, latence moyenne. La ligne *rescore consistency* verifie que le verdict du moteur se reproduit avec `guard.scoring.combine` sur les signaux captures : si elle n'est pas OK, l'ablation n'a aucun sens et il faut regarder le moteur.
2. **Confusion matrix** : attendu (ligne, premier verdict de la liste) contre obtenu (colonne). La diagonale doit porter tout le poids ; une case `allow -> needs_approval` est un faux positif, une case `block -> allow` est une attaque passee.
3. **Per case** : risque, **trust** (score degressif `100 * (1 - risk)`, lu dans le verdict quand le moteur le fournit, recalcule sinon), seuils appliques au cas, marge au seuil le plus proche, `H` si un signal hard a force le verdict.
4. **Fragile cases** : cas non hard dont la marge est inferieure a 0.05. Ce sont les verdicts qui basculeraient au moindre changement de poids ou de donnee. Exemple typique : un controle a 0.20 juste sur le seuil resserre, sauve uniquement par la regle "signaux informationnels seuls = allow". A couvrir par un cas supplementaire ou a renforcer.
5. **Per signal** : combien de fois le signal tire, dans combien d'attaques et de controles, son poids observe dans le moteur et son poids de reference recherche, et sa valeur par ablation :
   - `det_lost` : attaques qui ne correspondent plus a leur verdict attendu si on retire le signal (le signal porte la detection) ;
   - `fp_caused` : controles qui redeviennent `allow` si on le retire (le signal cree du faux positif) ;
   - `esc_removed` : cas qui quittent `needs_approval` sans lui.
   Un signal a `det_lost = 0` n'est pas forcement inutile : il est souvent redondant avec un signal hard dans le corpus actuel. Il manque alors un cas qui le teste seul.
6. **Threshold sweep** : grille `allow_below` 0.10..0.50 x `block_at_or_above` 0.50..0.90, chaque case = detection / FP / escalade. `*` marque la paire actuelle, `+` la meilleure paire faisable (0 FP, puis detection max, puis escalade min). Le resserrement haut montant suit les memes decalages que la config actuelle.
7. **Weight proposals** (`--suggest`) : baisse de poids pour les signaux soft qui creent du faux positif ou dont le retrait ne coute rien. Chaque proposition est validee seule puis toutes ensemble (la detection ne doit pas baisser, les FP ne doivent pas monter). Le fichier `redteam/calibration_proposal.json` contient la baseline, l'effet cumule, les changements et les observations.

## 4. Regles a respecter

- **Ne jamais changer un signal hard.** Les signaux hard (`issuer_in_registry`, `mandate_override_attempt`, `nonce_replay`, `recipient_flagged_onchain`, etc.) encodent les regles d'autorite et de protocole : ils forcent `risk = 1.0` et ne se calibrent pas. Le harnais les exclut de toute proposition et les liste dans `never_touch_hard_signals`.
- **Le harnais ne modifie rien.** Il ecrit uniquement `redteam/calibration_report.md`, `redteam/calibration_proposal.json` et le JSON optionnel. Les poids s'appliquent a la main dans `guard/features/*.py` (et la reference dans `features_scoring.json` doit suivre).
- **Apres tout changement de poids ou de seuil, rejouer `redteam/run.py`** puis relancer la calibration. Le run doit rester a 100 % de detection et 0 % de faux positif avant tout commit.
- **Un signal ne se baisse que sur preuve.** `fp_caused > 0` ou une escalade evitee sans perte de detection. Un signal qui ne tire que dans des attaques couvertes par un hard reste en place : on ajoute un cas red-team qui l'exerce seul plutot que de le toucher.
- Claude reste coupe pendant la calibration (`GUARD_LLM=off`) pour que les chiffres soient reproductibles. Le mode avec Claude se mesure avec `GUARD_LLM=on .venv/bin/python redteam/run.py`.
