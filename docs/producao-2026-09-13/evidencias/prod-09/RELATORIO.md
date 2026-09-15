# PROD-09 — Relatório de execução

**Cartão:** PROD-09 — Garantir efeitos idempotentes de worker e falhas observáveis (AC1–AC4)
**Itens auditados:** BE11 · BE12 · BE07 · UI08 · **Contratos:** C04 (G03) · **Estado do cartão:** IMPLEMENTED (não DONE)
**Candidato:** HEAD `754f9badac46278e77d21de91c58eedb15e80581` + worktree (delta **não commitado**; nenhum arquivo de
`packages/auth`, webhook, contact-groups, `conversation.repository.ts` ou `realtime-bus.ts` foi tocado — as fronteiras
do PROD-05/PROD-04/PROD-12 foram respeitadas). `packages/events/src/outbox-lease.ts` e `outbox-reader.ts` já continham
trabalho não commitado de outra frente (lease C03/AAA-07); o delta do PROD-09 é aditivo sobre esse estado.

Ambiente de prova (harness AAA, nunca o banco do host): PostgreSQL 16 + Redis isolados por run (`marker.runId`
conferido, `cvg_aaa_*`), migrate+seed reais e teardown com `stopServices+dropDatabase`.

| Run | Worker | PostgreSQL | Banco | Redis | Exit |
|---|---|---:|---|---:|---:|
| `prod09-repro2` (repro antes) | 23 | 127.0.0.1:58732 | `cvg_aaa_prod09_repro2_w23` | 56910 | 0 |
| `prod09-verif1` / `prod09-verif2` (suíte AC, 2 rodadas) | 22 | 127.0.0.1:58632 | `cvg_aaa_prod09_verif{1,2}_w22` | 56900 | 0 / 0 |
| `prod09-verif-worker` (regressão worker) | 22 | 127.0.0.1:58632 | `cvg_aaa_prod09_verif_worker_w22` | 56900 | 0 |
| `prod09-contra2` (contraprova pós-delta) | 27 | 127.0.0.1:59132 | `cvg_aaa_prod09_contra2_w27` | 56950 | 0 |
| `prod09-regressao-events2` (regressão events) | 26 | 127.0.0.1:59032 | `cvg_aaa_prod09_regressao_events2_w26` | 56940 | 1 (pré-existente) |

---

## 1. Problema reproduzido (antes do delta)

Script `repro-antes.ts` (usa o **código real** de `createAlert` e do worker `index.ts` no estado anterior; roda no
runner isolado). Saída integral em `logs/repro-antes.log` e `repro-antes.json`.

**A — replay sem chave de dedup:** duas chamadas do MESMO `(eventId, efeito)` criam **2 alertas lógicos**.

```json
"A_replay_sem_dedup": { "firstIsOk": true, "secondIsOk": true, "alertsCreated": 2, "expectedWithDedup": 1, "defect": true }
```

**B — `Err` engolido ⇒ ACK sem efeito:** trigger real faz o `INSERT` do alerta falhar **uma vez**; o worker loga
`Failed to create alert...`, o handler **resolve**, o worker dá **ACK** e **nada vai para retry/DLQ**:

```json
"B_err_engolido_ack_sem_efeito": {
  "processedAtSet": true, "consumerRetryCount": 0, "alertsCreated": 0, "deadLetterRows": 0, "defect": true
}
```

Log real do worker (estado anterior) — além do efeito perdido, o conteúdo do payload (marcador `pii-<uuid>` do
`errorMessage`) vaza para o log via mensagem do driver com `params:`:

```json
{"msg":"[Worker] Secretary invocation failed", ..., "error":"falha com pii-0d1c…", "level":"warn"}
{"msg":"[Worker] Failed to create alert for secretary failure", "error":"Failed query: insert into \"alerts\" … params: …,Action: respond, Erro: falha com pii-0d1c…", "level":"error"}
{"msg":"[Worker] Successfully processed event", ...}
```

**C — efeito de handoff impossível:** o worker cria o alerta com `type: 'handoff'`, que **não existe** no enum
`alert_type` (0002: `message|deadline|assignment|system`). O alerta de handoff **nunca** pôde ser criado — o
`Err` era mascarado pelo ACK de B.

```json
"C_handoff_enum_invalido": { "isErr": true, "error": "Failed query: insert into \"alerts\" …", "alertsCreated": 0, "defect": true }
```

**Veredito do script:** `DEFECT_REPRODUCED`.

---

## 2. Delta

| Arquivo | Linhas | Mudança |
|---|---:|---|
| `packages/database/supabase/migrations/0026_worker_effect_receipts.sql` (novo) | 28 | Tabela `worker_effect_receipts` com UNIQUE `(event_id, consumer_id, effect_type)` + índice; `ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'handoff'` (aditivo). Expand-only; 0001–0025 intocados. |
| `packages/database/supabase/migrations/meta/_journal.json` | +7 | Entrada `0026_worker_effect_receipts` (idx 26). |
| `packages/database/src/schema.ts` | +21 | `workerEffectReceipts` (l.531) e `handoff` no `alertTypeEnum` (l.134). |
| `modules/alerts/src/infrastructure/repositories/alert.repository.ts` | +6 | `create`/`findById`/`addEvent` aceitam `DatabaseExecutor` (transação). |
| `modules/alerts/src/application/use-cases/create-alert.use-case.ts` | 78→199 | `createAlert(input, { idempotency })`; caminho transacional `createAlertIdempotent` (l.122): recibo `ON CONFLICT DO NOTHING` → alerta + `alert_events` + auditoria no MESMO `tx` → `result_ref`; replay retorna o alerta ancorado com `deduplicated: true`. Backward compatible (2º parâmetro opcional). |
| `packages/events/src/outbox-lease.ts` | +33 | `ClaimInput.eventTypes` filtra candidatos (l.184) — contrato explícito de tipos; `NackInput.errorCode/permanent` (l.56-61); `nack` (l.304+) força `retry_count = maxRetries` e DLQ imediata quando permanente; DLQ passa a gravar o **envelope íntegro** + `error_code` da causa (antes: payload cru). |
| `packages/events/src/outbox-reader.ts` | +22 | `eventTypes` em options/claim e passthrough de `errorCode/permanent` no `nack`. |
| `apps/message-worker/src/index.ts` | 405→210 | Composition root: reader com catálogo de tipos, retry config por env, processador injetado, hook `WORKER_FAULT_AFTER_EFFECT=crash` (prova de crash), log do erro redigido; `workerReader.acknowledge(owner+generation)`/`nack`. |
| `apps/message-worker/src/contract.ts` (novo) | 36 | Catálogo `WORKER_EVENT_CONTRACT` (tipos + versão máxima), `consoleWorkerLogger`. |
| `apps/message-worker/src/errors.ts` (novo) | 61 | `PermanentEventError` (`permanent=true` + `errorCode`), `classifyHandlerError` (4xx ⇒ permanente), `describeError` (inclui `cause` do driver), `redactErrorForLog` (remove `params:` do log). |
| `apps/message-worker/src/handlers.ts` (novo) | 177 | Handlers reais com validação de payload → `MALFORMED_PAYLOAD` permanente; efeito via `createAlert(..., { idempotency: { eventId, consumerId, effectType } })`; `Err` é **lançado** (`classifyHandlerError`), nunca engolido; logs sem conteúdo do payload. |
| `apps/message-worker/src/processor.ts` (novo) | 255 | Processador com retry/backoff em processo (orçamento único com o lease), falha permanente ⇒ DLQ imediata, observação do resultado do ACK/NACK (`acked/stale/retry/dead-letter`), mirror de DLQ e hook pós-efeito. |
| `apps/message-worker/src/dead-letter.ts` | 66→55 | Removido o `void persist().catch(...)` que engolia falha de persistência (a durabilidade é transacional no `nack`); erro do espelho em memória redigido. |
| `apps/message-worker/src/__tests__/worker-structure.test.ts` | atualizado | Estrutura nova (catálogo, idempotência, ACK observado). |
| `apps/desk-api/src/__tests__/production/prod-09.test.ts` (novo) | 1180 | 13 testes PG+Redis reais (AC1–AC4), com crash de processo real. |
| `docs/producao-2026-09-13/evidencias/prod-09/**` (novo) | — | este relatório, `repro-antes.ts`/`.json`, `repro-depois.ts`/`.json`, logs e summaries. |

Nenhum `TODO`/`skip`/`.only` foi introduzido (verificado por grep).

---

## 3. Aceites com prova

Suíte final: `logs/vitest-prod-09-verif1.log` e `logs/vitest-prod-09-verif2.log` — **13/13 em duas rodadas
consecutivas**, exit 0; casos em `prod-09-evidence.json` (run `prod09-verif2`). Contraprova em `logs/repro-depois.log`
(veredito `NO_DEFECT_OBSERVED`).

### AC1 — efeito idempotente por (eventId, consumer, efeito) + dedup transacional

| Caso | Prova | Resultado |
|---|---|---|
| AC1a replay sequencial | 2ª aplicação retorna o MESMO `alertId` com `deduplicated: true`; `worker_effect_receipts=1`, `alerts=1`, `alert_events=1` | PASS |
| AC1b concorrência | 5 chamadas simultâneas: 1 `deduplicated:false` + 4 `true`, 1 id distinto, 1 recibo, 1 alerta | PASS |
| AC1c granularidade | mesmo evento com 2 `effectType` + mesmo efeito em outro consumer ⇒ 3 recibos/alerta independentes | PASS |
| AC1d crash simulado (efeito commitado, sem ACK) + reclaim | `gen 1` aplica sem ACK; lease expira; `gen 2` reprocessa ⇒ `deduplicated:true`, exatamente 1 alerta/1 histórico | PASS |

### AC2 — falha propaga; orçamento/backoff; DLQ durável com causa

| Caso | Prova | Resultado |
|---|---|---|
| AC2a transitória | `Err` do efeito ⇒ outcome `retry`, `processed_at NULL`, `retry_count=1`, `last_error` com a causa real; **sem** log de sucesso; após a dependência voltar ⇒ `acked`, 1 alerta | PASS |
| AC2b orçamento esgotado | 2 claims com falha ⇒ `retry` e depois `dead-letter`; `retry_count=2`, DLQ `PENDING`, `error_code=RETRY_BUDGET_EXHAUSTED`, envelope íntegro (`event_id`, `event_type`, `occurred_at`, `correlation_id`, payload), evento deixa de ser reclamável, 0 alertas | PASS |
| AC2c poison/malformed | `reason` não-string ⇒ DLQ **imediata** `MALFORMED_PAYLOAD` (retry_count=3=max), mensagem sem ecoar o valor inválido, envelope preserva o payload original | PASS |
| AC2d versão não suportada | `event_version=2` ⇒ DLQ `UNSUPPORTED_EVENT_VERSION` com envelope `event_version=2` | PASS |
| AC2e contrato de tipos | evento `conversation.created` **não** é claimado nem ACKado pelo worker; permanece pendente para o consumidor dono | PASS |
| AC2f nada engole | `catch` do processador só registra o erro e delega ao lease; `recordWorkerDeadLetter` não persiste mais com `catch` silencioso (a DLQ é transacional no `nack`) | PASS (AC2a/b/c) |

### AC3 — crash/retomada com PG real e fencing stale

| Caso | Prova | Resultado |
|---|---|---|
| AC3a stale ACK | claim A (`gen 1`), expira, claim B (`gen 2`); A aplica o efeito e recebe `stale` (não marca `processed_at`, não relata sucesso); B deduplica e `acked`; 1 alerta lógico | PASS |
| AC3b crash real de processo | worker #1 (`WORKER_FAULT_AFTER_EFFECT=crash`) encerra com **exit 86** logo após o efeito e antes do ACK: `processed_at NULL`, receipt=1, alerta=1; lease expirado; worker #2 reclamado (`gen 2`) conclui: `acked`, `effect_status=deduplicated`, `recovered=true`, receipt=1, alerta=1, `alert_events=1` | PASS |

Log integral dos dois processos em `logs/worker-prod-09-process.log`.

### AC4 — retry × dead-letter × recuperação; logs com eventId/correlation e sem PII

| Caso | Prova | Resultado |
|---|---|---|
| AC4a logs | registros de processamento/sucesso com `event_id`, `correlation_id`, `effect_type`, `ack_result`; nenhum log contém o marcador PII nem `errorMessage`; falhas têm `error` redigido (corte em `params:`) e a causa completa fica no registro durável | PASS |
| AC4b estados | retry (`retry_count≥1`, `processed_at NULL`, `last_error`), dead-letter (`PENDING`, `error_code`, `attempt_count`) e recuperação (`claimForReplay` `REPLAYING` → `markReplayed` `RESOLVED`, `replayCount=1`, `resolutionReason=replayed`, payload imutável) distinguíveis | PASS |
| PII no processo real | stdout do worker #2 (crash/retomada) sem o marcador de conteúdo | PASS |

---

## 4. Comandos e exit codes

Todos via runner isolado (`PG`/`Redis` próprios; teardown por runId). Os logs e `runner-summary-*.json` estão em
`logs/`.

```bash
# Repro ANTES (código anterior) — exit 0; veredito DEFECT_REPRODUCED
node scripts/production/run-integration-isolated.mjs --run-id prod09-repro2 --worker 23 \
  -- pnpm exec tsx docs/producao-2026-09-13/evidencias/prod-09/repro-antes.ts

# Suíte AC (2 rodadas consecutivas) — exit 0; 13/13 PASS
node scripts/production/run-integration-isolated.mjs --run-id prod09-verif1 --worker 22 \
  -- pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-09.test.ts
node scripts/production/run-integration-isolated.mjs --run-id prod09-verif2 --worker 22 \
  -- pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-09.test.ts

# Contraprova DEPOIS — exit 0; veredito NO_DEFECT_OBSERVED (A/B/C)
node scripts/production/run-integration-isolated.mjs --run-id prod09-contra2 --worker 27 \
  -- pnpm exec tsx docs/producao-2026-09-13/evidencias/prod-09/repro-depois.ts

# Regressão worker — exit 0; 13/13 PASS
node scripts/production/run-integration-isolated.mjs --run-id prod09-verif-worker --worker 22 \
  -- pnpm --filter @cvg/message-worker test

# Regressão events — exit 1 POR FALHAS PRÉ-EXISTENTES (ver §5); 155 passed, 1 failed, 13 skipped
node scripts/production/run-integration-isolated.mjs --run-id prod09-regressao-events2 --worker 26 \
  -- pnpm --filter @cvg/events test

# Estático nos pacotes tocados — exit 0 (o arquivo novo do PROD-09 também passa
# `eslint src/__tests__/production/prod-09.test.ts` isolado; ver §5 para o lint
# global do desk-api, que está vermelho por arquivo de outra frente)
pnpm --filter @cvg/database typecheck && pnpm --filter @cvg/events typecheck \
  && pnpm --filter @cvg/alerts typecheck && pnpm --filter @cvg/message-worker typecheck \
  && pnpm --filter @cvg/desk-api typecheck
pnpm --filter @cvg/message-worker lint && pnpm --filter @cvg/alerts lint \
  && pnpm --filter @cvg/events lint && pnpm --filter @cvg/database lint
pnpm --filter @cvg/desk-api exec eslint src/__tests__/production/prod-09.test.ts
```

---

## 5. Riscos e limitações (honestos)

1. **Janela efeito→ACK** (o risco central do cartão): fechada para os efeitos do worker porque o recibo
   `(event_id, consumer_id, effect_type)` e o efeito commitam na MESMA transação e o replay retorna o efeito
   ancorado. Vale para efeitos que passem por esse port; um efeito externo não transacional (e-mail/push) exigiria
   outbox própria por efeito — não há e-mail de alerta no caminho do worker hoje.
2. **Replay administrativo da DLQ cria novo `event_id`** (`-replay-N`) por contrato existente; para efeitos de
   alerta isso produz um NOVO alerta (reprocessamento administrativo deliberado), diferente do replay do MESMO
   evento, que deduplica. Registrado para não confundir com duplicata.
3. **Retenção dos recibos**: `worker_effect_receipts` cresce 1 linha por evento+efeito; não há TTL/purge nesta
   tarefa (BE12/PROD-26 pode adicionar retenção). Volume é baixo (1 linha por evento com efeito) e o índice é
   enxuto.
4. **Retry em processo segura o lease enquanto dorme** (backoff default 1s/2s/4s, teto 30s < lease 120s). Se o
   orçamento/lease forem reduzidos a ponto de o backoff superar o lease, outro worker reclama geração; o ACK do
   antigo vira `stale` e o efeito já aplicado é deduplicado. Comportamento coberto por AC3a/AC3b.
5. **Falha permanente marca o evento como esgotado** (`retry_count = maxRetries`) sem `processed_at`; recuperar
   exige corrigir a causa e reenviar/replay administrativo (novo `event_id`). É o comportamento desejado para
   poison, mas operadores precisam conhecer o caminho da DLQ (admin).
6. **Sem endpoint de métricas Prometheus no worker** (C09/PROD-31/32): a decisão é observável por log estruturado +
   `outbox_consumer_acks` + `dead_letter_events`. Não há contadores exportados.
7. **Redis real, mas fora do caminho do worker**: cada run provisiona PostgreSQL **e** Redis e a suíte faz um
   `PING` real no Redis isolado (harness ok). O efeito/lease/DLQ do worker é PostgreSQL puro; quem usa Redis é o
   realtime (fora da fronteira desta tarefa, coberto por PROD-12).
8. **Falhas pré-existentes na regressão de events** (não causadas por este delta):
   - `persistent-dead-letter.test.ts` — `FK dead_letter_events_resolved_by_fkey` (introduzida pela migration 0023,
     de outra frente) contra UUID aleatório do teste: `Key (resolved_by)=… is not present in table "users"` (23503).
     PROD-09 não toca `persistent-dead-letter.ts` nem esse teste.
   - `aaa-07-lease-real.test.ts` — suíte dedicada com banco/porta fixos (`127.0.0.1:56432`,
     `cvg_aaa_aaa_20260912_a7`); excluída do `test:ci`, não roda sob outro runId.
9. **Lint global do desk-api está vermelho por arquivo de outra frente**: `prod-14.test.ts` (untracked, PROD-14)
   tem 3 erros de eslint (`no-unused-vars`/`no-useless-assignment`). O arquivo desta tarefa passa lint isolado
   (`eslint src/__tests__/production/prod-09.test.ts` exit 0) e os demais pacotes tocados passam com os limites
   vigentes.
10. **`ALTER TYPE ... ADD VALUE` é irreversível** (rollback = roll-forward); o valor é aditivo e nenhum consumidor
    antigo quebra.

---

## 6. Recuperação

- **Crash entre efeito e ACK**: o lease expira e outro worker (ou o mesmo no restart) reclama `generation+1`; o
  replay encontra o recibo e conclui sem novo efeito. Para acelerar manualmente no incidente:
  `UPDATE outbox_consumer_acks SET lease_until = now() - interval '1 second' WHERE event_id = '<id>' AND consumer_id = 'worker';`
  (foi exatamente o que AC3b fez).
- **Retry pendente** (`processed_at NULL`, `0 < retry_count < maxRetries`): o poller reclama sozinho; o ACK
  reseta `retry_count`. Nenhuma ação manual necessária.
- **DLQ durável**: `dead_letter_events` com envelope íntegro e `error_code`. Reprocessar por
  `POST /dead-letter/:id/replay` (admin:write; claim `PENDING→REPLAYING`, `RESOLVED` com `replay_count`), ou
  `persistentDeadLetterStore.claimForReplay/markReplayed`. Falha no replay volta para `PENDING` com motivo.
- **Poison corrigido**: após o fix, replay administrativo gera novo `event_id` e o efeito é aplicado uma vez para
  esse novo evento; entradas podem ser `RESOLVED`/`DISCARDED` com justificativa auditada.
- **Teardown**: apenas por `runId` no runner isolado; nunca apagar banco pré-existente.

## 7. Rollback

1. Código: reverter os arquivos do delta (§2) — os pontos de entrada antigos continuam válidos (o 2º parâmetro de
   `createAlert` é opcional e `nack` sem `permanent/errorCode` mantém a semântica anterior, exceto o payload da DLQ,
   agora envelope).
2. Schema: `DROP TABLE IF EXISTS worker_effect_receipts;` (remove índices juntos). O valor `handoff` do enum é
   aditivo e não pode ser removido; mantê-lo é inócuo.
3. Dados: nenhuma linha existente foi alterada; a 0026 é expand-only.

## 8. Contraprova (pós-delta)

`repro-depois.ts` (mesmos cenários contra o código corrigido):

```json
{
  "A_replay_com_dedup": { "alertsCreated": 1, "secondDeduplicated": true, "defect": false },
  "B_err_persistente_dlq": { "dlqArrived": true, "processedAtSet": false, "consumerRetryCount": 2,
                             "dlqErrorCode": "RETRY_BUDGET_EXHAUSTED", "envelopeEventIdMatches": true,
                             "alertsCreated": 0, "defect": false },
  "C_handoff_valido": { "isOk": true, "alertsCreated": 1, "defect": false },
  "verdict": "NO_DEFECT_OBSERVED"
}
```

Os logs do cenário B mostram o erro redigido (`…` antes de `params:`), enquanto a DLQ durável mantém a causa
completa (mensagem do trigger + `error_code`).

**Sem skip/TODO.** O fechamento DONE depende do integrador conferir identidade do candidato, revisão e os aceites
acima.
