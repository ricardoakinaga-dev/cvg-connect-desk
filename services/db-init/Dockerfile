# Dockerfile para db-init (executa migrations e seed uma vez)
FROM node:20-alpine
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

# Copiar arquivos de definição do workspace
COPY package.json pnpm-lock.yaml* ./
COPY pnpm-workspace.yaml ./
COPY turbo.json ./

# Copiar TODO o código dos workspaces (apps, packages, modules) antes de instalar
COPY apps/ ./apps/
COPY packages/ ./packages/
COPY modules/ ./modules/

# Instalar dependências do workspace (todas, incluindo dos pacotes)
RUN pnpm install -r --no-lockfile

# One-shot: sem healthcheck (HEALTHCHECK NONE) — o compose usa `completed-successfully`.
HEALTHCHECK NONE

# Comando padrão: rodar migrations e seed usando pnpm exec (respeita workspaces)
CMD ["sh", "-c", "pnpm --filter @cvg/database exec tsx src/migrate.ts && pnpm --filter @cvg/database exec tsx src/seed.ts"]