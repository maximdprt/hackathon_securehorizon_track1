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
- `contracts/AuthorityRegistry.sol` : le contrat "visa" + registre incidents + `assess()`. ✅ (à déployer)
- Accès AWS OK, Bedrock + Claude OK, Fuji configuré. ✅

## 12. Prochaines étapes (priorité)
1. **Walid** : déployer la L1 / le contrat "visa" + coder le `mcp_server.py` (relie le scorer + la lecture on-chain + la décision).
2. **Corentin + Bruno** : monter les 2 agents sur AWS + les scénarios d'attaque + produire le scoring.
3. **Maxime** : l'UI 3D + la slide compliance DORA/MiCA + le pitch.
4. Tous : chemin doré Acte 1 (agent vidé) → Acte 2 (sauvé + visa refusé + log on-chain) → Acte 3 (2e agent immunisé).

## 13. Règles repo & hackathon
- `git push` toutes les heures (compte AWS effacé à la fin).
- `.env` **jamais commité** (déjà dans `.gitignore`). Creds AWS temporaires = rafraîchir depuis la page event quand ça expire.
- Données synthétiques + canary flags (`FLAG{team2-canary}`), jamais de vraie donnée.
- Noter les adresses de contrat déployées ici.
- Livrables : PoC détection+réponse, response playbook, defense sheet (1 page), compliance slide (DORA/MiCA/AML/AI Act), pitch 4 min + vidéo démo, repo public (après scrub des secrets).
