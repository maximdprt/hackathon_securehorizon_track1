# Sentinel — Conformité (slide)

**Thèse** : chaque décision de paiement d'agent devient une **preuve inviolable, horodatée, rejouable** sur Avalanche. L'audit n'est plus déclaratif, il est **vérifiable on-chain**. Un contrôle = un événement (`DecisionRecorded`), un refus = un flag (`ThreatFlagged`), une autorisation = un visa à usage unique (`VisaGranted`).

## DORA (Digital Operational Resilience Act)
- **Journal d'incidents inviolable** : chaque block/flag est un événement on-chain daté → piste d'audit non répudiable (art. sur la journalisation et la détection des incidents TIC).
- **Détection & réponse** : le garde détecte (7 couches + IA) et répond (block/flag/escalade) en < 1 ms (heuristiques) / ~3 s (IA) ; incident DORA ouvert automatiquement au refus (`INC-AAAA-xxxx`).
- **Résilience** : repli local si la chaîne est injoignable (le verdict tient), le paiement ne passe jamais sans visa valide (fail-closed via `GuardedVault`).
- **Reporting** : métriques exportables (taux de détection, faux positifs, temps de détection/réponse, nb d'incidents) pour le registre d'incidents.

## MiCA (Markets in Crypto-Assets)
- **Traçabilité des transferts** : émetteur, bénéficiaire, montant, verdict et motif inscrits on-chain → transparence exigée sur les transferts de crypto-actifs.
- **Contrôle du bénéficiaire** : registre de menaces on-chain (`threats`) + allowlist des contreparties → refus des adresses signalées (address poisoning, marchand fantôme).
- **Gouvernance** : décision par smart contract (`AuthorityRegistry`), autorités révocables (`revokeAuthority`), flags contestables (`clearThreat` = due process).

## AML / CFT (Travel Rule)
- **Qui paie qui, combien, pourquoi** : attachés à chaque transaction (métadonnées de paiement verify_payment) → éléments Travel Rule.
- **Détection de schémas** : structuring (montant juste sous le plafond), vélocité (paiements/heure), bénéficiaire récemment modifié, honeypot/contrat non vérifié → signaux dédiés.
- **Registre des adresses à risque** : partagé on-chain, réutilisable → la 2e tentative vers une adresse flaguée est refusée d'office.
- **KYB souverain (« know your beneficiary »)** : couche opt-in (`GUARD_KYB=on`) qui vérifie le bénéficiaire contre le **registre officiel des entreprises de l'État** (API Recherche d'entreprises, data.gouv.fr / DINUM). Entreprise active et correspondante → preuve officielle attachée à la décision (SIREN + état), bénéficiaire radié / introuvable / nom non concordant → signal de risque (escalade humaine). Vérification par **source tierce officielle**, loggée et rejouable (exigence DORA tiers), jamais déclarative. Dégrade proprement : si le registre est indisponible, aucun paiement n'est débloqué pour autant (le garde reste fail-closed via les autres couches).

## AI Act (règlement IA UE)
- **Transparence & explicabilité** : chaque décision est explicable — signaux cités, poids, formule (OU bruité), seuils affichés (exigence sur les systèmes à haut risque).
- **Surveillance humaine (human-in-the-loop)** : zone de doute (30–70) → **escalade à un humain** avant tout paiement ; l'humain tranche, sa décision est tracée.
- **Robustesse & exactitude** : banc de tests honnête (100/100, évasion 814 essais 100 %), recalibrage continu, faux positifs mesurés à 0 %.
- **Journalisation** : enregistrement automatique des décisions (logs + on-chain) sur toute la durée de vie.
- **Gestion du risque** : limites documentées, pas de décision « allow » devinée sans preuve (plancher humain quand l'IA est indisponible).

## Seuils (recommandation KPMG : décider par seuils explicites)
`confiance ≥ 70 → visa` · `30 ≤ confiance < 70 → humain` · `confiance < 30 → refus + flag`. Seuils resserrés automatiquement quand le montant approche le plafond du mandat.

## Preuves on-chain (vérifiables par le jury)
SentinelL1 (chainId 99999) · `AuthorityRegistry 0x7A7e…bcb6` · `GuardedVault 0xc7de…C7c0` · Explorer `https://explorer.petroi.fr` · chaque voiture de la ville 3D = un `DecisionRecorded` réel.
