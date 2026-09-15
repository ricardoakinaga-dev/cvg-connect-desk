import { pgTable, text, timestamp, integer, index } from 'drizzle-orm/pg-core';

/**
 * Registro persistente de webhook event IDs (anti-replay, Phase 1 §4.2).
 *
 * PROD-07 / migration 0024 — recibo reivindicável em duas fases:
 * - `state`: 'pending' | 'failed' | 'completed' (validado na aplicação);
 * - `payloadHash`: sha256 dos bytes exatos assinados, para distinguir replay
 *   verdadeiro (mesmo payload) de reuso indevido de event_id (mismatch);
 * - `completedAt`: fim do processamento do negócio (só em `completed`);
 * - `attempts`: número de reivindicações (claim) do recibo;
 * - `processedAt`: última reivindicação/transição (nome histórico mantido);
 * - `expiresAt`: TTL de retenção (24h), preservado da 0013.
 */
export const webhookReplayLog = pgTable('webhook_replay_log', {
  eventId: text('event_id').primaryKey(),
  signatureHash: text('signature_hash').notNull(),
  state: text('state').notNull().default('pending'),
  payloadHash: text('payload_hash'),
  processedAt: timestamp('processed_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  attempts: integer('attempts').notNull().default(0),
  expiresAt: timestamp('expires_at').notNull(),
}, (t) => ({
  expiresIdx: index('idx_webhook_replay_expires').on(t.expiresAt),
  stateIdx: index('idx_webhook_replay_state').on(t.state),
}));

export type WebhookReplayLogRow = typeof webhookReplayLog.$inferSelect;
