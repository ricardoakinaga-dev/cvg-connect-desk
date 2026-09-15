# Stage 1: Build
FROM node:24-alpine AS builder
WORKDIR /app
ENV CI=true

# All workspace manifests must be present so the frozen lockfile can be validated.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/desk-api/package.json apps/desk-api/
COPY apps/desk-web/package.json apps/desk-web/
COPY apps/message-worker/package.json apps/message-worker/
COPY apps/realtime-service/package.json apps/realtime-service/
COPY packages/ packages/
COPY modules/ modules/

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
RUN pnpm install -r --frozen-lockfile

COPY apps/message-worker/ apps/message-worker/
COPY tsconfig*.json ./

# Stage 2: Production
FROM node:24-alpine AS runner
WORKDIR /app
ENV CI=true
ENV NODE_ENV=production

RUN apk add --no-cache tini
RUN addgroup -g 1001 -S appgroup && adduser -S appuser -u 1001 -G appgroup

COPY --from=builder /app/package.json /app/pnpm-lock.yaml ./
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/apps/desk-api/package.json apps/desk-api/
COPY --from=builder /app/apps/desk-web/package.json apps/desk-web/
COPY --from=builder /app/apps/message-worker/package.json apps/message-worker/
COPY --from=builder /app/apps/realtime-service/package.json apps/realtime-service/
COPY --from=builder /app/packages/ packages/
COPY --from=builder /app/modules/ modules/
COPY --from=builder /app/apps/message-worker/ apps/message-worker/
COPY --from=builder /app/tsconfig*.json ./

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate \
  && pnpm install -r --frozen-lockfile --prod \
  && rm -rf /root/.pnpm-store

USER appuser

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD pnpm --filter @cvg/message-worker exec tsx src/healthcheck.ts

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "pnpm --filter @cvg/message-worker exec tsx src/index.ts"]
