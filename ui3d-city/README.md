# Sentinel City

La City 3D de l'explorer Avalanche Builder Hub (code open source, BSD-3), reprise telle quelle, avec un quartier
**Sécurité** où vit **Sentinel L1** : un péage qui analyse chaque paiement d'agent IA, un parking de validation humaine,
une déchetterie avec le registre des hackers, et une colonne de preuves on-chain.

## La ville

Au centre, le protocole sur son campus (liseré vert) : la tour Sentinel (vitrage sarcelle, couronne verte), la route
éclairée jusqu'à la C-Chain, le portique de radiographie, le poste d'avis humain, la presse et le registre, la colonne de
preuves en verre où chaque décision pose un bloc (vert visa, rouge refus), la porte rouge de la C-Chain dont le rideau de
lumière s'allume au passage d'un visa. Autour, **le reste du réseau** : les 229 autres L1 de Fuji, réelles (instantané),
debout en amphithéâtre ouvert côté caméra (`city.ts` `ringCity`, `withRing`), les plus hautes au fond, rien entre le
lecteur et la route ; une rivière passe devant le campus, la banlieue basse remplit le reste du plateau. Les quartiers,
les infobulles et la légende sont en français.

Pendant un paiement, si le lecteur n'a pas pris la caméra, elle se pose sur **la scène** (le protocole entier, vu de plus
près) puis revient ; `F` ou un clic sur la voiture la fait suivre plan par plan.

| Réglage | Effet |
| --- | --- |
| `?ring=0` ou `NEXT_PUBLIC_CITY_RING=0` | la ville du protocole seul (sans le réseau autour, avec son périmètre) |
| `?stage=0` | la caméra reste sur la vue d'ensemble pendant un paiement |
| `NEXT_PUBLIC_CITY_FULL=1` | la ville de builders-hub d'origine, toutes les chaînes à leur place |

> City 3D d'après le code open source Avalanche Builder Hub (BSD-3) · Concept Sentinel · simulation.
> Ce projet n'est ni affilié ni approuvé par Ava Labs. Licence d'origine : `LICENSES/builders-hub-LICENSE`.

## Lancer

```bash
npm i --legacy-peer-deps
npm run dev            # http://localhost:3000
```

Tout tourne hors ligne : les données Fuji viennent d'un instantané (`fixtures/`, servi par `app/api/[...path]`), lu une
seule fois. Aucune requête en boucle vers build.avax.network.

## Démo (clavier)

| Touche | Action |
| --- | --- |
| `1` | Fraude : facture empoisonnée, 4 800 USDC vers `0xBad1…7e3A`, refus, presse, registre |
| `2` | Légitime : 12 USDC, visa signé KMS, rue verte jusqu'à la C-Chain |
| `3` | Doute : score 55, parking, validation humaine (`A` approuver, `R` refuser) |
| `4` | Immunité : adresse déjà au registre, refus instantané (jouer `1` avant) |
| `0` | Reset |
| `Espace` | Pause / reprise |
| `F` | Caméra sur la voiture |
| `D` | Détail de la transaction |
| `Ctrl K` | Recherche |

Une seule transaction à la fois ; les suivantes attendent en file (`sim/Director.ts`).

## Chaque bâtiment est une porte

Survol : la plaque d'info au style de la City. Clic : l'écran s'ouvre par-dessus la ville (la scène reste montée),
l'URL suit (`?view=transactions&tx=tx_0042`), `Échap` ou Précédent ramène à la ville.

| Clic sur | Ouvre |
| --- | --- |
| Tour C-Chain (rouge) | **Transactions** : toutes les transactions, filtres, recherche, et pour chacune l'audit (score, 5 contrôles, seuils KPMG, chaîne d'autorité, contrat, preuve on-chain, conformité, JSON brut) |
| Conteneur rouge | **Registre des hackers** : adresses et empreintes de clé bannies, tentatives, preuve, export CSV |
| Parking couvert | **Validation humaine** : demande en attente (compte à rebours, A / R), plan du parking, historique |
| Péage | Transactions, ouvert sur la transaction en cours |
| Déchetterie | Transactions filtrées « Bloquées » |
| Colonne de preuves | Transactions filtrées « Preuve on-chain » |
| Tour Sentinel L1 | **Audit** : détection, escalades, délais, incidents DORA, contrôle décisif, seuils, conformité |
| La voiture | Transactions, ouvert sur sa transaction |
| Toute autre tour | Vol caméra de la City et fiche de la chaîne |

Les écrans lisent une seule source (`data/source.ts`) : historique synthétique plus transactions jouées. Pour le MCP
agent : `NEXT_PUBLIC_AVAGUARD_MCP_URL` dans `.env.local` (`GET /transactions` au format `verdict.schema.json`).

## Guard Yard : scanner et broyeur

Sur une transaction refusée, « Voir le contrôle » (carte d'analyse, audit d'une transaction) ouvre une cinématique 3D :
portique de radiographie, verdict, grue, presse à épaves, benne du registre des hackers. Aussi seule sur `/guard`.
Code, timings, branchement d'un verdict et captures : `docs/guard-yard.md`.

## Branché sur SentinelL1 (le modèle de main)

La ville lit la vraie chaîne de l'équipe via l'API de `main` (`api/server.py`, voir CLAUDE.md 11.3 à 11.7) :

- **Écrans** (Transactions, Registre, Validation, Audit) : `GET /cars` (chaque `DecisionRecorded` de
  `AuthorityRegistry`, avec le destinataire et le montant du `VisaGranted`) et `eth_getLogs ThreatFlagged` via
  `POST /rpc` (le registre des hackers on-chain). Mise à jour toutes les 3 s, liens vers l'explorer SentinelScan.
- **Tour du quartier Security** : la vraie SentinelL1 de Fuji (blockchainId `2Pqoo…NkZhd`, 1 validateur).
- **Voitures en direct** (`?live=1`) : le flux `GET /avaguard/events` (`{verdict, context, proof}`) fait jouer chaque
  décision dans la ville ; l'événement `DecisionRecorded(bytes32 paymentId, address issuer, string verdict, string reason)`
  donne la preuve. Un verdict reçu et sa ligne on-chain sont réunis par leur `paymentId`.
- La chaîne publie le verdict, la raison et la preuve, pas les scores des 5 contrôles : l'écran le dit
  (« verdict seul ») au lieu d'inventer des scores. Les touches 1 à 4 restent des démos, marquées « démo ».

Configuration : copier `.env.example` en `.env.local` (jamais commité) et y mettre les URLs du CLAUDE.md.
Sans `NEXT_PUBLIC_SENTINEL_API`, tout tourne sur la simulation locale.

## Structure

- `components/explorer-v2/**`, `lib/**`, `types/**` : code extrait de builders-hub (liste dans `VENDORED.md`). Chaque
  modification locale est marquée `// AVAGUARD:`.
- `components/explorer-v2/network/avaguard.ts` : la chaîne Sentinel L1, son district, ses flux ICM simulés.
- `components/explorer-v2/network/city3d/guardGeo.ts`, `Parcel.tsx`, `HumanLot.tsx`, `GuardCar.tsx`, `Door.tsx`,
  `AvaGuardRun.tsx` : la parcelle (péage, parking clos, déchetterie, registre, preuves), la voiture (le module de la
  flotte builders-hub), les portes cliquables, l'analyse au péage.
- `data/` : la source des écrans (historique synthétique, registre dérivé des refus, branchement MCP).
- `app/avaguard/views/` : les écrans Transactions, Registre, Validation humaine, Audit.
- `sim/` : scénarios, timings, store, Director (GSAP), adaptateur verdict, flux live.
- `app/avaguard/` : la page autour de la City (barre, recherche, chiffres, carte d'analyse, panneaux, alerte humaine).

## Scripts

```bash
npm test                  # vitest : city-wards (+ cas Security), city-ring (l'anneau du réseau), Director (4 scènes), source des écrans
npm run test:visual       # Playwright (Chrome installé) : captures home / péage / déchetterie, et chaque porte, dans docs/captures
npm run extract           # ré-extraire la City depuis un clone de builders-hub
npm run snapshot          # ré-enregistrer l'instantané Fuji (une fois)
node tools/capture.mjs <plan.json>   # captures et images pour GIF via Chrome headless
```

## Données

Les chiffres Chains, Validators et ICM·24H sont réels et datés (instantané Fuji), comme les tours de l'anneau (une par L1,
hauteur selon ses validateurs). Le flux ICM de Fuji étant vide au
moment de l'instantané, le trafic des rues est simulé et signalé comme tel (« ICM traffic · 24H · simulé »). Tout ce qui
concerne Sentinel (transactions, visas, registre, montants) est simulé.
