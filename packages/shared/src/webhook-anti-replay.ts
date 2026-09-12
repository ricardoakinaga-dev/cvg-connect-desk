import { FastifyRequest } from 'fastify';
import { db, schema } from '@cvg/database';
import { eq } from 'drizzle-orm';

/**
 * Anti-replay para webhooks (Phase 1 — §4.2).
 *
 * Contrato:
 * - X-Webhook-Timestamp: epoch seconds (string)
 * - X-Webhook-Event-Id: id único do evento (opaco, max 256)
 * - Assinatura cobre: `${timestamp}.${rawBody}` (documentado em MESSAGING_CONTRACTS).
 * - Modo legado (sem headers): aceito apenas fora de produção; registrado como
 *   `missing_timestamp`/`missing_event_id` para observabilidade.
 */

export const MAX_WEBHOOK_CLOCK_SKEW_SECONDS = Number(process.env.MAX_WEBHOOK_CLOCK_SKEW_SECONDS) || 300;
const WEBHOOK_EVENT_ID_TTL_SECONDS = Number(process.env.WEBHOOK_EVENT_ID_TTL_SECONDS) || 86400;

export type WebhookReplayReason =
  | 'missing_timestamp'
  | 'invalid_timestamp'
  | 'timestamp_too_old'
  | 'timestamp_too_future'
  | 'missing_event_id'
  | 'duplicate_event_id';

export interface WebhookReplayCheck {
  ok: boolean;
  reason?: WebhookReplayReason;
  message?: string;
  timestamp?: number;
  eventId?: string;
  legacyMode?: boolean;
}

function isProduction(): boolean {
  const env = (process.env.NODE_ENV || process.env.DESK_ENV || '').toLowerCase();
  return env === 'production' || env === 'prod';
}

export function validateWebhookTimestamp(raw: unknown, nowSeconds = Math.floor(Date.now() / 1000)): WebhookReplayCheck {
  if (raw === undefined || raw === null || raw === '') {
    if (isProduction()) {
      return { ok: false, reason: 'missing_timestamp', message: 'Missing X-Webhook-Timestamp' };
    }
    return { ok: true, legacyMode: true, reason: 'missing_timestamp' };
  }
  const timestamp = Number(raw);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return { ok: false, reason: 'invalid_timestamp', message: 'Invalid X-Webhook-Timestamp' };
  }
  const skew = Math.abs(nowSeconds - timestamp);
  if (nowSeconds - timestamp > MAX_WEBHOOK_CLOCK_SKEW_SECONDS) {
    return { ok: false, reason: 'timestamp_too_old', message: 'Webhook timestamp too old (replay suspected)' };
  }
  if (timestamp - nowSeconds > MAX_WEBHOOK_CLOCK_SKEW_SECONDS) {
    void skew;
    return { ok: false, reason: 'timestamp_too_future', message: 'Webhook timestamp too far in the future' };
  }
  return { ok: true, timestamp };
}

export function extractWebhookEventId(request: FastifyRequest): string | undefined {
  const raw = request.headers['x-webhook-event-id'];
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 256) return undefined;
  return trimmed;
}

export interface WebhookReplayStore {
  has(eventId: string): Promise<boolean>;
  add(eventId: string, signatureHash: string, ttlSeconds?: number): Promise<boolean>;
}

export class InMemoryWebhookReplayStore implements WebhookReplayStore {
  private seen = new Map<string, number>();

  async has(eventId: string): Promise<boolean> {
    const expiresAt = this.seen.get(eventId);
    if (expiresAt === undefined) return false;
    if (Date.now() > expiresAt) {
      this.seen.delete(eventId);
      return false;
    }
    return true;
  }

  async add(eventId: string, _signatureHash: string, ttlSeconds = WEBHOOK_EVENT_ID_TTL_SECONDS): Promise<boolean> {
    if (await this.has(eventId)) return false;
    this.seen.set(eventId, Date.now() + ttlSeconds * 1000);
    return true;
  }
}

export class PostgresWebhookReplayStore implements WebhookReplayStore {
  async has(eventId: string): Promise<boolean> {
    const rows = await db
      .select({ eventId: schema.webhookReplayLog.eventId })
      .from(schema.webhookReplayLog)
      .where(eq(schema.webhookReplayLog.eventId, eventId))
      .limit(1);
    return rows.length > 0;
  }

  async add(eventId: string, signatureHash: string, ttlSeconds = WEBHOOK_EVENT_ID_TTL_SECONDS): Promise<boolean> {
    try {
      await db.insert(schema.webhookReplayLog).values({
        eventId,
        signatureHash,
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      });
      return true;
    } catch {
      return false;
    }
  }
}

let defaultStore: WebhookReplayStore | null = null;

export function getDefaultWebhookReplayStore(): WebhookReplayStore {
  if (!defaultStore) {
    defaultStore = process.env.DATABASE_URL ? new PostgresWebhookReplayStore() : new InMemoryWebhookReplayStore();
  }
  return defaultStore;
}

export function setDefaultWebhookReplayStore(store: WebhookReplayStore): void {
  defaultStore = store;
}

/** Monta a mensagem assinada: `${timestamp}.${rawBody}` ou `rawBody` em modo legado. */
export function buildWebhookSignaturePayload(rawBody: string, timestamp?: number): string {
  return timestamp !== undefined ? `${timestamp}.${rawBody}` : rawBody;
}
