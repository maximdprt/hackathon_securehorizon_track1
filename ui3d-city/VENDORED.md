# Vendored code

The 3D City is extracted from **Avalanche Builder Hub** (https://github.com/ava-labs/builders-hub),
commit `c28b4e9969ff40b420554ec9a6b4363b7abb2689`, under the BSD 3-Clause License (Copyright (c) 2021, Ava Labs, Inc.), see
`LICENSES/builders-hub-LICENSE`. This project is not endorsed by Ava Labs. Their logos, wordmark and
site navigation are not used. Every local change to a vendored file is marked `// AVAGUARD:`.

Regenerate with `node scripts/extract-city.mjs <path to builders-hub>`.

## Files copied as is (85 + 1 declaration + 5 images)

- `components/explorer-v2/evm/EvmOverviewStats.tsx`
- `components/explorer-v2/evm/metric-charts.tsx`
- `components/explorer-v2/evm/query/motion.ts`
- `components/explorer-v2/format.ts`
- `components/explorer-v2/motion.ts`
- `components/explorer-v2/network/city-data.ts`
- `components/explorer-v2/network/city-frame.tsx`
- `components/explorer-v2/network/city-geometry.ts`
- `components/explorer-v2/network/city-key.tsx`
- `components/explorer-v2/network/city-model.ts`
- `components/explorer-v2/network/city-signal.ts`
- `components/explorer-v2/network/city-traffic.tsx`
- `components/explorer-v2/network/city.ts`
- `components/explorer-v2/network/city3d/Backdrop.tsx`
- `components/explorer-v2/network/city3d/Buildings.tsx`
- `components/explorer-v2/network/city3d/City3D.tsx`
- `components/explorer-v2/network/city3d/Ground.tsx`
- `components/explorer-v2/network/city3d/Helicopters.tsx`
- `components/explorer-v2/network/city3d/HubTower.tsx`
- `components/explorer-v2/network/city3d/Labels.tsx`
- `components/explorer-v2/network/city3d/Ledger.tsx`
- `components/explorer-v2/network/city3d/Lighting.tsx`
- `components/explorer-v2/network/city3d/Marks.tsx`
- `components/explorer-v2/network/city3d/Pillar.tsx`
- `components/explorer-v2/network/city3d/Post.tsx`
- `components/explorer-v2/network/city3d/Rig.tsx`
- `components/explorer-v2/network/city3d/Sites.tsx`
- `components/explorer-v2/network/city3d/Streetlights.tsx`
- `components/explorer-v2/network/city3d/Traffic.tsx`
- `components/explorer-v2/network/city3d/forms/ai.ts`
- `components/explorer-v2/network/city3d/forms/culture.ts`
- `components/explorer-v2/network/city3d/forms/enterprise.ts`
- `components/explorer-v2/network/city3d/forms/estate.ts`
- `components/explorer-v2/network/city3d/forms/finance.ts`
- `components/explorer-v2/network/city3d/forms/frame.ts`
- `components/explorer-v2/network/city3d/forms/gaming.ts`
- `components/explorer-v2/network/city3d/forms/index.ts`
- `components/explorer-v2/network/city3d/forms/infrastructure.ts`
- `components/explorer-v2/network/city3d/forms/shapes.ts`
- `components/explorer-v2/network/city3d/geometry.ts`
- `components/explorer-v2/network/city3d/haze.ts`
- `components/explorer-v2/network/city3d/instancing.ts`
- `components/explorer-v2/network/city3d/lanes.ts`
- `components/explorer-v2/network/city3d/model.ts`
- `components/explorer-v2/network/city3d/options.ts`
- `components/explorer-v2/network/city3d/paint.ts`
- `components/explorer-v2/network/city3d/palette.ts`
- `components/explorer-v2/network/city3d/passes.ts`
- `components/explorer-v2/network/city3d/peaks-bake.ts`
- `components/explorer-v2/network/city3d/shaders.ts`
- `components/explorer-v2/network/city3d/tile.ts`
- `components/explorer-v2/network/city3d/warmup.tsx`
- `components/explorer-v2/network/districts.ts`
- `components/explorer-v2/network/ground.ts`
- `components/explorer-v2/network/guest-logos.ts`
- `components/explorer-v2/network/hub-tower.tsx`
- `components/explorer-v2/network/icm-map.tsx`
- `components/explorer-v2/network/icm-parts.tsx`
- `components/explorer-v2/network/network-reads.ts`
- `components/explorer-v2/network/newcomers.ts`
- `components/explorer-v2/network/pchain-pulse.ts`
- `components/explorer-v2/network/private.ts`
- `components/explorer-v2/network/tx-targets.ts`
- `components/explorer-v2/network/webgl-probe.ts`
- `components/explorer-v2/page-data.ts`
- `components/explorer-v2/router-ref.tsx`
- `components/explorer-v2/staking/bits.tsx`
- `components/explorer-v2/staking/data.ts`
- `components/explorer-v2/subnav-tabs.ts`
- `components/explorer-v2/time-range.tsx`
- `components/explorer-v2/ui.tsx`
- `components/explorer-v2/view-switch.tsx`
- `constants/l1-chains.json`
- `lib/avalanchego-releases.ts`
- `lib/chain-alias.ts`
- `lib/dedicated-stats.ts`
- `lib/explorer-catalog.ts`
- `lib/explorer-query/target.ts`
- `lib/explorer-soft-status.ts`
- `lib/l1-validator-triage.ts`
- `lib/pchain-explorer.ts`
- `lib/pchain-node.ts`
- `lib/utils.ts`
- `lib/validator-triage.ts`
- `types/stats.ts`
- `types/n8ao.d.ts`
- `public/images/city3d/clouds-day.webp`
- `public/images/city3d/clouds-night.webp`
- `public/images/city3d/marble.webp`
- `public/images/city3d/peaks-dem.webp`
- `public/images/city3d/peaks.webp`

## Replaced by local stubs

- `components/explorer-v2/network/city-app.tsx` (imported by `components/explorer-v2/network/city-key.tsx`)

## npm packages used by the vendored code

- `@react-three/drei` (3 files)
- `@react-three/fiber` (17 files)
- `@scure/base` (1 file)
- `clsx` (1 file)
- `framer-motion` (3 files)
- `lucide-react` (6 files)
- `n8ao` (2 files)
- `next` (6 files)
- `postprocessing` (2 files)
- `react` (36 files)
- `recharts` (1 file)
- `tailwind-merge` (1 file)
- `three` (22 files)
