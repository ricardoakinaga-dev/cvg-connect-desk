# Auditoria CVG Connect Desk — Relatório Completo com Notas (0-100)

**Data:** 2026-09-12
**Escopo:** `apps/`, `packages/`, `modules/`, `services/`, `e2e/`, `docs/`, Docker/CI
**Método:** inspeção estática + 4 frentes paralelas (estrutura, backend/dados, frontend/realtime, qualidade/ops). Sem alteração de código. Sem execução de testes.
**Base factual:** 269 arquivos `.ts/.tsx` (247 `.ts` + 22 `.tsx`), 26.425 LOC. `apps` 61 arquivos / 10.159 LOC, `packages` 57 / 5.333, `modules` 143 / 10.140, `e2e` 8 / 793.
**Stack verificada:** Fastify 5 + Zod 4 (instalado, não usado) + Drizzle ORM 0.45.2 + `pg` 8.20 / React 18 + Vite 5 + react-router 6 + zustand 4 / `ws` 8.16 / Outbox Postgres, sem BullMQ/Redis-queue / pnpm 10.33 + Turborepo.
**Git:** branch `main`, limpo exceto `?? .opencode/`, último commit `373ab40 2026-04-10 feat: consolidate enterprise hardening and test coverage`.

## Tabela de notas (0-100)

| # | Item analisado | Nota | Veredito em 1 linha |
|---|---|---:|---|
| 1 | Arquitetura monorepo / organização | 72 | Boa separação, mas stubs e duplicações |
| 2 | Backend API Fastify | 68 | Base sólida, validação inconsistente |
| 3 | Frontend desk-web | 65 | Funcional completo, sem design system/RBAC |
| 4 | Realtime WebSocket | 70 | Auth por mensagem boa, polling + reconnect fraco |
| 5 | Worker / Eventos / Outbox | 72 | Fan-out por consumer bom, DLQ volátil |
| 6 | Banco Drizzle / Migrations | 68 | Boa cobertura, gaps FK/PK/tipos |
| 7 | Autenticação | 55 | Sessão opaca funciona, sem JWT/refresh/anti-brute |
| 8 | Autorização RBAC / Setores | 52 | Permissões do banco ignoradas, cobertura irregular |
| 9 | Validação + tratamento de erros | 58 | `Result/AppError` bom, 3 dialetos HTTP |
| 10 | Transações / idempotência / concorrência | 45 | Ponto mais crítico: zero `db.transaction` |
| 11 | Qualidade de código / TS / Lint | 60 | `strict:true`, mas stubs de lint/build e bugs reais |
| 12 | Testes (vitest/playwright) | 71 | 70 testes, real-DB bom, coverage mal configurado |
| 13 | CI/CD | 58 | Só 2 workflows, sem gate lint/type/build |
| 14 | Docker / Infra / Deploy | 70 | Multi-stage + healthchecks, 2 placebos |
| 15 | Segurança | 62 | HMAC + bcrypt + SQL param. bons, CORS/rate-limit fracos |
| 16 | Observabilidade | 60 | Health/readiness/swagger bons, sem OTEL/Prom |
| 17 | Documentação | 68 | 77 docs, desatualizada ~5 meses |
| 18 | Integrações Gateway/Secretary/Evolution | 70 | Contratos bons, fire-and-forget sem reconciliação |
| 19 | Performance / escalabilidade | 58 | Índices bons, N+1 + polling + estado em memória |
| | **Média geral** | **63** | Funcional, não enterprise-ready sem P0 |

Critério das notas: 90-100 referência; 80-89 sólido com gaps menores; 70-79 funcional com dívida relevante; 60-69 funciona mas com risco; 50-59 lacuna estrutural; 40-49 risco crítico; <40 bloqueador/inoperante.

---

### 1. Arquitetura monorepo / organização — 72

**Evidências:**
- `package.json`: `cvg-connect-desk-monorepo`, `private:true`, `pnpm@10.33.0`, `engines node>=20 pnpm>=9`. Scripts `build/dev/lint/test/typecheck` via `turbo run`.
- `pnpm-workspace.yaml:1-3`: só `apps/*`, `packages/*`, `modules/*`. `services/*` e `e2e/` fora do workspace.
- `turbo.json:4-19`: tasks `build(depends ^build)`, `lint`, `dev(persistent)`, `test`. Sem task `typecheck`.
- 4 apps: `desk-api` (Fastify, 18 arquivos, 3.092 LOC), `desk-web` (React, 31 arq., 5.057 LOC), `message-worker` (5 arq., 469 LOC), `realtime-service` (7 arq., 1.541 LOC, `src/index.ts` com 804 linhas sozinho).
- 6 packages: `auth` 606/9, `database` 826/8, `events` 2.692/20, `integrations` 116/3, `realtime` 227/4, `shared` 866/13.
- 17 modules: ex. `chat` 1.900/17, `admin` 1.260/9, `secretary-adapter` 814/12, `chatwoot-compat` 14/1.
- `services/db-init`: sem `package.json`, só `Dockerfile` (migrate+seed).

**Pontos fortes:** separação apps/packages/modules clara; `desk-api` consome 19 workspaces `@cvg/*`; convenção de nomes consistente.

**Gaps:** `lint=echo lint` em 26/27 pacotes; `build=echo build` em 22/27; 11 módulos + 4 packages (`auth,integrations,realtime,shared`) sem `tsconfig.json` próprio; duplicação `packages/auth` vs `modules/auth` (`apps/desk-api/src/app.ts:27` usa `@cvg/auth`, o outro é código morto); `modules/dashboard` preso em `fastify@4.26.0` vs resto v5; `modules/chatwoot-compat` 14 linhas.

### 2. Backend API Fastify — 68

**Evidências:** `apps/desk-api/src/app.ts:1,42,51,89-161,163-205,256-271` — Fastify 5 + Zod Type Provider + Swagger `/docs` + Helmet/CORS/RateLimit + pino-pretty dev + `trustProxy:true` + `bodyLimit 1MB` + `/health`, `/readiness` (`select users limit 1` + checagem `REDIS_URL`) + `/events` polling + 16 módulos registrados.

**Pontos fortes:** pino, helmet, CORS, rate-limit allowList `/health|/readiness`, swagger, graceful shutdown `index.ts:8-14`.

**Gaps:** `fastify-type-provider-zod` sem `setValidatorCompiler` (no-op); zero `z.object` em `src`; `POST/PUT /admin/users` (`modules/admin/.../admin.controller.ts:48,65,82`), `PUT /contacts/:id` (`contact.controller.ts:74`), `PUT/DELETE /sectors`, todo `POST /gateway/*` sem `schema.body`/auth; `origin:true` fallback + `credentials:true` (`app.ts:95-96`); `keyGenerator:user.id||ip` ineficaz pois auth roda depois (`app.ts:103-111`).

### 3. Frontend desk-web — 65

**Evidências:** `apps/desk-web/package.json:16-30` React 18.2 + Vite 5.1.4 + router 6.22 + zustand 4.5 + `persist auth-storage`; `src/lib/api.ts:3,10-90` ApiClient singleton (`VITE_API_URL||''`, `Authorization: Bearer` lendo `localStorage`); `App.tsx:20-47` 13 rotas; `Inbox.tsx:225-416` 417 linhas, 2 painéis + composer mídia base64 16MB; `Kanban.tsx:36,72-84` 5 colunas + `PATCH /kanban/card/:id/move`.

**Pontos fortes:** `ErrorBoundary.tsx:12-65`, `Layout.tsx:5-70` seccionado, ApiClient por domínio (`conversationApi, taskApi, alertApi...` `api.ts:292-479`), testes WS com `MockWebSocket` (`__tests__/realtime.test.ts:75-87`).

**Gaps:** só 2 componentes reutilizáveis; CSS puro sem Tailwind/MUI; `contacts:any, params:any, (msg as any).mediaUrl` (`Inbox.tsx:26,47,368`); `ProtectedRoute` só booleano (`App.tsx:20-24`) — admin/audit expostos a qualquer logado; sem 401/refresh; polling 30s redundante + resubscribe por `selectedConv` (`Inbox.tsx:113-123`).

### 4. Realtime WebSocket — 70

**Evidências:** server `ws@8.16.0` (`apps/realtime-service/src/index.ts:2,31,44`); client `new WebSocket` (`apps/desk-web/src/lib/realtime.ts:53-55`, `VITE_REALTIME_URL||ws://localhost:8080`); auth `{type:'auth',token}` validada via `GET /auth/me` (`realtime.ts:88-91`, `index.ts:194-217`); revalidação `300000ms` (`index.ts:40,382-443`); canais `global` + `user:{id}` + `subscribe/unsubscribe` + broadcast `global`, `{type}:{id}`, `correlation:{id}` (`index.ts:485-586,728-733`); whitelist `shouldProject/projectEvent` (`packages/realtime/src/projections.ts:49-73,148-164`).

**Pontos fortes:** auth por mensagem (não expõe token em URL/logs), `subscribe` bloqueado sem auth, `resubscribe` pós-reconnect, close codes 4001/4002/4003, logs JSON com `correlation_id/event_id`.

**Gaps:** ingestão é polling DB `500ms` (`index.ts:598-654`); fallback `GET /events` sem auth (`index.ts:656-708`); reconexão `setInterval 5000` sem backoff/jitter (`realtime.ts:48,127-133`); `disconnect()` no unmount mata singleton global; legado `?token=` ainda aceito (`index.ts:54-63`); nginx `/ws/ -> 8080` com `proxy_read_timeout 86400s`.

### 5. Worker / Eventos / Outbox — 72

**Evidências:** sem `bullmq/bull/ioredis`; fila = outbox Postgres + `ConsumerAwareOutboxReader{WORKER,REALTIME,HTTP_POLL}` batch 50 maxRetries 3 (`packages/events/src/outbox-reader.ts:129-267`); loop `500ms` (`apps/message-worker/src/index.ts:254-288`); handlers só `handoff.completed, secretary.invocation, message.persisted`; retry `1s*2^n cap 30s` (`retry.ts:25-75`, `index.ts:166-252`).

**Pontos fortes:** fan-out por consumer com `PK(event_id,consumer_id)` + `onConflictDoUpdate`, `acknowledge/acknowledgeWithError` idempotentes.

**Gaps:** `DeadLetterStore` `Map max 1000` volátil (`dead-letter.ts:66-79`); `InMemoryProcessedEventStore` (`consumer.ts:23-46`); `setInterval` sem trava overlap + `sleep` bloqueia lote; `handleMessagePersisted` só log; desconhecido = `warn+ack`; `GET /events` (`app.ts:238-246`) `fetch+ack` destrutivo at-most-once; `consumerRetryCount:0` fixo (`outbox-reader.ts:309-310`); `JSON.parse(payload)` sem try/catch (`:87`).

### 6. Banco Drizzle / Migrations — 68

**Evidências:** `packages/database/src/schema.ts:1-495`, migrations `0000-0012` (`supabase/migrations`), `drizzle.config.ts:6-14` (`dialect:postgresql`, `strict:true`); tabelas `users/roles/permissions/queues/teams`, `tutors/patients/contacts/conversations/messages`, `tasks/notes/alerts`, `sessions/audit_logs`, `labels/sectors/groups/transfers`, `outbox_events/outbox_consumer_acks`; bons índices (`idx_conversations_sector/assigned/status_v2`, `idx_audit_entity/action/created`, `idx_outbox_processed/created`, uniques anti-dup).

**Gaps:** `contacts.tutorId/patientId` sem `.references()` (`schema.ts:18-19`); `contacts.externalId/phone/email` sem unique/índice; `role_permissions/user_roles` `pk:{columns}` inválido + migration sem PK; drift `idx_messages_media_type` e `idx_acks_pending` no SQL mas não no schema; `timestamp` vs `timestamptz` misto; `metadata/payload` `text+JSON.stringify` em vez de `jsonb`; FKs sem `onDelete`; dois `Pool` (`client.ts:8-10` vs `index.ts:5-7`).

### 7. Autenticação — 55

**Evidências:** `packages/auth/.../auth.repository.ts:25-40` `bcrypt.compare`, `token=uuid()`, `+7 dias`; `middleware.ts:27-47` `sessions.token` + `expiresAt` + `users.isActive` + `getUserRoles`; `POST /auth/login|logout`, `GET /auth/me` (`auth.controller.ts:16,87,119`); `401 Invalid credentials` genérico (bom anti-enumeração).

**Gaps:** sem `jsonwebtoken/jose/@fastify/jwt`; `JWT_SECRET` exigido no compose mas zero hits em `src`; sem refresh/rotação; `invalidateAllUserSessions:73-77` nunca chamado; sem rate-limit por rota nem lockout; duplicação `packages/auth` vs `modules/auth`.

### 8. Autorização RBAC / Setores — 52

**Evidências:** `packages/auth/src/rbac.ts:1-55` hardcoded `Admin/Receptionist/Veterinarian/Manager`; `requirePermission` OR não AND (`rbac-middleware.ts:15-43`); tabelas `role_permissions/user_roles` nunca consultadas; `sector-permissions.ts:11-107` (`getUserSectorIds`, `hasAccess`, `isGlobalAdmin`) só aplicado em `conversationRepository.findAll:47-58`.

**Gaps:** `GET /conversations`, `POST/PUT /contacts`, `transfers`, `kanban` só `authenticate`; `DELETE /contacts` exige `admin:write` mas `POST/PUT` não; `GET /audit/entity/:entityType` sem auth; todo `/gateway/*` sem auth.

### 9. Validação + tratamento de erros — 58

**Evidências:** base `packages/shared/src/error.ts:1-43` (`AppError`) + `result.ts:1-35` (`Ok/Err`); padrão dominante `if(result.isErr()) reply.status(...)` (ex. `task.controller.ts:62-71`); webhook inbound estrito `required:['from']`, `additionalProperties:false` (`webhook-inbound.controller.ts:19`); `pagination.ts:69-77` comenta "Schema Zod" mas exporta JSON-Schema.

**Gaps:** 3 dialetos: `Result→reply`, `throw result.error` (dashboard `:17-19` cai em `INTERNAL_ERROR` genérico `app.ts:53-69`), `500 {PROCESSING_ERROR,message}` com leak (gateway `:39,96`); `content` sem `minLength`; `uuid` como `string` sem format; `throw new Error('entityId is required')` sem 400.

### 10. Transações / idempotência / concorrência — 45

**Evidências:** inbound `findByExternalId→ok` + `UNIQUE externalMessageId` (`receive-inbound-message.use-case.ts:41-48`); outbox `UNIQUE eventId` + acks PK; `publishBatch` loop sem transação (`outbox-publisher.ts:34-38`).

**Gaps (críticos):** zero `db.transaction` em `src`; `receive-inbound:58-127` (conversa+history+mensagem+outbox+audit soltos); `transfers:create+updateConversationSector+updateContactSector`; `kanban:updateStatus+Sector+assign`; `setUserSectors:delete+insert`; `createUser+assignRoles`; `check-then-insert` race vira 500; `msg_${Date.now()}` quebra dedup; sem `Idempotency-Key`.

### 11. Qualidade de código / TS / Lint — 60

**Evidências:** `strict:true` raiz + apps (`tsconfig.json:10`), `noImplicitReturns`, `noFallthroughCases`; `inferSelect/inferInsert` ponta-a-ponta; `eslint.config.js:1-18` flat (`tseslint.recommended`, `no-explicit-any:warn`).

**Gaps:** `noUnusedLocals:false`, sem `noUncheckedIndexedAccess`; bugs reais: `where(eq(...) && eq(...))` avalia só 2ª condição (`seed.ts:77-79`, `admin.repository.ts:300-302`); `getUserRoles` busca tudo e filtra em memória (`auth.repository.ts:53-64`, deveria `inArray`); `query.where` sem reatribuir perdido (`sector.repository.ts:8-10`); N+1 (`outbound.controller.ts:164-175`, `contact.repository.ts:82-92`); `TeamRepository.getUsers` sempre `[]`; import com extensão `.ts` (`admin.controller.ts:9`); segredo default no código (`media-service.ts:3-5`).

### 12. Testes — 71

**Evidências:** 70 arquivos (66 `.test.ts` + 4 `.test.tsx`): `desk-api` 14 (12 integration: `auth,chat,contact-groups,contacts,dead-letter,events-polling,kanban,labels,sectors,transfers,webhook-inbound,webhook-security-stats`), `desk-web` 3+4, `worker` 2, `realtime` 5, `e2e/smoke` 5, `modules` 22, `events` 8, `shared` 6; `test:postgres-real` encadeia `db:types+db:migrate+events real-db + 7 suites`; real Postgres via `DATABASE_URL` (`real-db-test-utils.ts:7-58`, skip se sem banco); `integration-mocks.ts:3-34`.

**Gaps:** root `vitest.config.ts:4-18` `include **/*.test.ts` não casa `.tsx`, `coverage.include` exclui `apps/*,e2e/*`, web exclui `__tests__`, sem thresholds; sem `pg-mem/testcontainers`; e2e só chromium `workers:1`.

### 13. CI/CD — 58

**Evidências:** `.github/workflows/`: só `postgres-real-tests.yml:1-50` (PG 15 + `test:postgres-real`) e `smoke-e2e.yml:1-87` (chromium + stack + `test:e2e:smoke` + artifacts).

**Gaps:** sem gate lint/typecheck/build/coverage; `turbo.json` sem task `typecheck`.

### 14. Docker / Infra / Deploy — 70

**Evidências:** 5 Dockerfiles multi-stage (`desk-api:1-48`, `desk-web:1-43` nginx:1.25, `realtime:1-46`, `worker:1-45`, `db-init:1-25`), `appuser 1001`, `tini+curl`; `HEALTHCHECK` api `curl :3000/health`, web `curl :80`, realtime `nc 8080`; 3 composes prod/dev/smoke com `depends healthy`; `.dockerignore` correto.

**Gaps:** `message-worker:41-42` e `db-init:21-22` `HEALTHCHECK node -e process.exit(0)` placebo; `infra/` só `make_packages.mjs:1-28` scaffold stubs.

### 15. Segurança — 62

**Evidências:** `helmet{csp:false}` + nginx `X-Frame/SAMEORIGIN/nosniff/XSS/Referrer/Permissions` (`nginx.conf:7-12`); HMAC `sha256=<hex>` + `timingSafeEqual` + fail-secure prod (`webhook-guard.ts:46-142`, bootstrap `app.ts:16-22`); `bcrypt` ok; SQL só `sql\`\`` parametrizado, sem `raw/unsafe`; nenhum `.env` commitado; zero `dangerouslySetInnerHTML`.

**Gaps:** CORS fallback `origin:true`; rate-limit in-memory `100/min` sem Redis store; HMAC sobre `JSON.stringify(body)` não `rawBody`; `bodyLimit 1MB` vs mídia base64 em `TEXT`; outbound fire-and-forget sem `failed`.

### 16. Observabilidade — 60

**Evidências:** `/health {status,uptime,version}`, `/readiness {db+redis}` (`app.ts:163-205`); swagger; pino + `console JSON correlation/event_id`; 8 `GET /metrics/*` negócio + `dead-letters/stats` + `webhook-security/stats`.

**Gaps:** worker/realtime `console.*` manual; sem OTEL/Prometheus; stats process-local; sem `/metrics/worker|realtime`; `skipOnError:true` esconde falha.

### 17. Documentação — 68

**Evidências:** 77 `docs/*.md` + `README.md`, `DOCKER_SETUP.md`, `.env.example` comentado; arquitetura/endpoints bem descritos; 30+ relatórios fanout/realtime rastreáveis.

**Gaps:** último `docs/` em `373ab40 2026-04-10` (~5 meses); divergências admitidas (`11-security:29`, `18-deployment:6`); sem ADR canônico.

### 18. Integrações Gateway/Secretary/Evolution — 70

**Evidências:** `gateway-contracts.ts:3-96` (`WA_INBOUND/CW_OUTBOUND/WA_RECEIPT/INSTANCE_STATUS`); normalizers Evolution; outbound pull `GET /pending` + `POST /:id/sent` + `axios 10s x-api-key` (`gateway-service.ts:17-66`); Secretary `POST /invoke + Abort 30s + GET /health` (`secretary-client.ts:36-90`), singleton só se `URL+KEY`, `requested/success/failed` auditável; Evolution `sendText/Media/Audio/download` (`media-service.ts:15-172`).

**Gaps:** `gatewayService success:true` sem validar body; `parseInt(id.slice(0,8))` colide; `sendImage if/else` idênticos; outbound deixa `pending` para sempre sem reconciliação.

### 19. Performance / escalabilidade — 58

**Pontos fortes:** índices quentes, batch 50, paginação.
**Gaps:** N+1 + `IN sql.join` estoura; 3 pollers 500ms no PG; estado em memória impede horizontal; rate-limit local; 2 Pools/processo; reconexão sem jitter.

---

## P0 — corrigir antes de produção

1. Transações em multi-escritas + `onConflictDoNothing` idempotente + `Idempotency-Key`.
2. `GET /events` não destrutivo; corrigir `consumerRetryCount`, `JSON.parse` try/catch.
3. Fechar authz: `GET /audit/entity`, `/gateway/*`, `POST/PUT /contacts`, setores em transfers/kanban; remover CORS `origin:true`.
4. Corrigir `&&` em `where`, PK `role_permissions/user_roles`, FK `contacts`, `query.where` perdido.
5. HMAC sobre `rawBody`; remover segredo default; reconciliar `message.status failed` + retry.

## P1 — próxima onda

Redis store rate-limit, refresh/rotação sessão + lockout login, DLQ/outbox persistente, OTEL/Prom + `/metrics/worker|realtime`, CI gates lint/type/build/coverage, coverage incluir `apps/*.tsx` + thresholds, unificar `packages/auth` × `modules/auth`, pinar `turbo latest`.
