# Instalação Local e Setup Limpo

Este guia cobre a forma mais segura de subir o projeto localmente com o mínimo de atrito, usando o estado real do código atual.

## 1. Requisitos

Antes de começar, tenha instalado:

- `git`
- `node` `>= 20`
- `pnpm` `>= 9` e preferencialmente `10.33.0` (versão declarada no monorepo)
- `docker` + `docker compose` plugin

Infra obrigatória para o projeto funcionar:

- `PostgreSQL 15+`

Infra opcional no estado atual do código:

- `Redis 7+`

Observações importantes:

- O monorepo usa `pnpm workspaces` + `turbo`
- O frontend é `React + Vite`
- A API é `Fastify`
- O banco usa `Drizzle ORM`
- Os scripts de banco na raiz (`pnpm db:migrate` e `pnpm db:seed`) ainda são placeholders; use os comandos do pacote `@cvg/database`

## 2. Instalação das dependências

Na raiz do projeto:

```bash
corepack enable
corepack prepare pnpm@10.33.0 --activate
pnpm install
```

## 3. Configuração do `.env`

Copie o arquivo de exemplo:

```bash
cp .env.example .env
```

Use este conteúdo como referência final:

```env
# Banco de dados
DATABASE_URL=postgresql://connect_desk:root@localhost:5432/connect_desk_db
POSTGRES_USER=connect_desk
POSTGRES_PASSWORD=root
POSTGRES_DB=connect_desk_db

# Infra auxiliar
REDIS_URL=redis://localhost:6379

# Aplicacao
PORT=3000
REALTIME_PORT=8080
WORKER_POLL_INTERVAL_MS=1000
REALTIME_POLL_INTERVAL_MS=500

# Frontend
VITE_API_URL=http://localhost:3000

# Integracoes externas
GATEWAY_URL=http://localhost:8081
EVOLUTION_API_URL=http://localhost:8082
SECRETARY_URL=http://localhost:8083
SECRETARY_API_KEY=

# Reserva / futuro uso
JWT_SECRET=change_me_in_production
```

### O que é obrigatório hoje

- `DATABASE_URL`
- `PORT` para a API
- `VITE_API_URL` para o frontend

### O que é opcional hoje

- `REDIS_URL`
- `REALTIME_PORT`
- `WORKER_POLL_INTERVAL_MS`
- `REALTIME_POLL_INTERVAL_MS`
- `GATEWAY_URL`
- `EVOLUTION_API_URL`
- `SECRETARY_URL`
- `SECRETARY_API_KEY`
- `JWT_SECRET`

### Importante sobre carregamento do `.env`

Os serviços backend usam `dotenv/config`, mas os scripts são executados dentro de cada pacote. Para evitar ter que duplicar arquivos `.env` em várias pastas, exporte o `.env` da raiz no terminal antes de rodar qualquer comando:

```bash
set -a
source .env
set +a
```

Repita esse passo em cada novo terminal aberto.

## 4. Subindo a infraestrutura local

Com Docker:

```bash
docker compose up -d postgres redis
```

Verifique os containers:

```bash
docker compose ps
```

Se preferir usar banco fora do Docker, garanta que o `DATABASE_URL` aponte para um PostgreSQL acessível.

## 5. Preparando o banco

Rode as migrations:

```bash
set -a
source .env
set +a
pnpm --filter @cvg/database db:migrate
```

Rode a seed inicial:

```bash
set -a
source .env
set +a
pnpm --filter @cvg/database db:seed
```

Isso cria:

- perfis básicos de papel (`Admin`, `Receptionist`, `Veterinarian`, `Manager`)
- usuário administrador inicial

Credenciais iniciais:

- e-mail: `admin@cvg.com`
- senha: `admin123`

## 6. Subindo os serviços

### Terminal 1: API

```bash
set -a
source .env
set +a
pnpm --filter @cvg/desk-api dev
```

Disponível em:

- `http://localhost:3000`
- `http://localhost:3000/health`
- `http://localhost:3000/readiness`
- `http://localhost:3000/docs`

### Terminal 2: Frontend

```bash
set -a
source .env
set +a
pnpm --filter @cvg/desk-web dev
```

Disponível em:

- `http://localhost:5173`

### Terminal 3: Worker

```bash
set -a
source .env
set +a
pnpm --filter @cvg/message-worker dev
```

### Terminal 4: Realtime

```bash
set -a
source .env
set +a
pnpm --filter @cvg/realtime-service dev
```

WebSocket disponível em:

- `ws://localhost:8080`

## 7. Ordem recomendada para subir tudo

1. `pnpm install`
2. `cp .env.example .env`
3. `set -a && source .env && set +a`
4. `docker compose up -d postgres redis`
5. `pnpm --filter @cvg/database db:migrate`
6. `pnpm --filter @cvg/database db:seed`
7. `pnpm --filter @cvg/desk-api dev`
8. `pnpm --filter @cvg/desk-web dev`
9. `pnpm --filter @cvg/message-worker dev`
10. `pnpm --filter @cvg/realtime-service dev`

## 8. Checklist rápido de validação

Depois de subir os serviços:

- API responde em `GET /health`
- `GET /readiness` retorna `database: ok`
- Swagger abre em `http://localhost:3000/docs`
- frontend abre em `http://localhost:5173`
- login funciona com `admin@cvg.com` / `admin123`

## 9. Problemas comuns

### API sobe mas não conecta no banco

Verifique:

- se o `docker compose up -d postgres redis` foi executado
- se o `DATABASE_URL` está correto
- se você executou `source .env` no terminal atual antes de rodar a API

### Frontend abre mas não consegue falar com a API

Verifique:

- se `VITE_API_URL` aponta para `http://localhost:3000`
- se a API realmente está rodando na porta `3000`
- se você reiniciou o Vite depois de alterar variáveis de ambiente

### Migrations falham

Verifique:

- se o PostgreSQL já está aceitando conexões
- se o banco `connect_desk_db` existe
- se o usuário e senha batem com o `DATABASE_URL`

### Comandos da raiz para banco não funcionam

Isso é esperado no estado atual do projeto. Use:

```bash
pnpm --filter @cvg/database db:migrate
pnpm --filter @cvg/database db:seed
```

## 10. Reset limpo do ambiente local

Se quiser recomeçar do zero com o banco local em Docker:

```bash
docker compose down -v
docker compose up -d postgres redis
set -a
source .env
set +a
pnpm --filter @cvg/database db:migrate
pnpm --filter @cvg/database db:seed
```

Esse fluxo apaga os volumes locais do PostgreSQL e do Redis.
