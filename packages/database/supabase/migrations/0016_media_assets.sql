-- Migration: 0016_media_assets
-- Purpose: Final-3/4 — metadados de mídia (storage + scan/quarentena).
-- Backward compatible: tabela nova.

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS media_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID REFERENCES messages(id),
  storage_driver TEXT NOT NULL DEFAULT 'external',
  storage_bucket TEXT,
  storage_key TEXT,
  sha256 TEXT,
  mime_type TEXT,
  size_bytes INTEGER,
  filename TEXT,
  scan_status TEXT NOT NULL DEFAULT 'PENDING_SCAN',
  storage_status TEXT NOT NULL DEFAULT 'EXTERNAL',
  retention_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT media_assets_scan_check CHECK (scan_status IN ('PENDING_SCAN', 'CLEAN', 'INFECTED', 'SCAN_FAILED')),
  CONSTRAINT media_assets_storage_check CHECK (storage_status IN ('EXTERNAL', 'QUARANTINED', 'STORED', 'DELETED'))
);

--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_assets_key ON media_assets(storage_key) WHERE storage_key IS NOT NULL;

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_media_assets_message ON media_assets(message_id);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_media_assets_sha ON media_assets(sha256);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_media_assets_scan ON media_assets(scan_status);
