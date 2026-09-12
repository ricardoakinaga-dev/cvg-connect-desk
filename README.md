# CVG Connect Desk

Sistema operacional de atendimento digital e coordenação interna para hospital veterinário.

## Visão Geral

O **CVG Connect Desk** é a camada operacional que organiza conversas, atribuições, tarefas, notas, alertas e visibilidade gerencial sobre o atendimento digital via WhatsApp.

### Stack

| Componente | Tecnologia |
|-----------|-----------|
| Backend API | Fastify + TypeScript |
| Frontend | React + Vite |
| Banco de dados | PostgreSQL + Drizzle ORM |
| Cache/Filas | Redis |
| Realtime | WebSocket |
| Monorepo | pnpm workspaces + Turborepo |

## Arquitetura

```
WhatsApp → Evolution API → Gateway → CVG Connect Desk → Agent Secretary (IA)
                                                    ↓
                                              Frontend (React)
```

### Serviços

| Serviço | Porta | Descrição |
|---------|-------|-----------|
| `desk-api` | 3000 | API principal (REST + Webhook) |
| `desk-web` | 80 | Frontend (nginx + SPA) |
| `message-worker` | — | Processamento assíncrono de eventos |
| `realtime-service` | 8080 | WebSocket para atualizações em tempo real |
| `postgres` | 5432 | Banco de dados |
| `redis` | 6379 | Cache e rate limiting |

## Início Rápido

### Pré-requisitos

- Node.js >= 20
- pnpm >= 9 (`corepack enable`)
- Docker + Docker Compose

### Instalação

> **⚠️ Para setup completo e atual, consulte [docs/21-instalacao-local.md](./docs/21-instalacao-local.md).**
> Este guia mostra os comandos mais comuns. O documento de instalação local tem informações mais detalhadas e atualizadas.

```bash
# Clonar
git clone <repo-url> && cd connect_desk

# Instalar dependências
corepack enable
corepack prepare pnpm@10.33.0 --activate
pnpm install

# Configurar ambiente
cp .env.example .env
# Edite .env com suas configurações

# Subir infraestrutura (Postgres + Redis)
docker compose up -d postgres redis

# Executar migrations e seed (via package database)
pnpm --filter @cvg/database db:migrate
pnpm --filter @cvg/database db:seed

# Iniciar serviços (em terminais separados)
pnpm --filter @cvg/desk-api dev
pnpm --filter @cvg/desk-web dev
pnpm --filter @cvg/message-worker dev
pnpm --filter @cvg/realtime-service dev
```

> **Nota sobre scripts de banco:** Os scripts `pnpm db:migrate` e `pnpm db:seed` na raiz são placeholders que redirecionam para `@cvg/database`. Os comandos reais estão em `packages/database/package.json`.

### Docker (Produção)

```bash
# Build e start de todos os serviços
docker compose up -d --build

# Verificar status
docker compose ps

# Logs
docker compose logs -f desk-api
```

### Acesso

- **Frontend**: http://localhost (produção) ou http://localhost:8081 (dev)
- **API**: http://localhost:3000
- **Swagger**: http://localhost:3000/docs
- **Portainer**: http://localhost:9000 (se instalado)

### Credenciais Iniciais (desenvolvimento)

- **Email**: valor de `ADMIN_BOOTSTRAP_EMAIL` (default local: admin@cvg.com)
- **Senha**: valor de `ADMIN_BOOTSTRAP_PASSWORD` (defina no `.env`; mínimo 12 caracteres)
- ⚠️ **Produção: o seed NÃO cria admin sem `ADMIN_BOOTSTRAP_EMAIL` + `ADMIN_BOOTSTRAP_PASSWORD` (fail-secure). Nunca use senha default em produção.**

## Módulos

```
apps/
  desk-api/          # API Fastify
  desk-web/          # Frontend React
  message-worker/    # Worker de eventos
  realtime-service/  # WebSocket

modules/
  chat/              # Conversas e mensagens
  tasks/             # Tarefas operacionais
  notes/             # Notas internas
  alerts/            # Alertas operacionais
  tutors/            # Responsáveis e vínculos com pacientes
  patients/          # Pacientes veterinários
  admin/             # CRUD de usuários, filas, times
  audit/             # Trilha de auditoria
  dashboard/         # Métricas e KPIs
  secretary-adapter/ # Integração com Agent Secretary

packages/
  database/          # Schema, migrations, Drizzle
  auth/              # Autenticação, RBAC
  events/            # Event envelope, publisher, consumer
  realtime/          # Tipos e projeções realtime
  integrations/      # Clients externos (Secretary, Gateway)
  shared/            # Erros, Result, utilitários
```

## API Endpoints

### Autenticação
- `POST /auth/login` — Login
- `POST /auth/logout` — Logout
- `GET /auth/me` — Usuário atual

### Chat
- `POST /webhook/inbound` — Webhook do Gateway
- `GET /conversations` — Listar conversas
- `GET /conversations/:id/messages` — Mensagens da conversa
- `POST /messages` — Enviar mensagem

### Operações
- `POST /tasks`, `GET /tasks`, `PATCH /tasks/:id/status`
- `POST /notes`, `GET /notes`
- `POST /alerts`, `GET /alerts`, `POST /alerts/:id/acknowledge`, `POST /alerts/:id/resolve`
- `GET/POST/PUT/DELETE /tutors` — Cadastro e vínculos de tutores
- `GET/POST/PUT/DELETE /patients` — Cadastro e vínculos de pacientes

### Dashboard
- `GET /metrics/summary` — Resumo geral
- `GET /metrics/premium` — KPIs operacionais consolidados
- `GET /metrics/response-time`, `/metrics/handoff`, `/metrics/sector-backlog`
- `GET /metrics/aging`, `/metrics/alerts/criticality`
- `GET /metrics/conversations` — Métricas de conversas
- `GET /metrics/tasks` — Métricas de tarefas
- `GET /metrics/alerts` — Métricas de alertas

### Admin
- CRUD completo: `/admin/users`, `/admin/roles`, `/admin/queues`, `/admin/teams`

### Sistema
- `GET /health` — Liveness check
- `GET /readiness` — Readiness check
- `GET /docs` — Documentação Swagger

## Testes

```bash
# Executar todos os testes
pnpm test

# Testes de um pacote específico
pnpm --filter @cvg/shared test

# Com coverage
pnpm --filter @cvg/shared test --coverage
```

## Verificação e certificação

```bash
# Master gate (lint, typecheck, testes, postgres-real, migrations, build, audit)
pnpm triple-aaa:verify
# → artifacts/triple-aaa-report.json
```

Estado atual: `docs/TRIPLE_AAA_CERTIFICATION.md` (AAA-1 VERIFIED; AAA-2/AAA-3
CONDITIONAL até evidência de CI). Matriz de testes: `docs/TEST_MATRIX.md`.
Métricas Prometheus: `GET /metrics`. Tracing OTEL: `OTEL_ENABLED=true`.

## Documentação

- [Docs do Projeto](./docs/) — Arquitetura, modelo de dados, roadmap
- [Swagger](http://localhost:3000/docs) — API interativa
- [Instalação Local](./docs/21-instalacao-local.md) — Guia detalhado

## Variáveis de Ambiente

Veja [.env.example](./.env.example) para todas as variáveis disponíveis.

| Variável | Obrigatória | Descrição |
|---------|------------|-----------|
| `DATABASE_URL` | ✅ | URL do PostgreSQL |
| `JWT_SECRET` | ✅ | Segredo para tokens JWT |
| `REDIS_URL` | ⚡ | URL do Redis (rate limiting) |
| `SECRETARY_URL` | ❌ | URL do Agent Secretary |
| `WEBHOOK_SECRET` | ❌ | HMAC para validação de webhook |
| `INTERNAL_EVENTS_SECRET` | ✅ em produção | Chave interna entre API e realtime para polling de eventos |
| `TRUST_PROXY` | ❌ | IPs/CIDRs explícitos dos proxies confiáveis |

## License

Proprietário — CVG Connect Desk.
