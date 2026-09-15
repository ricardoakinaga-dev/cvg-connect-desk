# INVENTARIO_CHECKS — checks existentes e configuração de teste (apoio AAA-00)

- Run: `apoio-AAA-00-inventario` (agente de apoio documental).
- Escopo: inventário estático de comandos/checks existentes. **Nenhuma suíte foi executada; nada aqui é PASS.**
- Base: `754f9badac46278e77d21de91c58eedb15e80581` (HEAD em 2026-09-12).
- Snapshot de hashes: `fontes-hashes-inicio.txt` / `fontes-hashes-fim.txt`.
- Fontes: `package.json` (raiz e 33 workspaces), `.github/workflows/*.yml`, `vitest.config.ts` por pacote, configs Playwright, `turbo.json`, `scripts/*.mjs`, `infra/scripts/*`, Dockerfiles, `e2e/**`, `runtime/state.json` (histórico).
- Convenção: **REAL** = executa validação; **PLACEHOLDER** = apenas imprime (`echo`); **MISSING** = script ausente; **NÃO EXECUTADO** = configuração existe mas não foi rodada nesta entrega.

## 1. Scripts raiz (`package.json`)

| Comando | Definido em | O que faz | Serviços | Efeitos de escrita | Limitações |
|---|---|---|---|---|---|
| `pnpm build` (l.8) | `package.json` scripts.build | `turbo run build`; `prebuild` roda `db:types` | Nenhum serviço; `db:types` requer apenas tsc | `dist/**`, `.turbo`, `packages/database/src/schema.d.ts(.map)` (gerados) | Em 33 workspaces, build é real em 6 e `echo build` em 27 (ver §3) |
| `pnpm lint` (l.11) | scripts.lint | `turbo run lint` | Nenhum | `.turbo`, caches | Só `@cvg/desk-web` executa ESLint; 32 pacotes usam `echo lint` |
| `pnpm typecheck` (l.21) | scripts.typecheck | `turbo run typecheck`; `pretypecheck` roda `db:types` | Nenhum | `schema.d.ts(.map)`, `.turbo` | Só 6 workspaces declaram typecheck; `@cvg/desk-api` não declara |
| `pnpm test` (l.12) | scripts.test | `turbo run test` em todos os workspaces | Depende do pacote: unit puro, DB real, Redis, skip-guard (ver §5) | `coverage/**` quando `--coverage`; caches; banco quando integração | `--passWithNoTests` torna verde vazio em pacotes sem teste; suítes de DB sem `DATABASE_URL` podem cair em default local |
| `pnpm test:postgres-real` (l.13) | scripts.test:postgres-real | `db:types` → `db:migrate` → 8 comandos de suíte | PostgreSQL real (env) | Aplica migrations no banco alvo; testes criam/apagam linhas | Não cria banco; sem `DATABASE_URL` o alvo pode ser o default local; cadeia em série |
| `pnpm test:e2e` (l.14) | scripts.test:e2e | `playwright test` com `playwright.config.ts` (smoke) | Browser + stack smoke (PG 55432, Redis 56379, API 4330, realtime 4930, web 4173, mock Evolution 8082) | Sobe processos via `webServer`; fixtures escrevem no banco smoke; `test-results/` | Exige `e2e:stack:up`; `reuseExistingServer: true` pode reutilizar servidor alheio |
| `pnpm test:e2e:smoke` (l.15) | scripts.test:e2e:smoke | Igual acima, com `DATABASE_URL` fixo no smoke | Idem | Idem | Mesma base do `test:e2e`; `DATABASE_URL` inline vence `.env` |
| `pnpm e2e:stack:up/down` (l.17-18) | scripts | Compose smoke PG/Redis | Docker (bloqueado neste host) | `down -v` **apaga volumes** e `fuser -k` derruba portas 4330/4930/4173/8082 | Alternativa local não-Docker para smoke não existe hoje |
| `pnpm triple-aaa:verify` (l.24) | scripts | Orquestra gates locais (ver §4) | PG 5432 default, rede (install/audit) | `artifacts/triple-aaa-report.{json,md}` | Lê evidências de MinIO/ClamAV/OTel apenas como arquivos pré-existentes |
| `pnpm staging:smoke` (l.25) | scripts | MinIO/ClamAV/Collector reais | MinIO, ClamAV, TCP collector | Nenhum arquivo; console | Importa `.ts` via `node` (§4, limitação) |
| `pnpm production-readiness` (l.26) | scripts | Validação de env de produção | Nenhum | Nenhum | Só configuração, não testa runtime |
| `pnpm db:migrate` / `db:seed` (l.22-23) | scripts | Migrations/seed do pacote database | PostgreSQL | DDL e dados | Seed cria admin/roles/permissões; não usar em banco compartilhado |

## 2. CI (`.github/workflows/`)

| Workflow / job | Comando principal | Serviços | Escreve | Observações |
|---|---|---|---|---|
| `ci.yml` / install | `pnpm install --frozen-lockfile` | Nenhum | `node_modules` | Node 20 + pnpm 10.33.0 |
| `ci.yml` / lint-typecheck | `desk-web eslint --max-warnings 100` + `tsc --noEmit` | Nenhum | Nenhum | Limite de warnings da CI (100) difere do script local (0) |
| `ci.yml` / unit | 5 filtros: `@cvg/shared`, `@cvg/messaging-contracts`, `@cvg/auth`, `@cvg/gateway-adapter`, `ai-policy.test.ts` | Nenhum | Nenhum | Não roda `turbo test` completo; não cobre desk-api |
| `ci.yml` / migration-check | `DATABASE_URL=.../postgres pnpm --filter @cvg/database db:check` | postgres:15 | Cria/derruba banco de checagem (`MIGCHECK_DB`) | Prova migrations em banco novo |
| `ci.yml` / build | `pnpm --filter @cvg/desk-web build` | Nenhum | `dist/` | — |
| `ci.yml` / docker | `docker build` api + worker | Docker | Imagens | Dockerfiles usam `pnpm install -r --no-lockfile` e `tsc --noEmit || true` → não reproduzível e sem typecheck efetivo |
| `postgres-real-tests.yml` | `pnpm test:postgres-real` | postgres:15 em 5432 | Migrations + linhas de teste | Suíte de banco real oficial |
| `smoke-e2e.yml` | `pnpm e2e:stack:up` → `pnpm test:e2e:smoke` → `down -v` | Compose smoke + browser | Volumes Docker (apagados no fim); fixtures no banco smoke | Libera portas com `fuser -k`; artefatos de falha |
| `security.yml` | CodeQL; Gitleaks; Trivy (exit 1 em HIGH/CRITICAL); dependency-review; `pnpm audit --audit-level=critical`; SBOM | Docker (Trivy), rede | SARIF, SBOM | Apenas **critical** bloqueia no audit; highs documentados como triagem |
| `dr-e2e.yml` | `bash infra/scripts/dr-e2e.sh` | postgres:15 (superuser) | Cria/derruba `connect_desk_dr_src/dst`; `/tmp/dr-e2e`; app log | Semanal/manual |
| `staging-integrations.yml` | `db:migrate`; `minio-real` + `clamav-real`; `staging:smoke`; `otel-e2e-check` | postgres, redis, minio, clamav, otel-collector (services reais) | Migrations; artefatos `artifacts/staging-*.json` | Exige `STAGING_SMOKE=1` |
| `triple-aaa-gate.yml` | `turbo run test --force`; `postgres-real`; `db:check`; web lint/typecheck/build; audit critical; Gitleaks | postgres, redis | Caches, banco | `promotion-state` = CONDITIONAL quando gates verdes |
| `triple-aaa-certification.yml` | `certification-aggregator.mjs` via `gh api` | Rede/GitHub | `artifacts/triple-aaa-report.*` | `TRIPLE_AAA_CERTIFIED` só manual; agregador falha sem `VERIFIED_CANDIDATE+` |

Observação factual: em `triple-aaa-gate.yml`, o passo "Migration fresh-DB check" declara `DATABASE_URL` inline e no `env:` do passo com valores diferentes; o inline prevalece para o comando.

## 3. Scripts por workspace (lint/build/typecheck/test)

33 workspaces. Valores derivados dos `package.json` de cada pacote.

| Classe | lint | build | typecheck | test |
|---|---|---|---|---|
| REAL (executa validação) | 1 (`desk-web`) | 6 (`desk-web`, `message-worker`, `realtime-service`, `dashboard`, `patients`, `tutors`) | 6 (mesmos, sem `desk-api`) | 33 (todas as suítes usam vitest; 27 com `--passWithNoTests`) |
| PLACEHOLDER (`echo ...`) | 32 | 27 | 0 | 0 |
| MISSING | 0 | 0 | 27 | 0 |

Consequências: `lint` e `typecheck` do monorepo não validam 27 pacotes; `build` de `@cvg/desk-api` é inócuo; `test` é real em todos, mas verde vazio onde não há arquivos.

## 4. Gates, observabilidade e scripts operacionais

| Script | Comando | Serviços | Efeitos | Limitações observadas |
|---|---|---|---|---|
| `scripts/triple-aaa-verify.mjs` | `pnpm triple-aaa:verify [--with-external-evidence]` | PG default `postgres:postgres@localhost:5432`; rede | `artifacts/triple-aaa-report.{json,md}` | Não roda MinIO/ClamAV; evidências externas só contam se arquivos existirem; exit 1 se FAILED |
| `scripts/production-readiness.mjs` | `pnpm production-readiness` | Nenhum | Nenhum | Valida env; exige `MEDIA_STORAGE_DRIVER=s3`; sem runtime real |
| `scripts/staging-smoke.mjs` | `pnpm staging:smoke` | MinIO (S3), ClamAV (INSTREAM), TCP collector | Nenhum | (a) importa `../packages/media/src/*.ts` em script `node` — requer loader TS que o workflow Node 20 não habilita; (b) usa `DeleteObjectCommand` sem importá-lo; (c) check `minio.delete` termina com `|| true` (sempre verdadeiro) |
| `scripts/otel-e2e-check.mjs` | `node scripts/otel-e2e-check.mjs` | Receiver HTTP local (não o Collector do compose) | `artifacts/staging-otel.json` | Importa `../packages/tracing/src/index.ts` em script `node` — mesma restrição de loader; valida export OTLP a um receiver local, não ao Collector real |
| `infra/scripts/query-performance.mjs` | `DATABASE_URL=... node infra/scripts/query-performance.mjs` | PostgreSQL | `artifacts/query-performance.json` | Só `EXPLAIN`; heurística `acceptable` simplificada |
| `infra/scripts/dr-e2e.sh` | `DR_POSTGRES_URL=... bash infra/scripts/dr-e2e.sh` | PostgreSQL superuser; app em porta 4339 | Cria/derruba `connect_desk_dr_src/dst`; backup em `/tmp/dr-e2e`; valida 10 tabelas, integridade e smoke `/health`+`/readiness` | Destrutivo apenas nos bancos DR; exige pg_dump/pg_restore/curl; não roda MinIO/ClamAV |
| `infra/scripts/pg-backup.sh` | `POSTGRES_URL=... ./pg-backup.sh` | PostgreSQL | Escreve dump + `.sha256`; **apaga** dumps antigos por retenção | Sem retenção configurável além de `RETENTION_DAYS` |
| `infra/scripts/pg-restore.sh` | `POSTGRES_URL=... BACKUP_FILE=... ./pg-restore.sh` | PostgreSQL | Restaura (destrutivo no schema público) | Exige confirmação; `I_UNDERSTAND_DESTROY_DATA=1` libera |
| `scripts/capture-design.mjs` | `node scripts/capture-design.mjs` | Chromium (`@playwright/test`); API mockada por `page.route` | Screenshots em `/tmp/cvg-design-current`; JSON no stdout | Captura visual/interação; não falha o processo em regressão (sem asserts de exit); requer web em `CVG_DESIGN_URL` (default 5173) |
| `.github/scripts/certification-aggregator.mjs` | via workflow | `gh` API/network | `artifacts/triple-aaa-report.*` | Só no GitHub Actions com token |
| `infra/scripts/make_packages.mjs` | manual | Nenhum | **Cria** `package.json` com scripts `echo` para pacotes ausentes | Script legado que pode fabricar placeholders; não faz parte de gate |

## 5. Grupos de suíte por serviço (mapa estático)

| Grupo | Arquivos | Precisa de | Guarda/skip | Efeitos no banco |
|---|---|---|---|---|
| Unit puro (sem serviço) | `packages/shared` (9), `packages/auth` (2), `packages/messaging-contracts` (2), `packages/database` (1), `packages/tracing` (1), `packages/events` (6), `apps/desk-web` (2), `apps/message-worker` (3), `apps/realtime-service` (4), `modules/dashboard/aging`, `modules/gateway-adapter` (2) | Nenhum | — | Nenhum |
| DB real (desk-api) | 20 arquivos `apps/desk-api/src/__tests__/*integration*` + `aaa-03` | PostgreSQL | Sem skip; `integration-mocks.ts` mocka audit/secretary/chat-publisher/gateway | `beforeAll/afterAll` criam e apagam users, roles, sessions, conversations, messages, outbox, audit, mídia |
| DB real (outros pacotes) | `modules/privacy/data-subject-service`, `modules/{admin,alerts,audit,auth,chat,contact-groups,contacts,labels,notes,sectors,tasks,transfers}/repository-structure`, `modules/secretary-adapter/ai-tools`, `modules/chat/conversation-repository` | PostgreSQL | Alguns sem skip | Inserções/anonymização; `repository-structure` inspeciona schema/índices |
| DB real com skip-guard | `packages/events/{outbox-reader-real,outbox-fanout-behavioral,schema-check}`, `modules/chat/{chat-ports,receive-inbound-idempotency,secretary-handoff}` | PostgreSQL | `probeRealDatabase`/`skipIf(!DATABASE_URL)` — skip silencioso sem DB | Prefixos de eventId; limpeza explícita |
| Redis real | `apps/realtime-service/{realtime-fanout,realtime-three-replica}`, `packages/events/realtime-bus` | Redis | Fallback para `redis://127.0.0.1:6379` | Publica/consome canais; sem limpeza de chaves visível |
| HTTP local | `apps/realtime-service/{realtime-auth-behavioral,realtime-http-polling}`, `apps/message-worker/health`, `modules/gateway-adapter/provider-chaos`, `packages/media/media-pipeline` | Portas efêmeras (`listen(0)`) e servidores no processo | — | Nenhum |
| MinIO/ClamAV reais | `packages/media/{minio-real,clamav-real}` | MinIO + ClamAV | `STAGING_SMOKE=1`; sem ele `it.skip` | Bucket/objetos no MinIO; nada em disco local |
| Browser smoke | `e2e/smoke/*` (5) | Stack smoke completa + Chromium | — | Fixtures de contato/conversa/mensagem e sessão admin no banco smoke |
| Browser AAA | `e2e/aaa/00-harness-sanity.spec.ts` | Stack AAA isolada + Chromium | — | Nenhuma escrita de produto; valida health/marker/login |
| Controle negativo | `e2e/aaa/99-negative-control.canary.spec.ts` | Nenhum serviço | Projeto `canary` separado | Nenhum; deve falhar |

## 6. Harness AAA-00 já existente (`e2e/support/aaa/**`)

| Artefato | Papel | Efeitos |
|---|---|---|
| `run-context.ts` | run id, diretórios, portas (PG 56432, Redis 56680, API 4630, realtime 4931, web 4373, mock 8083; offset por worker) | Cria dirs de run |
| `pg.ts` | `initdb`/`pg_ctl`, banco `cvg_aaa_*`, tabela marcadora `aaa_environment_marker`, guarda de URL, teardown restrito ao data dir | Escreve em `/tmp/cvg-aaa-runs/**`; DDL do banco do run |
| `redis.ts` | descoberta de binário, start com pidfile, stop restrito por cmdline/porta | `/tmp/cvg-aaa-runs/**` |
| `isolated-env.ts` | orquestra PG+Redis e grava `runtime/environment/isolated-env.json` | `runtime/environment/**` (sob coordenação) |
| `fixtures.ts` | dataset sintético determinístico (mínimo e `benchmark` 200/50×100) | Insere linhas no banco do run |
| `start-aaa-stack.ts` | migrations, seed, mock Evolution, API/realtime/web isolados | Processos e banco do run |
| `harness-selfcheck.ts` | guardas + boot + canary + sanidade; grava `runtime/harness/*` | Processos, banco, `runtime/harness/**` |
| `baseline.ts` / `inventory.ts` | manifesto/hashes/preservação e inventário de scripts/serviços | `runtime/environment/**` |
| `playwright.aaa.config.ts` | projetos `aaa` e `canary`, webServer do stack isolado | `runtime/harness/playwright-artifacts` |
| `teardown-aaa-env.ts` | teardown explícito `--stop-services [--drop-database]` | Encerra PG/Redis do run |

Arquivos **propostos e ausentes** (cartões futuros): `e2e/aaa/accessibility.spec.ts` (AAA-22), `e2e/aaa/visual.spec.ts` (AAA-22), `e2e/aaa/performance.spec.ts` (AAA-25), `infra/scripts/aaa-load.mjs` (AAA-25).

## 7. Configuração existente × proposta × histórico

- **Existente e estático**: tudo nas §1–§6 marcado como REAL/PLACEHOLDER, workflows e scripts citados.
- **Proposto (não implementado)**: checks `TO_CREATE` do catálogo — ex.: `aaa-13/21/29/30/31.test.tsx`, `aaa-03.integration.test.ts` (este já criado pelo Agente 3 no worktree), `accessibility.spec.ts`, `visual.spec.ts`, `performance.spec.ts`, `aaa-load.mjs`, `playwright.aaa.config.ts` (criado no run atual).
- **Evidência histórica (não atual)**: `docs/auditorias/2026-09-12/evidencias/*` registram 149 testes aprovados e repros em 12/09; `runtime/evidence/AAA-00-*.txt` registram suíte de auth 6/6 e negativos no ambiente adotado; `runtime/state.json` registra `AAA-03 implemented-in-review`. São registros datados, não execução desta entrega.

## 8. Verificações não executadas nesta entrega

Nenhuma suíte, script, migration, provisionamento ou build foi executado. Classificações acima vêm de leitura de arquivos e buscas. Em especial: não foi verificado se `turbo run test` fecha sem ciclo após AAA-02; não foi verificado se as suítes de DB passam; não foi confirmado o comportamento de skip em CI; não foi executado `db:check`, `dr-e2e`, `staging-smoke` nem `otel-e2e-check`.
