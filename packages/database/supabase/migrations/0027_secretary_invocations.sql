-- Migration: 0027_secretary_invocations
-- Purpose: PROD-10 / C04+C08 (G03) — estado DURÁVEL de cada invocação da
-- Secretary disparada pelo worker assíncrono.
--
-- A intenção durável é o evento `message.persisted` do inbound, commitado na
-- MESMA transação da mensagem (persistInboundAtomically); o worker o reclama
-- com lease e executa a invocação. Esta tabela registra o estado da invocação
-- (pending/processing/completed/failed/unknown) com chave estável por mensagem
-- (`invocation_key = 'inbound:<messageId>'`), de modo que replay/crash:
--   * não reexecutam a IA quando a invocação já concluiu;
--   * não duplicam a resposta ao contato (o envio usa o caminho idempotente
--     C05 com a chave `secretary-reply:<externalMessageId>`);
--   * deixam causa/erro observáveis para operação.
--
-- Expand-only: tabela nova e índices novos; nenhuma tabela/linha existente é
-- alterada. Rollback = DROP TABLE (nenhum consumidor antigo depende dela).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS secretary_invocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invocation_key TEXT NOT NULL,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  event_id TEXT,
  consumer_id TEXT,
  action TEXT NOT NULL DEFAULT 'classify',
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  error_code TEXT,
  result_ref TEXT,
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT secretary_invocations_status_check
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'unknown'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS secretary_invocations_key_unique
  ON secretary_invocations (invocation_key);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_secretary_invocations_conversation
  ON secretary_invocations (conversation_id, status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_secretary_invocations_message
  ON secretary_invocations (message_id);
