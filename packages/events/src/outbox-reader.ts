import { db, schema } from '@cvg/database';
import { eq, isNull, and, asc, sql, not, exists, isNotNull } from 'drizzle-orm';
import type { EventEnvelope } from './envelope';

export interface OutboxEvent {
  id: string;
  eventId: string;
  eventType: string;
  eventVersion: number;
  aggregateType: string;
  aggregateId: string;
  occurredAt: Date;
  payload: unknown;
  metadata?: Record<string, unknown>;
  correlationId?: string;
  causationId?: string;
  version: number;
  processedAt: Date | null;
  retryCount: number;
  lastError?: string;
  createdAt: Date;
}

export interface ConsumerOutboxEvent extends OutboxEvent {
  consumerRetryCount: number;
  consumerLastError?: string;
}

export interface OutboxReaderOptions {
  batchSize?: number;
  maxRetries?: number;
}

export class OutboxReader {
  private batchSize: number;
  private maxRetries: number;

  constructor(options: OutboxReaderOptions = {}) {
    this.batchSize = options.batchSize || 50;
    this.maxRetries = options.maxRetries || 3;
  }

  async fetchPendingEvents(): Promise<OutboxEvent[]> {
    const results = await db
      .select()
      .from(schema.outboxEvents)
      .where(
        and(
          isNull(schema.outboxEvents.processedAt),
          sql`${schema.outboxEvents.retryCount} < ${this.maxRetries}`
        )
      )
      .orderBy(asc(schema.outboxEvents.createdAt))
      .limit(this.batchSize);

    return results.map(row => this.mapRowToOutboxEvent(row));
  }

  async markAsProcessed(eventId: string): Promise<void> {
    await db
      .update(schema.outboxEvents)
      .set({
        processedAt: new Date(),
      })
      .where(eq(schema.outboxEvents.eventId, eventId));
  }

  async markAsFailed(eventId: string, error: string): Promise<void> {
    await db
      .update(schema.outboxEvents)
      .set({
        lastError: error,
        retryCount: sql`${schema.outboxEvents.retryCount} + 1`,
      })
      .where(eq(schema.outboxEvents.eventId, eventId));
  }

  private mapRowToOutboxEvent(row: typeof schema.outboxEvents.$inferSelect): OutboxEvent {
    return {
      id: row.id,
      eventId: row.eventId,
      eventType: row.eventType,
      eventVersion: row.eventVersion,
      aggregateType: row.aggregateType,
      aggregateId: row.aggregateId,
      occurredAt: row.occurredAt,
      payload: JSON.parse(row.payload as string),
      metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
      correlationId: row.correlationId ?? undefined,
      causationId: row.causationId ?? undefined,
      version: row.version,
      processedAt: row.processedAt ?? null,
      retryCount: row.retryCount,
      lastError: row.lastError ?? undefined,
      createdAt: row.createdAt,
    };
  }

  toEventEnvelope(outboxEvent: OutboxEvent): EventEnvelope {
    return {
      event_id: outboxEvent.eventId,
      event_type: outboxEvent.eventType,
      event_version: outboxEvent.eventVersion,
      aggregate_type: outboxEvent.aggregateType,
      aggregate_id: outboxEvent.aggregateId,
      occurred_at: outboxEvent.occurredAt.toISOString(),
      payload: outboxEvent.payload,
      metadata: outboxEvent.metadata,
      correlation_id: outboxEvent.correlationId,
      causation_id: outboxEvent.causationId,
      version: outboxEvent.version,
    };
  }
}

export const outboxReader = new OutboxReader();

// ============================================
// Consumer-Aware Outbox Reader
// Suporta fan-out: múltiplos consumers processam o mesmo evento independentemente
//
// Modelo de estados por consumer:
// - Sem ack: evento pendente para este consumer
// - Ack com processedAt: evento processado com sucesso por este consumer
// - Ack sem processedAt (retryCount >= maxRetries): evento falhou permanentemente para este consumer
// - Ack sem processedAt (retryCount < maxRetries): evento falhou mas pode ser retentado
// ============================================

export const CONSUMER_IDS = {
  WORKER: 'worker',
  REALTIME: 'realtime',
  HTTP_POLL: 'http-poll',
} as const;

export type ConsumerId = typeof CONSUMER_IDS[keyof typeof CONSUMER_IDS];

export interface ConsumerAwareReaderOptions extends OutboxReaderOptions {
  consumerId: ConsumerId;
}

export class ConsumerAwareOutboxReader {
  private batchSize: number;
  private maxRetries: number;
  private consumerId: ConsumerId;

  constructor(options: ConsumerAwareReaderOptions) {
    this.batchSize = options.batchSize || 50;
    this.maxRetries = options.maxRetries || 3;
    this.consumerId = options.consumerId;
  }

  /**
   * Fetch pending events for this consumer.
   * 
   * Returns events where:
   * 1. No ack exists for this consumer (never attempted), OR
   * 2. An ack exists for this consumer without processedAt AND retryCount < maxRetries (failed but can retry)
   * 
   * Does NOT return events where:
   * - processedAt is set for this consumer (already processed successfully)
   * - retryCount >= maxRetries for this consumer (permanently failed)
   */
  async fetchPendingEvents(): Promise<ConsumerOutboxEvent[]> {
    const hasSuccessfulAck = exists(
      db
        .select({ eventId: schema.outboxConsumerAcks.eventId })
        .from(schema.outboxConsumerAcks)
        .where(
          and(
            eq(schema.outboxConsumerAcks.eventId, schema.outboxEvents.eventId),
            eq(schema.outboxConsumerAcks.consumerId, this.consumerId),
            isNotNull(schema.outboxConsumerAcks.processedAt)
          )
        )
    );

    const hasPermanentFailure = exists(
      db
        .select({ eventId: schema.outboxConsumerAcks.eventId })
        .from(schema.outboxConsumerAcks)
        .where(
          and(
            eq(schema.outboxConsumerAcks.eventId, schema.outboxEvents.eventId),
            eq(schema.outboxConsumerAcks.consumerId, this.consumerId),
            isNull(schema.outboxConsumerAcks.processedAt),
            sql`${schema.outboxConsumerAcks.retryCount} >= ${this.maxRetries}`
          )
        )
    );

    const results = await db
      .select()
      .from(schema.outboxEvents)
      .where(
        and(
          not(hasSuccessfulAck),
          not(hasPermanentFailure)
        )
      )
      .orderBy(asc(schema.outboxEvents.createdAt))
      .limit(this.batchSize);

    return results.map(row => this.mapRowToConsumerOutboxEvent(row));
  }

  /**
   * Acknowledge successful processing.
   * Upserts the consumer ack so a later success can overwrite a prior failure state.
   * Sets processedAt and clears retry metadata for this consumer.
   */
  async acknowledge(eventId: string): Promise<void> {
    await db
      .insert(schema.outboxConsumerAcks)
      .values({
        eventId,
        consumerId: this.consumerId,
        processedAt: new Date(),
        retryCount: 0,
      })
      .onConflictDoUpdate({
        target: [schema.outboxConsumerAcks.eventId, schema.outboxConsumerAcks.consumerId],
        set: {
          processedAt: new Date(),
          retryCount: 0,
          lastError: sql`NULL`,
        },
      });
  }

  /**
   * Acknowledge failed processing.
   * DOES NOT delete the ack - instead increments retryCount and sets lastError.
   * The processedAt remains NULL, allowing future retries within the limit.
   * Uses upsert to handle both new and existing ack records.
   */
  async acknowledgeWithError(eventId: string, error: string): Promise<void> {
    const existing = await db
      .select({ retryCount: schema.outboxConsumerAcks.retryCount })
      .from(schema.outboxConsumerAcks)
      .where(
        and(
          eq(schema.outboxConsumerAcks.eventId, eventId),
          eq(schema.outboxConsumerAcks.consumerId, this.consumerId)
        )
      )
      .limit(1);

    const currentRetryCount = existing.length > 0 ? existing[0].retryCount : 0;

    await db
      .insert(schema.outboxConsumerAcks)
      .values({
        eventId,
        consumerId: this.consumerId,
        processedAt: sql`NULL`,
        lastError: error,
        retryCount: currentRetryCount + 1,
      })
      .onConflictDoUpdate({
        target: [schema.outboxConsumerAcks.eventId, schema.outboxConsumerAcks.consumerId],
        set: {
          lastError: error,
          retryCount: sql`${schema.outboxConsumerAcks.retryCount} + 1`,
          processedAt: sql`NULL`,
        },
      });
  }

  async getConsumerAck(eventId: string): Promise<{
    processedAt: Date | null;
    retryCount: number;
    lastError: string | null;
  } | null> {
    const [ack] = await db
      .select({
        processedAt: schema.outboxConsumerAcks.processedAt,
        retryCount: schema.outboxConsumerAcks.retryCount,
        lastError: schema.outboxConsumerAcks.lastError,
      })
      .from(schema.outboxConsumerAcks)
      .where(
        and(
          eq(schema.outboxConsumerAcks.eventId, eventId),
          eq(schema.outboxConsumerAcks.consumerId, this.consumerId)
        )
      )
      .limit(1);
    return ack ?? null;
  }

  private mapRowToConsumerOutboxEvent(row: typeof schema.outboxEvents.$inferSelect): ConsumerOutboxEvent {
    return {
      id: row.id,
      eventId: row.eventId,
      eventType: row.eventType,
      eventVersion: row.eventVersion,
      aggregateType: row.aggregateType,
      aggregateId: row.aggregateId,
      occurredAt: row.occurredAt,
      payload: JSON.parse(row.payload as string),
      metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
      correlationId: row.correlationId ?? undefined,
      causationId: row.causationId ?? undefined,
      version: row.version,
      processedAt: row.processedAt ?? null,
      retryCount: row.retryCount,
      lastError: row.lastError ?? undefined,
      createdAt: row.createdAt,
      consumerRetryCount: 0,
      consumerLastError: undefined,
    };
  }

  toEventEnvelope(outboxEvent: ConsumerOutboxEvent): EventEnvelope {
    return {
      event_id: outboxEvent.eventId,
      event_type: outboxEvent.eventType,
      event_version: outboxEvent.eventVersion,
      aggregate_type: outboxEvent.aggregateType,
      aggregate_id: outboxEvent.aggregateId,
      occurred_at: outboxEvent.occurredAt.toISOString(),
      payload: outboxEvent.payload,
      metadata: outboxEvent.metadata,
      correlation_id: outboxEvent.correlationId,
      causation_id: outboxEvent.causationId,
      version: outboxEvent.version,
    };
  }
}
