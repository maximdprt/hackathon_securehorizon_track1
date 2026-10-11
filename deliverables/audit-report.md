# Rapport d'audit — Sentinel (garde des paiements d'agents IA)

**Date** : 2026-10-11 · **Version** : hackathon ESSECKATHON (PoC) · **Auditable par** : risque / conformité / revue KPMG.

> Thèse : l'audit n'est pas déclaratif, il est **vérifiable on-chain**. Chaque décision de paiement d'un agent IA est un
> événement horodaté, non répudiable et rejouable sur SentinelL1. Le lecteur de ce rapport peut **re-vérifier lui-même**
> chaque chiffre sur l'explorer public, sans nous faire confiance.

## 1. Périmètre
- **Système audité** : le garde (moteur de décision + IA) et son application on-chain (visa / flag / trace).
- **Chaîne** : SentinelL1, Avalanche L1 sur Fuji (ACP-77), **chainId 99999**, token SEC.
- **Contrats** : `AuthorityRegistry` `0x7A7e5F80BE65F588DF975C4Aa563BA442db8bcb6` · `GuardedVault` `0xc7deAE9f1205e9c8B99d3311458542938D8CC7c0`.
- **Surfaces publiques** : API `https://rpc.petroi.fr` · Explorer `https://explorer.petroi.fr` · Ville 3D `https://city.petroi.fr`.
- **Hors périmètre** : la décision métier (allow/block/human) est produite par le cerveau (agents + scoring) ; ce rapport
  audite la **traçabilité et l'enforcement**, pas la qualité intrinsèque du modèle de détection (voir §8).

## 2. Architecture de contrôle (le flux)
```
Agent IA veut payer
   -> Garde (sanitisation + 7 couches de signaux + fusion Claude) = score de confiance 0..100
   -> Décision :  >=70 allow  ·  30-70 humain  ·  <30 block
   -> Application on-chain (API /authorize) :
        allow  -> VisaGranted (visa à usage unique) -> GuardedVault.pay() consomme le visa, sinon REVERT
        block  -> ThreatFlagged (adresse au registre) -> 2e tentative refusée d'office
        humain -> DecisionRecorded (en attente) -> un humain tranche, sa décision est tracée
   -> DecisionRecorded émis pour CHAQUE décision = piste d'audit
```
Point clé : l'enforcement est **dans l'EVM** (`GuardedVault`), pas dans le code de l'agent. Un agent compromis ne peut pas
payer sans visa valide = **fail-closed**.

## 3. Piste d'audit on-chain (le cœur)
Chaque décision écrit un événement inviolable et horodaté :
- `DecisionRecorded(paymentId, issuer, verdict, reason)` — toute décision.
- `VisaGranted(paymentId, issuer, recipient, amount, expiry)` — autorisation à usage unique.
- `ThreatFlagged(subject, severity, reason)` — bénéficiaire/émetteur signalé.

**État au moment de l'audit** (lu en direct sur la chaîne, bloc **218**) :

| Mesure | Valeur | Vérifiable via |
|---|---|---|
| Décisions enregistrées on-chain | **113** | `GET /cars?lookback=400` |
| dont autorisées (allow / visa) | **18** | event `VisaGranted` |
| dont refusées (block / flag) | **81** | event `ThreatFlagged` |
| dont escaladées à un humain | **14** | `DecisionRecorded` verdict=needs_human |

## 4. Cartographie réglementaire
Détail complet dans `deliverables/compliance.md`. Synthèse :
- **DORA** : journal d'incidents inviolable (chaque refus = incident daté on-chain) · détection + réponse (<1 ms heuristiques,
  ~3 s avec IA) · résilience fail-closed (repli local, paiement jamais sans visa) · reporting métriques.
- **MiCA** : traçabilité émetteur/bénéficiaire/montant/verdict on-chain · contrôle du bénéficiaire (registre de menaces) ·
  gouvernance par smart contract (autorités révocables, flags contestables).
- **AML / Travel Rule** : qui paie qui / combien / pourquoi attaché à chaque tx · détection de schémas (structuring,
  vélocité, bénéficiaire récent, contrat non vérifié) · registre d'adresses à risque partagé.
- **EU AI Act** : explicabilité (signaux + poids + seuils affichés) · **surveillance humaine** (zone 30-70 → humain avant
  tout paiement) · journalisation automatique · gestion du risque (jamais d'allow deviné sans preuve).
- **NIST CSF / OWASP ASI03-ASI07 / MITRE ATLAS** : couverts (identify/protect/detect/respond/recover ; confusion
  d'autorité, abus d'outil, prompt injection).

## 5. Métriques & seuils
**Seuils de décision** (recommandation KPMG : décider par seuils explicites) :
`confiance >= 70 -> visa` · `30 <= confiance < 70 -> humain` · `confiance < 30 -> refus + flag`.
Seuils resserrés automatiquement quand le montant approche le plafond du mandat (ex. plafond shopping 10 000 €).

**Banc de test (red-team, reproductible `python redteam/run.py`)** :
- 21 scénarios d'attaque (S1-S7, M1-M10, A1, I1 + contrôles) → **détection 100 %, faux positifs 0 %**.
- Campagne de durcissement : 47 cas bénins (**faux positifs 38 % → 0 %**), évasion **850 mutations**, fuzzing **800 requêtes**,
  tests protocole MCP + persistance, 3 passes Claude live stables.
- Latence : **< 1 ms** (heuristiques) / **~3 s** (fusion IA).

## 6. Preuves vérifiables (échantillon, cliquables)
| Cas | Verdict | Preuve on-chain (tx) | Bloc |
|---|---|---|---|
| Paiement dans le mandat | ALLOW (visa) | `0x8aaed0d4…` | 8 |
| Doc piégé / site d'arnaque | BLOCK (flag) | `0xdcdd96d8…` | 10 |
| Montant au-dessus du mandat | HUMAIN | `0xd5fe0a19…` | 47 |

Re-vérification indépendante :
- `GET https://rpc.petroi.fr/cars` → toutes les décisions (verdict, couloir, tx, bloc).
- `GET https://rpc.petroi.fr/flagged/{adresse}` → une adresse est-elle au registre ?
- `GET https://rpc.petroi.fr/visa/{paymentId}` → le visa est-il valide / consommé ?
- Explorer `https://explorer.petroi.fr` → chaque bloc / tx / event lisible.

## 7. Gouvernance & due process
- Décision par smart contract (`AuthorityRegistry`), autorités **révocables** (`revokeAuthority`).
- Flags **contestables** (`clearThreat` = droit de recours, exigence AI Act).
- Surveillance humaine réelle (14 cas escaladés à un humain dans l'échantillon).
- Contrôle d'accès : seuls les `authorizers` écrivent les visas/flags ; precompile **Tx Allow List** au niveau VM.

## 8. Limites & risques résiduels (honnête)
- **L1 mono-validateur** : à date, un seul validateur (nous) → l'immuabilité est "relative", pas encore décentralisée.
  *Mitigation* : passer en multi-validateurs ou ancrer périodiquement une empreinte sur la C-Chain Fuji.
- **Données synthétiques (PoC)** : montants, agents et boutiques sont simulés (canary `FLAG{team2-canary}`), pas du volume
  de production.
- **Métriques auto-évaluées** : 100 % détection / 0 % FP sont mesurés sur **notre** jeu red-team ; un adversaire réel
  adaptatif n'est pas garanti stoppé. *Mitigation* : recalibrage continu + banc élargi.
- **Conformité = alignement, pas certification** : on démontre qu'on adresse les exigences (DORA/MiCA/AML/AI Act), ce n'est
  pas un audit certifié par un tiers agréé.
- **Pas de vrais fonds** en jeu dans la démo (le `GuardedVault` est prouvé, mais sur des montants de test).

## 9. Conclusion
Le contrôle est **réel et vérifiable** : chaque paiement d'agent passe par un garde, la décision est appliquée dans l'EVM
(fail-closed) et **prouvée on-chain** de façon indépendante. La principale valeur d'audit — *une décision = une preuve
inviolable et rejouable* — est démontrée en production sur SentinelL1 (113 décisions au bloc 218). Les limites ci-dessus
sont celles d'un PoC de 36 h, documentées en toute transparence.

> Audit reproductible : `python redteam/run.py` (métriques) · `curl https://rpc.petroi.fr/cars` (décisions on-chain) ·
> `https://explorer.petroi.fr` (vérification bloc par bloc).
