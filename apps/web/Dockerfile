FROM node:24-bookworm AS builder
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/tsconfig.json apps/web/vite.config.ts apps/web/index.html ./apps/web/
COPY packages/shared/package.json ./packages/shared/
COPY packages/config/package.json ./packages/config/
COPY packages/ui/package.json ./packages/ui/
RUN pnpm install --filter @genergi/web... --frozen-lockfile=false
COPY apps/web ./apps/web
COPY packages/shared ./packages/shared
COPY packages/config ./packages/config
COPY packages/ui ./packages/ui
RUN pnpm --filter @genergi/web build

FROM nginx:1.27-alpine
COPY apps/web/nginx.default.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
