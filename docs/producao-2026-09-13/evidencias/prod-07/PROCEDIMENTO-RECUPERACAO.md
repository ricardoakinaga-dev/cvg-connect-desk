# PROD-07 — Recuperação operacional e rollback da 0024

Ambiente de referência: run `prod07-20260913` (worker 11). Em produção, os
comandos abaixo rodam no banco da aplicação com as credenciais normais — nunca no
banco de um run de evidência.

## 1. Inspeção do recibo

```sql
SELECT event_id, state, attempts, payload_hash, signature_hash,
       processed_at, completed_at, expires_at
  FROM webhook_replay_log
 WHERE event_id = '<X-Webhook-Event-Id>';
```

Leitura esperada:

- `completed` — negócio persistido; reentrega recebe 200 idempotente com
  `deduplicated: true` (sem efeito novo). Nada a fazer.
- `failed` — falha de negócio registrada; o próximo redelivery do gateway é
  aceito de imediato. Nada a fazer além de confirmar que o payload era válido.
- `pending` com `processed_at` recente — entrega em processamento; reentrega
  recebe 409 `event_in_progress`.
- `pending` com `processed_at` antigo (> `WEBHOOK_REPLAY_STALE_SECONDS`, default
  120 s) — crash/interrupção; o próximo redelivery é recuperado sozinho.

## 2. Recuperação quando o gateway não redelivera

O caminho normal é o redelivery do produtor. Se for necessário agir manualmente:

```sql
-- Reabre um evento preso (pending/failed) para o próximo retry; o negócio é
-- idempotente por externalMessageId, então repetir é seguro.
UPDATE webhook_replay_log
   SET state = 'failed', processed_at = now()
 WHERE event_id = '<event-id>' AND state <> 'completed';
```

Depois, reenvie o MESMO evento (mesmos bytes e headers assinados) pelo produtor.
Não apague a linha para "liberar" o evento: apagar transforma um replay potencial
em recibo novo e enfraquece a defesa — use o UPDATE acima.

Se a mensagem já existe (`messages.external_message_id = '<messageId>'`), a
reentrega retorna 200 pelo caminho idempotente e apenas consolida o recibo.

## 3. Rollback da migration 0024 (expand/contract)

A 0024 é aditiva (colunas com default + índice). O rollback só é necessário se a
aplicação também voltar para um código que não conhece `claim`.

Ordem: (1) reverter/implantar o código anterior; (2) só então remover o schema.

```sql
BEGIN;
ALTER TABLE webhook_replay_log DROP COLUMN IF EXISTS state;
ALTER TABLE webhook_replay_log DROP COLUMN IF EXISTS payload_hash;
ALTER TABLE webhook_replay_log DROP COLUMN IF EXISTS completed_at;
ALTER TABLE webhook_replay_log DROP COLUMN IF EXISTS attempts;
DROP INDEX IF EXISTS idx_webhook_replay_state;
DELETE FROM drizzle.__drizzle_migrations
 WHERE hash = (SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 1);
COMMIT;
```

Conferências após o rollback:

```sql
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'webhook_replay_log' ORDER BY column_name;
-- esperado: event_id, expires_at, processed_at, signature_hash
SELECT count(*) FROM drizzle.__drizzle_migrations; -- uma entrada a menos que o journal
```

`db:check`/readiness volta a `SCHEMA_BEHIND` enquanto o journal tiver a 0024 e o
ledger não — o que é o estado esperado durante o rollback parcial. Ensaiar em
banco isolado antes de produção; não editar 0001–0024.

## 4. Por que não há "contract" agora

Manter as colunas é seguro para leitores antigos (defaults preenchidos). O
`state` default `'pending'` em linhas antigas é conservador: preserva o retry.
Uma futura migration de contract pode:
- adicionar `CHECK (state IN ('pending','failed','completed'))`;
- popular/validar `payload_hash` de legados;
- purgar por `expires_at` (novo job), se DPO ratificar a retenção.
