# Multi-stage build: install workspace deps once, then build/run just this service.
FROM node:20-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/db/package.json packages/db/package.json
COPY services/settlement-engine/package.json services/settlement-engine/package.json
RUN pnpm install --frozen-lockfile --filter "@ajopay/db" --filter "@ajopay/settlement-engine"...

FROM base AS runtime
COPY --from=deps /app /app
COPY packages/db packages/db
COPY services/settlement-engine services/settlement-engine
COPY tsconfig.base.json ./
RUN pnpm --filter @ajopay/db generate

WORKDIR /app/services/settlement-engine
EXPOSE 4001
CMD ["pnpm", "exec", "tsx", "src/index.ts"]
