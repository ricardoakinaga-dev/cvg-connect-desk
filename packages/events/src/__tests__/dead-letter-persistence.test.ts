import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventEnvelope } from '../envelope';

const select = vi.fn();
const insert = vi.fn();
const update = vi.fn();

vi.mock('@cvg/database', () => ({
  db: { select, insert, update },
  schema: {
    deadLetterEvents: {
      id: 'dead_letter_events.id',
      eventType: 'dead_letter_events.event_type',
      eventId: 'dead_letter_events.event_id',
      payload: 'dead_letter_events.payload',
      error: 'dead_letter_events.error',
      failedAt: 'dead_letter_events.failed_at',
      retryCount: 'dead_letter_events.retry_count',
      handlerName: 'dead_letter_events.handler_name',
      sourceEvent: 'dead_letter_events.source_event',
      failureContext: 'dead_letter_events.failure_context',
      resolved: 'dead_letter_events.resolved',
      resolvedAt: 'dead_letter_events.resolved_at',
    },
  },
}));

vi.mock('drizzle-orm', () => ({
  desc: vi.fn((column: unknown) => ({ desc: column })),
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
}));

const { PersistentDeadLetterStore } = await import('../dead-letter-persistence');

const event = {
  event_id: 'event-1',
  event_type: 'message.persisted',
  event_version: 1,
  aggregate_type: 'Message',
  aggregate_id: 'message-1',
  occurred_at: '2026-08-12T12:00:00.000Z',
  payload: { messageId: 'message-1' },
  version: 1,
} satisfies EventEnvelope;

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dlq-1',
    eventType: event.event_type,
    eventId: event.event_id,
    payload: JSON.stringify(event.payload),
    error: 'timeout',
    failedAt: new Date('2026-08-12T12:00:00.000Z'),
    retryCount: 3,
    handlerName: 'worker.handler',
    sourceEvent: JSON.stringify(event),
    failureContext: JSON.stringify({ reason: 'timeout' }),
    resolved: false,
    resolvedAt: null,
    ...overrides,
  };
}

function mockSelectRows(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn(() => ({ limit }));
  const where = vi.fn(() => ({ orderBy, limit }));
  select.mockReturnValue({
    from: vi.fn(() => ({ where, orderBy })),
  });
  return { limit, orderBy, where };
}

describe('PersistentDeadLetterStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes a replayable failure with explicit audit context', async () => {
    const returning = vi.fn().mockResolvedValue([{
      id: 'dlq-1',
      eventType: event.event_type,
      eventId: event.event_id,
      payload: JSON.stringify(event.payload),
      error: 'timeout',
      failedAt: new Date('2026-08-12T12:00:00.000Z'),
      retryCount: 3,
      handlerName: 'worker.handler',
      sourceEvent: JSON.stringify(event),
      failureContext: JSON.stringify({ stage: 'worker-terminal', decision: 'dead-letter' }),
      resolved: false,
      resolvedAt: null,
    }]);
    insert.mockReturnValue({ values: vi.fn().mockReturnValue({ returning }) });
    const store = new PersistentDeadLetterStore();

    const result = await store.add({
      eventType: event.event_type,
      eventId: event.event_id,
      payload: JSON.stringify(event.payload),
      error: 'timeout',
      retryCount: 3,
      handlerName: 'worker.handler',
      sourceEvent: JSON.stringify(event),
      failureContext: {
        stage: 'worker-terminal',
        decision: 'dead-letter',
        handlerName: 'worker.handler',
        eventType: event.event_type,
        eventId: event.event_id,
        retryCount: 3,
        retryable: true,
        reason: 'timeout',
      },
    });

    expect(result).toMatchObject({ id: 'dlq-1', eventId: 'event-1', resolved: false });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0]).toBeDefined();
  });

  it('reads entries and resolves them with an idempotent update', async () => {
    const row = {
      id: 'dlq-1',
      eventType: event.event_type,
      eventId: event.event_id,
      payload: JSON.stringify(event.payload),
      error: 'timeout',
      failedAt: new Date(),
      retryCount: 3,
      handlerName: 'worker.handler',
      sourceEvent: JSON.stringify(event),
      failureContext: undefined,
      resolved: false,
      resolvedAt: null,
    };
    select.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({ limit: vi.fn(() => Promise.resolve([row])) })),
          limit: vi.fn(() => Promise.resolve([row])),
        })),
        orderBy: vi.fn(() => ({ limit: vi.fn(() => Promise.resolve([row])) })),
      })),
    });
    update.mockReturnValue({
      set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })),
    });
    const store = new PersistentDeadLetterStore();

    await expect(store.getAll({ resolved: false, limit: 10 })).resolves.toHaveLength(1);
    await expect(store.resolve('dlq-1')).resolves.toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('supports defaults, explicit ids and entries without a replay source', async () => {
    const returning = vi.fn().mockResolvedValue([row({
      id: 'explicit-dlq',
      sourceEvent: null,
    })]);
    const values = vi.fn().mockReturnValue({ returning });
    insert.mockReturnValue({ values });
    const store = new PersistentDeadLetterStore();

    const result = await store.add({
      id: 'explicit-dlq',
      eventType: 'manual.event',
      eventId: 'manual-1',
      payload: JSON.stringify({ value: 1 }),
      error: 'manual-only',
      retryCount: 0,
      handlerName: '',
    });

    expect(result.sourceEvent).toBeUndefined();
    expect(JSON.parse(values.mock.calls[0][0].failureContext)).toMatchObject({
      stage: 'worker-terminal',
      decision: 'dead-letter',
      retryable: false,
      reason: 'manual-only',
    });
    expect(insert.mock.calls[0][0]).toBeDefined();
  });

  it('covers filtering, lookup misses, retryability and statistics', async () => {
    const resolvedAt = new Date('2026-08-12T13:00:00.000Z');
    const entries = [
      row(),
      row({ id: 'dlq-2', eventId: 'event-2', resolved: false, sourceEvent: null, failureContext: null }),
      row({ id: 'dlq-3', eventId: 'event-3', resolved: true, resolvedAt }),
    ];
    mockSelectRows(entries);
    const store = new PersistentDeadLetterStore();

    await expect(store.getAll()).resolves.toHaveLength(3);
    await expect(store.getAll({ resolved: false, limit: 1 })).resolves.toHaveLength(3);
    await expect(store.getById('dlq-1')).resolves.toMatchObject({ id: 'dlq-1' });

    mockSelectRows([]);
    await expect(store.getById('missing')).resolves.toBeUndefined();
    await expect(store.resolve('missing')).resolves.toBe(false);
    await expect(store.canRetry('missing')).resolves.toBe(false);

    mockSelectRows([row()]);
    await expect(store.canRetry('dlq-1')).resolves.toBe(true);
    mockSelectRows(entries);
    await expect(store.getStats()).resolves.toEqual({ total: 3, unresolved: 2, resolved: 1 });
    await expect(store.getOperationalStats()).resolves.toMatchObject({
      total: 3,
      unresolved: 2,
      resolved: 1,
      replayable: 1,
      manualOnly: 1,
      lastFailedAt: '2026-08-12T12:00:00.000Z',
    });
  });

  it('keeps resolve idempotent when the row already has a resolution timestamp', async () => {
    const resolvedAt = new Date('2026-08-12T13:00:00.000Z');
    mockSelectRows([row({ resolved: true, resolvedAt })]);
    update.mockReturnValue({
      set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })),
    });
    const store = new PersistentDeadLetterStore();

    await expect(store.resolve('dlq-1')).resolves.toBe(true);
    expect(update.mock.calls[0]).toBeDefined();
  });

  it('delegates every operation through the async adapter', async () => {
    const store = {
      add: vi.fn().mockReturnValue({ id: '1' }),
      getAll: vi.fn().mockReturnValue([]),
      getById: vi.fn().mockReturnValue(undefined),
      resolve: vi.fn().mockReturnValue(false),
      canRetry: vi.fn().mockReturnValue(false),
      getStats: vi.fn().mockReturnValue({ total: 0, unresolved: 0, resolved: 0 }),
      getOperationalStats: vi.fn().mockReturnValue({ total: 0 }),
    };
    const adapter = new (await import('../dead-letter-persistence')).AsyncDeadLetterStoreAdapter(store as never);

    await adapter.add({ eventType: 'event', eventId: 'id', payload: '{}', error: 'error', retryCount: 1, handlerName: 'handler' });
    await adapter.getAll({ resolved: false, limit: 1 });
    await adapter.getById('id');
    await adapter.resolve('id');
    await adapter.canRetry('id');
    await adapter.getStats();
    await adapter.getOperationalStats();

    expect(store.add).toHaveBeenCalledTimes(1);
    expect(store.getAll).toHaveBeenCalledTimes(1);
    expect(store.getById).toHaveBeenCalledWith('id');
    expect(store.resolve).toHaveBeenCalledWith('id');
    expect(store.canRetry).toHaveBeenCalledWith('id');
    expect(store.getStats).toHaveBeenCalledTimes(1);
    expect(store.getOperationalStats).toHaveBeenCalledTimes(1);
  });
});
