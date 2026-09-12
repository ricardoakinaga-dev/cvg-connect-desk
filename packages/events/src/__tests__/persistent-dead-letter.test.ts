import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { persistentDeadLetterStore } from '../persistent-dead-letter';

/**
 * Final-1: DLQ persistente em PostgreSQL real.
 * Critério: restart do processo NÃO perde eventos (store é stateless; PG é a verdade).
 */
describe('PersistentDeadLetterStore (real PG)', () => {
  const prefix = `dlq.persist.${Date.now()}`;

  beforeEach(async () => {
    await persistentDeadLetterStore.deleteByEventPrefix(prefix);
  });

  afterAll(async () => {
    await persistentDeadLetterStore.deleteByEventPrefix(prefix);
  });

  function input(suffix: string, payload: unknown = { hello: 'world' }) {
    return {
      originalEventId: `${prefix}.${suffix}`,
      consumerId: 'worker',
      eventType: 'message.persisted',
      payload,
      errorCode: 'WORKER_TERMINAL',
      errorMessage: 'boom',
      attemptCount: 3,
    };
  }

  it('persists failure and recovers it (restart-safe)', async () => {
    const { entry, isDuplicate } = await persistentDeadLetterStore.persist(input('a'));
    expect(isDuplicate).toBe(false);
    expect(entry.status).toBe('PENDING');
    expect(entry.attemptCount).toBe(3);

    // "Restart": nenhuma referência à instância anterior é necessária —
    // o próprio store não guarda estado; o PG responde.
    const recovered = await persistentDeadLetterStore.findByEvent(`${prefix}.a`, 'worker');
    expect(recovered?.id).toBe(entry.id);
    expect(recovered?.payload).toMatchObject({ hello: 'world' });
  });

  it('duplicate persist returns existing entry (idempotent)', async () => {
    const first = await persistentDeadLetterStore.persist(input('b'));
    const second = await persistentDeadLetterStore.persist(input('b'));
    expect(second.isDuplicate).toBe(true);
    expect(second.entry.id).toBe(first.entry.id);
  });

  it('isolates entries per consumer', async () => {
    await persistentDeadLetterStore.persist(input('c'));
    await persistentDeadLetterStore.persist({ ...input('c'), consumerId: 'realtime' });
    const worker = await persistentDeadLetterStore.list({ consumerId: 'worker', eventType: 'message.persisted', limit: 100 });
    expect(worker.map((e) => e.originalEventId)).toContain(`${prefix}.c`);
  });

  it('atomic claim: only one concurrent claimant wins', async () => {
    const { entry } = await persistentDeadLetterStore.persist(input('d'));
    const [first, second] = await Promise.all([
      persistentDeadLetterStore.claimForReplay(entry.id),
      persistentDeadLetterStore.claimForReplay(entry.id),
    ]);
    const winners = [first, second].filter(Boolean);
    expect(winners).toHaveLength(1);
  });

  it('replay lifecycle: claim → replayed → resolved and excluded from pending', async () => {
    const { entry } = await persistentDeadLetterStore.persist(input('e'));
    const claimed = await persistentDeadLetterStore.claimForReplay(entry.id);
    expect(claimed?.status).toBe('REPLAYING');

    const done = await persistentDeadLetterStore.markReplayed(entry.id);
    expect(done?.status).toBe('RESOLVED');
    expect(done?.replayCount).toBe(1);

    const pending = await persistentDeadLetterStore.list({ status: 'PENDING', limit: 100 });
    expect(pending.map((p) => p.id)).not.toContain(entry.id);
  });

  it('replay failure returns entry to PENDING (visible again)', async () => {
    const { entry } = await persistentDeadLetterStore.persist(input('f'));
    await persistentDeadLetterStore.claimForReplay(entry.id);
    const back = await persistentDeadLetterStore.markReplayFailed(entry.id, 'republish exploded');
    expect(back?.status).toBe('PENDING');
    expect(back?.attemptCount).toBe(4);
  });

  it('resolve and discard with actor and reason', async () => {
    const { entry: e1 } = await persistentDeadLetterStore.persist(input('g'));
    const resolved = await persistentDeadLetterStore.resolve(e1.id, randomUUID(), 'fixed manually');
    expect(resolved?.status).toBe('RESOLVED');
    expect(resolved?.resolutionReason).toBe('fixed manually');

    const { entry: e2 } = await persistentDeadLetterStore.persist(input('h'));
    const discarded = await persistentDeadLetterStore.discard(e2.id, randomUUID(), 'poison event');
    expect(discarded?.status).toBe('DISCARDED');
  });

  it('claim on non-pending entry returns null (duplicate replay safe)', async () => {
    const { entry } = await persistentDeadLetterStore.persist(input('i'));
    await persistentDeadLetterStore.claimForReplay(entry.id);
    await persistentDeadLetterStore.markReplayed(entry.id);
    const again = await persistentDeadLetterStore.claimForReplay(entry.id);
    expect(again).toBeNull();
  });

  it('corrupted payload handling: string payload wrapped, not thrown', async () => {
    const { entry } = await persistentDeadLetterStore.persist(input('j', 'not-json{{{'));
    const recovered = await persistentDeadLetterStore.getById(entry.id);
    expect(recovered?.payload).toMatchObject({ _raw: 'not-json{{{' });
  });

  it('batch claim respects limit and excludes claimed', async () => {
    const consumer = `${prefix}-batch`;
    const mk = (s: string) => ({ ...input(s), consumerId: consumer });
    await persistentDeadLetterStore.persist(mk('k1'));
    await persistentDeadLetterStore.persist(mk('k2'));
    await persistentDeadLetterStore.persist(mk('k3'));
    const batch = await persistentDeadLetterStore.claimBatch({ consumerId: consumer, limit: 2 });
    expect(batch).toHaveLength(2);
    const rest = await persistentDeadLetterStore.list({ status: 'PENDING', consumerId: consumer, limit: 100 });
    const restIds = rest.map((r) => r.originalEventId);
    expect(restIds).toHaveLength(1);
    expect(restIds[0]).toMatch(/\.k[123]$/);
    expect(restIds).not.toContain(batch[0].originalEventId);
    expect(restIds).not.toContain(batch[1].originalEventId);
  });

  it('stats: countByStatus and oldestPendingAge', async () => {
    await persistentDeadLetterStore.persist(input('l'));
    const counts = await persistentDeadLetterStore.countByStatus();
    expect(counts.PENDING).toBeGreaterThanOrEqual(1);
    const age = await persistentDeadLetterStore.oldestPendingAge();
    expect(age.count).toBeGreaterThanOrEqual(1);
    expect(age.oldestAgeSeconds).not.toBeNull();
  });
});
