-- Migration: 0022_privacy_operations
-- Purpose: AAA-17 / C07 — operações DSAR retomáveis com checkpoint por passo
-- (pseudonimização/eliminação idempotente), política D02 pendente.
--
-- Expand-only: tabela nova, nenhum objeto existente é alterado. Sem PII
-- persistida aqui: escopo = ids de setor; relatório = contagens/estado.

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS privacy_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id TEXT NOT NULL,
  contact_id UUID NOT NULL,
  operation TEXT NOT NULL DEFAULT 'pseudonymize',
  mode TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  policy_version TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT '{}',
  report TEXT NOT NULL DEFAULT '{}',
  steps TEXT NOT NULL DEFAULT '[]',
  checkpoint INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  actor_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT privacy_operations_mode_check CHECK (mode IN ('dry-run', 'execute')),
  CONSTRAINT privacy_operations_status_check CHECK (status IN ('planned', 'running', 'partial', 'completed', 'failed'))
);

--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS privacy_operations_request_id_unique ON privacy_operations(request_id);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_privacy_operations_contact ON privacy_operations(contact_id);
