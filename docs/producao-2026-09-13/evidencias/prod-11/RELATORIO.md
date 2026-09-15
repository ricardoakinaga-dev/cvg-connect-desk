# PROD-11 — Relatório de execução

**Cartão:** PROD-11 — Validar reconciliação outbound e retenção da intenção (AC1–AC4)
**Itens auditados:** BE10 · BE15 · UI04 · **Contratos:** C05 (G03) · **Gates:** G03/G09
**Estado do cartão:** IMPLEMENTED (não DONE)
**Candidato:** HEAD `754f9badac46278e77d21de91c58eedb15e80581` + worktree (delta **não commitado**).
Fronteiras respeitadas: `packages/auth`, `packages/media`, `modules/privacy`,
`apps/message-worker`, `packages/database/src/schema.ts` e `supabase/migrations/**`
**não** foram tocados (o lock `schema-migrations` permanece com o outro executor).
`modules/gateway-adapter/**` não precisou de mudança: o sandbox de teste consome o
contrato real (`gatewayService`/`/gateway/receipt`) sem mock de módulo.

Ambiente de prova (harness AAA, nunca o banco do host): PostgreSQL 16 + Redis
isolados por run (`marker.runId` conferido, bancos `cvg_aaa_prod11*_w38`),
migrate+seed reais e teardown `stopServices+dropDatabase` por runId.

| Run | Worker | PostgreSQL | Banco | Redis | Exit |
|---|---|---:|---|---:|---:|
| `prod11-before` (repro antes, código pré-delta) | 38 | 127.0.0.1:60232 | `cvg_aaa_prod11_before_w38` | 57060 | 0 |
| `prod11`/`prod11b` (runs de desenvolvimento do teste, corrigidos) | 38 | 60232 | `cvg_aaa_prod11{,_b}_w38` | 57060 | 1 / 1 |
| `prod11c`/`prod11d` (suíte AC, 2 rodadas) | 38 | 60232 | `cvg_aaa_prod11{c,d}_w38` | 57060 | 0 / 0 |
| `prod11e` (suíte AC final) | 38 | 60232 | `cvg_aaa_prod11e_w38` | 57060 | 0 |
| `prod11-contra` (contraprova pós-delta) | 38 | 60232 | `cvg_aaa_prod11_contra_w38` | 57060 | 0 |
| `prod11-reg-chat` (regressão chat) | 37 | 127.0.0.1:60132 | `cvg_aaa_prod11_reg_chat_w37` | 57050 | 0 |
| `prod11-reg-outbound` (regressão outbound-idempotency) | 36 | 127.0.0.1:60032 | `cvg_aaa_prod11_reg_outbound_w36` | 57040 | 0 |

`prod11`/`prod11b` são rodadas de desenvolvimento que falharam por defeitos do
**harness de teste** (nome errado da tabela de ACK na limpeza; ator/conteúdo do
filho de crash divergente do retry). Nenhuma foi mascarada por skip; os defeitos
foram corrigidos e as rodadas finais (`prod11c/d/e`) são limpas em 12/12.

---

## 1. Problema reproduzido (antes do delta)

O código pré-delta foi restaurado a partir dos baselines em `rollback/`
(`outbound-delivery.repository.pre-prod11.ts`, `chat-ports.pre-prod11.ts`,
`send-outbound-message.use-case.pre-prod11.ts`), executado pelo runner isolado e
restaurado em seguida (hashes SHA-256 conferidos antes/depois). Cenários do
mesmo `repro-antes.ts` que roda depois como contraprova.

```json
{
  "A_intencao_ambigua_callback": {
    "sendOutcome": "unknown_reconciling",
    "deliveryStatusBeforeReceipt": "unknown_reconciling",
    "deliveryStatusAfterReceipt": "unknown_reconciling",
    "messageStatusAfterReceipt": "pending",
    "receiptUpdated": false, "gatewaySends": 1, "defect": true
  },
  "B_orfa_sem_reconciliacao": {
    "hasReceiptReconciler": false, "hasOrphanList": false, "hasExplicitResolve": false, "defect": true
  },
  "C_retencao_sem_politica": {
    "hasExpireStale": false, "hasListExpired": false, "hasPurge": false,
    "unknownRetainedAfterTtl": "unknown_reconciling", "defect": true
  },
  "D_retry_sem_reenvio": { "retryOutcome": "unknown_reconciling", "retryDeduplicated": true, "noBlindResend": true },
  "verdict": "DEFECT_REPRODUCED"
}
```

- **A**: um receipt tardio do gateway (referência = id interno ecoado no
  `event_id` do DESK_OUTBOUND) não encontrava a mensagem por
  `external_message_id` (nunca gravado no aceite perdido) e a intenção ficava
  presa em `unknown_reconciling` para sempre.
- **B**: não existia reconciliação explícita/listagem de órfãs — crash entre o
  envio e o callback deixava a intenção sem caminho de resolução.
- **C**: não havia política/função testável de retenção (expirados, `unknown`
  antigo, purge de terminais com tombstone).
- **D (já correto)**: retry da mesma chave não reenviava — a lacuna era a
  reconciliação, não a dedup básica.

Evidência: `logs/repro-antes-runner.log` (runner `prod11-before`,
`--skip-seed`, exit 0) e `logs/repro-antes-direct.log` (execução anterior à
edição, mesmo ambiente provisionado pelo runner).

---

## 2. Delta

| Arquivo | Linhas (pré → pós) | Mudança |
|---|---:|---|
| `modules/chat/src/infrastructure/repositories/outbound-delivery.repository.ts` | 94 → 668 | `reconcileOutboundReceiptFromCallback` (resolve intenção por `provider_message_id`/`external_message_id`/id interno, `FOR UPDATE` + advisory lock, uma única transição, duplicado no-op, progresso monotônico `sent→delivered`); `resolveOutboundIntentExplicitly` (confirmação/órfã idempotente); `listOutboundIntentsForReconciliation`; `listExpiredOutboundIntents`; `expireStaleOutboundIntents` (dry-run/apply); `purgeTerminalOutboundDeliveries` (dry-run/apply, nunca toca não-terminal/`unknown`, trigger grava tombstone); `finalizeDelivery` agora **guardado** contra regressão terminal e devolve o estado final. |
| `modules/chat/src/application/ports/chat-ports.ts` | 77 → 106 | `applyReceipt` passa a resolver a intenção via `reconcileOutboundReceiptFromCallback` (fallback legado preservado para mensagem sem mapping); `confirmation.markOutboundSent` resolve a órfã por id interno via `resolveOutboundIntentExplicitly` (fallback preservado). |
| `modules/chat/src/application/use-cases/send-outbound-message.use-case.ts` | 280 → 300 | `deliverOutbound` deriva `outcome`/`status` do estado FINAL persistido (a corrida callback×envio converge; sem regressão de `unknown_reconciling` sobre terminal). |
| `apps/desk-api/src/__tests__/production/prod-11.test.ts` (novo) | 1213 | 12 casos PG+Redis reais: AC1 (retenção/conflito/escopo/corrida/TTL), AC2 (reset/429/callback sucesso/falha/duplicado/corrida/confirmação), AC3 (órfã listável + crash real de processo), AC4 (TTL + purge com tombstone). |
| `docs/producao-2026-09-13/evidencias/prod-11/**` (novo) | — | este relatório, `RETENCAO.md`, `repro-antes.ts`, `crash-send.ts`, `prod-11-evidence.json`, `logs/**`, `rollback/*.pre-prod11.ts`. |

Nenhum `TODO`/`skip`/`.only` introduzido; nenhuma migration/coluna nova.
SHA-256 dos artefatos finais:

```
7d36812847b5f7685e645067c9b40153ddd14874bdc81bfb8a19e2eafe696064  outbound-delivery.repository.ts
56add00272635a6215c01af2128259c37e72bb9e6572185629b3b7520c8c8da3  chat-ports.ts
2fb207d1889077cae45f5a8c72b4198742158877c7bc7277c919f577dd03fa33  send-outbound-message.use-case.ts
5f55084efa93a5861b0f43f533322a3781d8de6494a3cfcaf3a07ef9a03183dd  prod-11.test.ts
d67dfb3c516cfc951d83785298cbf7200fb77a208802e9dcca32816fc0c8256e  crash-send.ts
bc3c40b17b8d93ca90af331d46f5b4f58ca46eb7806c1ac3ad38073d60140c39  repro-antes.ts
```

---

## 3. Aceites com prova

Suíte final `prod11e` (`logs/vitest-prod-11-final.log`, `prod-11-evidence.json`):
**12/12 PASS, exit 0**, reproduzida em `prod11c` e `prod11d`. Contraprova
`NO_DEFECT_OBSERVED` (`logs/repro-depois-runner.log`).

### AC1 — intenção retida/idempotente, 409 e TTL observável

| Caso | Prova (run `prod11e`) | Resultado |
|---|---|---|
| Mesma chave + mesmo payload | 201 na 1ª e 200 com **mesmo** `messageId`/`deduplicated:true` na 2ª; 1 mensagem/1 delivery/1 evento | PASS |
| Payload divergente com a mesma chave | 409 `IDEMPOTENCY_KEY_CONFLICT`, sem side effect; 1 fornecedor chamado 1× (3 envios reais no total do caso) | PASS |
| Escopo ator+conversa | mesma chave literal em conversa distinta e em ator distinto cria intenções distintas (2/2/2 na conversa A, 1/1/1 na B) | PASS |
| Corrida real (14 requests HTTP simultâneos) | `messages=1, deliveries=1, events=1`, `gatewayRequests=1`, 1×201 + 13×200, um único `messageId` | PASS |
| TTL expirado | retry devolve 200, `deduplicated:true`, `expired:true`, `outcome:'failed'`; delivery `failed`/`idempotency_ttl_expired`; mensagem `failed`; **nenhum** novo request ao provider | PASS |

### AC2 — estado ambíguo + reconciliação por callback (uma única vez)

| Caso | Prova | Resultado |
|---|---|---|
| Reset de socket ⇒ `unknown_reconciling` | 3 tentativas do cliente idempotente, intenção `unknown_reconciling`, mensagem `pending`; callback sem HMAC → 401 sem mudança de estado | PASS |
| Callback de sucesso resolve 1× | receipt `delivered` por id interno → delivery `sent`, `provider_message_id` e `external_message_id` gravados, mensagem `delivered`; 1/1/1 | PASS |
| Duplicado tardio não regride | 2º receipt (`delivered`) e receipt tardio de `failed` → `attempt_count` estável, delivery `sent`, mensagem `delivered` | PASS |
| Callback de falha | `failed` → delivery/mensagem `failed` (`provider_receipt_failed`); retry da mesma chave devolve `failed` sem novo envio | PASS |
| 429 após teto de retries | `outcome:'failed'`, 3 requests (1+2), retry `failed` sem novo envio | PASS |
| Corrida callback × retry | envio em voo (hang) + receipt `delivered` + retry concorrentes → estado final `sent`/`delivered`, 1/1/1, `gatewayRequests=1`, retry `deduplicated:true` | PASS |
| Confirmação do gateway (rota real autenticada) | `POST /gateway/outbound/:id/sent` resolve a órfã (`sent`, id externo), 2ª chamada idempotente (attempt estável) | PASS |

### AC3 — crash/retomada e órfã reconciliável

| Caso | Prova | Resultado |
|---|---|---|
| Órfã listável/resolvível | `listOutboundIntentsForReconciliation` contém a intenção; resolução explícita `failed` (`operator_confirmed_not_sent`) → `resolved:true`; 2ª chamada `duplicate:true` e sem novo efeito; sai da listagem | PASS |
| **Crash real** entre envio e callback | processo filho `tsx` com o caminho real de envio é morto (SIGKILL de process group) com o request registrado no sandbox; delivery/mensagem/evento **sobrevivem** (`pending`, 1/1/1); retry da mesma chave devolve `pending`/`deduplicated:true` **sem** novo request; receipt resolve para `sent`/`delivered`; `gatewayRequests` inalterado; nenhuma duplicata | PASS |

### AC4 — retenção testável (detalhe em `RETENCAO.md`)

| Caso | Prova | Resultado |
|---|---|---|
| TTL: nada apagado antes do vencimento | intenção fresca fora de `listExpiredOutboundIntents`; dry-run `applied=0` e estado intacto | PASS |
| Expirado terminaliza com causa | `expireStaleOutboundIntents({apply:true})` → `failed`/`idempotency_ttl_expired`, **linha retida**, mensagem `pending`→`failed`; futura intocada | PASS |
| `unknown` antigo nunca é purgado | dry-run/apply do purge não listam nem removem `unknown_reconciling` mesmo com `expires_at` 40 dias vencido | PASS |
| Purge de terminal antigo + tombstone | candidato só o `sent` antigo (não o `unknown` nem o `sent` recente); apply remove a delivery, mensagem permanece; tombstone gravado; retry da chave purgada → 409 sem chamar o provider | PASS |

---

## 4. Comandos e exit codes

Todos via runner isolado (PG/Redis próprios; teardown por runId). Logs em
`docs/producao-2026-09-13/evidencias/prod-11/logs/`; originais e
`runner-summary.json` em `evidencias/integration-runs/<run>/`.

```bash
# Repro ANTES (código pré-delta restaurado dos baselines em rollback/) — exit 0; DEFECT_REPRODUCED
node scripts/production/run-integration-isolated.mjs --run-id prod11-before --worker 38 --skip-seed \
  -- pnpm exec tsx docs/producao-2026-09-13/evidencias/prod-11/repro-antes.ts

# Suíte AC final — exit 0; 12/12 PASS (2 rodadas extras prod11c/prod11d também 12/12)
node scripts/production/run-integration-isolated.mjs --run-id prod11e --worker 38 \
  -- pnpm --filter @cvg/desk-api exec vitest run src/__tests__/production/prod-11.test.ts

# Contraprova DEPOIS — exit 0; NO_DEFECT_OBSERVED
node scripts/production/run-integration-isolated.mjs --run-id prod11-contra --worker 38 --skip-seed \
  -- pnpm exec tsx docs/producao-2026-09-13/evidencias/prod-11/repro-antes.ts

# Regressões — todas exit 0
node scripts/production/run-integration-isolated.mjs --run-id prod11-reg-chat --worker 37 \
  -- pnpm --filter @cvg/chat exec vitest run --exclude '**/aaa-08-atomicity.test.ts'   # 34/34
node scripts/production/run-integration-isolated.mjs --run-id prod11-reg-outbound --worker 36 \
  -- pnpm --filter @cvg/desk-api exec vitest run src/__tests__/outbound-idempotency.integration.test.ts   # 8/8
pnpm --filter @cvg/gateway-adapter test   # 20/20, exit 0 (sem DB)

# Estático — exit 0
pnpm --filter @cvg/chat typecheck && pnpm --filter @cvg/desk-api typecheck
pnpm --filter @cvg/chat lint                                            # 0 erros, 8 warnings (teto)
pnpm --filter @cvg/desk-api exec eslint src/__tests__/production/prod-11.test.ts   # 0 problemas
```

---

## 5. Riscos e limitações (honestos)

1. **Correlação do receipt com intenção sem id externo**: quando o aceite remoto
   se perde, o vínculo disponível é o `event_id` interno ecoado pelo gateway
   (`outbound_deliveries.internal_message_id`/`messages.id`). O casamento por id
   interno vale apenas dentro do webhook autenticado por HMAC; sem esse eco, a
   resolução da órfã exige confirmação explícita (rota autenticada ou operação
   assistida). Está documentado no código.
2. **Callback de `failed` após intenção terminal `sent` não regride** e receipt
   de sucesso após `failed` definitivo também não: a primeira transição
   terminal vence (resolução única). A mensagem acompanha o estado da delivery
   para não ficar inconsistente. Uma contradição real provider/desk fica
   visível no `last_error`/estado e exige operação.
3. **`aaa-12.integration.test.ts` não pôde ser reexecutado nesta janela**: a
   suíte fixa porta `56432`/banco `cvg_aaa_aaa_20260912_a12`, ocupados por outro
   run (`aaa-20260912`) de outro executor — não derrubado. A área equivalente
   foi reexecutada via `outbound-idempotency.integration.test.ts` (8/8) e a
   suíte nova cobre os caminhos de `finalizeDelivery`; o lock global de writer
   antigo permanece coberto por aaa-12 (arquivo não alterado) e pelo
   `outbound-atomic.repository.ts` intocado.
4. **Pull do gateway (`GET /gateway/outbound/pending`)**: a lista continua
   excluindo `unknown_reconciling`; no crash com provider idempotente a
   intenção fica `pending` e poderia ser relistada — o contrato do provider
   idempotente deduplica pelo `event_id`; para provider sem idempotência a
   intenção nasce `unknown_reconciling` e nunca é listada. Não houve mudança de
   `message.repository.ts` (fora do escopo de escrita do cartão).
5. **Retry interno do cliente de gateway** (`GATEWAY_MAX_RETRIES`, default 2)
   aparece nos casos de reset/429: 3 requests por envio ambíguo. É retry do
   transporte com `event_id` estável (idempotência do provider), não reenvio de
   intenção; `Number(env) || 2` é footgun pré-existente (0 vira 2).
6. **Retenção de mensagens/backups fora do escopo** (D-B5): o purge remove só a
   delivery e o tombstone preserva a chave; mensagens nunca são apagadas por
   esta política.
7. **Sem métricas Prometheus novas** (C09/PROD-31/32): observabilidade por log
   estruturado sem PII (`[outbound-reconciliation] ... ref=<digest>`) e pelas
   colunas de estado/erro.
8. **Órfãs legadas anteriores à 0021** (`expires_at NULL`) ficam fora de
   expiração e purge — preservação conservadora; backfill é decisão de dados.

---

## 6. Recuperação e rollback

- **Rollback do código**: restaurar os três baselines pré-PROD-11 de
  `rollback/`:
  `outbound-delivery.repository.pre-prod11.ts` → `outbound-delivery.repository.ts`,
  `chat-ports.pre-prod11.ts` → `chat-ports.ts`,
  `send-outbound-message.use-case.pre-prod11.ts` → `send-outbound-message.use-case.ts`,
  e remover `apps/desk-api/src/__tests__/production/prod-11.test.ts` e
  `evidencias/prod-11/`. `send-outbound-message.use-case.ts` e
  `outbound-delivery.repository.ts` são compartilhados com o delta AAA-12 não
  commitado: os baselines preservam ESSE estado (não o HEAD), evitar
  `git checkout` nesses arquivos.
- **Dados**: nenhum. As funções de expiração/purge só foram executadas contra
  linhas criadas pela própria suíte no PG isolado do run (removido no
  teardown). Reintroduzir o código pré-delta recria a lacuna de reconciliação
  (intenções `unknown_reconciling` presas) — usar apenas em emergência e
  reconciliar por operação/confirmação antes.
- **Reconciliação operacional de órfãs reais** (sem rollback):
  `listOutboundIntentsForReconciliation` para mapear; `resolveOutboundIntentExplicitly`
  (`sent` com id externo comprovado ou `failed` com causa) ou a rota
  `POST /gateway/outbound/:id/sent`; TTL vencido →
  `expireStaleOutboundIntents({apply:true})`; terminais antigas →
  `purgeTerminalOutboundDeliveries({apply:true})` (dry-run primeiro).
- **Teardown**: apenas por runId no runner isolado; nunca apagar banco
  pré-existente.

O fechamento DONE depende do integrador conferir identidade do candidato,
revisão e os aceites acima; PROD-40 inspeciona independentemente.
