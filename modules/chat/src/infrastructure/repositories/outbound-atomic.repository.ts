import { createHash } from 'node:crypto';
import { db, schema, type DatabaseExecutor } from '@cvg/database';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import {
  createMessagePersistedEvent,
  outboxIntentWriter,
  publishRealtimeHintsAfterCommit,
  type EventEnvelope,
} from '@cvg/events';
import { messageRepository, type Message, type NewMessage } from './message.repository';

/**
 * AAA-12 / C04 + C03 D-C03-1 — persistência atômica da intenção outbound.
 *
 * Em UMA transação de banco:
 *   1. serializa a chave por (ator, conversa, idempotencyKey) com advisory
 *      lock transacional (corridas não criam mensagem perdedora);
 *   2. compara o fingerprint do payload; reuso incompatível ⇒ conflito (409);
 *   3. cria mensagem + mapping + intenção `message.persisted` no mesmo `tx`.
 *
 * TTL: `expires_at` delimita a janela de uma intenção não-terminal. Vencida,
 * a intenção vira falha terminal (`failed`) e a resposta marca `expired`, sem
 * reenvio silencioso — o registro de mapeamento é o tombstone da chave.
 *
 * Provider sem idempotência: a intenção nasce em `unknown_reconciling` (não em
 * `pending`), então um crash entre o commit e a resposta do provider não pode
 * ser reprocessado cegamente; exige reconciliação explícita.
 */

export type OutboundDelivery = typeof schema.outboundDeliveries.$inferSelect;
export type OutboundOutcome = 'accepted' | 'pending' | 'sent' | 'failed' | 'unknown_reconciling';

export const DEFAULT_OUTBOUND_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
export const OUTBOUND_TTL_EXPIRED_ERROR = 'idempotency_ttl_expired';

const TERMINAL_DELIVERY_STATUSES: ReadonlySet<string> = new Set([
  'sent',
  'failed',
  'unknown_reconciling',
]);

/**
 * Sinaliza que um writer ANTIGO commitou uma linha crua com a mesma chave
 * enquanto a transação nova estava aberta. Lançar aborta a transação (rollback
 * de mensagem/mapping/outbox) e vira conflito 409 fail-closed.
 */
class OldWriterConflictError extends Error {
  constructor() {
    super('AAA-12: writer antigo detectado na segunda checagem (rollback)');
    Object.setPrototypeOf(this, OldWriterConflictError.prototype);
  }
}

/**
 * Linha no formato do código ANTERIOR: `idempotency_key` = chave crua e algum
 * de `client_key`/`scope_actor_id`/`scope_conversation_id` NULL. Detecta tanto
 * writers antigos quanto linhas que escaparam do backfill.
 */
async function findOldWriterRow(
  executor: DatabaseExecutor,
  clientKey: string,
): Promise<{ id: string } | null> {
  const [row] = await executor
    .select({ id: schema.outboundDeliveries.id })
    .from(schema.outboundDeliveries)
    .where(
      and(
        eq(schema.outboundDeliveries.idempotencyKey, clientKey),
        or(
          isNull(schema.outboundDeliveries.clientKey),
          isNull(schema.outboundDeliveries.scopeActorId),
          isNull(schema.outboundDeliveries.scopeConversationId),
        ),
      ),
    );
  return row ?? null;
}

export function resolveOutboundIdempotencyTtlMs(env = process.env.OUTBOUND_IDEMPOTENCY_TTL_MS): number {
  const parsed = Number(env);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_OUTBOUND_IDEMPOTENCY_TTL_MS;
  return Math.floor(parsed);
}

export interface OutboundFingerprintInput {
  conversationId: string;
  content: string;
  recipient: string;
  sender?: string;
  senderType?: string;
  instance?: string;
  mediaUrl?: string;
  mediaType?: string;
  mediaMimetype?: string;
  mediaFilename?: string;
  metadata?: Record<string, unknown>;
}

/** JSON determinístico (chaves ordenadas; ordem de arrays preservada). */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}

/**
 * Fingerprint canônico da INTENÇÃO: mesmo conteúdo lógico ⇒ mesmo hash,
 * payload divergente com a mesma chave ⇒ hash diferente (409).
 */
export function computeOutboundFingerprint(input: OutboundFingerprintInput): string {
  const canonical = stableStringify({
    conversationId: input.conversationId,
    content: input.content ?? '',
    recipient: input.recipient ?? null,
    sender: input.sender ?? null,
    senderType: input.senderType ?? null,
    instance: input.instance ?? null,
    mediaUrl: input.mediaUrl ?? null,
    mediaType: input.mediaType ?? null,
    mediaMimetype: input.mediaMimetype ?? null,
    mediaFilename: input.mediaFilename ?? null,
    metadata: input.metadata ?? null,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Chave de ARMAZENAMENTO estável e escopada (migration 0021): preserva o
 * índice único global legado (`ON CONFLICT (idempotency_key)`) enquanto a
 * mesma chave crua pode existir em atores/conversas distintos — a chave crua
 * fica em `client_key` e a unicidade C04 é o índice escopado.
 */
export function computeOutboundStorageKey(
  actorId: string,
  conversationId: string,
  clientKey: string,
): string {
  return `c04:${createHash('sha256')
    .update(JSON.stringify([actorId, conversationId, clientKey]))
    .digest('hex')}`;
}

export interface PersistOutboundIntentInput {
  actorId: string;
  idempotencyKey: string;
  payloadFingerprint: string;
  ttlMs?: number;
  /** `false` ⇒ a intenção já nasce `unknown_reconciling` (sem reenvio cego). */
  providerIdempotent?: boolean;
  /** A direção é fixada em `outbound` pelo núcleo atômico. */
  message: Omit<NewMessage, 'status' | 'direction'>;
}

export type PersistOutboundIntentResult =
  | { kind: 'created'; message: Message; delivery: OutboundDelivery; event: EventEnvelope }
  | { kind: 'duplicate'; message: Message; delivery: OutboundDelivery; expired: boolean }
  | { kind: 'conflict'; reason: 'payload_mismatch' | 'fingerprint_missing' | 'key_archived' };

/** Resultado que a resposta HTTP pode expor para uma intenção já existente. */
export function deriveOutboundOutcome(delivery: OutboundDelivery, message: Message | null): OutboundOutcome {
  switch (delivery.status) {
    case 'sent':
      return message && (message.deliveredAt || message.status === 'delivered') ? 'sent' : 'accepted';
    case 'failed':
      return 'failed';
    case 'unknown_reconciling':
      return 'unknown_reconciling';
    case 'accepted':
      return 'accepted';
    default:
      return 'pending';
  }
}

export async function persistOutboundIntentAtomically(
  input: PersistOutboundIntentInput,
): Promise<PersistOutboundIntentResult> {
  const ttlMs = input.ttlMs ?? resolveOutboundIdempotencyTtlMs();
  const expiresAt = new Date(Date.now() + ttlMs);
  const providerIdempotent = input.providerIdempotent !== false;
  const clientKey = input.idempotencyKey;
  const conversationId = input.message.conversationId as string;
  const storageKey = computeOutboundStorageKey(input.actorId, conversationId, clientKey);
  // JSON evita ambiguidade de separador e não contém byte NUL (inválido no PG).
  const lockKey = JSON.stringify([input.actorId, conversationId, clientKey]);

  let result: PersistOutboundIntentResult;
  try {
    result = await db.transaction(async (tx) => {
      // Corrida da mesma intenção: o lock transacional serializa; o segundo
      // enxerga o mapping do primeiro e nunca cria mensagem perdedora.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);

      const [existing] = await tx
        .select()
        .from(schema.outboundDeliveries)
        .where(
          and(
            eq(schema.outboundDeliveries.scopeActorId, input.actorId),
            eq(schema.outboundDeliveries.scopeConversationId, conversationId),
            eq(schema.outboundDeliveries.clientKey, clientKey),
          ),
        );

      if (!existing) {
        // Janela de rollout: linha gravada pelo código ANTERIOR (sem fingerprint
        // e com ator 'legacy'/NULL). Não é possível verificar o payload; retorna
        // conflito explícito em vez de arriscar um segundo envio da mesma chave.
        const [legacy] = await tx
          .select()
          .from(schema.outboundDeliveries)
          .where(
            and(
              eq(schema.outboundDeliveries.clientKey, clientKey),
              eq(schema.outboundDeliveries.scopeConversationId, conversationId),
              isNull(schema.outboundDeliveries.payloadFingerprint),
            ),
          );
        if (legacy) {
          return { kind: 'conflict', reason: 'fingerprint_missing' } as const;
        }

        // Writer ANTIGO rodando APÓS a migration (janela de rolling deploy):
        // grava `idempotency_key = <chave crua>` sem escopo/client_key/fingerprint.
        // O caminho novo não a encontraria pela chave derivada e faria um segundo
        // envio. Detecta a forma antiga pela chave crua global e FALHA FECHADO.
        if (await findOldWriterRow(tx, clientKey)) {
          return { kind: 'conflict', reason: 'fingerprint_missing' } as const;
        }

        // Chave arquivada: a mensagem original foi excluída e o tombstone
        // preserva a proibição de reenvio. Não há resultado original a devolver.
        const [tombstone] = await tx
          .select({ clientKey: schema.outboundIdempotencyTombstones.clientKey })
          .from(schema.outboundIdempotencyTombstones)
          .where(
            and(
              eq(schema.outboundIdempotencyTombstones.scopeActorId, input.actorId),
              eq(schema.outboundIdempotencyTombstones.scopeConversationId, conversationId),
              eq(schema.outboundIdempotencyTombstones.clientKey, clientKey),
            ),
          );
        if (tombstone) {
          return { kind: 'conflict', reason: 'key_archived' } as const;
        }
      }

      if (existing) {
        if (!existing.payloadFingerprint) {
          return { kind: 'conflict', reason: 'fingerprint_missing' } as const;
        }
        if (existing.payloadFingerprint !== input.payloadFingerprint) {
          return { kind: 'conflict', reason: 'payload_mismatch' } as const;
        }

        const message = await messageRepository.findById(existing.internalMessageId, tx);
        if (!message) throw new Error('AAA-12: mapping idempotente sem mensagem (integridade violada)');

        const expired = existing.expiresAt ? existing.expiresAt.getTime() <= Date.now() : false;
        if (expired && !TERMINAL_DELIVERY_STATUSES.has(existing.status)) {
          const [failedDelivery] = await tx
            .update(schema.outboundDeliveries)
            .set({ status: 'failed', lastError: OUTBOUND_TTL_EXPIRED_ERROR, reconcilingAt: null })
            .where(eq(schema.outboundDeliveries.id, existing.id))
            .returning();
          if (message.status === 'pending') {
            const [failedMessage] = await tx
              .update(schema.messages)
              .set({ status: 'failed' })
              .where(eq(schema.messages.id, message.id))
              .returning();
            return { kind: 'duplicate', message: failedMessage, delivery: failedDelivery, expired: true } as const;
          }
          return { kind: 'duplicate', message, delivery: failedDelivery, expired: true } as const;
        }

        return { kind: 'duplicate', message, delivery: existing, expired } as const;
      }

      const message = await messageRepository.create(
        { ...input.message, direction: 'outbound', status: 'pending' },
        tx,
      );

      const [delivery] = await tx
        .insert(schema.outboundDeliveries)
        .values({
          internalMessageId: message.id,
          idempotencyKey: storageKey,
          clientKey,
          provider: 'evolution',
          status: providerIdempotent ? 'pending' : 'unknown_reconciling',
          scopeActorId: input.actorId,
          scopeConversationId: message.conversationId,
          payloadFingerprint: input.payloadFingerprint,
          expiresAt,
          ...(providerIdempotent
            ? {}
            : { lastError: 'awaiting_attempt', reconcilingAt: new Date() }),
        })
        .returning();

      const event = createMessagePersistedEvent({
        messageId: message.id,
        conversationId: message.conversationId,
        direction: 'outbound',
        content: message.content,
        sender: message.sender ?? undefined,
        recipient: message.recipient ?? undefined,
        status: message.status,
        createdAt: message.createdAt.toISOString(),
    });
    // D-C03-1: a intenção de evento participa da MESMA transação.
    await outboxIntentWriter.persist(tx, event);

    // Segunda checagem NA MESMA transação: se um writer antigo commitou a
    // linha crua enquanto criávamos a nossa, aborta e devolve 409. Reduz a
    // janela de corrida do rolling deploy; a eliminação exige drenar writers
    // antigos ANTES de ligar o caminho novo (ver migration-notes/RETORNO).
    if (await findOldWriterRow(tx, clientKey)) {
      throw new OldWriterConflictError();
    }

    return { kind: 'created', message, delivery, event } as const;
    });
  } catch (error) {
    if (error instanceof OldWriterConflictError) {
      return { kind: 'conflict', reason: 'fingerprint_missing' };
    }
    throw error;
  }

  if (result.kind === 'created') {
    // D-C03-2: hint só depois do commit; best-effort (Noop sem REDIS_URL).
    void publishRealtimeHintsAfterCommit([result.event]).catch(() => {});
  }

  return result;
}
