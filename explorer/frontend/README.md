# SentinelScan frontend

SvelteKit explorer UI for SentinelL1 (adapter-node, daisyUI + Tailwind v4), themed with the
Vercel-inspired design system in [`/DESIGN.md`](../../DESIGN.md).

```bash
cp .env.example .env
npm install
npm run build
node build        # serves on PORT (default 3000)
```
Needs the backend API (`EXPLORER_API_URL`) and MongoDB (`DB_STRING`). English-only locale by default.
