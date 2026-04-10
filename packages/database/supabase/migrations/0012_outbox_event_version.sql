-- Migration: 0012_outbox_event_version
-- Purpose: Versionamento explicito do envelope de evento no outbox

ALTER TABLE outbox_events
ADD COLUMN IF NOT EXISTS event_version INTEGER NOT NULL DEFAULT 1;

COMMENT ON COLUMN outbox_events.event_version IS 'Versao explicita do contrato do evento (envelope), distinta da versao do aggregate.';
