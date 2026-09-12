-- Migration: 0014_outbound_idempotency
-- Purpose: Phase 2 §5.4 — mapping idempotency_key -> mensagem para não duplicar
-- envio ao WhatsApp após crash/retry. Unique em idempotency_key garante dedup
-- mesmo sob concorrência (insert ... on conflict do nothing).

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS outbound_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  internal_message_id UUID NOT NULL REFERENCES messages(id),
  idempotency_key TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'evolution',
  provider_message_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT outbound_deliveries_status_check CHECK (status IN ('pending', 'sent', 'failed'))
);

--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_deliveries_key ON outbound_deliveries(idempotency_key);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_outbound_deliveries_message ON outbound_deliveries(internal_message_id);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_outbound_deliveries_status ON outbound_deliveries(status);
