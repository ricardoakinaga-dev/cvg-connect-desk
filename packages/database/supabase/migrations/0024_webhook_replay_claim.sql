-- 0024_webhook_replay_claim.sql
-- PROD-07 / C03 / BE09 — recibo de webhook em duas fases (expand).
--
-- O guard HMAC grava o recibo ANTES de o negócio persistir; uma falha entre a
-- reserva e o commit do negócio transformava o retry legítimo em 409. A 0024
-- evolve `webhook_replay_log` para um recibo reivindicável com estado e hash de
-- payload, mantendo o TTL existente e sem remover/renomear nada:
--   * state        — 'pending' | 'failed' | 'completed' (default preserva linha antiga);
--   * payload_hash — sha256 dos bytes exatos do corpo assinado, para rejeitar
--                    reuso de event_id com payload diferente (mismatch);
--   * completed_at — instante em que o negócio concluiu (pending/failed → completed);
--   * attempts     — tentativas de reivindicação (claim), para observabilidade.
-- `processed_at` (0013) passa a registrar a ÚLTIMA reivindicação/transição.
--
-- Rollback (falha ensaiada): parar a API, remover a linha do ledger
-- `drizzle.__drizzle_migrations` do tag 0024 e executar os DROP COLUMN abaixo —
-- as colunas são aditivas com default, portanto não há reescrita de dados.

--> statement-breakpoint
ALTER TABLE webhook_replay_log
  ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'pending';

--> statement-breakpoint
ALTER TABLE webhook_replay_log
  ADD COLUMN IF NOT EXISTS payload_hash TEXT;

--> statement-breakpoint
ALTER TABLE webhook_replay_log
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

--> statement-breakpoint
ALTER TABLE webhook_replay_log
  ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_webhook_replay_state ON webhook_replay_log(state);
