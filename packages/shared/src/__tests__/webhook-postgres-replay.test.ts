import { describe, expect, it, vi } from 'vitest';
import { PostgresWebhookReplayStore } from '../webhook-anti-replay';

const mock = vi.hoisted(() => {
  type QueryChain = {
    from: ReturnType<typeof vi.fn>;
    where: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
    values?: ReturnType<typeof vi.fn>;
    onConflictDoNothing?: ReturnType<typeof vi.fn>;
    returning: ReturnType<typeof vi.fn>;
    set?: ReturnType<typeof vi.fn>;
  };
  const state = {
    inserts: [] as Array<unknown[]>,
    insertErrors: [] as Array<unknown>,
    selects: [] as Array<unknown[]>,
    updates: [] as Array<unknown[]>,
  };
  const schema = { webhookReplayLog: { eventId: 'eventId', state: 'state', signatureHash: 'signatureHash', payloadHash: 'payloadHash', processedAt: 'processedAt' } };
  const select = vi.fn(() => ({
    from: vi.fn(function from(this: QueryChain) { return this; }),
    where: vi.fn(function where(this: QueryChain) { return this; }),
    limit: vi.fn(() => Promise.resolve(state.selects.shift() ?? [])),
  }));
  const insert = vi.fn(() => ({
    values: vi.fn(function values(this: QueryChain) { return this; }),
    onConflictDoNothing: vi.fn(function onConflictDoNothing(this: QueryChain) { return this; }),
    returning: vi.fn(() => {
      const error = state.insertErrors.shift();
      if (error) return Promise.reject(error);
      return Promise.resolve(state.inserts.shift() ?? []);
    }),
  }));
  const update = vi.fn(() => ({
    set: vi.fn(function set(this: QueryChain) { return this; }),
    where: vi.fn(function where(this: QueryChain) { return this; }),
    returning: vi.fn(() => Promise.resolve(state.updates.shift() ?? [])),
  }));
  return { state, schema, db: { select, insert, update } };
});

vi.mock('@cvg/database', () => ({ db: mock.db, schema: mock.schema }));
vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => null),
  eq: vi.fn(() => null),
  isNull: vi.fn(() => null),
  lt: vi.fn(() => null),
  ne: vi.fn(() => null),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}));

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const row = (overrides: Record<string, unknown> = {}) => ({
  eventId: 'evt',
  signatureHash: HASH_A,
  payloadHash: HASH_A,
  state: 'pending',
  processedAt: new Date(),
  ...overrides,
});

describe('PostgresWebhookReplayStore', () => {
  it('reads presence and claims a new event', async () => {
    const store = new PostgresWebhookReplayStore();
    mock.state.selects.push([row()]);
    expect(await store.has('evt')).toBe(true);
    mock.state.inserts.push([{ eventId: 'evt-new' }]);
    expect(await store.claim('evt-new', HASH_A, HASH_A)).toEqual({ action: 'claimed_new' });
  });

  it('handles duplicate, mismatch and failed retry states', async () => {
    const store = new PostgresWebhookReplayStore();

    mock.state.inserts.push([]);
    mock.state.selects.push([row({ state: 'completed' })]);
    expect(await store.claim('evt', HASH_A, HASH_A)).toEqual({ action: 'duplicate' });

    mock.state.inserts.push([]);
    mock.state.selects.push([row({ payloadHash: HASH_B })]);
    expect(await store.claim('evt', HASH_A, HASH_A)).toEqual({ action: 'mismatch' });

    mock.state.inserts.push([]);
    mock.state.selects.push([row({ state: 'failed' })]);
    mock.state.updates.push([{ eventId: 'evt' }]);
    expect(await store.claim('evt', HASH_B, HASH_A)).toEqual({ action: 'claimed_retry' });
  });

  it('does not reopen unknown or processing records', async () => {
    const store = new PostgresWebhookReplayStore();

    mock.state.inserts.push([]);
    mock.state.selects.push([row({ state: 'unknown' })]);
    expect(await store.claim('evt', HASH_B, HASH_A)).toEqual({ action: 'in_progress' });

    mock.state.inserts.push([]);
    mock.state.selects.push([row({ state: 'processing' })]);
    expect(await store.claim('evt', HASH_B, HASH_A)).toEqual({ action: 'in_progress' });
  });

  it('recovers legacy rows and stale pending rows, but preserves active work', async () => {
    const store = new PostgresWebhookReplayStore();

    mock.state.inserts.push([]);
    mock.state.selects.push([row({ payloadHash: null })]);
    mock.state.updates.push([{ eventId: 'evt' }]);
    expect(await store.claim('evt', HASH_B, HASH_B)).toEqual({ action: 'claimed_retry' });

    mock.state.inserts.push([]);
    mock.state.selects.push([row({ processedAt: new Date(Date.now() - 300_000) })]);
    mock.state.updates.push([{ eventId: 'evt' }]);
    expect(await store.claim('evt', HASH_A, HASH_A)).toEqual({ action: 'claimed_retry' });

    mock.state.inserts.push([]);
    mock.state.selects.push([row({ processedAt: new Date() })]);
    expect(await store.claim('evt', HASH_A, HASH_A)).toEqual({ action: 'in_progress' });
  });

  it('retries when a concurrent insert loses the race and propagates non-unique errors', async () => {
    const store = new PostgresWebhookReplayStore();
    const uniqueError = Object.assign(new Error('duplicate'), { code: '23505' });
    mock.state.insertErrors.push(uniqueError, uniqueError, uniqueError);
    expect(await store.claim('missing', HASH_A, HASH_A)).toEqual({ action: 'in_progress' });

    mock.state.insertErrors.push(new Error('connection refused'));
    await expect(store.claim('broken', HASH_A, HASH_A)).rejects.toThrow('connection refused');
  });

  it('completes and fails only the targeted receipt', async () => {
    const store = new PostgresWebhookReplayStore();
    mock.state.updates.push([{ eventId: 'evt' }], []);
    expect(await store.complete('evt')).toBe(true);
    expect(await store.complete('evt')).toBe(false);
    await expect(store.fail('evt')).resolves.toBeUndefined();
  });
});
