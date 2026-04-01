# CVG Connect Desk

Sistema operacional de atendimento digital para hospital veterinário, com inbox operacional, tarefas, notas, alertas, dashboard, auditoria e integração com WhatsApp/Gateway/Secretary.

## O que este repositório entrega

- `desk-api`: API Fastify
- `desk-web`: frontend React + Vite
- `message-worker`: processamento assíncrono
- `realtime-service`: WebSocket para updates em tempo real
- `packages/database`: schema, migrations e seed
- módulos de `chat`, `tasks`, `notes`, `alerts`, `dashboard`, `audit`, `admin`, `labels`, `sectors`, `contacts`, `tutors`, `patients`, `kanban`, `transfers`

## Stack

| Camada | Tecnologia |
|---|---|
| Backend | Node.js, TypeScript, Fastify |
| Frontend | React, Vite, TypeScript |
| Banco | PostgreSQL, Drizzle ORM |
| Mensageria interna | Event bus + worker |
| Realtime | WebSocket |
| Monorepo | pnpm workspaces, Turborepo |
| Infra | Docker, Docker Compose |

## Arquitetura resumida

```text
WhatsApp -> Evolution API -> Gateway -> Connect Desk -> Agent Secretary
                                            |
                                            +-> API
                                            +-> Worker
                                            +-> Realtime
                                            +-> Frontend
```

## Antes de instalar

Existem 2 formas recomendadas de rodar o projeto:

1. `Desenvolvimento local`
   Melhor para programação, debugging e validação por terminal.
2. `Servidor com Docker`
   Melhor para homologação e deploy controlado.

Se você quer apenas clonar e subir o sistema com o mínimo de atrito, prefira começar pelo fluxo de **desenvolvimento local** e depois avançar para **Docker em servidor**.

## Requisitos

### Requisitos obrigatórios

- `git`
- `node >= 20`
- `pnpm = 10.33.0` preferencialmente
- `docker`
- `docker compose`
- `PostgreSQL 15+`

### Requisitos recomendados

- `Redis 7+`
- Linux x64 ou ambiente compatível com Docker
- pelo menos `4 GB RAM`
- pelo menos `2 vCPU`

## Estrutura principal

```text
apps/
  desk-api/
  desk-web/
  message-worker/
  realtime-service/

modules/
  admin/
  alerts/
  audit/
  chat/
  contacts/
  contact-groups/
  dashboard/
  gateway-adapter/
  kanban/
  labels/
  notes/
  patients/
  sectors/
  secretary-adapter/
  tasks/
  transfers/
  tutors/

packages/
  auth/
  database/
  events/
  integrations/
  realtime/
  shared/
```

## Variáveis de ambiente

Copie o arquivo de exemplo:

```bash
cp .env.example .env
```

As variáveis mais importantes são:

| Variável | Obrigatória | Uso |
|---|---|---|
| `DATABASE_URL` | Sim | conexão com PostgreSQL |
| `POSTGRES_USER` | Sim | usuário do banco |
| `POSTGRES_PASSWORD` | Sim | senha do banco |
| `POSTGRES_DB` | Sim | nome do banco |
| `REDIS_URL` | Recomendado | rate-limit, worker, realtime |
| `PORT` | Sim | porta da API |
| `VITE_API_URL` | Sim | URL da API no frontend |
| `VITE_REALTIME_URL` | Recomendado | URL do WebSocket |
| `JWT_SECRET` | Sim em produção | autenticação |
| `WEBHOOK_SECRET` | Sim em produção | assinatura HMAC do webhook |
| `SECRETARY_URL` | Opcional | integração com Secretary |
| `SECRETARY_API_KEY` | Opcional | autenticação da Secretary |

Referência completa: [`.env.example`](./.env.example)

## Fluxo 1: desenvolvimento local

### 1. Clonar o projeto

```bash
git clone <repo-url>
cd connect_desk
```

### 2. Ativar a versão correta do pnpm

```bash
corepack enable
corepack prepare pnpm@10.33.0 --activate
pnpm --version
```

### 3. Instalar dependências

```bash
pnpm install
```

Se o ambiente for CI ou servidor limpo, prefira:

```bash
pnpm install --frozen-lockfile
```

### 4. Configurar ambiente

```bash
cp .env.example .env
```

Revise pelo menos estes valores:

```env
DATABASE_URL=postgresql://connect_desk:root@localhost:5432/connect_desk_db
REDIS_URL=redis://localhost:6379
PORT=3000
VITE_API_URL=http://localhost:3000
VITE_REALTIME_URL=ws://localhost:8080
JWT_SECRET=change_me_in_production_use_strong_random_key
```

### 5. Exportar o `.env` no terminal atual

Os comandos dos pacotes dependem das variáveis de ambiente estarem carregadas no shell:

```bash
set -a
source .env
set +a
```

Repita isso sempre que abrir um terminal novo para rodar API, worker, realtime, migration ou seed.

### 6. Subir infraestrutura local

```bash
docker compose up -d postgres redis
docker compose ps
```

### 7. Executar migrations

Os scripts da raiz para banco ainda não são o fluxo oficial. Use o pacote `@cvg/database`:

```bash
set -a
source .env
set +a
pnpm --filter @cvg/database db:migrate
```

### 8. Executar seed inicial

```bash
set -a
source .env
set +a
pnpm --filter @cvg/database db:seed
```

Credenciais padrão criadas pela seed:

- email: `admin@cvg.com`
- senha: `admin123`

Troque a senha depois do primeiro acesso em qualquer ambiente sério.

### 9. Validar o projeto antes de subir os serviços

```bash
pnpm lint
pnpm typecheck
pnpm test
```

### 10. Subir os serviços em terminais separados

#### Terminal 1 — API

```bash
cd "/caminho/para/connect_desk"
set -a && source .env && set +a
pnpm --filter @cvg/desk-api dev
```

#### Terminal 2 — Frontend

```bash
cd "/caminho/para/connect_desk"
set -a && source .env && set +a
pnpm --filter @cvg/desk-web dev
```

#### Terminal 3 — Worker

```bash
cd "/caminho/para/connect_desk"
set -a && source .env && set +a
pnpm --filter @cvg/message-worker dev
```

#### Terminal 4 — Realtime

```bash
cd "/caminho/para/connect_desk"
set -a && source .env && set +a
pnpm --filter @cvg/realtime-service dev
```

### 11. URLs esperadas

- frontend: `http://localhost:5173`
- API: `http://localhost:3000`
- health: `http://localhost:3000/health`
- readiness: `http://localhost:3000/readiness`
- Swagger: `http://localhost:3000/docs`
- WebSocket: `ws://localhost:8080`

## Fluxo 2: servidor com Docker

### Atenção importante sobre a Secretary

O `docker-compose.yml` inclui um serviço `secretary` que aponta para um caminho externo ao repositório:

```text
../../cvg-lab/projects/cvg-secretary
```

Se você clonar **apenas este repositório** em um servidor novo, esse serviço **não vai buildar** sozinho.

Você tem 2 opções:

1. disponibilizar o repositório da Secretary nesse caminho esperado
2. rodar o Connect Desk sem build local da Secretary e apontar `SECRETARY_URL` para uma instância externa já existente

Se você não tiver a Secretary local, **não use** `docker compose up -d --build` cegamente para todos os serviços.

### Opção A — servidor sem Secretary local

1. clone o projeto
2. configure `.env`
3. garanta que `SECRETARY_URL` aponte para um endpoint externo válido ou deixe a integração desabilitada de forma consciente
4. suba apenas os serviços do Desk

Exemplo:

```bash
git clone <repo-url>
cd connect_desk
cp .env.example .env
docker compose build postgres redis db-init desk-api desk-web message-worker realtime-service
docker compose up -d postgres redis db-init desk-api desk-web message-worker realtime-service
```

### Opção B — servidor com Secretary local

Se você tiver a Secretary no caminho esperado pelo compose:

```bash
git clone <repo-url>
cd connect_desk
cp .env.example .env
docker compose up -d --build
```

### Validação depois do deploy

```bash
docker compose ps
curl http://localhost:3000/health
curl http://localhost:3000/readiness
docker compose logs --tail=100 desk-api
docker compose logs --tail=100 message-worker
docker compose logs --tail=100 realtime-service
```

## Checklist de instalação sem dor

Use este checklist em qualquer máquina nova:

- [ ] `git clone` executado
- [ ] `corepack` habilitado
- [ ] `pnpm 10.33.0` ativo
- [ ] `pnpm install` executado sem erro
- [ ] `.env` criado a partir de `.env.example`
- [ ] PostgreSQL e Redis ativos
- [ ] migrations executadas
- [ ] seed executada
- [ ] `pnpm lint` passou
- [ ] `pnpm typecheck` passou
- [ ] `pnpm test` passou
- [ ] API acessível em `/health`
- [ ] frontend abrindo
- [ ] login com `admin@cvg.com` funcionando

## Testes e validação inicial

### Suite completa

```bash
pnpm lint
pnpm typecheck
pnpm test
```

### Teste de um pacote específico

```bash
pnpm --filter @cvg/shared test
pnpm --filter @cvg/events test
pnpm --filter @cvg/desk-web typecheck
pnpm --filter @cvg/desk-api build
```

### Smoke test manual mínimo

1. abrir `http://localhost:5173`
2. fazer login com `admin@cvg.com / admin123`
3. abrir `http://localhost:3000/docs`
4. verificar `GET /health`
5. verificar `GET /readiness`
6. abrir Inbox e Dashboard

## Problemas comuns

### `pnpm` falha por permissão em `node_modules`

Se o diretório foi criado com `root`, ajuste o owner:

```bash
sudo chown -R "$USER":"$USER" node_modules
pnpm install
```

### API não conecta no banco

Verifique:

- se `postgres` está de pé
- se `DATABASE_URL` está correto
- se o terminal atual carregou o `.env`
- se as migrations já foram executadas

### Frontend não fala com a API

Verifique:

- `VITE_API_URL`
- API ativa na porta `3000`
- reinício do Vite após alteração de `.env`

### Realtime não conecta

Verifique:

- `VITE_REALTIME_URL`
- `REALTIME_PORT`
- logs do `realtime-service`

### Migrations falham

Verifique:

- se o PostgreSQL está aceitando conexão
- se usuário, senha e nome do banco batem com `DATABASE_URL`
- se o banco de destino já existe

### Docker build falha por causa da Secretary

Isso acontece quando o compose tenta buildar um serviço externo que não está presente.

Solução:

- suba apenas os serviços do Desk
- ou providencie o repositório da Secretary no caminho esperado

## Endpoints principais

### Auth

- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/me`

### Chat

- `POST /webhook/inbound`
- `GET /conversations`
- `GET /conversations/:conversationId/messages`
- `POST /messages`

### Operação

- `POST /tasks`
- `GET /tasks`
- `PATCH /tasks/:id/status`
- `POST /notes`
- `GET /notes`
- `POST /alerts`
- `GET /alerts`

### Dashboard e auditoria

- `GET /metrics/summary`
- `GET /metrics/premium`
- `GET /metrics/response-time`
- `GET /metrics/handoff`
- `GET /audit/logs`

### Sistema

- `GET /health`
- `GET /readiness`
- `GET /docs`

## Documentação adicional

- [Instalação local](./docs/21-instalacao-local.md)
- [Guia de deploy](./docs/26-deploy-guide.md)
- [Runbook operacional](./docs/runbook-operacional.md)
- [Troubleshooting](./docs/troubleshooting-guide.md)

## Licença

Uso proprietário.
