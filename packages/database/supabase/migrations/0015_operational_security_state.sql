-- Migration: 0015_operational_security_state
-- Purpose: persist webhook security counters and gateway nonce claims

CREATE TABLE IF NOT EXISTS "webhook_security_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "reason" text NOT NULL,
  "allowed" boolean NOT NULL,
  "webhook_mode" text NOT NULL,
  "has_secret" boolean NOT NULL,
  "signature_present" boolean,
  "status_code" integer,
  "occurred_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_webhook_security_reason"
ON "webhook_security_events" ("reason");

CREATE INDEX IF NOT EXISTS "idx_webhook_security_occurred"
ON "webhook_security_events" ("occurred_at");

CREATE TABLE IF NOT EXISTS "gateway_request_nonces" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "scope" text NOT NULL,
  "nonce" text NOT NULL,
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_gateway_nonce_scope_nonce"
ON "gateway_request_nonces" ("scope", "nonce");

CREATE INDEX IF NOT EXISTS "idx_gateway_nonce_expires"
ON "gateway_request_nonces" ("expires_at");
