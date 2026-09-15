import { db, schema } from '@cvg/database';
import { eq, isNull, and, asc, sql, not, exists, isNotNull, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { EventEnvelope } from './envelope';
import {
  PostgresOutboxLease,
  type AckResult,
  type LeaseToken,
  type NackResult,
  type OutboxLeasePort,
} from './outbox-lease';

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
    const safeParse = (value: unknown): unknown => {
      if (typeof value !== 'string') return value;
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    };
    return {
      id: row.id,
      eventId: row.eventId,
      eventType: row.eventType,
      eventVersion: row.eventVersion,
      aggregateType: row.aggregateType,
      aggregateId: row.aggregateId,
      occurredAt: row.occurredAt,
      payload: safeParse(row.payload),
      metadata: row.metadata ? (safeParse(row.metadata) as Record<string, unknown> | undefined) : undefined,
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
  /** Porta de lease (C03); injetável para teste. Default: PostgresOutboxLease. */
  lease?: OutboxLeasePort;
  /**
   * Catálogo de tipos consumidos (PROD-09/BK06). O claim filtra candidatos por
   * esta lista; eventos fora do contrato não são reservados nem ACKados.
   */
  eventTypes?: readonly string[];
}

/** Lease default do claim (C03 §4 e rota HTTP). */
export const DEFAULT_LEASE_SECONDS = 120;

export class ConsumerAwareOutboxReader {
  private batchSize: number;
  private maxRetries: number;
  private consumerId: ConsumerId;
  private lease: OutboxLeasePort;
  private eventTypes?: readonly string[];

  constructor(options: ConsumerAwareReaderOptions) {
    this.batchSize = options.batchSize || 50;
    this.maxRetries = options.maxRetries || 3;
    this.consumerId = options.consumerId;
    this.eventTypes = options.eventTypes;
    this.lease = options.lease ?? new PostgresOutboxLease({ maxRetries: this.maxRetries });
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

    const pendingPredicate = this.eventTypes && this.eventTypes.length > 0
      ? and(
        not(hasSuccessfulAck),
        not(hasPermanentFailure),
        inArray(schema.outboxEvents.eventType, [...this.eventTypes]),
      )
      : and(not(hasSuccessfulAck), not(hasPermanentFailure));

    const results = await db
      .select()
      .from(schema.outboxEvents)
      .where(pendingPredicate)
      .orderBy(asc(schema.outboxEvents.createdAt))
      .limit(this.batchSize);

    const events = results.map(row => this.mapRowToConsumerOutboxEvent(row));
    await this.populateConsumerMeta(events);
    return events;
  }

  /**
   * Claim atômico com lease (C03 D-C03-4): `FOR UPDATE SKIP LOCKED`, fencing
   * por geração e `since` aplicado antes da reserva (MEDIUM-03). Consumidores
   * do mesmo `consumerId` nunca recebem o mesmo evento simultaneamente.
   */
  async claim(input: {
    owner: string;
    leaseSeconds?: number;
    limit?: number;
    since?: Date;
    eventTypes?: readonly string[];
  }): Promise<Array<{ event: EventEnvelope; lease: LeaseToken }>> {
    return this.lease.claim({
      consumerId: this.consumerId,
      owner: input.owner,
      leaseSeconds: input.leaseSeconds ?? DEFAULT_LEASE_SECONDS,
      limit: input.limit ?? this.batchSize,
      since: input.since,
      eventTypes: input.eventTypes ?? this.eventTypes,
    });
  }

  /** Renewal condicionado a owner+geração; null quando o lease foi cercado. */
  async renew(lease: LeaseToken, leaseSeconds: number): Promise<LeaseToken | null> {
    return this.lease.renew(lease, leaseSeconds);
  }

  /** ACK cercado por owner+geração; `stale` não marca processado nem retry. */
  async ack(input: { eventId: string; owner: string; generation: number }): Promise<AckResult> {
    return this.lease.ack({ ...input, consumerId: this.consumerId });
  }

  /** NACK cercado; `dead-letter` esgota o retry do consumidor e grava DLQ. */
  async nack(input: {
    eventId: string;
    owner: string;
    generation: number;
    error: string;
    errorCode?: string;
    permanent?: boolean;
  }): Promise<NackResult> {
    return this.lease.nack({
      ...input,
      consumerId: this.consumerId,
    });
  }

  /**
   * ACK do lease vigente deste consumidor sem exigir token do chamador
   * (compatibilidade da rota HTTP que não ecoa owner/generation). A resolução
   * do token é atômica: se um reclaim aconteceu antes da leitura, o ACK é do
   * lease novo; se acontecer depois, o fencing da porta rejeita (`stale`).
   */
  async acknowledgeCurrentLease(eventId: string): Promise<AckResult> {
    const [row] = await db
      .select({
        leaseOwner: schema.outboxConsumerAcks.leaseOwner,
        generation: schema.outboxConsumerAcks.generation,
      })
      .from(schema.outboxConsumerAcks)
      .where(
        and(
          eq(schema.outboxConsumerAcks.eventId, eventId),
          eq(schema.outboxConsumerAcks.consumerId, this.consumerId),
        ),
      )
      .limit(1);
    if (!row || !row.leaseOwner) return 'not_found';
    return this.ack({ eventId, owner: row.leaseOwner, generation: row.generation });
  }

  /**
   * Alias histórico de claim (A06). Antes era um fetch sem reserva; agora
   * delega para `claim()` e devolve `{ event, lease }`, garantindo reserva
   * atômica por (eventId, consumerId). Mantido para consumidores existentes.
   */
  async claimPendingEvents(opts?: {
    leaseOwner?: string;
    leaseSeconds?: number;
    limit?: number;
    since?: Date;
  }): Promise<Array<{ event: EventEnvelope; lease: LeaseToken }>> {
    return this.claim({
      owner: opts?.leaseOwner ?? `${this.consumerId}:${randomUUID().slice(0, 8)}`,
      leaseSeconds: opts?.leaseSeconds ?? DEFAULT_LEASE_SECONDS,
      limit: opts?.limit ?? this.batchSize,
      since: opts?.since,
    });
  }

  private async populateConsumerMeta(events: ConsumerOutboxEvent[]): Promise<void> {
    if (events.length === 0) return;
    const { inArray } = await import('drizzle-orm');
    const ids = events.map((e) => e.eventId);
    const acks = await db
      .select({
        eventId: schema.outboxConsumerAcks.eventId,
        retryCount: schema.outboxConsumerAcks.retryCount,
        lastError: schema.outboxConsumerAcks.lastError,
      })
      .from(schema.outboxConsumerAcks)
      .where(
        and(
          eq(schema.outboxConsumerAcks.consumerId, this.consumerId),
          inArray(schema.outboxConsumerAcks.eventId, ids)
        )
      );
    const byId = new Map(acks.map((a) => [a.eventId, a]));
    for (const event of events) {
      const ack = byId.get(event.eventId);
      if (ack) {
        event.consumerRetryCount = ack.retryCount;
        event.consumerLastError = ack.lastError ?? undefined;
      }
    }
  }

  private safeJsonParse(value: unknown): unknown {
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  /**
   * Acknowledge successful processing.
   *
   * Com token (`{owner, generation}`) aplica o ACK cercado do C03: só conclui
   * se o lease vigente é do owner e da geração informados; token antigo retorna
   * `stale` sem marcar processado e sem incrementar retry.
   *
   * Sem token mantém a semântica legada (upsert com processedAt), necessária
   * para consumidores/rotinas anteriores ao lease.
   */
  async acknowledge(eventId: string): Promise<void>;
  async acknowledge(eventId: string, lease: { owner: string; generation: number }): Promise<AckResult>;
  async acknowledge(
    eventId: string,
    lease?: { owner: string; generation: number },
  ): Promise<void | AckResult> {
    if (lease) {
      return this.ack({ eventId, owner: lease.owner, generation: lease.generation });
    }

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
      payload: this.safeJsonParse(row.payload),
      metadata: row.metadata ? (this.safeJsonParse(row.metadata) as Record<string, unknown> | undefined) : undefined,
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
