-- Migration 0009: Media fields for messages
-- Data: 2026-03-31

ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_url TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_type TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_mimetype TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_filename TEXT;

CREATE INDEX IF NOT EXISTS idx_messages_media_type ON messages(media_type);
