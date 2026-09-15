-- Migration: 0026_worker_effect_receipts
-- Purpose: PROD-09 / C04 (G03) — dedup durável de efeitos de handler por
-- (event_id, consumer_id, effect_type). O chamador grava o recibo e o efeito
-- na MESMA transação; crash após o efeito e antes do ACK não duplica no
-- replay. Expand-only: tabela nova e novo valor de enum aditivo; nenhuma
-- linha/tabela existente é alterada.
--
-- Inclui `handoff` no enum `alert_type`: o handler de `handoff.completed` do
-- worker usa esse tipo desde sempre, mas ele não existia no enum — o efeito
-- nunca pôde ser criado (BE11). Aditivo, nenhum valor removido.
--> statement-breakpoint
ALTER TYPE "alert_type" ADD VALUE IF NOT EXISTS 'handoff';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS worker_effect_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL,
  consumer_id TEXT NOT NULL,
  effect_type TEXT NOT NULL,
  result_ref TEXT,
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS worker_effect_receipts_unique
  ON worker_effect_receipts (event_id, consumer_id, effect_type);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_worker_effect_receipts_event
  ON worker_effect_receipts (event_id, consumer_id);
