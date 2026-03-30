CREATE TYPE "conversation_status" AS ENUM ('open', 'pending', 'closed', 'archived');
CREATE TYPE "message_direction" AS ENUM ('inbound', 'outbound');
CREATE TYPE "message_status" AS ENUM ('pending', 'sent', 'delivered', 'failed');
CREATE TYPE "interaction_type" AS ENUM ('clinical', 'commercial', 'urgent');
--> statement-breakpoint
CREATE TABLE "tutors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" text,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" text,
	"name" text NOT NULL,
	"species" text,
	"breed" text,
	"tutor_id" uuid REFERENCES "public"."tutors"("id"),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" text,
	"phone" text,
	"name" text,
	"email" text,
	"tutor_id" uuid,
	"patient_id" uuid,
	"metadata" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid REFERENCES "public"."contacts"("id"),
	"status" "conversation_status" DEFAULT 'open' NOT NULL,
	"interaction_type" "interaction_type",
	"queue_id" uuid REFERENCES "public"."queues"("id"),
	"team_id" uuid REFERENCES "public"."teams"("id"),
	"is_active" boolean DEFAULT true NOT NULL,
	"external_channel_id" text,
	"external_conversation_id" text,
	"metadata" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp
);
--> statement-breakpoint
CREATE INDEX "idx_conversations_contact" ON "conversations"("contact_id");
CREATE INDEX "idx_conversations_status" ON "conversations"("status");
CREATE UNIQUE INDEX "idx_conversations_external" ON "conversations"("external_conversation_id");
--> statement-breakpoint
CREATE TABLE "conversation_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL REFERENCES "public"."conversations"("id"),
	"status" "conversation_status" NOT NULL,
	"changed_by" uuid REFERENCES "public"."users"("id"),
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX "idx_status_history_conversation" ON "conversation_status_history"("conversation_id");
--> statement-breakpoint
CREATE TABLE "conversation_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL REFERENCES "public"."conversations"("id"),
	"user_id" uuid NOT NULL REFERENCES "public"."users"("id"),
	"assigned_by" uuid REFERENCES "public"."users"("id"),
	"assigned_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX "idx_assignments_conversation" ON "conversation_assignments"("conversation_id");
CREATE INDEX "idx_assignments_user" ON "conversation_assignments"("user_id");
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL REFERENCES "public"."conversations"("id"),
	"direction" "message_direction" NOT NULL,
	"content" text NOT NULL,
	"sender" text,
	"sender_type" text,
	"recipient" text,
	"status" "message_status" DEFAULT 'pending' NOT NULL,
	"external_message_id" text,
	"metadata" text,
	"sent_at" timestamp,
	"delivered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX "idx_messages_conversation" ON "messages"("conversation_id");
CREATE UNIQUE INDEX "idx_messages_external" ON "messages"("external_message_id");
CREATE INDEX "idx_messages_direction" ON "messages"("direction");
