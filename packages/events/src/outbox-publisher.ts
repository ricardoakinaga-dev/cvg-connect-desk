import type { EventEnvelope } from './envelope';
import { db, schema, type DatabaseExecutor } from '@cvg/database';
import { publishRealtimeHint } from './realtime-bus';

export interface OutboxEventPublisher {
  publish<T>(event: EventEnvelope<T>): Promise<void>;
  publishBatch<T>(events: EventEnvelope<T>[]): Promise<void>;
}

/**
 * Linha canônica do outbox para um envelope de domínio. Mantida em um único
 * lugar para que o insert transacional e o insert avulso permaneçam idênticos.
 */
function toOutboxRow<T>(event: EventEnvelope<T>) {
  return {
    eventId: event.event_id,
    eventType: event.event_type,
    eventVersion: event.event_version ?? 1,
    aggregateType: event.aggregate_type,
    aggregateId: event.aggregate_id,
    occurredAt: new Date(event.occurred_at),
    payload: JSON.stringify(event.payload),
    metadata: event.metadata ? JSON.stringify(event.metadata) : null,
    correlationId: event.correlation_id || null,
    causationId: event.causation_id || null,
    version: event.version,
    processedAt: null,
    retryCount: 0,
    lastError: null,
    createdAt: new Date(),
  };
}

/**
 * D-C03-1 — grava a INTENÇÃO do evento usando o MESMO executor transacional
 * da mensagem/estado (o `tx` de `db.transaction`). NÃO publica hint Redis:
 * publicação é pós-commit e responsabilidade de
 * `publishRealtimeHintsAfterCommit` (D-C03-2).
 *
 * Idempotente por `event_id` (unique): replay do mesmo envelope não duplica
 * linha nem efeito (C03 D-C03-3, identidade estável).
 */
export async function persistOutboxEventIntent<T>(
  executor: DatabaseExecutor,
  event: EventEnvelope<T>,
): Promise<void> {
  await executor
    .insert(schema.outboxEvents)
    .values(toOutboxRow(event))
    .onConflictDoNothing({ target: schema.outboxEvents.eventId });
}

/** Objeto exportado para permitir observação/substituição em testes da fronteira. */
export const outboxIntentWriter = {
  persist: persistOutboxEventIntent,
};

/**
 * D-C03-2 — hints realtime são best-effort e SÓ podem ser chamados após o
 * commit da transação que gravou a intenção. Nunca lança: se o Redis cair, o
 * polling do outbox continua sendo o caminho durável.
 */
export async function publishRealtimeHintsAfterCommit(
  events: readonly EventEnvelope[],
): Promise<number> {
  let published = 0;
  for (const event of events) {
    try {
      if (await publishRealtimeHint(event)) published += 1;
    } catch {
      // Hint é fast path; a intenção durável já está commitada.
    }
  }
  return published;
}

export async function publishToOutbox<T>(event: EventEnvelope<T>): Promise<void> {
  // Insert avulso é autocommit: quando a promise resolve, a intenção já está
  // durável. O hint entra depois (D-C03-2), sem bloquear o produtor.
  await persistOutboxEventIntent(db, event);
  void publishRealtimeHint(event).catch(() => {});
}

export class DatabaseEventPublisher implements OutboxEventPublisher {
  async publish<T>(event: EventEnvelope<T>): Promise<void> {
    await publishToOutbox(event);
  }

  async publishBatch<T>(events: EventEnvelope<T>[]): Promise<void> {
    for (const event of events) {
      await publishToOutbox(event);
    }
  }
}

export const databaseEventPublisher = new DatabaseEventPublisher();
