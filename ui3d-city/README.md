# AvaGuard+ City

La City 3D de l'explorer Avalanche Builder Hub (code open source, BSD-3), reprise telle quelle, avec un quartier
**Security** où vit **AvaGuard L1** : un péage qui analyse chaque paiement d'agent IA, un parking de validation humaine,
une déchetterie avec le registre des hackers, et une colonne de preuves on-chain.

> City 3D d'après le code open source Avalanche Builder Hub (BSD-3) · Concept AvaGuard+ · simulation.
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
| Tour AvaGuard L1 | **Audit** : détection, escalades, délais, incidents DORA, contrôle décisif, seuils, conformité |
| La voiture | Transactions, ouvert sur sa transaction |
| Toute autre tour | Vol caméra de la City et fiche de la chaîne |

Les écrans lisent une seule source (`data/source.ts`) : historique synthétique plus transactions jouées. Pour le MCP
agent : `NEXT_PUBLIC_AVAGUARD_MCP_URL` dans `.env.local` (`GET /transactions` au format `verdict.schema.json`).

## Mode live

Copier les variables dans `.env.local` (jamais commité), puis ouvrir `http://localhost:3000/?live=1`.

```
NEXT_PUBLIC_AVAGUARD_SSE_URL=http://localhost:8787/events     # verdicts de l'API (ou _WS_URL)
NEXT_PUBLIC_AVAGUARD_RPC_URL=...                               # RPC de la L1 (lecture seule)
NEXT_PUBLIC_AVAGUARD_REGISTRY_ADDRESS=0x...                    # contrat DecisionRecorded(...)
NEXT_PUBLIC_AVAGUARD_CHAIN_ID=avaguard-l1
```

En attendant l'API de l'équipe, `tools/live_bridge.py` fait tourner le vrai `detection/scorer.py` et diffuse ses
verdicts en SSE :

```bash
python tools/live_bridge.py --repo ..      # puis GET /demo?case=poisoned ou POST /score
```

Aucune clé privée côté front ; les identifiants AWS restent dans le `.env` du repo, lu par le bridge seulement.

## Structure

- `components/explorer-v2/**`, `lib/**`, `types/**` : code extrait de builders-hub (liste dans `VENDORED.md`). Chaque
  modification locale est marquée `// AVAGUARD:`.
- `components/explorer-v2/network/avaguard.ts` : la chaîne AvaGuard L1, son district, ses flux ICM simulés.
- `components/explorer-v2/network/city3d/guardGeo.ts`, `Parcel.tsx`, `HumanLot.tsx`, `GuardCar.tsx`, `Door.tsx`,
  `AvaGuardRun.tsx` : la parcelle (péage, parking clos, déchetterie, registre, preuves), la voiture (le module de la
  flotte builders-hub), les portes cliquables, l'analyse au péage.
- `data/` : la source des écrans (historique synthétique, registre dérivé des refus, branchement MCP).
- `app/avaguard/views/` : les écrans Transactions, Registre, Validation humaine, Audit.
- `sim/` : scénarios, timings, store, Director (GSAP), adaptateur verdict, flux live.
- `app/avaguard/` : la page autour de la City (barre, recherche, chiffres, carte d'analyse, panneaux, alerte humaine).

## Scripts

```bash
npm test                  # vitest : city-wards (+ cas Security), Director (4 scènes), source des écrans
npm run test:visual       # Playwright (Chrome installé) : captures home / péage / déchetterie, et chaque porte, dans docs/captures
npm run extract           # ré-extraire la City depuis un clone de builders-hub
npm run snapshot          # ré-enregistrer l'instantané Fuji (une fois)
node tools/capture.mjs <plan.json>   # captures et images pour GIF via Chrome headless
```

## Données

Les chiffres Chains, Validators et ICM·24H sont réels et datés (instantané Fuji). Le flux ICM de Fuji étant vide au
moment de l'instantané, le trafic des rues est simulé et signalé comme tel (« ICM traffic · 24H · simulé »). Tout ce qui
concerne AvaGuard (transactions, visas, registre, montants) est simulé.
