FROM node:24-bookworm AS builder
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/tsconfig.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
COPY packages/config/package.json ./packages/config/
RUN pnpm install --filter @genergi/api... --frozen-lockfile=false
COPY apps/api ./apps/api
COPY packages/shared ./packages/shared
COPY packages/config ./packages/config
RUN pnpm --filter @genergi/api build

FROM node:24-bookworm
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/api/dist ./apps/api/dist
EXPOSE 8787
CMD ["node", "apps/api/dist/apps/api/src/index.js"]
