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

### Comando rápido

```bash
pnpm run qa:full-cycle
```

Para a trilha de evidência, mantenha o padrão de `qa:full-cycle` em `p95=200ms` e, se necessário, execute:

```bash
QA_P95_THRESHOLD_MS=300 pnpm run qa:full-cycle:archive
```

Executa em sequência: subir `desk-api` (com rate limit alto), validar saúde da API, rodar `pnpm --filter @cvg/tasks test` e `pnpm test:stress`, imprimindo thresholds do `stress-test/summary.json`.

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

### Credenciais Padrão

- **Email**: admin@cvg.com
- **Senha**: admin123
- ⚠️ **Altere imediatamente em produção!**

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

### Dashboard
- `GET /metrics/summary` — Resumo geral
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

### Ciclo de validação completo (padrão)

Use um único comando para subir a API em `localhost:3000`, rodar testes de `@cvg/tasks` com coverage e executar `k6 stress` (via Docker, sem instalação local de `k6`):

```bash
pnpm run qa:full-cycle
```

Opções úteis:

- `TARGET_URL` (padrão: `http://localhost:3000`)
- `RATE_LIMIT_MAX` (padrão: `50000`)
- `RATE_LIMIT_WINDOW` (padrão: `1m`)
- `SUMMARY_PATH` (padrão: `stress-test/summary.json`)
- `HEALTH_TIMEOUT` (padrão: `180`)
- `TEARDOWN=1` para encerrar o `desk-api` ao final
- `COMPOSE_FILE` para apontar outro `docker-compose` (padrão: `docker-compose.dev.yml`)
- `SUMMARY_PATH` para sobrescrever o caminho de saída do summary (`stress-test/summary.json` por padrão)

### Comando de evidência (P5)

```bash
pnpm run qa:full-cycle:archive
```

Este fluxo executa o ciclo completo e persiste:

- log timestampado em `qa-runs/<YYYYMMDD-HHMMSS>/qa-full-cycle.log`
- resumo da execução em `qa-runs/<YYYYMMDD-HHMMSS>/summary.json`
- entrada automática em `docs/qa-full-cycle-log.md`

Ambiente customizável para o comando de evidência:

- `QA_EVIDENCE_DIR` para mudar pasta de saída (padrão: `qa-runs`)
- `QA_DOC_LOG` para mudar arquivo de changelog (padrão: `docs/qa-full-cycle-log.md`)
- `QA_RUN_TS` e `QA_RUN_DATE` para controlar timestamp e data do registro.

## Checklist de decisão PASS/FAIL (padrão de operação)

Use este checklist toda vez que executar:

```bash
pnpm run qa:full-cycle
```

### 1) Pré-requisitos do ambiente

- [ ] `docker` encontrado
- [ ] `pnpm` encontrado
- [ ] `curl` encontrado
- [ ] `docker compose` disponível
- [ ] Arquivo de compose informado existe (`$COMPOSE_FILE` ou `docker-compose.dev.yml`)

Falha esperada:
- O comando deve terminar com erro não-zero e mensagem objetiva antes de subir qualquer serviço.

### 2) Fluxo do ciclo

- [ ] Health check OK (`GET /health` retornou 200)
- [ ] Testes do pacote `@cvg/tasks` executaram sem falha
- [ ] `stress-test/summary.json` foi gerado

Falha esperada:
- Se qualquer etapa falhar, o ciclo encerra com status não-zero.

### 3) Regras de decisão dos thresholds

Após rodar, valide:

```bash
jq '.scenario_thresholds' stress-test/summary.json
```

- [ ] `duration_p95_ms.passed = true` e `duration_p95_ms.actual <= duration_p95_ms.threshold`
- [ ] `error_rate_5xx_percent.passed = true` e `error_rate_5xx_percent.actual <= error_rate_5xx_percent.threshold`
- [ ] `checks_rate.passed = true` e `checks_rate.actual >= checks_rate.threshold`
- [ ] `scenario_passed = true`

Regra de decisão:
- Se qualquer item acima estiver `false`, considerar **FAIL**, corrigir causa raiz e reexecutar.
- Se todos os itens estiverem `true`, considerar **PASS** e registrar evidência.

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

## License

Proprietário — CVG Connect Desk.
