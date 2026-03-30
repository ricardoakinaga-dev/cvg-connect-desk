-- Migration: Auth and Audit Tables
-- Created: 2026-03-29
-- Purpose: Add sessions and audit_logs tables for authentication and auditing

--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "public"."users"("id"),
	"token" text NOT NULL UNIQUE,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text
);
CREATE INDEX "idx_sessions_user" ON "sessions"("user_id");
CREATE UNIQUE INDEX "idx_sessions_token" ON "sessions"("token");

--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid REFERENCES "public"."users"("id"),
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"old_value" text,
	"new_value" text,
	"ip_address" text,
	"user_agent" text,
	"correlation_id" text,
	"metadata" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX "idx_audit_logs_user" ON "audit_logs"("user_id");
CREATE INDEX "idx_audit_logs_entity" ON "audit_logs"("entity_type", "entity_id");
CREATE INDEX "idx_audit_logs_action" ON "audit_logs"("action");
CREATE INDEX "idx_audit_logs_created" ON "audit_logs"("created_at");
