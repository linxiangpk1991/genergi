FROM node:24-bookworm AS builder
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/tsconfig.json ./apps/worker/
COPY packages/shared/package.json ./packages/shared/
COPY packages/config/package.json ./packages/config/
RUN pnpm install --filter @genergi/worker... --frozen-lockfile=false
COPY apps/worker ./apps/worker
COPY packages/shared ./packages/shared
COPY packages/config ./packages/config
RUN pnpm --filter @genergi/worker build

FROM node:24-bookworm
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/worker/package.json ./apps/worker/package.json
COPY --from=builder /app/apps/worker/dist ./apps/worker/dist
CMD ["node", "apps/worker/dist/apps/worker/src/index.js"]
