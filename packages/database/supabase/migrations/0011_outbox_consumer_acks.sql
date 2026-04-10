-- Migration: 0011_outbox_consumer_acks
-- Purpose: Tabela de acknowledgments por consumer para fan-out seguro
-- Enables: Múltiplos consumers processarem o mesmo evento independentemente
-- Fixes: Consumer A não bloqueia Consumer B ao processar evento
-- Note: A chave primária é (event_id, consumer_id) para garantir que cada
-- consumer processa o mesmo evento apenas uma vez. O campo 'id' foi removido
-- para evitar conflict de primary key duplo.

CREATE TABLE IF NOT EXISTS outbox_consumer_acks (
  event_id TEXT NOT NULL,
  consumer_id TEXT NOT NULL,
  processed_at TIMESTAMP,  -- NULL = pendente/retry, NOT NULL = processado com sucesso
  last_error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, consumer_id)
);

-- Índice para buscar todos os consumers de um evento (já coberto pela PK)
-- CREATE INDEX IF NOT EXISTS idx_acks_event ON outbox_consumer_acks(event_id);

-- Índice para buscar todos os eventos processados por um consumer
CREATE INDEX IF NOT EXISTS idx_acks_consumer ON outbox_consumer_acks(consumer_id);

-- Índice para buscar eventos pendentes (processed_at IS NULL) por consumer
CREATE INDEX IF NOT EXISTS idx_acks_pending ON outbox_consumer_acks(consumer_id, processed_at) WHERE processed_at IS NULL;

-- Comentário na tabela
COMMENT ON TABLE outbox_consumer_acks IS 'Acknowledgments por consumer. Cada consumer processa eventos independentemente. Um evento pode ser processado por worker, realtime e http-poll simultaneamente.';
