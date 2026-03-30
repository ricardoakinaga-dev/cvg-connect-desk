CREATE TYPE "task_status" AS ENUM ('pending', 'in_progress', 'completed', 'cancelled');
CREATE TYPE "task_priority" AS ENUM ('low', 'medium', 'high', 'urgent');
CREATE TYPE "alert_status" AS ENUM ('active', 'acknowledged', 'resolved');
CREATE TYPE "alert_severity" AS ENUM ('info', 'warning', 'error', 'critical');
CREATE TYPE "alert_type" AS ENUM ('message', 'deadline', 'assignment', 'system');
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid REFERENCES "public"."conversations"("id"),
	"title" text NOT NULL,
	"description" text,
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"priority" "task_priority" DEFAULT 'medium' NOT NULL,
	"assigned_to" uuid REFERENCES "public"."users"("id"),
	"created_by" uuid REFERENCES "public"."users"("id"),
	"due_at" timestamp,
	"completed_at" timestamp,
	"metadata" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX "idx_tasks_conversation" ON "tasks"("conversation_id");
CREATE INDEX "idx_tasks_assigned" ON "tasks"("assigned_to");
CREATE INDEX "idx_tasks_status" ON "tasks"("status");
--> statement-breakpoint
CREATE TABLE "task_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL REFERENCES "public"."tasks"("id"),
	"status" "task_status" NOT NULL,
	"changed_by" uuid REFERENCES "public"."users"("id"),
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX "idx_task_status_history_task" ON "task_status_history"("task_id");
--> statement-breakpoint
CREATE TABLE "internal_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL REFERENCES "public"."conversations"("id"),
	"task_id" uuid REFERENCES "public"."tasks"("id"),
	"author_id" uuid NOT NULL REFERENCES "public"."users"("id"),
	"content" text NOT NULL,
	"metadata" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX "idx_notes_conversation" ON "internal_notes"("conversation_id");
CREATE INDEX "idx_notes_task" ON "internal_notes"("task_id");
CREATE INDEX "idx_notes_author" ON "internal_notes"("author_id");
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid REFERENCES "public"."conversations"("id"),
	"task_id" uuid REFERENCES "public"."tasks"("id"),
	"type" "alert_type" NOT NULL,
	"title" text NOT NULL,
	"message" text,
	"severity" "alert_severity" DEFAULT 'info' NOT NULL,
	"status" "alert_status" DEFAULT 'active' NOT NULL,
	"triggered_by" uuid REFERENCES "public"."users"("id"),
	"acknowledged_by" uuid REFERENCES "public"."users"("id"),
	"acknowledged_at" timestamp,
	"resolved_by" uuid REFERENCES "public"."users"("id"),
	"resolved_at" timestamp,
	"metadata" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX "idx_alerts_conversation" ON "alerts"("conversation_id");
CREATE INDEX "idx_alerts_task" ON "alerts"("task_id");
CREATE INDEX "idx_alerts_status" ON "alerts"("status");
--> statement-breakpoint
CREATE TABLE "alert_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alert_id" uuid NOT NULL REFERENCES "public"."alerts"("id"),
	"event_type" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"changed_by" uuid REFERENCES "public"."users"("id"),
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX "idx_alert_events_alert" ON "alert_events"("alert_id");
