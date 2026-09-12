-- Migration: 0013_security_correctness
-- Purpose: Phase 1 — session token hashing, relacoes de contato, anti-replay webhook, PKs compostas.
-- Backward compatible: colunas novas NULLABLE; tokens legados migrados para hash.

--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pgcrypto;

--> statement-breakpoint
ALTER TABLE sessions
ADD COLUMN IF NOT EXISTS token_hash TEXT,
ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS absolute_expires_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS revoked_reason TEXT,
ADD COLUMN IF NOT EXISTS ip_hash TEXT,
ADD COLUMN IF NOT EXISTS user_agent_hash TEXT;

--> statement-breakpoint
UPDATE sessions SET token_hash = encode(digest(token, 'sha256'), 'hex') WHERE token_hash IS NULL;

--> statement-breakpoint
UPDATE sessions SET token = token_hash WHERE token_hash IS NOT NULL AND token != token_hash;

--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);

--> statement-breakpoint
UPDATE contacts SET tutor_id = NULL WHERE tutor_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tutors WHERE tutors.id = contacts.tutor_id);

--> statement-breakpoint
UPDATE contacts SET patient_id = NULL WHERE patient_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM patients WHERE patients.id = contacts.patient_id);

--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_tutor_id_fkey' AND conrelid = 'contacts'::regclass) THEN
    ALTER TABLE contacts ADD CONSTRAINT contacts_tutor_id_fkey FOREIGN KEY (tutor_id) REFERENCES tutors(id);
  END IF;
END $$;

--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_patient_id_fkey' AND conrelid = 'contacts'::regclass) THEN
    ALTER TABLE contacts ADD CONSTRAINT contacts_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES patients(id);
  END IF;
END $$;

--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_external ON contacts(external_id);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);

--> statement-breakpoint
DELETE FROM role_permissions a USING role_permissions b WHERE a.ctid < b.ctid AND a.role_id = b.role_id AND a.permission_id = b.permission_id;

--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'role_permissions_pkey' AND conrelid = 'role_permissions'::regclass) THEN
    ALTER TABLE role_permissions ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (role_id, permission_id);
  END IF;
END $$;

--> statement-breakpoint
DELETE FROM user_roles a USING user_roles b WHERE a.ctid < b.ctid AND a.user_id = b.user_id AND a.role_id = b.role_id;

--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_roles_pkey' AND conrelid = 'user_roles'::regclass) THEN
    ALTER TABLE user_roles ADD CONSTRAINT user_roles_pkey PRIMARY KEY (user_id, role_id);
  END IF;
END $$;

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS webhook_replay_log (
  event_id TEXT PRIMARY KEY,
  signature_hash TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours'
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_webhook_replay_expires ON webhook_replay_log(expires_at);
