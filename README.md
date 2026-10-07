# AjoPay-Backend

Backend services for **AjoPay** — handles FX quoting, settlement orchestration, and
on-chain event indexing for the AjoPay merchant payment platform.

## Services

| Service | Port | Responsibility |
|---|---|---|
| `api-gateway` | 4000 | Public REST API, auth, request routing |
| `settlement-engine` | 4001 | Creates/tracks payments, calls the settlement contract |
| `fx-engine` | 4002 | USDC → NGN/KES/GHS rate quotes, caching |
| `indexer` | 4003 | Polls Soroban RPC for settlement events, writes to DB |

## Structure

```
AjoPay-Backend/
├── services/
│   ├── api-gateway/
│   ├── settlement-engine/
│   ├── fx-engine/
│   └── indexer/
├── prisma/
│   └── schema.prisma
├── .env.example
├── package.json
└── pnpm-workspace.yaml
```

## Requirements

- Node.js 20+
- pnpm
- PostgreSQL (local or hosted, e.g. Supabase/Railway/Neon)

## Quick Start

```bash
cp .env.example .env
pnpm install
pnpm prisma migrate dev
pnpm dev   # starts all four services concurrently
```

## Environment Variables

See `.env.example`. Key ones:

- `DATABASE_URL` — Postgres connection string
- `STELLAR_RPC_URL` — Soroban RPC endpoint (testnet or mainnet)
- `SETTLEMENT_CONTRACT_ID` / `GOVERNANCE_CONTRACT_ID` — from `AjoPay-Contract` deploy
- `FX_RATE_PROVIDER_API_KEY` — your chosen FX/crypto price API key

## Status

Under active development — see the org-level build plan for the current milestone.

## License

MIT
