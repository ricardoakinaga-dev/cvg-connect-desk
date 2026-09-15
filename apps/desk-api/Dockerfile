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

COPY apps/desk-api/ apps/desk-api/
COPY tsconfig*.json ./

# The production image must typecheck deployable code without depending on the
# repository-only AAA harness, which is intentionally not copied into the image.
# Test sources remain covered by the workspace typecheck and production suites.
RUN pnpm --filter @cvg/desk-api exec tsc --noEmit -p tsconfig.build.json

# Stage 2: Production
FROM node:24-alpine AS runner
WORKDIR /app
ENV CI=true
ENV NODE_ENV=production

RUN apk upgrade --no-cache && apk add --no-cache tini curl
RUN addgroup -g 1001 -S appgroup && adduser -S appuser -u 1001 -G appgroup

COPY --from=builder /app/package.json /app/pnpm-lock.yaml ./
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/apps/desk-api/package.json apps/desk-api/
COPY --from=builder /app/apps/desk-web/package.json apps/desk-web/
COPY --from=builder /app/apps/message-worker/package.json apps/message-worker/
COPY --from=builder /app/apps/realtime-service/package.json apps/realtime-service/
COPY --from=builder /app/packages/ packages/
COPY --from=builder /app/modules/ modules/
COPY --from=builder /app/apps/desk-api/ apps/desk-api/
COPY --from=builder /app/tsconfig*.json ./

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate \
  && pnpm install -r --frozen-lockfile --prod \
  && corepack cache clean \
  && rm -rf \
    /root/.cache/node/corepack \
    /root/.local/share/pnpm/store \
    /root/.pnpm-store \
    /usr/local/lib/node_modules/npm \
    /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm \
    /usr/local/bin/npx \
    /usr/local/bin/corepack \
    /usr/local/bin/pnpm \
    /usr/local/bin/pnpx

USER appuser
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/readiness || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["apps/desk-api/node_modules/.bin/tsx", "apps/desk-api/src/index.ts"]
