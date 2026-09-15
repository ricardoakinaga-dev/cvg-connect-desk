-- Migration: 0029_media_intake_recovery
-- Purpose: PROD-14-R2 — claim, lease, bounded retry and backoff for inbound media.
-- Additive: existing messages remain readable and legacy rows are immediately eligible.

--> statement-breakpoint
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_intake_attempt_count INTEGER NOT NULL DEFAULT 0;

--> statement-breakpoint
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_intake_next_attempt_at TIMESTAMPTZ;

--> statement-breakpoint
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_intake_lease_owner TEXT;

--> statement-breakpoint
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_intake_lease_until TIMESTAMPTZ;

--> statement-breakpoint
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_intake_last_error TEXT;

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_messages_media_intake_recovery
  ON messages(media_intake_next_attempt_at, created_at, id)
  WHERE media_url IS NULL;
