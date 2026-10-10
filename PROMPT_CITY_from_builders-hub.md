# PROMPT : AvaGuard+ City, à partir du vrai code de la City Avalanche (builders-hub)

> À coller tel quel dans Claude Code, dans le repo `hackathon_securehorizon_track1`.
> Tout se fait en code. On **reprend le code open source de la vue City d'Avalanche** et on y ajoute **notre L1, notre bureau AvaGuard+, et une simulation de transactions, une voiture à la fois**.
> Lis tout avant de coder. Avance par phases (section 12). Une capture d'écran à la fin de chaque phase, comparée à la vraie City (`https://build.avax.network/explorer/fuji/chains`, vue City).

---

## 0. Source et licence (à respecter)

- Code source : **https://github.com/ava-labs/builders-hub**, branche `master`, commit de référence `c28b4e9969ff40b420554ec9a6b4363b7abb2689` (9 oct. 2026). Clone-le à côté du projet :
  `GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 https://github.com/ava-labs/builders-hub vendor/builders-hub`
- Licence **BSD 3-Clause** (Copyright (c) 2021, Ava Labs, Inc.). Obligations :
  1. copier le fichier `LICENSE` d'origine dans `ui3d-city/LICENSES/builders-hub-LICENSE` et garder l'en-tête de copyright dans les fichiers repris ;
  2. ne **pas** utiliser le nom Ava Labs ou Avalanche pour laisser croire qu'ils soutiennent le projet ;
  3. la licence ne donne **aucun droit sur les marques** : retirer le logo Avalanche, le wordmark et la navigation du site Builder Hub.
- Mention visible en bas de l'UI : `City 3D d'après le code open source Avalanche Builder Hub (BSD-3) · Concept AvaGuard+ · simulation`.
- Les données de l'écosystème (chaînes, validateurs, flux ICM) sont **réelles et publiques** quand elles viennent d'un instantané (section 3). Toute donnée que nous générons nous-mêmes est marquée `simulé`.

## 1. Ce qu'il y a dans leur code (lis ces fichiers avant tout)

Tout est dans `vendor/builders-hub/components/explorer-v2/network/` :

| Fichier | Rôle |
|---|---|
| `city3d/City3D.tsx` (export par défaut) | Le canvas R3F complet. Props : `CityViewProps` (`icm-map.tsx` l.498) + `labels`, `route`, `onRoute` |
| `city3d/Buildings.tsx`, `shaders.ts`, `paint.ts`, `palette.ts`, `instancing.ts`, `geometry.ts` | Immeubles instanciés, shader des fenêtres, palette jour/nuit |
| `city3d/forms/*.ts` | Les formes d'immeubles par quartier (`finance.ts`, `ai.ts`, …) et le planificateur `plannerOf` (`forms/index.ts`) |
| `city3d/HubTower.tsx` | La tour C-Chain (downtown), avec `flashHubTower` / `stepHubTower` (flash à chaque transaction) |
| `city3d/Traffic.tsx` + `lanes.ts` | Les voitures (`PODS` : car, van, bus, truck), les voies (`streetsOf(routes, lot)`), le survol et la sélection d'une route (`hovered`, `picked`, `blue[]`) |
| `city3d/Labels.tsx` | Pastilles des chaînes (`Badges`), libellés de quartier (`TagLayout`), ancrage HTML (`Anchor`) |
| `city3d/Rig.tsx` | La caméra (`FOV = 28`, `Shot`, vols `fly()`), `CameraHandle` (`icm-map.tsx` l.490) |
| `city3d/Ground.tsx`, `Streetlights.tsx`, `Backdrop.tsx` (montagnes, nuages), `Pillar.tsx`, `Ledger.tsx`, `Helicopters.tsx`, `Sites.tsx`, `Lighting.tsx`, `Post.tsx`, `warmup.tsx` | Sol, lampadaires, décor, socle, anneau du registre P-Chain, hélicoptères, chantiers des nouvelles L1, lumières, post-traitement, mise en route |
| `city.ts` | Le plan de la ville : `planCity()`, quartiers (`Ward`), lots (`CityLot`), `streetRoute()` |
| `districts.ts` | Les 7 quartiers (`District`), leur ordre et leur texte |
| `city-data.ts` | `useCityData()` : lit `/api/overview-stats`, `/api/icm-flow`, `/api/l1-registry`, `/api/pchain/...` et construit `CityData` (`nodes`, `routes`, `city`, `pulse`, `newcomers`, `sites`) |
| `icm-map.tsx` | Types `Node`, `Route`, constantes de la ville (`CX`, `CY`, `PLATE`, hauteurs) |
| `city-app.tsx`, `city-key.tsx`, `city-frame.tsx` | L'interface autour du canvas (recherche, puces, légende, barre de chiffres, panneaux) |
| `../staking/bits.tsx` | `TipPlate`, l'infobulle de la référence |

Chiffres utiles mesurés sur ce commit : `City3D.tsx` et ses dépendances = **79 fichiers**, dépendances npm : `three`, `@react-three/fiber`, `@react-three/drei`, `postprocessing`, `n8ao`, `framer-motion`, `lucide-react`, `recharts`, `clsx`, `tailwind-merge`, `@scure/base`, `next`. En revanche `city-app.tsx` tire **231 fichiers** (la recherche "Ask" par IA, des requêtes serveur, prisma) : **on ne le reprend pas tel quel**, on refait son interface à l'identique (section 7).

## 2. Stratégie : extraire la City dans une petite app Next.js

On ne lance pas tout le site Builder Hub (docs, academy, base de données). On crée `ui3d-city/`, une app **Next.js 16 + React 19 + TypeScript**, avec **les mêmes versions** que leur `package.json` (`three ^0.180`, `@react-three/fiber ^9.3`, `@react-three/drei ^10.7`, `postprocessing ^6.39`, `n8ao`, Tailwind identique à leur config).

1. Écris `ui3d-city/scripts/extract-city.mjs` : il part de `components/explorer-v2/network/city3d/City3D.tsx`, `city-data.ts`, `city-key.tsx`, `../staking/bits.tsx`, suit tous les imports (`@/…` et relatifs), et copie la fermeture **en gardant les mêmes chemins** (pour que l'alias `@/*` marche sans réécrire les imports). Il copie aussi `public/images/city3d/*` (nuages, montagnes, marbre). Il écrit la liste des fichiers copiés dans `ui3d-city/VENDORED.md` avec le commit d'origine.
2. Pour tout import qui tire du serveur (prisma, redis, clickhouse, IA), **ne copie pas** : remplace-le par un petit module local (stub) avec la même signature, et liste-le dans `VENDORED.md`.
3. `tsconfig.json` : même alias `@/*` que leur repo. `tailwind.config` et le CSS global : reprends leurs tokens (couleurs, polices, `dark`).
4. Objectif de cette phase : la page `/` affiche **leur City à l'identique**, en mode sombre, réseau **Fuji**, sans erreur console.
5. Ne modifie le code repris que là où c'est nécessaire, et marque chaque modification par un commentaire `// AVAGUARD:` pour qu'on puisse refaire la mise à jour depuis leur repo.

## 3. Les données (pour que la City tourne hors de leur site)

Leur code lit des routes `/api/...` de leur propre serveur. Certaines ont besoin de clés privées (ClickHouse pour `/api/icm-flow`). On remplace par des **instantanés** :

1. `scripts/snapshot.mjs` : **une seule fois**, télécharge les réponses publiques de `https://build.avax.network` pour Fuji et Mainnet : `/api/overview-stats?timeRange=month&network=fuji`, `/api/icm-flow?days=1&sides=both&network=fuji`, `/api/l1-registry/fuji`, et les chemins `/api/pchain/fuji/...` que `useCityData` et `useNewcomers` appellent. Enregistre-les dans `ui3d-city/fixtures/` avec la date. Pas de boucle, pas de rafraîchissement automatique : on ne charge pas leur serveur. Si une route refuse, on passe au point 3.
2. Crée les **mêmes routes** dans `ui3d-city/app/api/...` qui servent ces fichiers. Leur code client n'a ainsi presque rien à changer.
3. Si `/api/icm-flow` n'est pas récupérable : génère des flux plausibles entre la C-Chain et les 15 chaînes les plus validées, marqués `simulé` dans la légende (`RUES : trafic ICM simulé`).
4. Option plus tard : un mode "live" qui lit directement l'API publique `https://stats-api.avax.network` (leur `EXPLORER_API_URL` par défaut) côté serveur.

## 4. Ajouter notre L1 et notre bureau dans leur ville

### 4.1 Notre chaîne comme une vraie L1 de la ville
- Ajoute **AvaGuard L1** dans la liste des chaînes (`MapChain`) avant le calcul du plan : `chainId` de notre L1 (ou un identifiant de démo `avaguard-l1` en attendant Walid), `chainName: "AvaGuard L1"`, `validatorCount` réaliste pour un hackathon (ex. 5), logo = notre bouclier en SVG (data URI, pas de logo existant).
- Ajoute une **route** AvaGuard L1 ↔ C-Chain (`Route` avec `hub: true`) pour que leur code dessine la rue et ses voies (`streetsOf`).

### 4.2 Un quartier "Security" (préféré) ou le quartier "AI" (repli)
- **Préféré** : ajoute un 8e quartier `security` (`District`, `DISTRICTS` avec `label: "Security"`, `about: "Agents protégés, contrôles de paiement et preuves d'audit"`, `LIST_ORDER`, `DISTRICT_GLASS`, une forme `forms/security.ts` inspirée de `infrastructure.ts`). Corrige tous les `Record<District, …>` que TypeScript signale. Vérifie que `planCity()` attribue un arc au quartier sans casser l'équilibre (test `tests/unit/explorer/city-wards.test.ts` du repo d'origine à reprendre et faire passer).
- **Repli** si le planificateur résiste plus d'une heure : place AvaGuard L1 dans le quartier `ai` ("Agents, models and the data they learn from"), ce qui reste cohérent avec notre produit.

### 4.3 Le bureau AvaGuard+ (notre immeuble)
- Forme : un repère du skyline (`landmark`) avec la forme `stepped` ou `spire` et un toit `lantern` (types `Kind` / `Roof` de `icm-map.tsx`). Même shader de fenêtres que les autres, mêmes couleurs. **Seul ajout** : une fine couronne verte `#3FD08F` au sommet (anneau émissif discret) et une pastille verte. Ajoute une entrée `AVAGUARD3` dans `palette.ts` (jour et nuit) plutôt que des couleurs en dur.
- Libellé de quartier au même style que les leurs : `SECURITY  1`.

### 4.4 Les équipements de la parcelle (nouveaux composants dans `city3d/`, même style que le reste)
Positionne-les à partir du lot de notre chaîne (`CityLot`) et des points de voie de notre route (sortie de `streetsOf`) : le péage se place là où la voie quitte notre îlot.
- `Toll.tsx` : portique sombre au-dessus de la voie AvaGuard, bandeau vert discret `CONTRÔLE AVAGUARD+`, **barrière animée** rayée, scanner au sol.
- `HumanLot.tsx` : parking de 6 places à marquage ambre `#F2B33D`, borne avec gyrophare, libellé `VALIDATION HUMAINE`.
- `Scrapyard.tsx` : enclos, **broyeur** (portique + presse animée), conteneur `REGISTRE DES HACKERS` au liseré rouge `#FF5D57`, quelques cubes déjà broyés.
- `ProofStack.tsx` : colonne de petits blocs verts `PREUVE ON-CHAIN` au pied du HQ, un bloc de plus à chaque décision.
- Tout utilise les matériaux et la palette de leur code (`paint.ts`, `palette.ts`, `shaders.ts`) pour se fondre dans la ville. Pas de néon saturé.

## 5. La simulation : une voiture à la fois

Nouveau composant `city3d/AvaGuardRun.tsx`, monté dans `City3D.tsx` (marqué `// AVAGUARD:`), piloté par `sim/Director.ts` (hors du canvas).

- **Une seule transaction active.** La suivante démarre quand la précédente est finie (ou sur commande).
- **La voiture** : exporte `PODS` et le maillage "car" de `Traffic.tsx` et réutilise-les (même silhouette que leurs voitures), un peu plus grande, avec une **barre de toit** et un **halo au sol** à la couleur de l'état (bleu `#6FA8FF` vérification, vert `#3FD08F` visa, rouge `#FF5D57` refus, ambre `#F2B33D` humain).
- **Trajet** : elle part du HQ (ou d'un immeuble de l'agent pour le cas IA-IA), roule sur les voies de notre route avec le même amorti que leur trafic (`RAMP_OUT`, `RAMP_IN`, `EASE_SLOPE`), s'arrête au péage.
- **Caméra** : utilise leur `Rig` (`Shot`) pour les vols : `security` (notre parcelle), `toll`, `parking`, `scrapyard`, `cchain`, `follow`. Au retour, `CameraHandle.home()`.

### 5.1 Analyse au péage (chaque étape allume une ligne de la carte, section 6)
1. **Scan** : plan lumineux bleu qui balaie la voiture, carrosserie en "rayon X" un instant.
2. **Hologramme du contrat** : panneau HTML ancré au-dessus du péage (leur `Anchor` de `Labels.tsx` ou `drei <Html>`), qui se déplie ; la ligne `usdc.transfer(0xBad1…7e3A, 4800e6);` s'encadre en rouge avec `RISQUE`.
3. **Fil d'autorité** : nœuds `Humain → Agent → Lecteur PDF → facture_oct.pdf` qui apparaissent en l'air, liens qui se dessinent ; le lien facture → voiture casse en rouge avec `rupture : l'ordre vient de la facture`.
4. **Échantillonnage "Snowball"** (illustration du consensus Avalanche, présentée comme telle) : 20 petites sphères en anneau, 5 vagues de rayons, la couleur majoritaire se propage, barre `CONFIANCE` en 5 crans.
5. **Ping du registre** vers le conteneur de la déchetterie (blanc sans correspondance, rouge si correspondance).
6. **Score** : la jauge compte jusqu'au score, le radar se dessine.
7. **Verdict** : badge, couleur de la voiture.

### 5.2 Les issues
- **ALLOW** : cristaux verts sur le toit (`VISA-7781 · signé KMS`), barrière qui se lève, la voiture roule jusqu'à la C-Chain sur notre route **allumée comme leur survol de route mais en vert** (étends `Traffic` avec une teinte par route : leur `blue[]` devient une couleur par route). À l'arrivée, déclenche **leur flash de la tour** (`flashHubTower` / `runs`) : c'est leur "Flash with transactions". Bouclier vert sur la voiture, toast `Accepté et protégé par AvaGuard+`, un bloc sur la colonne.
- **BLOCK** : givre rouge, barrière qui clignote, demi-tour vers la déchetterie, presse qui descend, secousse de caméra courte, la voiture devient un cube jeté dans le conteneur, libellé `0xBad1…7e3A ajoutée au registre`, toast `Transaction détruite · 4 800 USDC protégés · incident DORA INC-2026-0042`, un bloc sur la colonne.
- **HUMAN** : la voiture se gare au parking, gyrophare ambre, sablier ; alerte en haut à droite avec compte à rebours et boutons **Approuver** / **Refuser** (raccourcis A / R) ; la décision relance ALLOW ou BLOCK.
- **Immunité** : adresse déjà au registre, analyse coupée à 0,3 s, refus immédiat, `Adresse connue · refus en 0,3 s · le 2e agent est immunisé`.

Toutes les durées dans `sim/timings.ts`. Respecte leur `useStill()` (mouvement réduit) : coupes au lieu de vols, pas de secousse.

## 6. Les cartes (même style que leur UI)

Reprends leurs classes Tailwind (`TipPlate`, panneaux de `city-app.tsx`, typo et couleurs de `ui.tsx`) pour que nos cartes aient l'air d'origine.
- **Infobulle de la voiture** (`TipPlate`) : `agent-compta-07 → 0xBad1…7e3A · 4 800 USDC · transfer() · tx_0042`.
- **Carte d'analyse** (à droite, comme leur panneau de chaîne) : en-tête `AVAGUARD · ANALYSE tx_0042` + badge (`ANALYSE…`, `ALLOW · visa`, `HUMAIN`, `BLOCK`) + `décidé en 1,8 s` ; jauge 0 à 100 avec les zones de seuil (vert < 40, ambre 40 à 69, rouge ≥ 70) ; radar des 5 contrôles ; barre `CONFIANCE` ; 5 lignes (Autorité, Bénéficiaire, Mandat, Intention IA, Contrat) avec score `/100` et raison ; 2 raisons en clair ; `Preuve on-chain : bloc #18 342 · 0x9c…e1` ; bouton **Voir le détail**.
- **Détail** : chronologie, chaîne d'autorité, extrait de l'injection, conformité (`DORA INC-2026-0042 · OWASP ASI03 · ASI07 · MITRE ATLAS · NIST CSF`), on-chain (chaîne, bloc, hash, visa, signé KMS), JSON brut.
- Graphiques en SVG (leur repo a `recharts`, tu peux l'utiliser pour le radar si c'est plus propre).

## 7. L'interface autour du canvas (copie de leur mise en page, sans leurs marques)

Lis `city-app.tsx`, `city-key.tsx`, `city-frame.tsx` et reproduis **les mêmes blocs, positions, tailles et classes**, avec nos contenus :
- **Barre haute** : à la place du logo et du menu Builder Hub, notre bouclier + `AvaGuard+`, onglets `City`, `Transactions`, `Registre`, `Audit`, recherche `SEARCH  CTRL K`, bouton thème.
- **Rangée de commandes** : pill `Chaînes N`, segment `Explorer | City`, segment `Mainnet | Fuji` (Fuji par défaut).
- **Recherche centrale** : `Rechercher une transaction, une adresse, un agent…` (filtre la simulation ; pas de recherche IA).
- **Puces** : `Transactions par état`, `Risque moyen`, `Registre des hackers`, `Montant protégé`.
- **Légende** (leur `city-key.tsx`) : garde `HEIGHT`, `WINDOWS`, `LIGHTS`, `STREETS` et ajoute un bloc `AVAGUARD` avec les 4 états.
- **Barre de chiffres** (même composant que leur bandeau AVAX / Market cap / Chains…) : garde `CHAINS`, `VALIDATORS`, `ICM · 24H` de l'instantané (réels, datés), et ajoute nos chiffres : `TRANSACTIONS`, `VISAS`, `BLOQUÉES`, `EN ATTENTE`, `REGISTRE`, `MONTANT PROTÉGÉ`, `DÉCISION MOYENNE`. Retire le prix AVAX et la market cap (on ne les a pas en direct).
- **Bouton rond** en bas à droite : journal des décisions.
- Badge permanent `Concept AvaGuard+ · simulation` et la mention de licence (section 0).
- Barre de démo discrète : `1 Fraude · 2 Légitime · 3 Doute · 4 Immunité · 0 Reset · Espace pause · F suivre`.

## 8. Données de la simulation

Lis d'abord `detection/verdict.schema.json` et `detection/scorer.py` de notre repo, puis écris `sim/adapters/verdictToTx.ts` pour produire ce type (ne modifie pas le schéma de l'équipe) :

```ts
type Decision = "ALLOW" | "HUMAN" | "BLOCK";
type Check = { score: number; reason: string };
type TxEvent = {
  tx_id: string; created_at: string; use_case: "shopping" | "agent_to_agent";
  from: { agent_id: string; address: string }; to: { label: string; address: string; domain?: string };
  amount: { value: number; token: "USDC" | "AVAX" };
  contract: { method: string; line: string; risky: boolean };
  authority_chain: { step: string; ok: boolean }[];
  checks: { authority: Check; beneficiary: Check; mandate: Check; intent_ai: Check; contract: Check };
  score: number; thresholds: { allow_below: number; block_from: number };
  decision: Decision; reasons: string[]; frameworks: string[]; timings_ms: { decide: number };
  onchain?: { chain: string; block: number; tx_hash: string; visa_id?: string }; registry_hit?: boolean;
};
```

`sim/scenario.ts` (démo, fictif) : **Fraude** `tx_0042` (`agent-compta-07` → `0xBad1…7e3A`, 4 800 USDC, facture piégée, contrôles 95 / 88 / 70 / 97 / 40, score 92, BLOCK, 1,8 s, bloc #18 342) ; **Légitime** `tx_0043` (x402, 12 USDC, `api-meteo.example`, score 8, ALLOW, `VISA-7781`) ; **Doute** `tx_0044` (640 USDC, `boutique-neuve.example`, domaine de 3 jours, score 55, HUMAN) ; **Immunité** `tx_0045` (`agent-achats-12` → `0xBad1…7e3A`, `registry_hit`, BLOCK en 0,3 s).

`sim/liveFeed.ts` : même interface, branchée sur l'API de Walid (WebSocket ou SSE) + lecture **viem** des événements du contrat visa (Fuji 43113 ou notre L1). URL et adresse dans `.env.local`, jamais commité. Aucune clé privée dans le front.

## 9. Ne pas casser leur qualité

- Garde leurs optimisations : instancing, `PerformanceMonitor`, `warmup`, `useStill`, ombres, `Post`. Mesure les i/s avant et après nos ajouts : on ne doit pas perdre plus de 5 i/s.
- Pas de `setState` React à chaque image : animations dans `useFrame` avec des refs, et GSAP (ou leurs propres courbes) pour les timelines.
- Le thème clair de leur code doit continuer à marcher (palette jour/nuit), même si la démo se fait en sombre.

## 10. Tests

- Reprends `tests/unit/explorer/city-wards.test.ts` et ajoute un cas avec le quartier `security`.
- Playwright : captures `home`, `toll` (pendant l'analyse), `scrapyard` (au broyage), comparées à des captures de référence enregistrées.
- Test du Director : les 4 transactions du scénario arrivent chacune au bon état final.

## 11. Interdits

- Logo, wordmark ou navigation Avalanche / Builder Hub dans notre UI ; logos de projets ajoutés par nous ; laisser croire à un produit officiel.
- Recopier `city-app.tsx` en entier (trop de dépendances serveur).
- Interroger leurs routes `/api` en boucle (un seul instantané).
- Clés ou secrets dans le code ou dans git.
- Néon saturé : nos ajouts suivent leur palette.
- Tiret cadratin dans les textes de l'interface.

## 12. Phases (capture à la fin de chacune)

1. **Extraction** : `ui3d-city/` affiche leur City Fuji à l'identique, sans erreur. `VENDORED.md` et la licence en place.
2. **Données** : instantanés + routes locales, la City marche hors ligne.
3. **Notre L1** : AvaGuard L1 dans le quartier Security (ou AI), le HQ, la rue vers la C-Chain.
4. **Parcelle** : péage, parking, déchetterie, colonne de blocs, dans le style de la ville.
5. **Simulation** : Director, voiture, analyse, 3 issues, immunité ; touches 1 à 4.
6. **UI** : barre haute, commandes, recherche, puces, légende, chiffres, cartes, alerte humaine.
7. **Live** : flux de Walid + viem.
8. **Finition** : tests, i/s, README (`npm i && npm run dev`, raccourcis, brancher le live).
