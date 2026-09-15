-- Migration: 0028_ai_budget_and_approval_hardening
-- Purpose: PROD-13 / C08 (G05, BE13/BE14/BE19) — fecha o budget DURÁVEL por
-- conversa e endurece o workflow de aprovação de ferramentas IA.
--
-- Alterações (todas expand-only; nenhuma linha deixa de satisfazer as novas
-- constraints nem coluna obrigatória é adicionada sem default):
--  1) `secretary_invocations.status` aceita o terminal `denied` — o bloqueio de
--     orçamento fica registrado de forma durável (auditoria sem PII) e NÃO
--     conta como invocação admitida (a contagem usa `status <> 'denied'`).
--  2) `ai_action_approvals.status` aceita `CONSUMED` (uso único) e ganha
--     `consumed_at` (instante do consumo) e `scope_sanitized` (escopo
--     vinculado ao hash canônico do payload ORIGINAL, já sanitizado).
--
-- Rollback: reverter as constraints ao conjunto anterior e remover as colunas
-- novas (`DROP COLUMN consumed_at, scope_sanitized`) — nenhuma linha existente
-- é removida ou reescrita.
--> statement-breakpoint
ALTER TABLE secretary_invocations
  DROP CONSTRAINT IF EXISTS secretary_invocations_status_check;
--> statement-breakpoint
ALTER TABLE secretary_invocations
  ADD CONSTRAINT secretary_invocations_status_check
  CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'unknown', 'denied'));
--> statement-breakpoint
ALTER TABLE ai_action_approvals
  DROP CONSTRAINT IF EXISTS ai_approvals_status_check;
--> statement-breakpoint
ALTER TABLE ai_action_approvals
  ADD CONSTRAINT ai_approvals_status_check
  CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CONSUMED'));
--> statement-breakpoint
ALTER TABLE ai_action_approvals
  ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ;
--> statement-breakpoint
ALTER TABLE ai_action_approvals
  ADD COLUMN IF NOT EXISTS scope_sanitized JSONB NOT NULL DEFAULT '{}';
