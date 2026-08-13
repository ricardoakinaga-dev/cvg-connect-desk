import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventEnvelope } from '../envelope';

const values = vi.fn().mockResolvedValue(undefined);
const insert = vi.fn(() => ({ values }));

vi.mock('@cvg/database', () => ({
  db: { insert },
  schema: {
    outboxEvents: 'outbox_events',
  },
}));

const { DatabaseEventPublisher, databaseEventPublisher, publishToOutbox } = await import('../outbox-publisher');

function event(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    event_id: 'event-1',
    event_type: 'message.persisted',
    event_version: 2,
    aggregate_type: 'Message',
    aggregate_id: 'message-1',
    occurred_at: '2026-04-28T00:00:00.000Z',
    payload: { messageId: 'message-1' },
    metadata: { source: 'test' },
    correlation_id: 'corr-1',
    causation_id: 'cause-1',
    version: 3,
    ...overrides,
  };
}

describe('outbox publisher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists event envelopes in the database outbox', async () => {
    await publishToOutbox(event());

    expect(insert).toHaveBeenCalledWith('outbox_events');
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'event-1',
      eventType: 'message.persisted',
      eventVersion: 2,
      aggregateType: 'Message',
      aggregateId: 'message-1',
      occurredAt: new Date('2026-04-28T00:00:00.000Z'),
      payload: JSON.stringify({ messageId: 'message-1' }),
      metadata: JSON.stringify({ source: 'test' }),
      correlationId: 'corr-1',
      causationId: 'cause-1',
      version: 3,
      processedAt: null,
      retryCount: 0,
      lastError: null,
      createdAt: expect.any(Date),
    }));
  });

  it('uses defaults for optional envelope fields', async () => {
    await publishToOutbox(event({
      event_version: undefined,
      metadata: undefined,
      correlation_id: undefined,
      causation_id: undefined,
    }));

    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      eventVersion: 1,
      metadata: null,
      correlationId: null,
      causationId: null,
    }));
  });

  it('publishes single events and batches through DatabaseEventPublisher', async () => {
    const publisher = new DatabaseEventPublisher();

    await publisher.publish(event({ event_id: 'event-1' }));
    await publisher.publishBatch([event({ event_id: 'event-2' }), event({ event_id: 'event-3' })]);
    await databaseEventPublisher.publish(event({ event_id: 'event-4' }));

    expect(values).toHaveBeenCalledTimes(4);
  });
});
