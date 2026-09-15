# Dockerfile para db-init (executa migrations e seed uma vez)
FROM node:24-alpine
WORKDIR /app
ENV CI=true

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

# Copiar arquivos de definição do workspace (lockfile obrigatório e congelado)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./

# Copiar TODO o código dos workspaces (apps, packages, modules) antes de instalar
COPY apps/ ./apps/
COPY packages/ ./packages/
COPY modules/ ./modules/

# Instalar dependências do workspace a partir do lock congelado
RUN pnpm install -r --frozen-lockfile

# One-shot: sem healthcheck (HEALTHCHECK NONE) — o compose usa `completed-successfully`.
HEALTHCHECK NONE

# Comando padrão: rodar migrations e seed usando pnpm exec (respeita workspaces)
CMD ["sh", "-c", "pnpm --filter @cvg/database exec tsx src/migrate.ts && pnpm --filter @cvg/database exec tsx src/seed.ts"]