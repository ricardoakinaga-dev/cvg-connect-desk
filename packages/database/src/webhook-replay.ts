import { pgTable, text, timestamp, index } from 'drizzle-orm/pg-core';

/** Registro persistente de webhook event IDs (anti-replay, Phase 1 §4.2). */
export const webhookReplayLog = pgTable('webhook_replay_log', {
  eventId: text('event_id').primaryKey(),
  signatureHash: text('signature_hash').notNull(),
  processedAt: timestamp('processed_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at').notNull(),
}, (t) => ({
  expiresIdx: index('idx_webhook_replay_expires').on(t.expiresAt),
}));
