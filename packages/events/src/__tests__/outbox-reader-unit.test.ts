import { beforeEach, describe, expect, it, vi } from 'vitest';

const limit = vi.fn();
const orderBy = vi.fn(() => ({ limit }));
const where = vi.fn(() => ({ orderBy, limit }));
const from = vi.fn(() => ({ where }));
const select = vi.fn(() => ({ from }));
const set = vi.fn(() => ({ where }));
const update = vi.fn(() => ({ set }));
const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
const values = vi.fn(() => ({ onConflictDoUpdate }));
const insert = vi.fn(() => ({ values }));

const eq = vi.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right }));
const isNull = vi.fn((value: unknown) => ({ op: 'isNull', value }));
const isNotNull = vi.fn((value: unknown) => ({ op: 'isNotNull', value }));
const and = vi.fn((...conditions: unknown[]) => ({ op: 'and', conditions }));
const asc = vi.fn((value: unknown) => ({ op: 'asc', value }));
const not = vi.fn((value: unknown) => ({ op: 'not', value }));
const exists = vi.fn((value: unknown) => ({ op: 'exists', value }));
const sql = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ op: 'sql', strings, values }));

const outboxEvents = {
  id: 'outbox.id',
  eventId: 'outbox.event_id',
  eventType: 'outbox.event_type',
  eventVersion: 'outbox.event_version',
  aggregateType: 'outbox.aggregate_type',
  aggregateId: 'outbox.aggregate_id',
  occurredAt: 'outbox.occurred_at',
  payload: 'outbox.payload',
  metadata: 'outbox.metadata',
  correlationId: 'outbox.correlation_id',
  causationId: 'outbox.causation_id',
  version: 'outbox.version',
  processedAt: 'outbox.processed_at',
  retryCount: 'outbox.retry_count',
  lastError: 'outbox.last_error',
  createdAt: 'outbox.created_at',
};

const outboxConsumerAcks = {
  eventId: 'acks.event_id',
  consumerId: 'acks.consumer_id',
  processedAt: 'acks.processed_at',
  retryCount: 'acks.retry_count',
  lastError: 'acks.last_error',
};

vi.mock('drizzle-orm', () => ({
  eq,
  isNull,
  isNotNull,
  and,
  asc,
  not,
  exists,
  sql,
}));

vi.mock('@cvg/database', () => ({
  db: {
    select,
    update,
    insert,
  },
  schema: {
    outboxEvents,
    outboxConsumerAcks,
  },
}));

const { CONSUMER_IDS, ConsumerAwareOutboxReader, OutboxReader } = await import('../outbox-reader');

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'row-1',
    eventId: 'event-1',
    eventType: 'message.persisted',
    eventVersion: 1,
    aggregateType: 'Message',
    aggregateId: 'message-1',
    occurredAt: new Date('2026-04-28T00:00:00.000Z'),
    payload: JSON.stringify({ messageId: 'message-1' }),
    metadata: JSON.stringify({ source: 'test' }),
    correlationId: 'corr-1',
    causationId: 'cause-1',
    version: 1,
    processedAt: null,
    retryCount: 0,
    lastError: null,
    createdAt: new Date('2026-04-28T00:00:01.000Z'),
    ...overrides,
  };
}

describe('OutboxReader unit behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limit.mockResolvedValue([]);
  });

  it('fetches pending events and maps nullable fields', async () => {
    limit.mockResolvedValueOnce([row({ metadata: null, correlationId: null, causationId: null, lastError: null })]);
    const reader = new OutboxReader({ batchSize: 10, maxRetries: 5 });

    const events = await reader.fetchPendingEvents();

    expect(events).toEqual([expect.objectContaining({
      eventId: 'event-1',
      payload: { messageId: 'message-1' },
      metadata: undefined,
      correlationId: undefined,
      causationId: undefined,
      processedAt: null,
      lastError: undefined,
    })]);
    expect(limit).toHaveBeenCalledWith(10);
  });

  it('marks events as processed or failed', async () => {
    const reader = new OutboxReader();

    await reader.markAsProcessed('event-1');
    expect(set).toHaveBeenCalledWith({ processedAt: expect.any(Date) });

    await reader.markAsFailed('event-1', 'boom');
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      lastError: 'boom',
      retryCount: expect.objectContaining({ op: 'sql' }),
    }));
  });

  it('converts outbox rows to event envelopes', () => {
    const reader = new OutboxReader();

    expect(reader.toEventEnvelope({
      id: 'row-1',
      eventId: 'event-1',
      eventType: 'message.persisted',
      eventVersion: 1,
      aggregateType: 'Message',
      aggregateId: 'message-1',
      occurredAt: new Date('2026-04-28T00:00:00.000Z'),
      payload: { messageId: 'message-1' },
      metadata: { source: 'test' },
      correlationId: 'corr-1',
      causationId: 'cause-1',
      version: 1,
      processedAt: null,
      retryCount: 0,
      createdAt: new Date('2026-04-28T00:00:01.000Z'),
    })).toMatchObject({
      event_id: 'event-1',
      event_type: 'message.persisted',
      occurred_at: '2026-04-28T00:00:00.000Z',
      payload: { messageId: 'message-1' },
      correlation_id: 'corr-1',
    });
  });
});

describe('ConsumerAwareOutboxReader unit behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limit.mockResolvedValue([]);
  });

  it('fetches pending events for one consumer', async () => {
    limit.mockResolvedValueOnce([row()]);
    const reader = new ConsumerAwareOutboxReader({
      consumerId: CONSUMER_IDS.REALTIME,
      batchSize: 7,
      maxRetries: 2,
    });

    const events = await reader.fetchPendingEvents();

    expect(events[0]).toMatchObject({
      eventId: 'event-1',
      consumerRetryCount: 0,
      consumerLastError: undefined,
    });
    expect(not).toHaveBeenCalledTimes(2);
    expect(limit).toHaveBeenCalledWith(7);
  });

  it('acknowledges successful and failed processing', async () => {
    const reader = new ConsumerAwareOutboxReader({ consumerId: CONSUMER_IDS.WORKER });

    await reader.acknowledge('event-1');
    expect(values).toHaveBeenCalledWith({
      eventId: 'event-1',
      consumerId: CONSUMER_IDS.WORKER,
      processedAt: expect.any(Date),
      retryCount: 0,
    });

    limit.mockResolvedValueOnce([{ retryCount: 2 }]);
    await reader.acknowledgeWithError('event-1', 'boom');
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'event-1',
      consumerId: CONSUMER_IDS.WORKER,
      processedAt: expect.objectContaining({ op: 'sql' }),
      lastError: 'boom',
      retryCount: 3,
    }));
  });

  it('reads a consumer ack and converts consumer events to envelopes', async () => {
    const ack = { processedAt: null, retryCount: 1, lastError: 'boom' };
    limit.mockResolvedValueOnce([ack]);
    const reader = new ConsumerAwareOutboxReader({ consumerId: CONSUMER_IDS.HTTP_POLL });

    await expect(reader.getConsumerAck('event-1')).resolves.toEqual(ack);
    limit.mockResolvedValueOnce([]);
    await expect(reader.getConsumerAck('event-2')).resolves.toBeNull();

    expect(reader.toEventEnvelope({
      id: 'row-1',
      eventId: 'event-1',
      eventType: 'message.persisted',
      eventVersion: 1,
      aggregateType: 'Message',
      aggregateId: 'message-1',
      occurredAt: new Date('2026-04-28T00:00:00.000Z'),
      payload: { messageId: 'message-1' },
      version: 1,
      processedAt: null,
      retryCount: 0,
      createdAt: new Date('2026-04-28T00:00:01.000Z'),
      consumerRetryCount: 0,
    })).toMatchObject({
      event_id: 'event-1',
      aggregate_id: 'message-1',
    });
  });
});
