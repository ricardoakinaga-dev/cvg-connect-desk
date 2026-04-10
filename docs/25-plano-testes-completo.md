# PLANO EXECUTIVO DE TESTES — ENTERPRISE PREMIUM

> **⚠️ DOCUMENTO ATUALIZADO — 2026-04-10**
>
> **Mudanças importantes:**
> - Infraestrutura de testes JÁ EXISTE (Vitest configurado)
> - Alguns testes JÁ EXISTEM e passam (`pnpm test` executa com sucesso)
> - Este documento reflete o **estado atual real** dos testes, não o zero absoluto
>
> Ver evidência: `apps/desk-api/src/__tests__/`, `packages/shared/src/__tests__/`, etc.

**Data:** 2026-04-10 (atualizado)
**Fase:** Test Phase 2 — Expansão de Cobertura
**Objetivo:** Sistema Enterprise sem erros ou bugs — teste completo de todas as camadas

---

## 1. ESTADO ATUAL DOS TESTES (Revalidado 2026-04-10)

### O Que JÁ Existe ✅

| Componente | Local | Status |
|------------|-------|--------|
| Infraestrutura Vitest | `vitest.config.ts` | ✅ Configurado |
| Testes API | `apps/desk-api/src/__tests__/` | ✅ 7 arquivos |
| Testes packages | `packages/*/src/__tests__/` | ✅ Múltiplos |
| Testes Web | `apps/desk-web/src/__tests__/` | ✅ Presentes, incluindo `Login`, `Inbox`, `Kanban` e o smoke de `Admin` com dead-letter contextual e resumo operacional |
| CI PostgreSQL real | `.github/workflows/postgres-real-tests.yml` | ✅ Automatizado |
| Execução | `pnpm test` | ✅ Passa |

### O Que Ainda Falta 🔄

| Componente | Prioridade | Status |
|------------|------------|--------|
| Cobertura > 70% | 🔴 Alta | 🔄 Em progresso |
| Testes de idempotência inbound | 🔴 Alta | ✅ Entregue (requer PostgreSQL migrado) |
| Testes de webhook security | 🔴 Alta | ✅ Entregue (`packages/shared/src/__tests__/webhook-guard.test.ts`) |
| Testes de auth realtime | 🔴 Alta | ✅ Entregue (`apps/realtime-service/src/__tests__/realtime-auth-behavioral.test.ts`) |
| Testes de integração HTTP/API | 🔴 Alta | ✅ Entregue (`apps/desk-api/src/__tests__/auth-routes.integration.test.ts`, `chat-routes.integration.test.ts`, `events-polling.integration.test.ts`, `webhook-inbound.integration.test.ts`, `kanban-routes.integration.test.ts`) |
| CI PostgreSQL real | 🟡 Média | ✅ Entregue (`.github/workflows/postgres-real-tests.yml`, `pnpm test:postgres-real`) |
| Testes E2E (Playwright) | 🟡 Média | ✅ Configurado e executado (`playwright.config.ts`, `e2e/smoke/` — 13 testes smoke: login-flow, inbox-authenticated, create-task, kanban, send-message; stack mínima em `docker-compose.smoke.yml`) |
| Testes de integração Secretary | 🟡 Média | ✅ Entregue (`modules/secretary-adapter/src/__tests__/invoke-secretary.integration.test.ts`, `trigger-handoff.integration.test.ts`, `modules/chat/src/__tests__/secretary-handoff.integration.test.ts`) |

---

## 1. FONTE DA VERDADE

Este plano segue a cadeia de dependências definida em `15-implementation-phases.md`:

```
Schema e migration
-> repositories
-> use cases
-> handlers/controllers
-> publicação de eventos
-> consumers/worker
-> realtime projection
-> UI operacional
-> dashboard e KPIs
-> hardening final
```

A ordem de teste segue a ordem de implementação: nenhuma camada pode ser testada antes da anterior estar pronta.

---

## 2. ESCOPO COMPLETO DE TESTES

> **Legenda:** ✅ Existe | 🔄 Parcial | ⏳ Não existe

### Camada 1: Database & Migrations
| Teste | Local | Estado |
|-------|-------|--------|
| Schema validation | `packages/database/src/__tests__/` | 🔄 Parcial |
| Migration runner | `packages/database/src/__tests__/` | 🔄 Parcial |
| Seed data integrity | `packages/database/src/__tests__/` | 🔄 Parcial |

### Camada 2: Packages (Core Libraries)
| Teste | Local | Estado |
|-------|-------|--------|
| Events publisher | `packages/events/src/__tests__/` | ✅ Existe |
| Dead-letter store | `packages/events/src/__tests__/` | ✅ Existe |
| Event envelope | `packages/events/src/__tests__/envelope.test.ts` | ✅ Existe |
| Auth password hashing | `packages/auth/src/__tests__/` | 🔄 Parcial |
| Auth session management | `packages/auth/src/__tests__/` | 🔄 Parcial |
| Shared AppError | `packages/shared/src/__tests__/` | ✅ Existe |
| Shared Result type | `packages/shared/src/__tests__/` | ✅ Existe |
| Realtime projections | `packages/realtime/src/__tests__/` | 🔄 Parcial |

### Camada 3: Modules (Domain Logic)
| Teste | Local | Estado |
|-------|-------|--------|
| Chat: conversation repository | `modules/chat/src/__tests__/conversation-repository.test.ts` | Unit | PostgreSQL |
| Chat: create conversation | `modules/chat/src/__tests__/create-conversation.test.ts` | Unit | PostgreSQL |
| Chat: receive inbound idempotency | `modules/chat/src/__tests__/receive-inbound-idempotency.test.ts` | Behavioral | PostgreSQL real |
| Chat: send outbound message | `modules/chat/src/__tests__/send-outbound.test.ts` | Unit | PostgreSQL |
| Webhook security | `packages/shared/src/__tests__/webhook-guard.test.ts` | Behavioral | Fastify/request guard |
| Tasks: task repository | `modules/tasks/src/__tests__/task-repository.test.ts` | Unit | PostgreSQL |
| Tasks: create task | `modules/tasks/src/__tests__/create-task.test.ts` | Unit | PostgreSQL |
| Tasks: update status | `modules/tasks/src/__tests__/update-task-status.test.ts` | Unit | PostgreSQL |
| Notes: create note | `modules/notes/src/__tests__/create-note.test.ts` | Unit | PostgreSQL |
| Notes: list notes | `modules/notes/src/__tests__/list-notes.test.ts` | Unit | PostgreSQL |
| Alerts: create alert | `modules/alerts/src/__tests__/create-alert.test.ts` | Unit | PostgreSQL |
| Alerts: acknowledge/resolve | `modules/alerts/src/__tests__/alert-lifecycle.test.ts` | Unit | PostgreSQL |
| Labels: CRUD | `modules/labels/src/__tests__/labels-crud.test.ts` | Unit | PostgreSQL |
| Sectors: CRUD | `modules/sectors/src/__tests__/sectors-crud.test.ts` | Unit | PostgreSQL |
| Transfers: create/accept/reject | `modules/transfers/src/__tests__/transfers.test.ts` | Unit | PostgreSQL |
| Contact Groups: CRUD | `modules/contact-groups/src/__tests__/contact-groups.test.ts` | Unit | PostgreSQL |
| Dashboard: KPI queries | `modules/dashboard/src/__tests__/kpi-queries.test.ts` | Unit | PostgreSQL |
| Audit: log creation | `modules/audit/src/__tests__/audit-log.test.ts` | Unit | PostgreSQL |
| Admin: user management | `modules/admin/src/__tests__/admin-users.test.ts` | Unit | PostgreSQL |
| Chatwoot compat | `modules/chatwoot-compat/src/__tests__/chatwoot.test.ts` | Unit | PostgreSQL |
| Labels: use cases | `modules/labels/src/__tests__/use-cases.test.ts` | Behavioral | Mock repo |
| Sectors: use cases | `modules/sectors/src/__tests__/use-cases.test.ts` | Behavioral | Mock repo |
| Transfers: use cases | `modules/transfers/src/__tests__/use-cases.test.ts` | Behavioral | Mock repo |
| Contact Groups: use cases | `modules/contact-groups/src/__tests__/use-cases.test.ts` | Behavioral | Mock repo |
| Contacts: use cases | `modules/contacts/src/__tests__/use-cases.test.ts` | Behavioral | Mock repo |
| Dashboard: use cases | `modules/dashboard/src/__tests__/use-cases.test.ts` | Behavioral | Mock repo |
| Secretary adapter | `modules/secretary-adapter/src/__tests__/invoke-secretary.integration.test.ts`, `modules/secretary-adapter/src/__tests__/trigger-handoff.integration.test.ts` | Integration | HTTP mock + event contract |
| Chat: Secretary handoff | `modules/chat/src/__tests__/secretary-handoff.integration.test.ts` | Behavioral | PostgreSQL real + Secretary mock |

### Camada 4: API Integration Tests
| Teste | Local | Tipo | Dependência |
|-------|-------|------|-------------|
| Auth endpoints | `apps/desk-api/src/__tests__/auth-routes.integration.test.ts` | Integration | Fastify + PostgreSQL |
| Chat endpoints | `apps/desk-api/src/__tests__/chat-routes.integration.test.ts` | Integration | Fastify + PostgreSQL |
| Dead-letter admin endpoints | `apps/desk-api/src/__tests__/dead-letter-routes.integration.test.ts` | Integration | Fastify + PostgreSQL |
| Webhook security stats | `apps/desk-api/src/__tests__/webhook-security-stats.integration.test.ts` | Integration | Fastify + PostgreSQL |
| Task endpoints | `apps/desk-api/src/__tests__/task-routes.test.ts` | Integration | Fastify + PostgreSQL |
| Kanban board endpoint | `apps/desk-api/src/__tests__/kanban-routes.integration.test.ts` | Integration | Fastify + PostgreSQL |
| Health/readiness | `apps/desk-api/src/__tests__/health.test.ts` | Integration | Fastify |
| Webhook inbound | `apps/desk-api/src/__tests__/webhook-inbound.integration.test.ts` | Integration | Fastify + PostgreSQL |
| Events polling | `apps/desk-api/src/__tests__/events-polling.integration.test.ts` | Integration | Fastify + PostgreSQL |
| Labels endpoints | `apps/desk-api/src/__tests__/labels-routes.integration.test.ts` | Integration | Fastify + PostgreSQL |
| Sectors endpoints | `apps/desk-api/src/__tests__/sectors-routes.integration.test.ts` | Integration | Fastify + PostgreSQL |
| Transfers endpoints | `apps/desk-api/src/__tests__/transfers-routes.integration.test.ts` | Integration | Fastify + PostgreSQL |
| Contacts endpoints | `apps/desk-api/src/__tests__/contacts-routes.integration.test.ts` | Integration | Fastify + PostgreSQL |
| Contact Groups endpoints | `apps/desk-api/src/__tests__/contact-groups-routes.integration.test.ts` | Integration | Fastify + PostgreSQL |

> `contacts-routes.integration.test.ts` agora roda inteiro, incluindo `GET /contacts/:id`, sem `skip`.
> `webhook-inbound.integration.test.ts` valida também `reason` operacional para `missing_secret`, `missing_signature` e `invalid_signature`.
> `webhook-security-stats.integration.test.ts` valida o resumo agregado por `reason` em `/admin/webhook-security/stats`.
> `dead-letter-routes.integration.test.ts` valida `/admin/dead-letters/stats` além da listagem e das ações de replay/resolução.

### Camada 5: Worker Tests
| Teste | Local | Tipo | Dependência |
|-------|-------|------|-------------|
| Message worker startup | `apps/message-worker/src/__tests__/worker.test.ts` | Integration | PostgreSQL + Redis |
| Message worker dead-letter replay context | `apps/message-worker/src/__tests__/dead-letter.test.ts` | Unit | Nenhuma |
| Handoff handler | `apps/message-worker/src/__tests__/handoff-handler.test.ts` | Unit | PostgreSQL |
| Alert handler | `apps/message-worker/src/__tests__/alert-handler.test.ts` | Unit | PostgreSQL |

### Camada 6: Realtime Service Tests
| Teste | Local | Tipo | Dependência |
|-------|-------|------|-------------|
| WebSocket connection | `apps/realtime-service/src/__tests__/websocket.test.ts` | Integration | WebSocket |
| Event projection | `apps/realtime-service/src/__tests__/projection.test.ts` | Unit | Nenhuma |
| Realtime non-projectable events do not dead-letter | `apps/realtime-service/src/__tests__/realtime-projector.test.ts` | Unit | Nenhuma |
| Auth handshake | `apps/realtime-service/src/__tests__/auth-handshake.test.ts` | Integration | WebSocket |
| Channel subscription | `apps/realtime-service/src/__tests__/subscription.test.ts` | Integration | WebSocket |
| Auth behavior (message + legacy) | `apps/realtime-service/src/__tests__/realtime-auth-behavioral.test.ts` | Behavioral | WebSocket + local auth server |

### Camada 7: Frontend Tests
| Teste | Local | Tipo | Dependência |
|-------|-------|------|-------------|
| Auth store (Zustand) | `apps/desk-web/src/__tests__/auth-store.test.ts` | Unit | Nenhuma |
| API client | `apps/desk-web/src/__tests__/api-client.test.ts` | Unit | Nenhuma |
| Admin dead-letter smoke | `apps/desk-web/src/__tests__/admin.test.tsx` | Integration | Vitest + React Testing Library |
| Realtime client | `apps/desk-web/src/__tests__/realtime.test.ts` | Behavioral | Mock WebSocket |
| Inbox page render | `apps/desk-web/src/__tests__/inbox.test.tsx` | Integration | Vitest + React Testing Library |
| Kanban page render | `apps/desk-web/src/__tests__/kanban.test.tsx` | Integration | Vitest + React Testing Library |
| Login page | `apps/desk-web/src/__tests__/login.test.tsx` | Integration | Vitest + React Testing Library |

### Camada 8: E2E Smoke Tests
| Teste | Local | Ferramenta |
|-------|-------|------------|
| Login flow | `e2e/smoke/login-flow.test.ts` | Playwright |
| Inbox autenticada | `e2e/smoke/inbox-authenticated.test.ts` | Playwright |
| Create task | `e2e/smoke/create-task.test.ts` | Playwright |
| Kanban smoke | `e2e/smoke/kanban.test.ts` | Playwright |
| Send message | `e2e/smoke/send-message.test.ts` | Playwright |

---

## 3. ESTADO ATUAL E PRÓXIMOS PASSOS

### ✅ Fase T1: Infraestrutura Base — CONCLUÍDA
1. ✅ Vitest configurado em `vitest.config.ts`
2. ✅ Testes existem em `apps/desk-api/src/__tests__/`
3. ✅ Testes existem em `packages/*/src/__tests__/`
4. ✅ Testes existem em `apps/desk-web/src/__tests__/`
5. ✅ `pnpm test` executa com sucesso

### 🔄 Fase T2: Expansão de Cobertura — EM ANDAMENTO
1. ✅ Adicionar testes de idempotência inbound (`modules/chat/src/__tests__/receive-inbound-idempotency.test.ts`)
2. ✅ Adicionar testes de webhook security (`packages/shared/src/__tests__/webhook-guard.test.ts` — comportamental)
3. ✅ Adicionar testes de auth realtime behavior (`apps/realtime-service/src/__tests__/realtime-auth-behavioral.test.ts`)
4. ✅ Adicionar testes de integração HTTP/API (`apps/desk-api/src/__tests__/auth-routes.integration.test.ts`, `chat-routes.integration.test.ts`, `events-polling.integration.test.ts`, `webhook-inbound.integration.test.ts`, `kanban-routes.integration.test.ts`)
5. ✅ Expandir cobertura de modules
6. ✅ Cobrir módulos premium menos protegidos com use-case tests (labels, sectors, transfers, contact-groups, contacts, dashboard)

### 🔄 Fase T3: Testes de Integração — PARCIAL
1. ✅ Setup Playwright para E2E mínimo
2. ✅ Smoke tests de fluxos críticos
3. ✅ Testes de integração Secretary

### Ordem de Implementação Original (Manter como referência)

A ordem de teste segue a ordem de implementação: nenhuma camada pode ser testada antes da anterior estar pronta.

### Fase T2: Módulos Core (próxima semana)
7. Chat repository e use case tests
8. Tasks, Notes, Alerts repository e use case tests
9. Labels, Sectors, Transfers tests
10. Dashboard KPI tests

### Fase T3: Integração API
11. ✅ Auth routes integration tests
12. ✅ Chat routes integration tests
13. ✅ Kanban routes integration tests
14. ✅ Webhook inbound tests
15. ✅ Events polling tests

### Fase T4: Frontend
16. Store tests (auth, etc)
17. Page component tests (Inbox, Kanban, Login) - entregues para os fluxos centrais do `desk-web`

### Fase T5: E2E
18. Playwright setup
19. Smoke tests

---

## 4. CONFIGURAÇÃO DE INFRAESTRUTURA

### 4.1 Test Database Strategy
- Usar PostgreSQL em memória com `pg-mem` ou Docker container dedicado para testes
- Cada test file faz cleanup após si
- Migrations rodam antes de cada suite

### 4.2 Mock Strategy
- HTTP mocks via `undici` ou `msw` (mock service worker)
- Redis mock via `ioredis-mock`
- WebSocket mock via `mock-socket`

### 4.3 Coverage Targets
| Camada | Target |
|--------|--------|
| Packages (core) | 90%+ |
| Modules (domain) | 80%+ |
| API routes | 70%+ |
| Frontend | 60%+ |
| Overall | 75%+ |

### 4.4 Event Envelope Versioning
- `packages/events/src/__tests__/envelope.test.ts` cobre o default de `event_version = 1` e a separacao entre `event_version` e `version`
- `packages/events/src/__tests__/outbox.test.ts` valida a propagacao estrutural do campo pelo publisher e reader

---

## 5. EXECUÇÃO

```bash
# Todos os testes
pnpm test

# Com coverage
pnpm test -- --coverage

# Só unit (rápido)
pnpm test -- --grep "unit|integration" --grepInvert "e2e"

# E2E (stack mínima sobe com webServer)
pnpm test:e2e
```

---

## 6. CRITÉRIO DE SAÍDA

### Estado Atual

| Critério | Status |
|----------|--------|
| Todos os testes passam | ✅ Sim (`pnpm test` passa) |
| Coverage >= 75% | 🔄 Não (limitada) |
| CI pipeline | ✅ Configurado (`.github/workflows/smoke-e2e.yml` — smoke E2E em push/PR) |
| Zero warnings lint | 🔄 Verificar |

### Meta para Produção Enterprise

- [ ] Coverage overall >= 75%
- [x] CI pipeline validando em cada commit (`.github/workflows/smoke-e2e.yml`) |
- [x] Testes E2E configurados
- [ ] Zero warnings de lint em código de teste

---

**Status:** Infraestrutura pronta — Expandir cobertura
**Atualizado:** 2026-04-09
