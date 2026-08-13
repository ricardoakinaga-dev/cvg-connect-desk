-- Migration: 0014_dead_letter_events
-- Purpose: persist terminal event failures across process restarts and replicas

CREATE TABLE IF NOT EXISTS "dead_letter_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_type" text NOT NULL,
  "event_id" text NOT NULL,
  "payload" text NOT NULL,
  "error" text NOT NULL,
  "failed_at" timestamp DEFAULT now() NOT NULL,
  "retry_count" integer DEFAULT 0 NOT NULL,
  "handler_name" text NOT NULL,
  "source_event" text,
  "failure_context" text,
  "resolved" boolean DEFAULT false NOT NULL,
  "resolved_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_dead_letter_event" ON "dead_letter_events" ("event_id");
CREATE INDEX IF NOT EXISTS "idx_dead_letter_unresolved" ON "dead_letter_events" ("resolved", "failed_at");
CREATE INDEX IF NOT EXISTS "idx_dead_letter_handler" ON "dead_letter_events" ("handler_name");
