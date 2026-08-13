-- Migration: 0013_hash_session_tokens
-- Purpose: remove reversible session secrets from the database

ALTER TABLE "sessions"
ADD COLUMN IF NOT EXISTS "token_hash" text;

-- Existing raw tokens cannot be safely recovered after the column is removed.
-- Invalidating all sessions forces a fresh login during the security migration.
DELETE FROM "sessions";

ALTER TABLE "sessions"
ALTER COLUMN "token_hash" SET NOT NULL;

ALTER TABLE "sessions"
DROP COLUMN IF EXISTS "token";

CREATE UNIQUE INDEX IF NOT EXISTS "idx_sessions_token_hash"
ON "sessions" ("token_hash");

COMMENT ON COLUMN "sessions"."token_hash" IS 'SHA-256 hash of the HttpOnly session token';
