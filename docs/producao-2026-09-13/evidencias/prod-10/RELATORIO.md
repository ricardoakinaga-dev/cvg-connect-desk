# PROD-10 — Relatório de execução

**Cartão:** PROD-10 — Mover Secretary para execução durável assíncrona (AC1–AC4)
**Itens auditados:** BE13 · BE14 · BE01 · BE09/BE11 · **Contratos:** C04/C05/C08 · **Gates:** G03/G05
**Estado do cartão:** IMPLEMENTED (não DONE)
**Decisões:** D05 OPEN — o avanço implementado é o permitido sem ratificação (deny-default/budget preservados; nenhuma ferramenta habilitada).

**Nota de revalidação R2:** as tabelas e logs históricos deste relatório foram
produzidos antes do endurecimento da fronteira `unknown`. A versão atual do
worktree mantém `unknown` terminal até reconciliação explícita, propaga um
`invocationId` estável como `Idempotency-Key`/`invocation_id` e reconhece
falhas ambíguas sem reabrir a invocação. A prova atual está registrada em
`../R2-REVALIDACAO-2026-09-13.md`; os artefatos históricos abaixo não foram
reescritos.

**Candidato:** HEAD `754f9badac46278e77d21de91c58eedb15e80581` + worktree (delta **não commitado**). Fronteiras respeitadas:
`packages/auth`, mídia, contact-groups, `conversation.repository.ts` e `realtime-bus.ts` **não** foram editados. Arquivos
compartilhados com outras frentes no worktree (ex.: `receive-inbound-message.use-case.ts` já vinha com o pipeline de mídia
do PROD-14) tiveram **apenas os hunks do PROD-10** alterados — ver §7 (rollback) para a advertência de reversão.

Ambiente de prova (harness AAA, nunca o banco do host): PostgreSQL 16 + Redis isolados por run (`marker.runId` conferido,
`cvg_aaa_*`), migrate+seed reais e teardown `stopServices+dropDatabase` por runId.

| Run | Worker | PostgreSQL | Banco | Redis | Exit |
|---|---|---:|---|---:|---:|
| `prod10-repro` (repro antes) | 24 | 127.0.0.1:58832 | `cvg_aaa_prod10_repro_w24` | 56920 | 0 |
| `prod10-verif3/4/5` (suíte AC, 3 rodadas finais) | 24 | 127.0.0.1:58832 | `cvg_aaa_prod10_verif{3,4,5}_w24` | 56920 | 0 / 0 / 0 |
| `prod10-contra2` (contraprova pós-delta) | 33 | 127.0.0.1:59732 | `cvg_aaa_prod10_contra2_w33` | 57010 | 0 |
| `prod10-reg-worker` (regressão worker) | 25 | 127.0.0.1:58932 | `cvg_aaa_prod10_reg_worker_w25` | 56930 | 0 |
| `prod10-reg-secretary` (regressão secretary) | 26 | 127.0.0.1:59032 | `cvg_aaa_prod10_reg_secretary_w26` | 56940 | 0 |
| `prod10-reg-chat2` (regressão chat, mesmo exclude do `test:ci`) | 28 | 127.0.0.1:59232 | `cvg_aaa_prod10_reg_chat2_w28` | 56960 | 0 |
| `prod10-reg-webhook` (webhook+resilience) | 29 | 127.0.0.1:59332 | `cvg_aaa_prod10_reg_webhook_w29` | 56970 | 0 |
| `prod10-reg-prod09` (regressão cruzada PROD-09) | 31 | 127.0.0.1:59532 | `cvg_aaa_prod10_reg_prod09_w31` | 56990 | 0 |
| `prod10-dbcheck` (migração fresh) | 30 | 127.0.0.1:59432 | `cvg_aaa_prod10_dbcheck_w30` | 56980 | 0 |

Rodadas de desenvolvimento **falhas** mantidas no histórico (`integration-runs/prod10-verif1` 0/7 e `prod10-verif2`
2/7) e corrigidas: (a) comparação de timestamp truncada em ms no predicado de "superseded"; (b) status `failed` em vez
de `unknown` para timeout; (c) `tsx` lança um processo Node filho — o kill do wrapper não matava o neto e workers órfãos
reclamavam eventos dos testes seguintes (corrigido com `detached` + kill de process group). Nenhuma delas foi mascarada
por skip.

---

## 1. Problema reproduzido (antes do delta)

Script `repro-antes.ts` usa o **código real** de `receiveInboundMessage` e do handler `message.persisted` do worker
contra PG isolado + sandbox HTTP da Secretary. Saída integral em `logs/repro-antes-runner.log` / `repro-antes.json`.

```json
{
  "A_webhook_sincrono": { "isOk": true, "elapsedMs": 3364, "secretaryDelayMs": 3000,
                          "gatewaySends": 1, "outboundReplies": 1, "defect": true },
  "B_duplicata_nao_recupera_invocacao": { "firstSecretaryCalls": 1, "duplicateSecretaryCalls": 0,
                          "persistedMessages": 1, "outboundRepliesForB": 0, "defect": true },
  "C_worker_apenas_loga": { "handlerReturn": null, "invocationStateRows": 0, "defect": true },
  "verdict": "DEFECT_REPRODUCED"
}
```

- **A — webhook síncrono:** com a IA levando 3s, o retorno do `receiveInboundMessage` levou 3364ms; a resposta outbound
  só existiu porque o próprio webhook a enviou.
- **B — duplicata retorna antes da IA:** a 1ª chamada persistiu a mensagem e falhou na IA; o reenvio do mesmo
  `messageId` retornou 200 com **0 chamadas** à Secretary e **0 respostas** — invocação permanentemente perdida.
- **C — worker apenas loga:** o handler real de `message.persisted` retorna `null` (nenhum efeito durável); um crash
  após o commit perde a invocação para sempre.

---

## 2. Delta (arquivos + linhas desta tarefa)

| Arquivo | Linhas | Mudança |
|---|---:|---|
| `packages/database/supabase/migrations/0027_secretary_invocations.sql` (novo) | 46 | Tabela `secretary_invocations` (estado `pending/processing/completed/failed/unknown`, `invocation_key` único, `attempt_count`, `error_code`, `result_ref`, `detail`) + 3 índices/constraint. Expand-only; 0001–0026 intocados. |
| `packages/database/supabase/migrations/meta/_journal.json` | +7 | Entrada `0027_secretary_invocations` (idx 27). |
| `packages/database/src/schema.ts` | +29 | `secretaryInvocations` (comentário + tabela). |
| `modules/secretary-adapter/src/infrastructure/repositories/secretary-invocation.repository.ts` (novo) | 211 | Padrão de recibo do PROD-09 para a invocação: `begin` (INSERT ON CONFLICT + `FOR UPDATE` → `processing`; `completed` ⇒ dedup), `complete`, `fail` (com `ambiguous` ⇒ `unknown`), `markUnknown`, `find`. |
| `modules/secretary-adapter/src/infrastructure/secretary-client-init.ts` (novo) | 25 | `initializeSecretaryFromEnv()` para processos de trabalho; ausência de config vira falha observável (DLQ), nunca silêncio. |
| `modules/secretary-adapter/src/infrastructure/index.ts` | +2 | Exporta os dois módulos novos. |
| `modules/secretary-adapter/src/application/use-cases/invoke-secretary.use-case.ts` | +9/−1 | `invocationId` opcional estável (replay reusa o id; ausente mantém o id sintético anterior). |
| `modules/chat/src/application/use-cases/execute-inbound-secretary.use-case.ts` (novo) | 345 | Orquestração assíncrona: carrega mensagem/conversa do DB (texto humano é a fonte), dedup por invocação, gates de handoff/superseded, IA, envio pelo caminho C05 (`secretary-reply:<externalMessageId>`), estado/causa, `unknown` para resultado ambíguo, erro relançado para retry/DLQ. |
| `modules/chat/src/application/use-cases/receive-inbound-message.use-case.ts` | −59/+6 | Removido o bloco síncrono de Secretary (IA, handoff, outbound e catch que engolia erro); fica só o comentário-contrato. Persistência/auditoria/mídia intactas. |
| `modules/chat/src/application/use-cases/process-message-with-secretary.use-case.ts` | +11/−8 | `Err` da IA **propaga** (não vira `ok` engolido); `invocationId` repassado. |
| `modules/chat/src/application/use-cases/index.ts` | +1 | Exporta o use case novo. |
| `apps/message-worker/src/handlers.ts` | +45/−5 | `handleMessagePersisted` inbound chama a invocação durável (evento `message.persisted` é a intenção commitada com o inbound); outbound segue observabilidade; relatório `secretary:invoke`; logs só com ids. |
| `apps/message-worker/src/errors.ts` | +14 | Reconhece erro de domínio com `permanent:true`+`errorCode` (DLQ imediata para `MESSAGE_NOT_FOUND`/`OUTBOUND_REJECTED` etc.). |
| `apps/message-worker/src/processor.ts` | +7 | `onBeforeEffect` (prova de crash entre commit e invocação). |
| `apps/message-worker/src/index.ts` | +35 | Composição: `setGatewayOutboundPort(gatewayService)` (mesmo transporte C05, sem caminho paralelo), `initializeSecretaryFromEnv`, fault `WORKER_FAULT_BEFORE_EFFECT=crash`. |
| `apps/message-worker/tsconfig.json` | +4/−1 | Inclui as augmentations `.d.ts` de `@cvg/chat`/`@cvg/gateway-adapter` no typecheck do worker. |
| `apps/message-worker/package.json` + `pnpm-lock.yaml` | +3 deps / +6 | `@cvg/chat`, `@cvg/gateway-adapter`, `@cvg/secretary-adapter` (workspace links; `pnpm install --offline --frozen-lockfile` exit 0). |
| `modules/chat/src/__tests__/secretary-handoff.integration.test.ts` | +70/−48 | Os 2 testes de `receiveInboundMessage` passam a aferir o contrato novo (sem IA síncrona; intenção durável presente); testes de `processMessageWithSecretary` inalterados. |
| `apps/desk-api/src/__tests__/production/prod-10.test.ts` (novo) | 1079 | 7 casos PG+Redis reais (webhook HTTP HMAC, worker real, sandboxes Secretary/Gateway, crash real de processo). |
| `docs/producao-2026-09-13/evidencias/prod-10/**` (novo) | — | este relatório, `repro-antes.ts`/`.json`, `repro-depois.ts`/`.json`, `prod-10-evidence.json`, `logs/`. |

Nenhum `TODO`/`skip`/`.only` introduzido (verificado por grep). Eventos versionados inalterados: nenhum tipo novo no
outbox; o envelope `message.persisted` v1 continua sendo o contrato C04.

---

## 3. Aceites com prova

Suíte final: `logs/vitest-prod-10-verif5.log` + `prod-10-evidence.json` (run `prod10-verif5`) — **7/7 PASS, exit 0**,
reproduzida em 3 rodadas (`verif3/4/5`). Contraprova `NO_DEFECT_OBSERVED` em `logs/repro-depois-runner.log`.

### AC1 — webhook confirma só recibo; intenção durável comita junto; worker processa sob lease

| Caso | Prova (run `prod10-verif5`) | Resultado |
|---|---|---|
| Webhook não espera a IA | Secretary lenta (3s): webhook respondeu em **45ms**, `completed` da IA = 0 no retorno | PASS |
| Intenção durável no mesmo commit | `message.persisted` existe no outbox com `event_id` = evento reclamado pelo worker (`duringRow.event_id === outboxEvent.event_id`); mensagem e evento commitados em `persistInboundAtomically` | PASS |
| Worker processa sob lease e conclui | invocação observada em `processing` (attempt 1) → `completed`; 1 resposta outbound; `outbox_consumer_acks.processed_at` preenchido; gateway = 1 request | PASS |
| Crash antes da invocação retoma | worker #1 com `WORKER_FAULT_BEFORE_EFFECT=crash` encerrou **exit 86**: mensagem persistida, 0 invocações, 0 chamadas à IA, evento **não ACKado**; worker #2 reclamou (lease expirado) e concluiu com **1** resposta | PASS |

### AC2 — idempotência por evento/efeito; crash/duplicata não duplica resposta; estado registrado

| Caso | Prova | Resultado |
|---|---|---|
| Replay pós-efeito sem ACK | handler aplicado sem ACK (`processed_at NULL`, 1 resposta, 1 chamada de IA); reclaim `generation 2` → `deduplicated: true`, **1** invocação, **1** resposta, IA **não** reexecutada | PASS |
| Duplicata inbound | 2 webhooks (event ids distintos, mesmo `messageId`): 1 mensagem, **1** evento `message.persisted`, invocação executada **1×**, **1** resposta | PASS |
| Estado da invocação | `pending`→`processing`→`completed` observados; falha registra `failed`/`unknown` + `error_code` + `last_error` (AC3 abaixo); `attempt_count` incrementa por tentativa | PASS |
| Recibo do PROD-09 reutilizado | chave única + `ON CONFLICT` + transição atômica no mesmo padrão de `worker_effect_receipts`; resposta ao contato deduplicada pelo recibo C05 (`outbound_deliveries.client_key=secretary-reply:<externalMessageId>` = 1) | PASS |
| Reconcilição externa = `unknown` | timeout/5xx da Secretary grava `unknown` + `SECRETARY_TIMEOUT`; outbound ambíguo grava `unknown` + `OUTBOUND_UNKNOWN` (sem reenvio cego — a intenção C05 fica retida) | PASS |

### AC3 — degradação preserva o humano; retry limitado; DLQ com causa; handoff/estado antigo cancelam resposta tardia (histórico)

| Caso | Prova | Resultado |
|---|---|---|
| Timeout/retry limitado | `SECRETARY_TIMEOUT_MS=300`: 4 tentativas de handler (2 claims × 2), **8** chamadas HTTP com retry interno do cliente — teto determinístico, nenhum loop | PASS |
| DLQ durável com causa | `dead_letter_events.error_code=RETRY_BUDGET_EXHAUSTED`, `error_message` com timeout, envelope íntegro (`event_id`/`event_type` do `message.persisted`) | PASS |
| Inbound preservado | mensagem com o conteúdo original intacto mesmo com a IA fora; 0 outbound | PASS |
| Handoff humano cancela resposta tardia | IA pede handoff → `current_handler=human` + `handoff.completed`; nova mensagem na conversa humana é **skipped** (`handler_not_bot`) **sem** chamar a IA | PASS |
| Estado antigo (superseded) | 2 inbounds; msg1 processada depois de msg2 → `skipped: superseded_by_newer_inbound` **sem** IA; msg2 gera a única resposta | PASS |

### AC4 — texto humano sem IA; outbound idempotente C05; logs sem PII; contrato preservado

| Caso | Prova | Resultado |
|---|---|---|
| Texto humano persiste sem IA | conteúdo exato no banco após DLQ da IA; `message.direction=inbound`; nenhum log contém o conteúdo | PASS |
| Resposta usa o caminho C05 | `outbound_deliveries` com a chave `secretary-reply:<externalMessageId>`, 1 mapping, entrega pelo `gatewayService` real (sandbox HTTP) — sem transporte paralelo | PASS |
| Sem PII em log | stdout real do worker com `event_id` presente e **sem** marcador de conteúdo nem telefone (`logHasEventIdOnly: true`) | PASS |
| Contratos/versionamento | sandbox real do contrato `/invoke` da Secretary e `/webhooks/desk` do Gateway; nenhum evento novo/reescrito (envelope v1 preservado); testes de consumidor real em `prod-10.test.ts` | PASS |

---

## 4. Comandos e exit codes

Todos via runner isolado (`PG`/`Redis` próprios; teardown por runId). Logs e `runner-summary.json` copiados em
`docs/producao-2026-09-13/evidencias/prod-10/logs/` (e originais em `evidencias/integration-runs/<run>/`).

```bash
# Repro ANTES — exit 0; veredito DEFECT_REPRODUCED (A/B/C)
node scripts/production/run-integration-isolated.mjs --run-id prod10-repro --worker 24 \
  -- pnpm exec tsx docs/producao-2026-09-13/evidencias/prod-10/repro-antes.ts

# Suíte AC (3 rodadas finais) — exit 0; 7/7 PASS em cada
node scripts/production/run-integration-isolated.mjs --run-id prod10-verif3 --worker 24 \
  -- pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-10.test.ts
node scripts/production/run-integration-isolated.mjs --run-id prod10-verif4 --worker 24 -- pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-10.test.ts
node scripts/production/run-integration-isolated.mjs --run-id prod10-verif5 --worker 24 -- pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-10.test.ts

# Contraprova DEPOIS — exit 0; veredito NO_DEFECT_OBSERVED (A/B/C)
node scripts/production/run-integration-isolated.mjs --run-id prod10-contra2 --worker 33 \
  -- pnpm exec tsx docs/producao-2026-09-13/evidencias/prod-10/repro-depois.ts

# Regressões — todas exit 0
node scripts/production/run-integration-isolated.mjs --run-id prod10-reg-worker --worker 25 -- pnpm --filter @cvg/message-worker test            # 13/13
node scripts/production/run-integration-isolated.mjs --run-id prod10-reg-secretary --worker 26 -- pnpm --filter @cvg/secretary-adapter test     # 38/38
node scripts/production/run-integration-isolated.mjs --run-id prod10-reg-chat2 --worker 28 -- pnpm --filter @cvg/chat exec vitest run --exclude '**/aaa-08-atomicity.test.ts'  # 34/34
node scripts/production/run-integration-isolated.mjs --run-id prod10-reg-webhook --worker 29 -- pnpm --filter @cvg/desk-api exec vitest run src/__tests__/webhook-inbound.integration.test.ts src/__tests__/resilience.integration.test.ts  # 13/13
node scripts/production/run-integration-isolated.mjs --run-id prod10-reg-prod09 --worker 31 -- pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-09.test.ts  # 13/13
node scripts/production/run-integration-isolated.mjs --run-id prod10-dbcheck --worker 30 -- pnpm --filter @cvg/database db:check                   # OK: 41 tabelas fresh

# Estático (exit 0)
pnpm --filter @cvg/database typecheck && pnpm --filter @cvg/secretary-adapter typecheck \
  && pnpm --filter @cvg/chat typecheck && pnpm --filter @cvg/message-worker typecheck \
  && pnpm --filter @cvg/desk-api typecheck
pnpm --filter @cvg/message-worker lint && pnpm --filter @cvg/secretary-adapter lint \
  && pnpm --filter @cvg/database lint && pnpm --filter @cvg/chat lint
pnpm --filter @cvg/desk-api exec eslint src/__tests__/production/prod-10.test.ts
```

---

## 5. Riscos e limitações (honestos)

1. **A intenção durável é o `message.persisted` do inbound** (commitado na mesma transação da mensagem em
   `persistInboundAtomically`), não um evento novo `secretary.invoke.requested`. Foi a forma de fechar a janela
   "commit do inbound → invocação" sem uma segunda escrita pós-commit e sem editar a infraestrutura transacional (fora
   do escopo permitido). A semântica do evento v1 é preservada e o handler passa a ter efeito real. Um evento dedicado
   exigiria escrevê-lo **dentro** de `persistInboundAtomically` (mudança de contrato C04 com ambos os lados); trilha de
   evolução registrada, não necessária para os aceites.
2. **Chamada externa à IA continua dependente do contrato do provider**: timeout/5xx pode gerar mais de uma tentativa de
   transporte, mas todas usam a mesma chave estável; o worker não reabre `unknown`. O visível ao contato não duplica
   (recibo C05). Exatamente-uma-vez exige que o provider honre `Idempotency-Key`/`invocation_id` ou reconciliação explícita.
3. **Respostas "superseded"**: se uma mensagem mais nova existe, a invocação antiga é cancelada. Se a invocação da
   mensagem mais nova falhar permanentemente, o contato pode ficar sem resposta automática — comportamento preferido ao
   envio tardio/fora de ordem; o operador vê a DLQ.
4. **Alertas de falha da Secretary continuam 1 por tentativa publicada** (`secretary.invocation` failed por attempt),
   via handler do PROD-09. É observabilidade, não reenvio; volume baixo, mas sem dedup por invocação lógica.
5. **Retenção de `secretary_invocations`**: 1 linha por mensagem invocada, sem TTL/purge nesta tarefa (mesmo limite dos
   recibos do PROD-09; BE12/PROD-26 pode adicionar retenção).
6. **`SECRETARY_MAX_RETRIES=0` agora é respeitado**: o parser aceita inteiros `>= 0`; o default permanece 2. Retries
   de respostas potencialmente ambíguas só ocorrem quando há `invocationId` estável.
7. **Regressão chat com `aaa-08-atomicity.test.ts`**: a suíte fixa porta `56432` e recusa qualquer run do runner
   (`59132`) — pré-existente e já excluída do `test:ci`; a regressão do chat rodou com o mesmo exclude do CI (34/34).
8. **Lint global do desk-api continua vermelho por `prod-14.test.ts`** (outra frente); o arquivo desta tarefa passa
   `eslint` isolado (exit 0) e os pacotes tocados passam os limites vigentes.
9. **Kill de workers em teste**: `tsx` cria um processo Node filho; a suíte usa `detached` + kill do process group. Em
   produção o supervisor deve encerrar o grupo (ou usar `exec`/build), sob pena de neto órfão.
10. **Sem métricas Prometheus para a invocação** (C09/PROD-31/32): observabilidade por log estruturado (sem PII),
   `secretary_invocations`, `outbox_consumer_acks` e `dead_letter_events`.
11. **Duas rodadas de desenvolvimento falharam antes das correções** (§ topo); o veredito final não as reutiliza como
    prova.

---

## 6. Recuperação

- **Crash antes da invocação** (processo morreu com o evento reclamado): o lease expira (ou o operador força
  `UPDATE outbox_consumer_acks SET lease_until = now() - interval '1 second' WHERE event_id='<id>' AND consumer_id='worker';`)
  e o próximo worker reclama `generation+1`; `beginSecretaryInvocation` retoma a mesma invocação (`attempt_count+1`).
- **Crash depois do efeito, antes do ACK**: o replay encontra `status=completed` e não reexecuta IA/outbound; o ACK
  conclui o evento.
- **Retry pendente** (`processed_at NULL`, `retry_count < maxRetries`): poller reclama sozinho; o ACK zera o contador.
- **DLQ durável** (`dead_letter_events.error_code`): reprocessar via `POST /dead-letter/:id/replay` (cria novo
  `event_id`; a invocação usa a MESMA `invocation_key` da mensagem — `completed` deduplica e `failed` retoma). Para
  `unknown`, uma redelivery apenas reconhece o estado; a reconciliação/reabertura da resposta é decisão explícita do
  operador (C05), nunca uma chamada cega.
- **Inspeção**:
  `SELECT invocation_key,status,attempt_count,error_code,last_error,result_ref FROM secretary_invocations WHERE invocation_key='inbound:<messageId>';`
- **Teardown**: apenas por runId no runner isolado; nunca apagar banco pré-existente.

## 7. Rollback

1. **Código**: reverter *somente os hunks do PROD-10* nos arquivos do §2 — **não** usar `git checkout` nos arquivos
   compartilhados com o worktree de outras frentes (ex.: `receive-inbound-message.use-case.ts` contém o pipeline de
   mídia do PROD-14; `invoke-secretary.use-case.ts` contém ajustes de outra frente). Se necessário, restaurar o bloco
   síncrono de Secretary conforme o estado anterior (comentado no §2) e remover o export do use case novo.
2. **Schema**: `DROP TABLE IF EXISTS secretary_invocations;` (índices e constraint caem juntos). A 0027 é expand-only;
   nenhuma linha/tabela existente foi alterada.
3. **Dados/efeitos**: nenhuma linha preexistente foi modificada; eventos já processados permanecem deduplicados pelos
   recibos C05. Voltar o worker antigo faz `message.persisted` voltar a ser apenas log; eventos ainda não ACKados
   ficariam pendentes (replay administrativo se necessário).
4. **Configuração**: remover `SECRETARY_*`/`GATEWAY_*` do worker se o processo antigo não os usava; sem efeito de
   contrato.

## 8. Contraprova pós-delta

`repro-depois.ts` (mesmos cenários, código novo, worker real em processo):

```json
{
  "A_webhook_assincrono": { "isOk": true, "elapsedMs": 50, "secretaryDelayMs": 3000,
                            "asyncReplyArrived": true, "defect": false },
  "B_duplicata_recupera_via_worker": { "firstIsOk": true, "duplicateIsOk": true,
                            "persistedMessages": 1, "replyArrived": true, "defect": false },
  "C_estado_duravel_da_invocacao": { "invocationStatus": "completed", "attemptCount": 5,
                            "resultRef": "28e3f687-…", "errorCode": null, "defect": false },
  "verdict": "NO_DEFECT_OBSERVED"
}
```

**Sem skip/TODO.** O fechamento DONE depende do integrador conferir identidade do candidato, revisão e os aceites
acima; PROD-40 inspeciona independentemente.

---

## 9. Revalidação R2 do worktree

Os testes abaixo foram executados em 13/09/2026 com PostgreSQL 16 e Redis
iniciados pelo harness local, cada execução em banco/portas exclusivos. O
`CVG_PROGRAM_DIR` apontou para `/tmp/opencode/...` para não sobrescrever os
artefatos históricos desta pasta; os resultados completos dos runs ficaram em
seus diretórios de evidência.

| Prova | Resultado |
|---|---|
| PROD-07 real: `prod07-repair-20260913` | 9/9 PASS; replay concluído retorna 200 `deduplicated`; mismatch 409; erro do store 500; HMAC/timestamp 401 |
| PROD-10 real: `prod10-repair-20260913b` | 7/7 PASS; webhook assíncrono, crash/replay, `unknown` terminal, handoff e superseded |
| PROD-13 real: `prod13-repair-20260913b` | 11/11 PASS; budget, concorrência, persistência, deny-default e approval |
| `@cvg/secretary-adapter` | 51/51 PASS com PostgreSQL isolado temporário |
| `@cvg/chat` boundary tests | 5/5 PASS; `unknown`, `processing`, erro ambíguo outbound e fencing |
| Shared webhook tests | 28/28 PASS; suíte completa anterior 90/90 com coverage acima dos thresholds |

O provider usado continua sendo sandbox HTTP local; não é prova de contrato
externo. D05 e a revisão independente permanecem abertos.
