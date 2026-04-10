import type { EventEnvelope } from './envelope';
import { db, schema } from '@cvg/database';

export interface OutboxEventPublisher {
  publish<T>(event: EventEnvelope<T>): Promise<void>;
  publishBatch<T>(events: EventEnvelope<T>[]): Promise<void>;
}

export async function publishToOutbox<T>(event: EventEnvelope<T>): Promise<void> {
  await db.insert(schema.outboxEvents).values({
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
  });
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
