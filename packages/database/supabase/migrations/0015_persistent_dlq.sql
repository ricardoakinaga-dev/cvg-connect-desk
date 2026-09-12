-- Migration: 0015_persistent_dlq
-- Purpose: Final-1 — dead_letter_events durável (restart-safe).
-- Backward compatible: tabela nova, sem alteração de tabelas existentes.

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS dead_letter_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_event_id TEXT NOT NULL,
  consumer_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  error_code TEXT,
  error_message TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  first_failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'PENDING',
  replay_count INTEGER NOT NULL DEFAULT 0,
  replayed_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID,
  resolution_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT dead_letter_events_status_check CHECK (status IN ('PENDING', 'REPLAYING', 'RESOLVED', 'DISCARDED')),
  CONSTRAINT dead_letter_events_unique_event_consumer UNIQUE (original_event_id, consumer_id)
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_dlq_status ON dead_letter_events(status);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_dlq_consumer ON dead_letter_events(consumer_id);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_dlq_event_type ON dead_letter_events(event_type);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_dlq_created ON dead_letter_events(created_at);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_dlq_pending_failed ON dead_letter_events(status, last_failed_at) WHERE status = 'PENDING';
