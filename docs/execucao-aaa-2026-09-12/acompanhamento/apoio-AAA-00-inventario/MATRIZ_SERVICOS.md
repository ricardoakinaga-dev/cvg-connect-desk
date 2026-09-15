# MATRIZ_SERVICOS — serviços exigidos por grupo de check/gate (apoio AAA-00)

- Run: `apoio-AAA-00-inventario`. **Estático: nenhum serviço foi provisionado, reservado ou executado.**
- Base: `754f9badac46278e77d21de91c58eedb15e80581`.
- Classificação: **OBRIGATÓRIO** (sem ele o check não valida o alvo), **OPCIONAL** (degrada com aviso), **MOCKADO** (substituto em processo), **N/D** (não determinado por leitura).
- Toda relação cita o código/configuração que a sustenta. Evidência histórica não é prova atual.

## 1. Tabela principal por grupo

| Grupo de check/gate | PostgreSQL | Redis | Gateway/Evolution | API/app | Navegador | MinIO | ClamAV | OTel | Base da classificação |
|---|---|---|---|---|---|---|---|---|---|
| Unit puro (`shared`, `auth` unit, `messaging-contracts`, `database/schema`, `tracing`, `events` unit, `desk-web` jsdom, `gateway-contracts/ports`, `ai-policy/ai-bypass/tools`) | — | — | MOCKADO quando citado | MOCKADO/in-process | — (jsdom) | — | — | OPCIONAL (Noop por default) | `vi.mock` nos testes; `packages/tracing/src/index.ts:53` (`OTEL_ENABLED`) |
| API integration `apps/desk-api/src/__tests__/*integration*` (20 arq.) | **OBRIGATÓRIO** | OPCIONAL | MOCKADO | in-process (`buildDeskApiApp`) | — | — | MOCKADO (`MALWARE_SCANNER=fake` em `outbound-idempotency`) | OPCIONAL | `@cvg/database` client; `integration-mocks.ts` mocka audit/secretary/chat-publisher/gateway; `app.ts:275` só usa Redis se `REDIS_URL` |
| `modules/*/repository-structure` + `conversation-repository` + `ai-tools` | **OBRIGATÓRIO** | — | — | — | — | — | — | — | imports de `@cvg/database`/`drizzle` |
| `modules/privacy/data-subject-service` | **OBRIGATÓRIO** | — | — | — | — | — | — | — | insere e anonimiza contato/conversa/mensagens |
| `packages/events` real-db (`outbox-reader-real`, `outbox-fanout-behavioral`, `schema-check`) | **OBRIGATÓRIO** | — | — | — | — | — | — | — | `probeRealDatabase` → `describe.skip` se indisponível (`real-db-test-utils.ts:7`) |
| `modules/chat` `receive-inbound-idempotency` / `secretary-handoff` | **OBRIGATÓRIO** | — | MOCKADO | — | — | — | — | — | probe + skip; fallback 5432 (`:38`/`:18`) |
| `modules/chat/chat-ports` | **OBRIGATÓRIO** | — | MOCKADO | — | — | — | — | — | `describe.skipIf(!DATABASE_URL)` (`:24-26`) |
| `apps/realtime-service` `realtime-fanout` / `realtime-three-replica` | — | **OBRIGATÓRIO** | — | HTTP local | — | — | — | — | `RedisRealtimeBus`; fallback `redis://127.0.0.1:6379` (`:14`/`:12`) |
| `apps/realtime-service` auth-behavioral / http-polling / projector / revalidation / structure | — | — | — | HTTP local (`listen(0)`) | — | — | — | — | `createServer` + `RealtimeServer` |
| `packages/events/realtime-bus` | — | **OBRIGATÓRIO** | — | — | — | — | — | — | canal `${REALTIME_BUS_CHANNEL}:test-*`; fallback 6379 (`:5`) |
| `packages/media/media-pipeline`, `s3-storage` | — | — | — | — | — | MOCKADO (client S3 fake) | MOCKADO (`FakeScanner`/TCP fake) | — | `media-pipeline.test.ts`; `scanner.ts:137` |
| `packages/media/minio-real` | — | — | — | — | — | **OBRIGATÓRIO** (real) | — | — | `STAGING_SMOKE=1`; sem isso `it.skip` (`:12-18`) |
| `packages/media/clamav-real` | — | — | — | — | — | — | **OBRIGATÓRIO** (real, EICAR) | — | `STAGING_SMOKE=1`; skips explícitos (`:86-92`) |
| `e2e/smoke` (5 testes) | **OBRIGATÓRIO** (55432) | **OBRIGATÓRIO** (56379) | MOCKADO (Evolution em 8082 via `mock-evolution-server.ts`) | **OBRIGATÓRIO** (API 4330, realtime 4930, web 4173) | **OBRIGATÓRIO** (Chromium) | — | — | — | `playwright.config.ts` webServer + `start-e2e-stack.ts`; `docker-compose.smoke.yml` |
| `e2e/aaa` sanidade/controle negativo | **OBRIGATÓRIO** (56432) | **OBRIGATÓRIO** (56680) | MOCKADO (8083) | **OBRIGATÓRIO** (4630/4931/4373) | Sanidade: **OBRIGATÓRIO**; canary: — | — | — | — | `playwright.aaa.config.ts` + `e2e/support/aaa/*`; `run-context.ts:72-77` |
| `scripts/triple-aaa-verify.mjs` | **OBRIGATÓRIO** (default 5432 `postgres:postgres`) | OPCIONAL (suites que usam) | MOCKADO nos testes | in-process | — | N/D (só lê artefatos) | N/D (só lê artefatos) | N/D (só lê artefatos) | `scripts/triple-aaa-verify.mjs:32,40,105-117` |
| `scripts/staging-smoke.mjs` | — | — | — | — | — | **OBRIGATÓRIO** (real) | **OBRIGATÓRIO** (real) | **OBRIGATÓRIO** (TCP reachability) | `scripts/staging-smoke.mjs:20-70` |
| `scripts/otel-e2e-check.mjs` | — | — | — | — | — | — | — | **MOCKADO** (receiver HTTP local, não o Collector do compose) | `scripts/otel-e2e-check.mjs:20-38` |
| `infra/scripts/dr-e2e.sh` | **OBRIGATÓRIO** (superuser) | — | — | **OBRIGATÓRIO** (porta 4339) | — | — | — | — | `dr-e2e.sh:11,33,92-103` |
| `infra/scripts/query-performance.mjs` | **OBRIGATÓRIO** | — | — | — | — | — | — | — | `query-performance.mjs:15-19` |
| `scripts/capture-design.mjs` | — | — | MOCKADO (`page.route` para API) | MOCKADO | **OBRIGATÓRIO** (Chromium) | — | — | — | `capture-design.mjs:1-9,92-118` |
| `security.yml` Trivy / CodeQL / SBOM | — | — | — | — | — | — | — | — | Docker + rede (workflow) |
| `staging-integrations.yml` | **OBRIGATÓRIO** | **OBRIGATÓRIO** | — | — | — | **OBRIGATÓRIO** | **OBRIGATÓRIO** | **OBRIGATÓRIO** | serviços declarados no workflow |
| `postgres-real-tests.yml` / `triple-aaa-gate.yml` | **OBRIGATÓRIO** | OBRIGATÓRIO no gate | MOCKADO | in-process | — | — | — | — | serviços `postgres:15` e `redis:7` |
| `smoke-e2e.yml` | **OBRIGATÓRIO** | **OBRIGATÓRIO** | MOCKADO | **OBRIGATÓRIO** | **OBRIGATÓRIO** | — | — | — | workflow + compose smoke |
| `dr-e2e.yml` | **OBRIGATÓRIO** | — | — | **OBRIGATÓRIO** | — | — | — | — | serviço postgres + script |

## 2. Fallbacks de `DATABASE_URL`/`REDIS_URL` (fato observado)

| Arquivo:linha | Fallback | Risco |
|---|---|---|
| `packages/database/src/index.ts:6` | `postgresql://connect_desk:root@localhost:5432/connect_desk_db` | Aponta para banco dev local quando env ausente |
| `packages/database/drizzle.config.ts:11` | idem | idem (uso fora de teste) |
| `packages/database/src/client.ts:10` | **nenhum explícito** (`connectionString: process.env.DATABASE_URL`) | Sem env, `pg` usa defaults libpq (host/usuário do SO, porta 5432); erro ou banco errado |
| `packages/events/src/__tests__/real-db-test-utils.ts:7` | `connect_desk:root@localhost:5432/connect_desk_db` | Suite de outbox pode atingir DB dev; existe `probeRealDatabase` + skip |
| `modules/chat/src/__tests__/receive-inbound-idempotency.test.ts:38` | idem | idem |
| `modules/chat/src/__tests__/secretary-handoff.integration.test.ts:18` | idem | idem |
| `apps/realtime-service/src/__tests__/realtime-fanout.test.ts:14` / `realtime-three-replica.test.ts:12` | `redis://127.0.0.1:6379` | Colisão com Redis dev/compartilhado |
| `packages/events/src/__tests__/realtime-bus.test.ts:5` | `redis://127.0.0.1:6379` | idem |
| `apps/realtime-service/src/index.ts:67` | `REDIS_URL || ''` | Sem Redis o serviço não usa bus (degradação), não é erro |
| `apps/desk-api/src/app.ts:275` | uso condicional a `REDIS_URL` | Rate-limit distribuído só com Redis; readiness checa só se definido |
| `modules/gateway-adapter/src/infrastructure/gateway-service.ts:5` | `GATEWAY_URL || http://localhost:3000` | Pode bater no desk-api local na porta 3000 |
| `modules/gateway-adapter/src/infrastructure/media-service.ts:3` | `EVOLUTION_API_URL || http://localhost:8082` | Bate no mock Evolution do smoke/harness |
| `packages/integrations/src/secretary-client.ts` + `.env.example:140` | `SECRETARY_URL` (sem default no código observado) | Sem env, integração não configurada (`SECRETARY_NOT_CONFIGURED`) |
| `packages/tracing/src/index.ts:53,71` | `OTEL_ENABLED=false`; endpoint opcional | Sem OTel, tracing Noop (aceitável em degradação) |
| `packages/media/src/index.ts:20` + `.env.example:101` | `MEDIA_STORAGE_DRIVER=memory` | Memory proibido em produção sem `MEDIA_ALLOW_MEMORY=true` |
| `packages/media/src/scanner.ts:136-140` | `MALWARE_SCANNER` vazio → `null`; `fake` → FakeScanner | Fake proibido em produção sem `MEDIA_ALLOW_FAKE_SCANNER=true`; política default `documents` (`:149`) |

## 3. Testes/rotinas que apagam ou sobrescrevem dados

| Local | Operação | Escopo | Observação |
|---|---|---|---|
| `apps/desk-api/src/__tests__/*integration*` (auth, aaa-03, dead-letter, outbound-idempotency, sector-authz, transfers, etc.) | `db.delete(...)` em `afterAll`/`beforeEach` | Linhas criadas pelo próprio teste (por userId/roleId/conversationId) | Depende de isolamento; se duas suítes compartilham banco, `delete` por prefixo/id pode se sobrepor |
| `apps/desk-api/src/__tests__/outbound-idempotency.integration.test.ts:230` | `delete mediaAssets` por sha | Só o sha do teste | idem |
| `modules/privacy/src/__tests__/data-subject-service.test.ts` | anonimização de contato | Dados do teste | Ação é o comportamento sob teste |
| `packages/events/src/__tests__/real-db-test-utils.ts` (`clearOutboxTestData`) | `delete` por prefixo de eventId | Prefixos do teste | Prefixo precisa ser único por run |
| `infra/scripts/dr-e2e.sh` | `DROP DATABASE IF EXISTS connect_desk_dr_src/dst`; `pg_restore --clean` | Bancos DR dedicados | Exige superuser; nunca apontar para produção |
| `infra/scripts/pg-restore.sh` | restauração destrutiva | `POSTGRES_URL` alvo | Confirmação ou `I_UNDERSTAND_DESTROY_DATA=1` |
| `infra/scripts/pg-backup.sh` | `find ... -delete` por retenção | Backups antigos | — |
| `pnpm e2e:stack:down` | `docker compose down -v` + `fuser -k` | Volumes smoke + portas 4330/4930/4173/8082 | Pode derrubar processo alheio que use as portas |
| `e2e/smoke/support.ts` | Cria contato `+5511988880011`, conversa, mensagem e sessão admin | Banco smoke | **Sem cleanup observado** (0 `delete(`); idempotente por upsert e deixa fixture |
| `e2e/support/aaa/fixtures.ts` | Inserts sintéticos com IDs determinísticos | Banco do run `cvg_aaa_*` | Idempotente por `onConflictDoNothing`; seed benchmark em lote |

## 4. Recursos compartilhados e riscos de colisão

| Recurso | Onde aparece | Risco |
|---|---|---|
| Portas smoke `55432`, `56379`, `4330`, `4930`, `4173`, `8082` | `docker-compose.smoke.yml:13,28`; `playwright.config.ts`; `start-e2e-stack.ts:11-16` | Fixas; `reuseExistingServer: true` pode reutilizar stack de outro run; `fuser -k` derruba qualquer dono |
| Portas staging `55433`, `56380`, `9100`, `9101`, `9310`, `4318`, `9090`, `3001`, `3200`, `4331`, `4332`, `4174` | `docker-compose.staging.yml` | Conflito com runs ad-hoc que usem as mesmas portas (histórico do run 55433/56380 foi realocada) |
| Portas base/dev `5432`, `6379`, `3000`, `8080`, `8081`, `80` | `docker-compose.yml`, `docker-compose.dev.yml` | Fallbacks de teste apontam para 5432/6379 |
| Portas harness AAA `56432`, `56680`, `4630`, `4931`, `4373`, `8083` | `e2e/support/aaa/run-context.ts:72-77` | Run único default `aaa-20260912`; Workers adicionais usam offset (`AAA_WORKER_INDEX`) |
| Porta run Agente 2 `56442`/`56681` | `runtime/dispatch/AAA-02.md`/`state.json` | Outro writer ativo; harness AAA não a usa |
| Porta DR `4339` | `infra/scripts/dr-e2e.sh:92` | Fixa; colisão se outro processo usar |
| Banco default `5432/postgres` | `triple-aaa-verify.mjs:32,40` | `test:postgres-real` aplica migrations nesse alvo se `DATABASE_URL` não vier do ambiente |
| Redis DB 0 compartilhado | fallbacks 6379 | Canais de teste (`:test-*`) e rate-limit/realtime podem cruzar entre suítes |
| Fixtures fixas | `e2e/smoke/support.ts` (telefone/e-mail fixos), testes desk-api com e-mails `Date.now()` | Duas execuções concorrentes no mesmo banco colidem no telefone fixo e potencialmente em `delete` cruzado |
| `.env` implícito | `dotenv/config` em `packages/database/src/client.ts`, `apps/*/src/index.ts` | Ambiente local pode injetar `DATABASE_URL`/`REDIS_URL` sem o executor perceber |
| Artefatos | `artifacts/` (gates), `test-results/`, `playwright-report/`, `runtime/harness/` | Runs concorrentes sobrescrevem relatórios se usarem o mesmo caminho |
| Docker socket | `docker compose`, workflows | Bloqueado neste host para o usuário; alternativa local necessária |

## 5. Recomendações de isolamento por run/worker (propostas — não implementadas aqui)

1. **Banco com marcador e guarda universal**: todo check que roda migrations ou integração deve recusar URL sem marcador (`cvg_aaa_*`/tabela `aaa_environment_marker`), como já faz `e2e/support/aaa/pg.ts:171-211`. Aplicar a `test:postgres-real`, `db:migrate`, `query-performance.mjs` e `dr-e2e.sh` (este último com allowlist explícita de bancos `*_dr_*`).
2. **Banco/namespace por worker**: `cvg_aaa_<run>_w<N>` (o harness já compõe `_wN` por `AAA_WORKER_INDEX`) e portas `base + 10*worker`, evitando qualquer faixa publicada em compose (ex.: não usar 55433/56380/55432/56379).
3. **Redis isolado**: porta dedicada por run (harness: 56680) e/ou `SELECT` de um DB lógico + prefixo de canal por run; limpar chaves por prefixo no teardown.
4. **Fixtures com namespace de run**: sufixar telefones/e-mails/eventIds com o run id; nunca depender de fixture fixa compartilhada; documentar que o smoke deixa linhas (ou adicionar cleanup por prefixo).
5. **Serialização de escritores**: suítes que apagam dados não devem rodar em paralelo no mesmo banco; usar `vitest --no-file-parallelism` para grupos de integração ou um banco por arquivo/worker. CI já isola por job com service containers.
6. **Teardown restrito**: encerrar apenas data dirs/pidfiles do run; evitar `fuser -k` e `down -v` quando houver outros runs; checar `postmaster.pid`/cmdline antes de matar (padrão de `pg.ts`/`redis.ts`).
7. **Portas efêmeras onde possível**: nos testes in-process, manter `listen(0)` (já usado em realtime/media); nos scripts de stack, derivar de env com fallback e verificar disponibilidade antes de subir.
8. **Evitar fallback silencioso em CI**: exportar `DATABASE_URL`/`REDIS_URL` explícitos nos jobs (já ocorre) e transformar fallback 5432/6379 em erro quando `CI=true`, para impedir suíte verde contra banco errado.
9. **Serviços de mídia**: manter MinIO/ClamAV/OTel exclusivos do job `staging-integrations` e do harness AAA; nenhum gate anterior deve depender deles (hoje só media/real e staging-smoke dependem).
