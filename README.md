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
cp  .env
pnpm install
pnpm prisma migrate dev
pnpm dev   # starts all four services concurrently
```

## Environment Variables

See `.env` Key ones:

- `DATABASE_URL` — Postgres connection string
- `STELLAR_RPC_URL` — Soroban RPC endpoint (testnet or mainnet)
- `SETTLEMENT_CONTRACT_ID` / `GOVERNANCE_CONTRACT_ID` — from `AjoPay-Contract` deploy
- `FX_RATE_PROVIDER_API_KEY` — your chosen FX/crypto price API key

## Webhooks

Merchants can set a `webhookUrl` on their account (currently a DB field — there's
no settings-page UI for it yet, a good next feature to pair with the frontend's
settings page). When set, `settlement-engine` POSTs an HMAC-signed JSON payload
on three events:

- `payment.paid`
- `settlement.completed`
- `settlement.failed`

Each request carries an `x-ajopay-signature` header (`HMAC-SHA256` over the raw
body, using `WEBHOOK_SIGNING_SECRET`). Deliveries are retried up to 3 times and
logged to the `WebhookDelivery` table either way, so failures are debuggable
rather than silent. See `services/settlement-engine/src/webhooks.ts`.

## Tests

`fx-engine` and `settlement-engine` have Vitest unit tests covering their core
business logic (`quote.ts` and `transitions.ts` respectively), kept deliberately
free of database/network calls so they run fast and don't need Postgres up:

```bash
pnpm test
```

`api-gateway` and `indexer` don't have dedicated tests yet — mostly thin
routing/polling logic — but are reasonable next additions if you want full
coverage.

## Running with Docker

Each service has its own `Dockerfile`, and `docker-compose.yml` wires them
together with a Postgres container:

```bash
cp .env.example .env     # fill in SETTLEMENT_CONTRACT_ID etc. first
docker compose up --build
```

This starts Postgres, `fx-engine`, `settlement-engine`, `indexer`, and
`api-gateway` on their usual ports. Run Prisma migrations against the
Dockerized Postgres once, from the host, before first use:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ajopay pnpm db:migrate
```

## Status

Under active development — see the org-level build plan for the current milestone.

## License

MIT
