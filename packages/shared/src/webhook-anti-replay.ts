import { FastifyRequest } from 'fastify';
import { db, schema } from '@cvg/database';
import { and, eq, isNull, lt, ne, sql } from 'drizzle-orm';

/**
 * Anti-replay para webhooks (Phase 1 — §4.2) + recibo recuperável (PROD-07).
 *
 * Contrato:
 * - X-Webhook-Timestamp: epoch seconds (string)
 * - X-Webhook-Event-Id: id único do evento (opaco, max 256)
 * - Assinatura cobre: `${timestamp}.${rawBody}` (documentado em MESSAGING_CONTRACTS).
 * - Modo legado (sem headers): aceito apenas fora de produção; registrado como
 *   `missing_timestamp`/`missing_event_id` para observabilidade.
 *
 * Recibo em duas fases (0024): o guard reivindica (`claim`) o eventId antes do
 * handler; o negócio só é dado como concluído (`complete`) depois do sucesso.
 * Falha de negócio marca `failed` (retry imediato); crash deixa `pending` e a
 * reivindicação expira por `processed_at` (janela de recuperação). Assim o
 * retry legítimo volta a ser aceito sem afrouxar HMAC/timestamp/dedup.
 */

export const MAX_WEBHOOK_CLOCK_SKEW_SECONDS = Number(process.env.MAX_WEBHOOK_CLOCK_SKEW_SECONDS) || 300;
const WEBHOOK_EVENT_ID_TTL_SECONDS = Number(process.env.WEBHOOK_EVENT_ID_TTL_SECONDS) || 86400;

/**
 * Janela máxima em que um recibo `pending` é considerado "em andamento". Após
 * ela, um crash sem transição é recuperável pelo próximo retry. `failed` é
 * recuperável de imediato.
 */
export function webhookClaimStaleSeconds(): number {
  const raw = Number(process.env.WEBHOOK_REPLAY_STALE_SECONDS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 120;
}

export type WebhookReplayReason =
  | 'missing_timestamp'
  | 'invalid_timestamp'
  | 'timestamp_too_old'
  | 'timestamp_too_future'
  | 'missing_event_id'
  | 'duplicate_event_id'
  | 'event_payload_mismatch'
  | 'event_in_progress';

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

/** Estado do recibo: em processamento, falhou (retryável) ou concluído. */
export type WebhookReplayState = 'pending' | 'failed' | 'completed';

/**
 * Resultado da reivindicação atômica de um eventId.
 * - `claimed_new`: recibo novo, pode processar;
 * - `claimed_retry`: mesmo payload e recibo retryável (failed ou
 *   pending além da janela de stale), pode reprocessar;
 * - `duplicate`: recibo já `completed` — replay verdadeiro, sem efeito novo;
 * - `mismatch`: mesmo eventId com payload diferente — rejeitar. A assinatura
 *   pode mudar a cada tentativa porque o timestamp assinado é renovado;
 * - `in_progress`: recibo `pending` recente (outra entrega em execução).
 */
export type WebhookClaimAction = 'claimed_new' | 'claimed_retry' | 'duplicate' | 'mismatch' | 'in_progress';

export interface WebhookClaimResult {
  action: WebhookClaimAction;
}

export interface WebhookClaimHandle {
  eventId: string;
  signatureHash: string;
  payloadHash: string;
  recovered: boolean;
}

export interface WebhookReplayStore {
  has(eventId: string): Promise<boolean>;
  claim(
    eventId: string,
    signatureHash: string,
    payloadHash: string,
    ttlSeconds?: number,
  ): Promise<WebhookClaimResult>;
  complete(eventId: string): Promise<boolean>;
  fail(eventId: string): Promise<void>;
}

export class InMemoryWebhookReplayStore implements WebhookReplayStore {
  private seen = new Map<string, { signatureHash: string; payloadHash: string; state: WebhookReplayState; claimedAt: number; expiresAt: number; attempts: number }>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  async has(eventId: string): Promise<boolean> {
    return this.seen.has(eventId);
  }

  async claim(
    eventId: string,
    signatureHash: string,
    payloadHash: string,
    ttlSeconds = WEBHOOK_EVENT_ID_TTL_SECONDS,
  ): Promise<WebhookClaimResult> {
    const now = this.now();
    const existing = this.seen.get(eventId);
    if (!existing) {
      this.seen.set(eventId, {
        signatureHash,
        payloadHash,
        state: 'pending',
        claimedAt: now,
        expiresAt: now + ttlSeconds * 1000,
        attempts: 1,
      });
      return { action: 'claimed_new' };
    }
    if (existing.payloadHash !== payloadHash) {
      return { action: 'mismatch' };
    }
    if (existing.state === 'completed') {
      return { action: 'duplicate' };
    }
    const staleBefore = now - webhookClaimStaleSeconds() * 1000;
    if (existing.state === 'failed' || existing.claimedAt <= staleBefore) {
      // A autenticação é por tentativa; um retry pode ter outro timestamp e
      // portanto outro HMAC, sem mudar a identidade do payload.
      existing.signatureHash = signatureHash;
      existing.state = 'pending';
      existing.claimedAt = now;
      existing.expiresAt = now + ttlSeconds * 1000;
      existing.attempts += 1;
      return { action: 'claimed_retry' };
    }
    return { action: 'in_progress' };
  }

  async complete(eventId: string): Promise<boolean> {
    const existing = this.seen.get(eventId);
    if (!existing || existing.state === 'completed') return false;
    existing.state = 'completed';
    return true;
  }

  async fail(eventId: string): Promise<void> {
    const existing = this.seen.get(eventId);
    if (!existing || existing.state === 'completed') return;
    existing.state = 'failed';
    existing.claimedAt = this.now();
  }
}

/** Código do PostgreSQL para violação de unicidade (23505), incl. causa do drizzle. */
function postgresErrorCode(error: unknown): string | undefined {
  const direct = (error as { code?: string }).code;
  if (direct) return direct;
  return (error as { cause?: { code?: string } }).cause?.code;
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

  async claim(
    eventId: string,
    signatureHash: string,
    payloadHash: string,
    ttlSeconds = WEBHOOK_EVENT_ID_TTL_SECONDS,
  ): Promise<WebhookClaimResult> {
    // Loop curto: cobre corrida entre INSERT ... ON CONFLICT e SELECT (registro
    // expurgado/atualizado por outro concorrente no meio).
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

      try {
        const inserted = await db
          .insert(schema.webhookReplayLog)
          .values({
            eventId,
            signatureHash,
            payloadHash,
            state: 'pending',
            attempts: 1,
            processedAt: now,
            expiresAt,
          })
          .onConflictDoNothing({ target: schema.webhookReplayLog.eventId })
          .returning({ eventId: schema.webhookReplayLog.eventId });
        if (inserted.length > 0) return { action: 'claimed_new' };
      } catch (error) {
        // Unicidade concorrente é conflito esperado; qualquer outro erro
        // (conexão, permissão, schema) deve PROPAGAR — nunca virar "duplicado".
        if (postgresErrorCode(error) !== '23505') throw error;
      }

      const [row] = await db
        .select()
        .from(schema.webhookReplayLog)
        .where(eq(schema.webhookReplayLog.eventId, eventId))
        .limit(1);
      if (!row) continue;

      const legacyPayload = row.payloadHash === null;
      if (!legacyPayload && row.payloadHash !== payloadHash) return { action: 'mismatch' };
      if (row.state === 'completed') return { action: 'duplicate' };

      const staleBefore = new Date(now.getTime() - webhookClaimStaleSeconds() * 1000);
      const retryable =
        legacyPayload ||
        row.state === 'failed' ||
        (row.state === 'pending' && row.processedAt.getTime() <= staleBefore.getTime());
      if (!retryable) return { action: 'in_progress' };

      const claimed = legacyPayload
        ? // Linha legada (anterior à 0024, payload_hash NULL): adota os hashes
          // atuais na primeira recuperação em vez de travar o evento.
          await db
            .update(schema.webhookReplayLog)
            .set({
              signatureHash,
              payloadHash,
              state: 'pending',
              attempts: sql`${schema.webhookReplayLog.attempts} + 1`,
              processedAt: now,
              expiresAt,
            })
            .where(
              and(
                eq(schema.webhookReplayLog.eventId, eventId),
                isNull(schema.webhookReplayLog.payloadHash),
              ),
            )
            .returning({ eventId: schema.webhookReplayLog.eventId })
          : row.state === 'failed'
            ? await db
                .update(schema.webhookReplayLog)
                .set({
                  signatureHash,
                  state: 'pending',
                  attempts: sql`${schema.webhookReplayLog.attempts} + 1`,
                  processedAt: now,
                  expiresAt,
                })
                .where(
                  and(
                    eq(schema.webhookReplayLog.eventId, eventId),
                    eq(schema.webhookReplayLog.state, 'failed'),
                    eq(schema.webhookReplayLog.payloadHash, payloadHash),
                  ),
                )
                .returning({ eventId: schema.webhookReplayLog.eventId })
            : await db
                .update(schema.webhookReplayLog)
                .set({
                  signatureHash,
                  state: 'pending',
                  attempts: sql`${schema.webhookReplayLog.attempts} + 1`,
                  processedAt: now,
                  expiresAt,
                })
                .where(
                  and(
                    eq(schema.webhookReplayLog.eventId, eventId),
                    eq(schema.webhookReplayLog.state, 'pending'),
                    eq(schema.webhookReplayLog.payloadHash, payloadHash),
                    lt(schema.webhookReplayLog.processedAt, staleBefore),
                  ),
                )
                .returning({ eventId: schema.webhookReplayLog.eventId });

      if (claimed.length > 0) return { action: 'claimed_retry' };
    }

    return { action: 'in_progress' };
  }

  async complete(eventId: string): Promise<boolean> {
    const completed = await db
      .update(schema.webhookReplayLog)
      .set({ state: 'completed', completedAt: new Date() })
      .where(
        and(
          eq(schema.webhookReplayLog.eventId, eventId),
          ne(schema.webhookReplayLog.state, 'completed'),
        ),
      )
      .returning({ eventId: schema.webhookReplayLog.eventId });
    return completed.length > 0;
  }

  async fail(eventId: string): Promise<void> {
    await db
      .update(schema.webhookReplayLog)
      .set({ state: 'failed', processedAt: new Date() })
      .where(
        and(
          eq(schema.webhookReplayLog.eventId, eventId),
          ne(schema.webhookReplayLog.state, 'completed'),
        ),
      );
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

/**
 * Anexa a reivindicação ao request para que o controller marque o desfecho.
 * Ficam apenas dados não sensíveis (hashes e id opaco do gateway).
 */
export function setWebhookClaim(request: FastifyRequest, claim: WebhookClaimHandle): void {
  (request as unknown as { webhookClaim?: WebhookClaimHandle }).webhookClaim = claim;
}

export function getWebhookClaim(request: FastifyRequest): WebhookClaimHandle | undefined {
  return (request as unknown as { webhookClaim?: WebhookClaimHandle }).webhookClaim;
}

/**
 * Marca o recibo como concluído. Erro do store PROPAGA: sem confirmação
 * durável, a resposta não pode ser 2xx como "processado".
 */
export async function completeWebhookClaim(request: FastifyRequest): Promise<void> {
  const claim = getWebhookClaim(request);
  if (!claim) return;
  await getDefaultWebhookReplayStore().complete(claim.eventId);
}

/**
 * Marca o recibo como retryável. Best-effort: se o store falhar, o recibo
 * permanece `pending` e a janela de stale cobre a recuperação.
 */
export async function failWebhookClaim(
  request: FastifyRequest,
  log?: Pick<FastifyRequest['log'], 'warn'>,
): Promise<void> {
  const claim = getWebhookClaim(request);
  if (!claim) return;
  try {
    await getDefaultWebhookReplayStore().fail(claim.eventId);
  } catch (error) {
    try {
      log?.warn({ err: error, event_id: claim.eventId }, '[WebhookReplay] falha ao marcar recibo como retryável');
    } catch {
      // Log nunca quebra o caminho de erro do webhook.
    }
  }
}

/** Monta a mensagem assinada: `${timestamp}.${rawBody}` ou `rawBody` em modo legado. */
export function buildWebhookSignaturePayload(rawBody: string, timestamp?: number): string {
  return timestamp !== undefined ? `${timestamp}.${rawBody}` : rawBody;
}
