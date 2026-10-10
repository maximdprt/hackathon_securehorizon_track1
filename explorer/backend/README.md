# SentinelScan backend — indexer + API

Node/TypeScript backend for the SentinelScan explorer.

- **API** (`src/index.ts`) — Koa REST: blocks, transactions, entities/contracts.
- **Indexer** (`periphery/indexer/index.ts`) — follows new blocks and writes them to MongoDB.
- **Backfill** (`backfill.ts`) — one-off load of existing history (the live indexer only picks up new blocks).

## Quick start
```bash
cp .env.example .env     # set DB_STRING + RPC_URL
npm install
npm run start:api        # :3002
npm run start:indexer    # separate terminal
npx ts-node backfill.ts  # once, to load existing blocks
```

## Env
| Var | Description |
|---|---|
| `PORT` | API port (default 3002) |
| `DB_STRING` | MongoDB connection string |
| `DB_NAME` | MongoDB database name |
| `RPC_URL` | SentinelL1 JSON-RPC endpoint |

## API
- `GET /blocks` · `GET /block/:number` · `GET /blocks/count`
- `GET /transactions` · `GET /transaction/:hash` · `GET /transactions/count`
- `GET /entity/resolve/:identifier`
