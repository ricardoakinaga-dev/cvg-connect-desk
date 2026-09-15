import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  beginSecretaryInvocation,
  completeSecretaryInvocation,
  failSecretaryInvocation,
} from '../infrastructure/repositories/secretary-invocation.repository';

const mock = vi.hoisted(() => {
  const state = {
    inserts: [] as Array<unknown[]>,
    selects: [] as Array<unknown[]>,
    counts: [] as Array<unknown[]>,
    updates: [] as Array<unknown[]>,
    wheres: [] as unknown[],
    sets: [] as unknown[],
  };
  const schema = {
    secretaryInvocations: {
      invocationKey: 'invocationKey',
      conversationId: 'conversationId',
      messageId: 'messageId',
      eventId: 'eventId',
      consumerId: 'consumerId',
      action: 'action',
      status: 'status',
      attemptCount: 'attemptCount',
    },
  };
  const chain = (queue: Array<unknown[]>) => {
    const value = {
      values: vi.fn(function values() { return value; }),
      onConflictDoNothing: vi.fn(function onConflictDoNothing() { return value; }),
      from: vi.fn(function from() { return value; }),
      where: vi.fn(function where(condition: unknown) {
        state.wheres.push(condition);
        return value;
      }),
      for: vi.fn(() => Promise.resolve(queue.shift() ?? [])),
      set: vi.fn(function set(patch: unknown) {
        state.sets.push(patch);
        return value;
      }),
      returning: vi.fn(() => Promise.resolve(queue.shift() ?? [])),
    };
    return value;
  };
  const transactionMock = {
    execute: vi.fn(() => Promise.resolve()),
    insert: vi.fn(() => chain(state.inserts)),
    select: vi.fn((projection?: unknown) => chain(projection ? state.counts : state.selects)),
    update: vi.fn(() => chain(state.updates)),
  };
  return {
    state,
    schema,
    db: {
      transaction: vi.fn(async (callback: (transaction: unknown) => Promise<unknown>) => callback(transactionMock)),
      update: vi.fn(() => chain(state.updates)),
    },
  };
});

vi.mock('@cvg/database', () => ({ db: mock.db, schema: mock.schema }));
vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => conditions),
  eq: vi.fn((column: unknown, value: unknown) => ({ column, value })),
  ne: vi.fn((column: unknown, value: unknown) => ({ column, value, operator: 'ne' })),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}));

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'invocation-row',
  invocationKey: 'inbound:message-1',
  conversationId: 'conversation-1',
  messageId: 'message-1',
  eventId: 'event-1',
  consumerId: 'worker',
  action: 'classify',
  status: 'processing',
  attemptCount: 1,
  lastError: null,
  errorCode: null,
  resultRef: null,
  detail: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  completedAt: null,
  ...overrides,
});

const input = {
  invocationKey: 'inbound:message-1',
  conversationId: 'conversation-1',
  messageId: 'message-1',
  eventId: 'event-2',
  consumerId: 'worker-2',
  action: 'classify',
};

describe('secretary invocation admission state machine', () => {
  beforeEach(() => {
    mock.state.inserts.length = 0;
    mock.state.selects.length = 0;
    mock.state.counts.length = 0;
    mock.state.updates.length = 0;
    mock.state.wheres.length = 0;
    mock.state.sets.length = 0;
  });

  it('does not reopen an unknown invocation', async () => {
    mock.state.inserts.push([]);
    mock.state.selects.push([row({ status: 'unknown', attemptCount: 2 })]);

    const result = await beginSecretaryInvocation(input);

    expect(result.outcome).toBe('unknown');
    expect(result.alreadyCompleted).toBe(false);
    expect(result.record.attemptCount).toBe(2);
    expect(mock.state.updates).toHaveLength(0);
  });

  it('does not start a second external call while processing', async () => {
    mock.state.inserts.push([]);
    mock.state.selects.push([row({ status: 'processing', attemptCount: 3 })]);

    const result = await beginSecretaryInvocation(input);

    expect(result.outcome).toBe('in_progress');
    expect(result.record.attemptCount).toBe(3);
    expect(mock.state.updates).toHaveLength(0);
  });

  it('starts a new invocation once and reports completed records as deduplicated', async () => {
    mock.state.inserts.push([row({ status: 'pending', attemptCount: 0 })]);
    mock.state.updates.push([row({ status: 'processing', attemptCount: 1 })]);

    const started = await beginSecretaryInvocation({ ...input, invocationKey: 'inbound:new-message' });
    expect(started.outcome).toBe('started');
    expect(started.record.status).toBe('processing');

    mock.state.inserts.push([]);
    mock.state.selects.push([row({ status: 'completed', attemptCount: 1, resultRef: 'outbound-1' })]);
    const completed = await beginSecretaryInvocation(input);
    expect(completed.outcome).toBe('completed');
    expect(completed.alreadyCompleted).toBe(true);
    expect(completed.record.resultRef).toBe('outbound-1');
  });

  it('fences terminal transitions by status and admitted attempt', async () => {
    mock.state.updates.push([row({ status: 'completed', attemptCount: 4 })]);

    await completeSecretaryInvocation(input.invocationKey, { expectedAttemptCount: 4 });

    expect(mock.state.sets[mock.state.sets.length - 1]).toMatchObject({ status: 'completed' });
    expect(mock.state.wheres[mock.state.wheres.length - 1]).toEqual(expect.arrayContaining([
      { column: 'invocationKey', value: input.invocationKey },
      { column: 'status', value: 'processing' },
      { column: 'attemptCount', value: 4 },
    ]));
  });

  it('marks ambiguous failures unknown instead of retryable failed', async () => {
    mock.state.updates.push([row({ status: 'unknown', attemptCount: 2 })]);

    await failSecretaryInvocation(input.invocationKey, {
      error: 'provider timeout',
      errorCode: 'SECRETARY_TIMEOUT',
      ambiguous: true,
      expectedAttemptCount: 2,
    });

    expect(mock.state.sets[mock.state.sets.length - 1]).toMatchObject({
      status: 'unknown',
      errorCode: 'SECRETARY_TIMEOUT',
    });
    expect(mock.state.wheres[mock.state.wheres.length - 1]).toEqual(expect.arrayContaining([
      { column: 'status', value: 'processing' },
      { column: 'attemptCount', value: 2 },
    ]));
  });
});
