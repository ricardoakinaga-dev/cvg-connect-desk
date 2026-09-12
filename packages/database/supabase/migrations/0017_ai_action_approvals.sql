-- Migration: 0017_ai_action_approvals
-- Purpose: Final-10 — aprovações humanas para ações sensíveis de IA.
-- Backward compatible: tabela nova.

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS ai_action_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invocation_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  args_hash TEXT NOT NULL,
  args_sanitized JSONB NOT NULL DEFAULT '{}',
  requested_by TEXT NOT NULL DEFAULT 'secretary-agent',
  status TEXT NOT NULL DEFAULT 'PENDING',
  reviewer_id UUID REFERENCES users(id),
  decided_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_approvals_status_check CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED')),
  CONSTRAINT ai_approvals_unique_tool_call UNIQUE (invocation_id, tool, args_hash)
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_ai_approvals_status ON ai_action_approvals(status);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_ai_approvals_invocation ON ai_action_approvals(invocation_id);
