# Stage 1: Build
FROM node:24-alpine AS builder
WORKDIR /app
ENV CI=true

COPY package.json pnpm-lock.yaml* ./
COPY pnpm-workspace.yaml ./
COPY turbo.json ./
COPY apps/desk-api/package.json apps/desk-api/
COPY packages/ packages/
COPY modules/ modules/

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
RUN pnpm install --frozen-lockfile --filter @cvg/desk-api...

COPY apps/desk-api/ apps/desk-api/
COPY tsconfig*.json ./

RUN pnpm --filter @cvg/desk-api exec tsc --noEmit || true

# Stage 2: Production
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN apk upgrade --no-cache && apk add --no-cache tini curl
RUN addgroup -g 1001 -S appgroup && adduser -S appuser -u 1001 -G appgroup

COPY package.json pnpm-lock.yaml* ./
COPY pnpm-workspace.yaml ./
COPY apps/desk-api/ apps/desk-api/
COPY packages/ packages/
COPY modules/ modules/
COPY tsconfig*.json ./

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate \
  && pnpm install --frozen-lockfile --prod --filter @cvg/desk-api... \
  && corepack cache clean \
  && rm -rf /root/.cache/node/corepack /root/.local/share/pnpm/store /root/.pnpm-store

USER appuser
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["apps/desk-api/node_modules/.bin/tsx", "apps/desk-api/src/index.ts"]
