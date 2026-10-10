# Sentinel City

City 3D de l'explorer Avalanche Builder Hub (code open source, BSD-3), reprise avec un quartier **Security** où vit
**Sentinel L1** : un péage qui analyse chaque paiement d'agent IA, un parking de validation humaine, une déchetterie avec
le registre des hackers, et une colonne de preuves on-chain. La ville ne montre **que Sentinel** (les autres chaînes et
leur trafic sont retirés) et **une seule voiture** par transaction : elle sort de Sentinel, s'arrête au péage, se fait
scanner, puis selon le verdict passe vers la blockchain (verte), se gare (orange) ou finit au compacteur (rouge).

> City 3D d'après le code open source Avalanche Builder Hub (BSD-3). Non affilié à Ava Labs. Licence : `LICENSES/builders-hub-LICENSE`.

## Lancer

```bash
npm i --legacy-peer-deps
npm run dev            # http://localhost:3000
```

## Démo (clavier)

| Touche | Action |
| --- | --- |
| `1` | Fraude : facture empoisonnée, 4 800 USDC vers `0xBad1…7e3A`, scan, refus, compacteur, registre |
| `2` | Légitime : visa signé KMS, barrière levée, route verte jusqu'à la blockchain |
| `3` | Doute : parking, validation humaine (`A` approuver, `R` refuser) |
| `4` | Immunité : adresse déjà au registre, refus instantané (jouer `1` avant) |
| `0` Reset · `Espace` pause · `F` suivre la voiture · `D` détail · `Ctrl K` recherche |

Une seule transaction à la fois ; les suivantes attendent en file (`sim/Director.ts`).

## Connexion à la blockchain Sentinel (mode live)

La ville est branchée sur la **vraie L1 Sentinel** déployée sur Avalanche Fuji. Ouvre **`/?live=1`** : chaque décision
prise par l'API (quand le cerveau appelle `POST /authorize`) arrive en **SSE** et fait apparaître une voiture, et la
**preuve on-chain** (event `DecisionRecorded`) est lue en direct sur le registre via viem.

`.env.local` (déjà configuré, jamais commité) :

```
NEXT_PUBLIC_AVAGUARD_SSE_URL=https://rpc.petroi.fr/avaguard/events   # flux des verdicts (format detection/verdict.schema.json)
NEXT_PUBLIC_RPC_URL=https://rpc.petroi.fr/rpc                        # RPC de Sentinel L1 (lecture seule)
NEXT_PUBLIC_REGISTRY_ADDRESS=0x7A7e5F80BE65F588DF975C4Aa563BA442db8bcb6  # AuthorityRegistry (DecisionRecorded)
NEXT_PUBLIC_CHAIN=l1
NEXT_PUBLIC_L1_CHAIN_ID=99999                                        # chainId de Sentinel L1 (token SEC)
NEXT_PUBLIC_AVAGUARD_CHAIN_ID=99999
```

Détails de la chaîne : L1 Avalanche (Fuji, ACP-77), chainId **99999**, token **SEC**, contrats `AuthorityRegistry`
`0x7A7e…bcb6` + `GuardedVault` `0xc7de…C7c0`. API + RPC + explorer publics : `rpc.petroi.fr`, `explorer.petroi.fr`.
Le wiring est dans `sim/liveFeed.ts` (SSE + `watchEvent` sur `DecisionRecorded`) et `app/avaguard/CityShell.tsx`.

Aucune clé privée côté front : la ville ne fait que **lire** la chaîne et **écouter** le flux de verdicts.
Hors ligne, les touches 1 à 4 rejouent des scénarios sans réseau.

## Structure

- `components/explorer-v2/**`, `lib/**`, `types/**` : code extrait de builders-hub (liste dans `VENDORED.md`). Les ajouts/retouches sont marqués `// AVAGUARD:` ou `// SENTINEL:`.
- `components/explorer-v2/network/city-data.ts` : réduit la ville à Sentinel + le hub (retire les autres chaînes).
- `components/explorer-v2/network/city3d/guardGeo.ts`, `Parcel.tsx`, `AvaGuardRun.tsx` : la parcelle, la route principale, le péage/scan, la voiture.
- `sim/` : scénarios, timings, store, Director (GSAP), adaptateur verdict (`adapters/verdictToTx.ts`), flux live (`liveFeed.ts`).
- `app/avaguard/` : la page (barre, recherche, chiffres, carte d'analyse, panneaux, alerte humaine).

## Scripts

```bash
npm test                              # vitest
npm run build && node .next/standalone # ou: npm start (next start)
node tools/capture.mjs <plan.json>    # captures via Chrome headless (CDP)
```
