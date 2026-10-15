# Multi-stage build: install workspace deps once, then build/run just this service.
FROM node:20-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/db/package.json packages/db/package.json
COPY services/indexer/package.json services/indexer/package.json
RUN pnpm install --frozen-lockfile --filter "@ajopay/db" --filter "@ajopay/indexer"...

FROM base AS runtime
COPY --from=deps /app /app
COPY packages/db packages/db
COPY services/indexer services/indexer
COPY tsconfig.base.json ./
RUN pnpm --filter @ajopay/db generate

WORKDIR /app/services/indexer
EXPOSE 4003
CMD ["pnpm", "exec", "tsx", "src/index.ts"]
