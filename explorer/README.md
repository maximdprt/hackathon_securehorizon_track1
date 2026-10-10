# SentinelScan — SentinelL1 block explorer

Self-hosted block explorer for **SentinelL1** (our Avalanche L1, chainId `99999`, token `SEC`). It indexes the chain into MongoDB and serves a SvelteKit UI, themed with our Vercel-inspired design system (see [`/DESIGN.md`](../DESIGN.md)). It renders blocks, transactions, addresses and contract logs — including our `AuthorityRegistry` events (`VisaGranted`, `ThreatFlagged`, `DecisionRecorded`) and blocked (reverted) payments, which is the on-chain proof trail for the demo.

## Architecture
```
Avalanche L1 (RPC)  ──►  indexer ──►  MongoDB  ──►  backend API (Koa)  ──►  frontend (SvelteKit)
                                                                            └─►  https://explorer.petroi.fr
```
- **backend/** — Node/TypeScript. Koa REST API (`/blocks`, `/transactions`, `/entity/...`) + a block indexer (`periphery/indexer`) that follows new blocks via `provider.on("block")`. One-off history load: `npx ts-node backfill.ts`.
- **frontend/** — SvelteKit (adapter-node), daisyUI + Tailwind v4, rebranded SentinelScan + Vercel theme.

## Run locally
```bash
# Mongo (docker)
docker run -d --name mongo -p 27017:27017 -v $PWD/mongodata:/data/db mongo:7

# backend
cd backend && cp .env.example .env   # set RPC_URL to the L1 rpc
npm install
npm run start:api        # :3002
npm run start:indexer    # separate process
npx ts-node backfill.ts  # load existing blocks once

# frontend
cd ../frontend && cp .env.example .env
npm install
npm run build && node build   # :3000 (PORT env to change)
```

## Production (what's live)
Deployed on our EC2, all as `systemd` services (`erol-api` :3002, `erol-indexer`, `erol-frontend` :3005) + Mongo (Docker), exposed at **https://explorer.petroi.fr** through the same cloudflare named tunnel as the API. See `CLAUDE.md` §11.5–11.6 for the full ops map.

## Notes
- subnet-evm chains are pre-Shanghai at genesis here, so contracts are compiled with `--evm-version paris` (see `/contracts`).
- The explorer is read-only; it never signs. Writes to the chain go through the authority API (`/api`).
