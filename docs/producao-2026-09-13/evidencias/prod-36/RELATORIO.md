# PROD-36 - Relatorio de execucao (boot, health/readiness e implantacao)

**Tarefa:** PROD-36 (AC1-AC4) · **Itens auditados:** BE18, OP09, OP10, OP11, BE06
**Contratos:** C08/C09 · **Data:** 2026-09-13
**Candidato:** `754f9badac46278e77d21de91c58eedb15e80581` + worktree compartilhada
**Estado do cartao:** **IMPLEMENTED / aguardando revisao do integrador - nao declarado DONE**

O worktree continua deliberadamente sujo conforme a baseline PROD-00. Nenhuma
migration foi criada ou alterada por esta tarefa. Os runs de integracao usaram
PostgreSQL/Redis locais isolados, banco marcado `cvg_aaa_*` e teardown por
`runId`; nenhum banco de desenvolvimento foi usado.

## 1. Delta implementado

| Area | Caminho | Mudanca |
|---|---|---|
| Configuracao | `apps/desk-api/src/runtime-config.ts` | `validateProductionConfig()` fail-closed para NODE_ENV, DB, Redis, CORS, secrets internos, S3, ClamAV, metricas, JWT placeholder e OTEL. |
| API | `apps/desk-api/src/app.ts` | `/health` permanece liveness; `/readiness` retorna 503 para configuracao, banco, migrations ou Redis criticos indisponiveis; Secretary segue degradavel. |
| Preflight | `scripts/production-readiness.mjs` | Contrato produtivo validado antes do boot, sem exigir JWT quando removido do desenho. |
| Worker | `apps/message-worker/src/{health.ts,healthcheck.ts,polling.ts,index.ts}` | Readiness baseada no loop real, falhas consecutivas e idade da fila; healthcheck consulta o processo; shutdown aguarda ciclo em andamento. |
| Realtime | `apps/realtime-service/src/index.ts` | HTTP `/health` e `/readiness` no mesmo listener do WebSocket; readiness exige polling bem-sucedido e nao aceita WS aberto como prova suficiente. |
| Eventos | `packages/events/src/outbox-reader.ts` | Claim respeita catalogo de `eventTypes` do consumidor. |
| Runtime | `apps/{desk-api,message-worker,realtime-service}/Dockerfile`, `docker-compose.yml`, `docker-compose.staging.yml`, `.env.production.example` | Healthchecks de readiness, filesystem/capabilities restritos, S3/ClamAV obrigatorios, Redis critico no Compose e propagacao OTEL. |
| Regressao | `scripts/production/prod-36.test.mjs`, testes de health/config | Casos positivos/negativos e contratos de runtime documentados. |

## 2. Aceites

### AC1 - preflight e contrato efetivo: **PASS (synthetic-isolated)**

- `scripts/production/prod-36.test.mjs`: contrato valido retorna `READY` e a
  configuracao incompleta retorna `NOT READY (fail fast)` com os nomes das
  variaveis ausentes, sem vazar valores; tambem cobre normalizacao de OTEL e
  placeholder JWT em caixa diferente.
- `apps/desk-api/src/__tests__/runtime-config.test.ts`: 6/6, incluindo contrato
  produtivo sem `JWT_SECRET` obrigatorio.
- Runner `prod36-health-final2` executou `db:types`, migration, seed e o
  preflight com exit 0; a suite teve 5/5 testes.

### AC2 - liveness/readiness, worker e realtime: **PASS (synthetic-isolated)**

- API: `resilience.integration.test.ts` 5/5 no run `prod36-api-resilience`;
  inbound continua persistido e Secretary indisponivel aparece como degradado.
- Worker: suite completa 4 arquivos/14 testes pass; readiness acompanha sucesso
  do polling e marca fila antiga como degradada.
- Realtime: testes focados 4 arquivos/19 testes pass; health 200 e readiness
  dependente do polling real.
- AAA-05 no run `prod36-realtime-final`: PostgreSQL, Redis e sockets WebSocket
  reais isolados, 14/14 testes pass, incluindo isolamento, revogacao,
  reconexao e fanout de tres replicas.

### AC3 - imagem, proxy e operacao externa: **PARTIAL**

A configuracao estatica cobre usuario/filesystem/rede restritos, readiness nos
healthchecks, headers de proxy, `/ws/`, CORS e rate limit. Nao foi possivel
observar build/start de imagem a partir de checkout limpo, TLS/WSS de outro
host, restart/graceful drain ou deployment remoto porque o socket Docker nao
tem permissao neste ambiente.

### AC4 - persistencia, scanner, recursos e rollback: **PARTIAL**

Compose exige S3 privado, ClamAV TCP, secrets internos e Redis critico; os
timeouts de readiness sao limitados. Ainda falta ensaio real de bucket/scanner,
persistencia após restart, limites/recursos efetivos e rollback compatível.

## 3. Comandos e resultados

| Comando | Resultado |
|---|---|
| `node --test scripts/production/prod-36.test.mjs` | exit 0 - 5/5 |
| `pnpm --filter @cvg/desk-api exec vitest run src/__tests__/runtime-config.test.ts` | exit 0 - 6/6 |
| `pnpm --filter @cvg/message-worker exec vitest run` | exit 0 - 14/14 |
| `pnpm --filter @cvg/realtime-service exec vitest run src/__tests__/realtime-health.test.ts src/__tests__/realtime-http-polling.test.ts src/__tests__/realtime-structure.test.ts src/__tests__/realtime-three-replica.test.ts` | exit 0 - 19/19 |
| `pnpm --filter @cvg/events typecheck && pnpm --filter @cvg/desk-api typecheck && pnpm --filter @cvg/message-worker typecheck && pnpm --filter @cvg/realtime-service typecheck` | exit 0 |
| runner `prod36-health-final2` | exit 0 - preflight 5/5 |
| runner `prod36-realtime-final` | exit 0 - AAA-05 14/14 |
| runner `prod36-api-resilience` | exit 0 - resilience 5/5 |
| `git diff --check` | exit 0 |

Evidencia bruta dos runs: `../integration-runs/prod36-health-final2/`,
`../integration-runs/prod36-realtime-final/` e
`../integration-runs/prod36-api-resilience/`. Cada diretorio contem
`runner-summary.json`, `runner-output.log` e o ambiente isolado; os processos
foram encerrados pelo teardown do runner.

## 4. Limitacoes e recuperacao

1. A execucao de `pnpm --filter @cvg/realtime-service exec vitest run` sem o
   runner terminou com 86 testes pass, 14 skipped e falha de setup no
   `aaa-05`, pois `DATABASE_URL` nao apontava para o run isolado. A prova
   correta foi repetida no runner e passou 14/14.
2. Docker permanece bloqueado por permissao do socket; MinIO, Compose real,
   TLS/WSS externo, deploy remoto, recursos efetivos e rollback continuam
   `NOT_RUN/BLOCKED`, nao PASS.
3. Revisao independente e fechamento `DONE` continuam pendentes; D01-D06
   seguem OPEN.
4. Rollback local e seguro consiste em reverter somente o delta dos caminhos
   de runtime desta tarefa. Nao ha migration ou dado persistente novo para
   reverter. Runs isolados foram removidos por `runId`.
