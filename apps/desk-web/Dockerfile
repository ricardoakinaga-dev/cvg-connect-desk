# Stage 1: builder
FROM node:20-alpine AS builder
WORKDIR /app
ENV CI=true
ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}
ARG VITE_REALTIME_URL=ws://localhost:8080
ENV VITE_REALTIME_URL=${VITE_REALTIME_URL}

COPY package.json pnpm-lock.yaml* ./
COPY pnpm-workspace.yaml ./
COPY turbo.json ./
COPY apps/desk-web/package.json apps/desk-web/
COPY packages/ packages/
COPY modules/ modules/

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
RUN pnpm install -r --no-lockfile

COPY apps/desk-web/ apps/desk-web/
RUN pnpm --filter @cvg/desk-web exec vite build

# Stage 2: nginx
FROM nginx:1.25-alpine AS runner
RUN apk add --no-cache curl
RUN addgroup -g 1001 -S appgroup && adduser -S appuser -u 1001 -G appgroup

COPY --from=builder /app/apps/desk-web/dist /usr/share/nginx/html
COPY apps/desk-web/nginx.conf /etc/nginx/conf.d/default.conf

RUN chown -R appuser:appgroup /usr/share/nginx/html \
  && chown -R appuser:appgroup /var/cache/nginx \
  && chown -R appuser:appgroup /var/log/nginx \
  && chown -R appuser:appgroup /etc/nginx/conf.d \
  && touch /var/run/nginx.pid \
  && chown -R appuser:appgroup /var/run/nginx.pid

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:80/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
