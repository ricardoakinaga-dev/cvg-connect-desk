# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
ENV CI=true

COPY package.json pnpm-lock.yaml* ./
COPY pnpm-workspace.yaml ./
COPY turbo.json ./
COPY apps/message-worker/package.json apps/message-worker/
COPY packages/ packages/
COPY modules/ modules/

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
RUN pnpm install -r --no-lockfile

COPY apps/message-worker/ apps/message-worker/
COPY tsconfig*.json ./

RUN mkdir -p apps/message-worker/dist \
  && pnpm exec esbuild apps/message-worker/src/index.ts \
    --bundle --platform=node --format=esm --packages=bundle \
    --sourcemap=external --outfile=apps/message-worker/dist/index.js

# Stage 2: Production
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache tini curl
RUN addgroup -g 1001 -S appgroup && adduser -S appuser -u 1001 -G appgroup

COPY --from=builder /app/apps/message-worker/dist/ ./dist/

USER appuser
EXPOSE 9090

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:9090/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
