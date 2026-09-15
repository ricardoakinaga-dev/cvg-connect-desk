# PROD-07 — Relatório de execução (candidato `754f9bad`, worktree preservado)

Data: 2026-09-13 · Run isolado: `prod07-20260913`, worker 11, PostgreSQL 16.15 em
`127.0.0.1:57532` (`cvg_aaa_prod07_20260913_w11`) e Redis em `127.0.0.1:56790` (harness AAA).
Teardown ao final (`stopServices: true, dropDatabase: true`): banco do run removido e
PostgreSQL parado — nenhum comando apontou para o banco do host (5432/5543).
`marker.sourceRevision = 754f9badac46278e77d21de91c58eedb15e80581`.

Escopo de escrita respeitado: nenhum arquivo de `packages/auth`, nenhum outro
controller, nenhuma migration 0001–0023 alterada (hashes conferidos pelo PROD-06;
0024 é a única nova).

## 1. Problema reproduzido (antes do delta)

`logs/repro-antes.log` (script `repro-antes.ts`, código do candidato antes da
correção) confirma os três defeitos do cartão:

| # | Defeito | Evidência antes |
|---|---|---|
| (a) | `store.add` consumia o eventId ANTES do handler (`webhook-guard.ts:232-261`) | 1ª entrega aceita; negócio falha; retry idêntico → **409 `duplicate_event_id`** — o evento some |
| (b) | `PostgresWebhookReplayStore.add` engolia qualquer exceção e retornava `false` (`webhook-anti-replay.ts:106-117`) | banco inalcançável → `add` retornou `false` sem lançar (10 ms) — erro transitório vira "duplicado" |
| (c) | dedup só por `event_id`; `signature_hash` gravado nunca era lido | mesmo eventId com payload/assinatura diferentes → 409 duplicado; `hashB` ignorado |

Saída real do script (exit 0):

```json
{"scenario":"a — falha do negócio após HMAC válido + retry idêntico",
 "observed":{"retryMesmoEventoMesmoPayload":"status 409","retryResposta":{"reason":"duplicate_event_id"},
             "defeito":"evento recuperável recebe 409 e é perdido"}}
{"scenario":"c — mesmo eventId com payload/assinatura diferentes",
 "observed":{"payloadDiferenteMesmoEvento":"status 409","storeAddHashDiferente":false,
             "defeito":"payload diferente tratado como duplicado; hash gravado nunca é comparado"}}
{"scenario":"b — erro transitório de banco no store",
 "observed":{"addRetornou":false,"excecaoEscapou":null,
             "defeito":"erro transitório engolido e retorno false (\"duplicado\")"}}
```

## 2. Delta

| Arquivo | Mudança |
|---|---|
| `packages/database/supabase/migrations/0024_webhook_replay_claim.sql` (novo) | expand: `state TEXT NOT NULL DEFAULT 'pending'`, `payload_hash TEXT`, `completed_at TIMESTAMPTZ`, `attempts INTEGER NOT NULL DEFAULT 0` + índice `idx_webhook_replay_state`; sem remover/renomear coluna |
| `packages/database/supabase/migrations/meta/_journal.json` | entrada `idx 24 / 0024_webhook_replay_claim` |
| `packages/database/src/webhook-replay.ts` | tabela drizzle alinhada ao DDL (state/payloadHash/completedAt/attempts); `processed_at` documentado como última reivindicação |
| `packages/shared/src/webhook-anti-replay.ts` | `claim`/`complete`/`fail` na interface e nos stores InMemory/Postgres; `WebhookClaimAction`, estados, janela de stale (`WEBHOOK_REPLAY_STALE_SECONDS`, default 120s); helpers `set/getWebhookClaim`, `complete/failWebhookClaim`; erro transitório PROPAGA (só `23505` é conflito) |
| `packages/shared/src/webhook-guard.ts:232-306` | guard reivindica o recibo (`claimed_new`/`claimed_retry`), responde 409 `duplicate_event_id` / `event_payload_mismatch` / `event_in_progress` e anexa o claim ao request; HMAC, timestamp e skew 300s inalterados |
| `packages/shared/src/webhook-security-stats.ts` | novos motivos `event_payload_mismatch` e `event_in_progress` |
| `modules/chat/src/presentation/http/webhook-inbound.controller.ts:130/137` | `completeWebhookClaim` só no 2xx pós-negócio; `failWebhookClaim` best-effort em 400/`Err`/catch (mantém recibo retryável) |
| `packages/shared/src/__tests__/webhook-guard.test.ts` | replay de concluído, retry legítimo, mismatch, in-progress, propagação de erro transitório |
| `packages/shared/src/__tests__/webhook-anti-replay.test.ts` (novo) | semântica do store: claim único, fail→retry, completed→replay, mismatch, stale/attempts |
| `apps/desk-api/src/__tests__/production/prod-07.test.ts` (novo) | suíte HTTP+PG real AC1–AC4 (9 testes) |
| `docs/producao-2026-09-13/evidencias/prod-07/**` | este relatório, procedimento, script/log de reprodução, logs e JSON de evidência |

Observação de fronteira: a tabela `webhook_replay_log` é declarada em
`packages/database/src/webhook-replay.ts` (reexportada por `client.ts`/`index.ts`),
não em `schema.ts`; para não duplicar a tabela nem quebrar o confronto do PROD-06,
o DDL drizzle foi atualizado no arquivo real da tabela (lock `schema-migrations`
respeitado; `schema.ts`/`check-migrations.ts` não foram tocados por este delta).

## 3. Desenho do recibo (AC2)

- **Estados**: `pending` (reivindicado, em processamento), `failed` (falha de
  negócio conhecida, retry imediato), `completed` (negócio persistido).
  `processedAt` guarda a última reivindicação; `completedAt` o desfecho;
  `attempts` conta reivindicações. Retenção: TTL de 24 h preservado (0013).
- **Claim atômico**: `INSERT ... ON CONFLICT (event_id) DO NOTHING RETURNING`
  decide a posse; no conflito, um único `UPDATE` condicional decide retry vs
  conflito, com `attempts = attempts + 1`. Concorrentes recentes recebem
  `event_in_progress`; só um processa (caso AC2-concorrência).
- **Mismatch**: mesmo `event_id` com `payload_hash`/`signature_hash` diferentes →
  409 `event_payload_mismatch`, sem aplicar efeito.
- **Completed**: replay verdadeiro → 409 `duplicate_event_id` (escolha documentada;
  o aceite exige nenhum efeito novo — o corpo nem chega ao use-case). A resposta
  anterior (200 no primeiro processamento) permanece estável.
- **Recuperação**: `failed` reivindica na hora; `pending` além da janela de stale
  (default 120 s, configurável) é recuperado — cobre crash entre o claim e o
  commit sem enfraquecer anti-replay (timestamp de 300 s continua obrigatório).
- **Erro transitório**: qualquer erro do store que não seja `23505` propaga;
  o Fastify responde 5xx e o gateway pode retentar. Nunca é convertido em 409.
- **Legado**: linhas anteriores à 0024 têm `payload_hash NULL`; na primeira
  recuperação os hashes atuais são adotados, preservando leitores antigos.
- **Lifecycle do cartão**: `pending`/`failed` = retryable; `completed` =
  committed/terminal. Payload e origem ficam vinculados por
  `payload_hash`/`signature_hash`/`event_id`; a retenção é o TTL. Um estado
  `terminal` separado para rejeição definitiva de negócio (ex.: payload inválido
  4xx) não foi introduzido — rejeições marcam `failed` (retryável), decisão
  registrada como limitação.

## 4. Aceites com prova

Comando de prova (executado no candidato com o delta; exit 0):

```bash
LOG_LEVEL=warn pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-07.test.ts
# 9 passed (9) · log: logs/vitest-prod-07.log · JSON: webhook-replay-evidence.json
```

| Aceite | Prova no teste HTTP+PG real | Resultado |
|---|---|---|
| AC1 falha pós-HMAC permite retry até persistir 1× | trigger `prod07_fail_insert` injeta exceção no INSERT da mensagem: 1º POST **500** e recibo `failed`; retry idêntico **200**; `messages=1`, `message.persisted=1`, `conversation.created=1`, `unread=1`, `attempts=2`, `state=completed` | PASS |
| AC1/AC3 crash entre claim e commit | recibo `pending` com `processed_at = now()-10min` → **200** e `attempts=2`; `pending` recente → **409 `event_in_progress`** sem mensagem | PASS |
| AC1 crash APÓS o commit do negócio | mensagem já persistida + recibo `pending` envelhecido → retry **200** pelo caminho idempotente, `messages=1`, `message.persisted=0` novo, `state=completed`, `attempts=2` | PASS |
| AC2 concorrência atômica | 2 POSTs simultâneos → `[200, 409]` (`event_in_progress`/`duplicate_event_id`), 1 mensagem e 1 evento | PASS |
| AC2 erro transitório não vira 409 | tabela renomeada → **500** sem `reason`; restaurada → retry **200** e `completed` | PASS |
| AC3 replay completed | 2º POST idêntico → **409 `duplicate_event_id`**; contagens e `attempts` inalterados | PASS |
| AC3 mesmo eventId + payload diferente | **409 `event_payload_mismatch`**; mensagem do payload B **0**; `payload_hash` originais intactos | PASS |
| AC3 negativos | assinatura inválida **401 `invalid_signature`**, timestamp antigo **401 `timestamp_too_old`**, futuro **401 `timestamp_too_future`**, bytes exatos adulterados **401 `invalid_signature`**; nenhum recibo e nenhuma mensagem criados | PASS |
| AC3 TTL + estado final | `payload_hash`/`signature_hash` iguais aos calculados no teste, `completed_at <= expires_at`, `expires_at` entre 23 h e 24 h | PASS |
| AC4 logs distintos | logs do run mostram `duplicate_event_id`, `event_payload_mismatch`, `event_in_progress` (warn) e `replay_claim_recovered` (info) — repetição, ataque e recuperação separados | PASS |

## 5. Comandos e resultados

| Comando | Exit |
|---|---|
| `pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-07.test.ts` | 0 (9/9) |
| `pnpm --filter @cvg/shared test` | 0 (82/82) |
| `pnpm --filter @cvg/database test` | 0 (27/27) |
| `pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-06.test.ts` | 0 (12/12) |
| `DATABASE_URL=<pg do run> vitest run src/__tests__/webhook-inbound.integration.test.ts` | 0 (8/8, log `logs/regressao-webhook-inbound.log`) |
| `pnpm --filter @cvg/desk-api typecheck` · `@cvg/chat` · `@cvg/shared` · `@cvg/database` | 0 |
| `pnpm --filter @cvg/shared lint` · `@cvg/chat` · `@cvg/database` · `@cvg/desk-api` | 0 |

## 6. Riscos e não comprovado

Riscos:

1. **Crash entre o commit do negócio e `complete`**: o retry reexecuta o
   use-case, que encontra a mensagem existente e retorna antes do Secretary
   (`receive-inbound-message.use-case.ts`), então não há efeito duplicado; o
   recibo pode ficar `pending` (409 `event_in_progress`) até a janela de stale.
2. **Processamento > stale (120 s)**: hoje o Secretário roda no caminho do
   webhook; um retry concorrente além da janela pode reprocessar. A mensagem é
   idempotente, mas a invocação IA pode duplicar (tratado por PROD-08).
3. **409 `duplicate_event_id` no gateway**: assume que o produtor trata 409 de
   evento já concluído como sucesso idempotente; o sandbox do Gateway/Evolution
   não está disponível neste ambiente.
4. **Purge/TTL**: o TTL é retenção, não libera identidade; um futuro job de purge
   só encontraria eventos com timestamp fora da janela de 300 s, que já são
   rejeitados antes do recibo.
5. **Rollback da 0024 exige rollback do código**: o claim usa as novas colunas.

Não comprovado (BLOCKED por ambiente/alcance):

- Contrato real do Gateway/sandbox e política de redelivery do provider (AC4 do
  cartão) — sem sandbox Evolution/Gateway no ambiente; prova limitada a HTTP local.
- Crash real de processo/queda de host: usado `pending` stale e tabela ausente
  como falhas sintéticas no run isolado.
- Concorrência entre processos distintos: os dois POSTs concorrentes usam o
  mesmo processo de teste (o claim é atômico no PG, mas não houve duas réplicas).
- `23505` defensivo no `ON CONFLICT`: caminho coberto por código, não exercitado
  (o `ON CONFLICT DO NOTHING` normalmente não chega a lançar).

## 7. Identidade e digests

- Candidato (HEAD): `754f9badac46278e77d21de91c58eedb15e80581`, worktree preservado
  (nenhum reset/clean/stash).
- `diff` rastreado do delta PROD-07 (7 arquivos modificados, sem untracked):
  `sha256=098ca5770d299f0cceac08686c77b28cf1c0f7c7db3c2dd3a1aa864a200659d2`.
- Artefatos novos:
  - `0024_webhook_replay_claim.sql` — `69543fc3755c5fa440bf9b3ce5e3c6e2406563a996473ac5719c11db99f3c8cf`
  - `webhook-anti-replay.test.ts` — `7882a1ce2072c2b79dd053bcb2a92a12aeb646ba9cb8a2941a201021c2dbeb0f`
  - `prod-07.test.ts` — `897c2907cca3b0368890d8049ca75976d8ec16f2cbe0c24367bf9393bda705af`
  - `logs/vitest-prod-07.log` — `387958c60636250b0f8529ed6b0e6ec7b3023164d55d5a269655f4676f61992c`
  - `webhook-replay-evidence.json` — `27b10b822b5fb96c0197b25240eb08b5e05ea77a817902c0e7518864b428d0ad`
- Ambiente: PG 16.15 `127.0.0.1:57532`, Redis `127.0.0.1:56790`, run
  `prod07-20260913` worker 11, `marker.sourceRevision` = HEAD; teardown executado.
- Migrations 0001–0023: hashes do baseline do PROD-00 conferidos no PROD-06 AC4.1
  (verde), sem alteração.

## 8. Próxima ação

Integrador revisa este delta no candidato, roda a suíte em CI com PG real e
decide o fechamento; PROD-08 deve remover o Secretário síncrono do caminho para
eliminar o risco 2; o contrato de redelivery do Gateway (AC4) segue como
pendência externa documentada.

## 9. Correção pós-revisão independente (F4) — teardown do run

**Defeito reproduzido:** o comando prescrito pelo cartão saía **1** mesmo com
os 9 testes verdes, por um erro não tratado `Socket closed unexpectedly`
(@redis/client) no `afterAll`. Causa: durante os testes, o
`publishRealtimeHintsAfterCommit` inicia o singleton do RealtimeBus; o
subscriber criado por `publisher.duplicate()` **não herda listeners de error**
do publisher, e o `afterAll` parava o Redis enquanto esse socket continuava
aberto. `app.close()` não encerra o barramento.

Baseline (candidato sem a correção): run `prod07-baseline` (worker 21) —
`9 passed (9)` **+ `Errors 1 error`** → comando `exit=1`
(`logs/vitest-prod-07-antes-f4.log`).

**Correção (mínima, dentro do escopo):**

- `packages/events/src/realtime-bus.ts:82-90` — o subscriber recebe um handler
  próprio de `error` (o `duplicate()` não herda o do publisher), mantendo o
  caminho durável no polling do outbox.
- `packages/events/src/realtime-bus.ts:190-203` — novo
  `stopSharedRealtimeBus()`: encerra o singleton se existir, sem criá-lo.
- `apps/desk-api/src/__tests__/production/prod-07.test.ts:288-296` — o
  `afterAll` fecha bus/subscribers **antes** do `app.close()` e do teardown de
  serviços (ordem exigida para não derrubar o socket junto com o Redis).

**Depois:** comando prescrito no runner isolado — exit **0**, **9/9**, zero
ocorrências de `Socket closed unexpectedly`/unhandled:

```bash
node scripts/production/run-integration-isolated.mjs --run-id prod07-fix --worker 21 -- pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-07.test.ts
# exit 0 · 9 passed (9) · run cvg_aaa_prod07_fix_w21 · logs/vitest-prod-07-fix.log
```

Evidência: `logs/vitest-prod-07-fix.log`, `logs/vitest-prod-07-fix-runner-summary.json`,
`logs/vitest-prod-07-antes-f4.log`, `logs/vitest-prod-07-antes-f4-runner-summary.json`;
`webhook-replay-evidence.json` regenerado (`runId: prod07-fix`, worker 21, 9 casos).
Prova do barramento: `pnpm --filter @cvg/events exec vitest run
src/__tests__/realtime-bus.test.ts` → **4/4**, incluindo "redis down → explicit
degraded state, never silent". Nenhum assert foi enfraquecido — a suíte, os 9
casos e o ACK/erro do contrato permanecem idênticos.

**Limitações restantes:** o handler apenas evita o uncaught exception — se o
Redis cair em produção, o subscriber registra o erro e tenta reconectar
(mesmo comportamento degradado do publisher; o outbox cobre a durabilidade).
Não foi adicionado hook de shutdown ao `buildDeskApiApp` (fora do escopo de
escrita); hosts que precisarem encerrar o barramento devem chamar
`stopSharedRealtimeBus()`.

**Rollback:** reverter `packages/events/src/realtime-bus.ts:82-90,190-203` e o
`afterAll` de `prod-07.test.ts`; testes e evidências são aditivos. Run
`prod07-fix` derrubado pelo runner (teardown `stopServices`/`dropDatabase`).
