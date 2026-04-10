-- Migration: 0010_outbox_events
-- Purpose: Outbox de eventos para pipeline interprocesso
-- Enables: API, Worker e Realtime-Service compartilharem eventos via banco

CREATE TABLE IF NOT EXISTS outbox_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  occurred_at TIMESTAMP NOT NULL,
  payload TEXT NOT NULL,
  metadata TEXT,
  correlation_id TEXT,
  causation_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  processed_at TIMESTAMP,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Índices para leitura eficiente
CREATE INDEX IF NOT EXISTS idx_outbox_event_id ON outbox_events(event_id);
CREATE INDEX IF NOT EXISTS idx_outbox_event_type ON outbox_events(event_type);
CREATE INDEX IF NOT EXISTS idx_outbox_aggregate ON outbox_events(aggregate_type, aggregate_id);
CREATE INDEX IF NOT EXISTS idx_outbox_processed ON outbox_events(processed_at);
CREATE INDEX IF NOT EXISTS idx_outbox_created ON outbox_events(created_at);

-- Comentário na tabela
COMMENT ON TABLE outbox_events IS 'Outbox de eventos para pipeline interprocesso. API publica, Worker/Realtime consomem.';
