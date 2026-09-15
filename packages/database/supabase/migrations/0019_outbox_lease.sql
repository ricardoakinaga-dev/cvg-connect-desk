-- Migration: 0019_outbox_lease
-- Purpose: AAA-07 / C03 — lease e fencing por (event_id, consumer_id).
-- Expand-only: adiciona colunas de lease em outbox_consumer_acks. Nenhuma
-- linha é apagada, nenhum default destrutivo, nenhum consumidor antigo é
-- obrigado a ler as colunas novas (expand/contract; contract fica para um
-- deploy posterior, quando nenhum processo usar ack sem token).
--
-- Semântica:
--   lease_owner  owner atual do lease (NULL = livre)
--   lease_until  validade do lease (NULL = livre; TIMESTAMPTZ)
--   generation   fencing token incrementado a cada claim/reclaim
--
-- Rollback documentado (manual, somente se nenhum consumidor usar lease):
--   DROP INDEX IF EXISTS idx_acks_lease_due;
--   ALTER TABLE outbox_consumer_acks DROP COLUMN IF EXISTS lease_owner;
--   ALTER TABLE outbox_consumer_acks DROP COLUMN IF EXISTS lease_until;
--   ALTER TABLE outbox_consumer_acks DROP COLUMN IF EXISTS generation;
-- O rollback descarta apenas estado de reserva (lease_*); eventos, acks e
-- retry counts permanecem intactos. Roll-forward preferível: manter colunas
-- e desligar o claim com lease nos consumidores.

--> statement-breakpoint
ALTER TABLE outbox_consumer_acks ADD COLUMN IF NOT EXISTS lease_owner TEXT;

--> statement-breakpoint
ALTER TABLE outbox_consumer_acks ADD COLUMN IF NOT EXISTS lease_until TIMESTAMPTZ;

--> statement-breakpoint
ALTER TABLE outbox_consumer_acks ADD COLUMN IF NOT EXISTS generation INTEGER NOT NULL DEFAULT 0;

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_acks_lease_due ON outbox_consumer_acks (consumer_id, lease_until) WHERE processed_at IS NULL;
