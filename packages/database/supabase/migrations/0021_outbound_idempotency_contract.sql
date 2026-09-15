-- Migration: 0021_outbound_idempotency_contract
-- Purpose: AAA-12 / C04 — chave estável por intenção com escopo ator+conversa,
-- fingerprint de payload, TTL explícito, estado de reconciliação e tombstone
-- de chave.
--
-- Expand-only: nenhum índice existente é removido e nenhuma coluna some. O
-- índice ÚNICO GLOBAL `idx_outbound_deliveries_key` (criado na 0014) é
-- MANTIDO, então o insert legado com
-- `ON CONFLICT (idempotency_key) DO NOTHING` continua válido durante rolling
-- deploy (verificado por teste em `aaa-12.integration.test.ts`). O CHECK de
-- status é recriado (não há ALTER CHECK no PostgreSQL) apenas para AMPLIAR os
-- valores aceitos; a FK é recriada como CASCADE + trigger de tombstone
-- (detalhado abaixo), sem apagar dados.
--
-- Escopo ator+conversa sem quebrar a unicidade global: o caminho novo grava em
-- `idempotency_key` uma CHAVE DE ARMAZENAMENTO derivada do escopo
-- (`c04:<sha256(ator|conversa|chave crua)>`) e a chave crua em `client_key`.
-- O índice único novo `idx_outbound_deliveries_scope_key` é
-- (scope_actor_id, scope_conversation_id, client_key) e expressa C04
-- diretamente; a unicidade global de `idempotency_key` continua valendo para
-- todo writer antigo.
--
-- Exclusão de mensagem (tombstone): a FK `internal_message_id` permanece
-- ON DELETE CASCADE (o mapping é propriedade da mensagem e o cleanup existente
-- não quebra), MAS um trigger BEFORE DELETE em `outbound_deliveries` arquiva a
-- chave em `outbound_idempotency_tombstones` antes da linha sumir. Assim a
-- chave usada nunca volta a enviar silenciosamente depois que a mensagem é
-- apagada; o retry passa a responder conflito explícito.
--
-- Semântica de TTL: expires_at marca o fim da janela em que uma intenção
-- NÃO-terminal pode ser completada. Após o vencimento o código marca a
-- intenção como falha terminal (`failed`, `last_error='idempotency_ttl_expired'`)
-- e NUNCA reenvia silenciosamente.
--
-- Retenção: `outbound_idempotency_tombstones` é permanente por padrão; contém
-- apenas escopo + chave + fingerprint + status (nenhum conteúdo de mensagem).
-- Política de limpeza futura deve preservar a proibição de reenvio; apagar um
-- tombstone reabilita a chave e só pode ocorrer por decisão explícita.
--
-- Rollback (manual, somente com o código anterior; não perde mensagens):
--   DROP TRIGGER IF EXISTS trg_outbound_deliveries_archive_tombstone ON outbound_deliveries;
--   DROP FUNCTION IF EXISTS archive_outbound_delivery_tombstone();
--   DROP TABLE IF EXISTS outbound_idempotency_tombstones;
--   DROP INDEX IF EXISTS idx_outbound_deliveries_reconciling;
--   DROP INDEX IF EXISTS idx_outbound_deliveries_scope_key;
--   ALTER TABLE outbound_deliveries DROP CONSTRAINT IF EXISTS outbound_deliveries_status_check;
--   ALTER TABLE outbound_deliveries ADD CONSTRAINT outbound_deliveries_status_check
--     CHECK (status IN ('pending','sent','failed'));
--   ALTER TABLE outbound_deliveries
--     DROP COLUMN IF EXISTS scope_actor_id,
--     DROP COLUMN IF EXISTS scope_conversation_id,
--     DROP COLUMN IF EXISTS client_key,
--     DROP COLUMN IF EXISTS payload_fingerprint,
--     DROP COLUMN IF EXISTS expires_at,
--     DROP COLUMN IF EXISTS reconciling_at,
--     DROP COLUMN IF EXISTS last_error;
--   -- a FK cascade e o índice global único originais são preservados.
-- Roll-forward preferível: manter as colunas e desligar o novo caminho no
-- código (expand/contract clássico).
--
-- Nota operacional: em produção com tabela quente, os CREATE INDEX devem rodar
-- com a variante CONCURRENTLY fora de transação.

--> statement-breakpoint
ALTER TABLE outbound_deliveries ADD COLUMN IF NOT EXISTS scope_actor_id TEXT;

--> statement-breakpoint
ALTER TABLE outbound_deliveries ADD COLUMN IF NOT EXISTS scope_conversation_id UUID;

--> statement-breakpoint
ALTER TABLE outbound_deliveries ADD COLUMN IF NOT EXISTS client_key TEXT;

--> statement-breakpoint
ALTER TABLE outbound_deliveries ADD COLUMN IF NOT EXISTS payload_fingerprint TEXT;

--> statement-breakpoint
ALTER TABLE outbound_deliveries ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

--> statement-breakpoint
ALTER TABLE outbound_deliveries ADD COLUMN IF NOT EXISTS reconciling_at TIMESTAMPTZ;

--> statement-breakpoint
ALTER TABLE outbound_deliveries ADD COLUMN IF NOT EXISTS last_error TEXT;

--> statement-breakpoint
UPDATE outbound_deliveries d
   SET scope_conversation_id = m.conversation_id
  FROM messages m
 WHERE m.id = d.internal_message_id
   AND d.scope_conversation_id IS NULL;

--> statement-breakpoint
UPDATE outbound_deliveries
   SET scope_actor_id = 'legacy'
 WHERE scope_actor_id IS NULL;

--> statement-breakpoint
-- Linhas legadas guardam a chave crua em `idempotency_key`; `client_key`
-- passa a ser a projeção canônica da chave do cliente.
UPDATE outbound_deliveries
   SET client_key = idempotency_key
 WHERE client_key IS NULL;

--> statement-breakpoint
UPDATE outbound_deliveries
   SET expires_at = created_at + INTERVAL '24 hours'
 WHERE expires_at IS NULL;

--> statement-breakpoint
ALTER TABLE outbound_deliveries DROP CONSTRAINT IF EXISTS outbound_deliveries_status_check;

--> statement-breakpoint
ALTER TABLE outbound_deliveries ADD CONSTRAINT outbound_deliveries_status_check
  CHECK (status IN ('accepted', 'pending', 'sent', 'failed', 'unknown_reconciling'));

--> statement-breakpoint
ALTER TABLE outbound_deliveries DROP CONSTRAINT IF EXISTS outbound_deliveries_internal_message_id_fkey;

--> statement-breakpoint
ALTER TABLE outbound_deliveries ADD CONSTRAINT outbound_deliveries_internal_message_id_fkey
  FOREIGN KEY (internal_message_id) REFERENCES messages(id) ON DELETE CASCADE;

--> statement-breakpoint
-- Unicidade de C04: mesmo ator + mesma conversa + mesma chave crua é UMA
-- intenção. NULLs não colidem (linhas legadas sem escopo ficam fora).
CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_deliveries_scope_key
  ON outbound_deliveries (scope_actor_id, scope_conversation_id, client_key);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_outbound_deliveries_reconciling
  ON outbound_deliveries (status, expires_at)
  WHERE status IN ('pending', 'accepted', 'unknown_reconciling');

--> statement-breakpoint
-- Tombstones: a chave sobrevive à exclusão da mensagem. Nenhum conteúdo de
-- mensagem é copiado (apenas escopo, chave, fingerprint e estado terminal).
CREATE TABLE IF NOT EXISTS outbound_idempotency_tombstones (
  scope_actor_id TEXT NOT NULL,
  scope_conversation_id UUID NOT NULL,
  client_key TEXT NOT NULL,
  payload_fingerprint TEXT,
  delivery_status TEXT,
  provider_message_id TEXT,
  expires_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scope_actor_id, scope_conversation_id, client_key)
);

--> statement-breakpoint
CREATE OR REPLACE FUNCTION archive_outbound_delivery_tombstone()
RETURNS trigger AS $$
BEGIN
  IF OLD.scope_actor_id IS NOT NULL
     AND OLD.scope_conversation_id IS NOT NULL
     AND OLD.client_key IS NOT NULL THEN
    INSERT INTO outbound_idempotency_tombstones (
      scope_actor_id,
      scope_conversation_id,
      client_key,
      payload_fingerprint,
      delivery_status,
      provider_message_id,
      expires_at
    ) VALUES (
      OLD.scope_actor_id,
      OLD.scope_conversation_id,
      OLD.client_key,
      OLD.payload_fingerprint,
      OLD.status,
      OLD.provider_message_id,
      OLD.expires_at
    )
    ON CONFLICT (scope_actor_id, scope_conversation_id, client_key) DO NOTHING;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_outbound_deliveries_archive_tombstone ON outbound_deliveries;

--> statement-breakpoint
CREATE TRIGGER trg_outbound_deliveries_archive_tombstone
  BEFORE DELETE ON outbound_deliveries
  FOR EACH ROW EXECUTE FUNCTION archive_outbound_delivery_tombstone();
