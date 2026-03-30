# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
ENV CI=true

COPY package.json pnpm-lock.yaml* ./
COPY pnpm-workspace.yaml ./
COPY turbo.json ./
COPY apps/realtime-service/package.json apps/realtime-service/
COPY packages/ packages/
COPY modules/ modules/

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
RUN pnpm install -r --no-lockfile

COPY apps/realtime-service/ apps/realtime-service/
COPY tsconfig*.json ./

# Stage 2: Production
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache tini netcat-openbsd
RUN addgroup -g 1001 -S appgroup && adduser -S appuser -u 1001 -G appgroup

COPY --from=builder /app/package.json /app/pnpm-lock.yaml* ./
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/apps/realtime-service/package.json apps/realtime-service/
COPY --from=builder /app/packages/ packages/
COPY --from=builder /app/modules/ modules/
COPY --from=builder /app/apps/realtime-service/ apps/realtime-service/
COPY --from=builder /app/tsconfig*.json ./

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate \
  && pnpm install -r --no-lockfile --prod \
  && rm -rf /root/.pnpm-store

USER appuser
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD nc -z localhost 8080 || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "pnpm --filter @cvg/realtime-service exec tsx src/index.ts"]
