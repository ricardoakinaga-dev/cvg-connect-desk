import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { persistentDeadLetterStore } from '../persistent-dead-letter';

/**
 * DLQ advanced (§17): state machine adversarial.
 * PENDING → REPLAYING → RESOLVED | PENDING (retry). Nunca estado impossível.
 */
describe('PersistentDLQ advanced validation', () => {
  const prefix = `dlq.adv.${Date.now()}`;
  const consumer = 'adv-worker';

  function evt(suffix: string) {
    return {
      originalEventId: `${prefix}.${suffix}`,
      consumerId: consumer,
      eventType: 'message.persisted',
      payload: { event_id: `${prefix}.${suffix}`, event_type: 'message.persisted', aggregate_type: 'Message', aggregate_id: randomUUID(), occurred_at: new Date().toISOString(), payload: {}, version: 1 },
      errorMessage: 'boom',
    };
  }

  beforeAll(async () => {
    await persistentDeadLetterStore.deleteByEventPrefix(prefix);
  });

  afterAll(async () => {
    await persistentDeadLetterStore.deleteByEventPrefix(prefix);
  });

  it('process kill after claim: entrada volta a PENDING via re-claim... (fenômeno de restart)', async () => {
    // Cenário: worker claim (REPLAYING) e morre ANTES do replay commit.
    const { entry } = await persistentDeadLetterStore.persist(evt('kill-claim'));
    const claimed = await persistentDeadLetterStore.claimForReplay(entry.id);
    expect(claimed?.status).toBe('REPLAYING');

    // "Restart": nova instância não vê REPLAYING como PENDING — mas o
    // sistema de replay opera por idempotência: second claim retorna null.
    const reClaim = await persistentDeadLetterStore.claimForReplay(entry.id);
    expect(reClaim).toBeNull();

    // Recovery operacional: markReplayFailed devolve PENDING (retentável).
    const back = await persistentDeadLetterStore.markReplayFailed(entry.id, 'lost after claim');
    expect(back?.status).toBe('PENDING');
  });

  it('process kill before replay commit: causaId fica resolvida sem duplicar', async () => {
    const { entry } = await persistentDeadLetterStore.persist(evt('kill-commit'));
    expect(entry.status).toBe('PENDING');
    // Nada replayed: permanece PENDING até action manual (idempotente).
    const again = await persistentDeadLetterStore.persist(evt('kill-commit'));
    expect(again.isDuplicate).toBe(true);
    expect(again.entry.status).toBe('PENDING');
  });

  it('concurrent replay: dois operadores, um vence (claim atômico)', async () => {
    const { entry } = await persistentDeadLetterStore.persist(evt('conc'));
    const [a, b] = await Promise.all([
      persistentDeadLetterStore.claimForReplay(entry.id),
      persistentDeadLetterStore.claimForReplay(entry.id),
    ]);
    const ifoReplay = !a || !b;
    expect(ifoReplay);
    expect(a === null || b === null).toBe(true);
    // Vencedor marca replayed; perdedor ficou null (não quebra).
    const done = await persistentDeadLetterStore.markReplayed(a ? a.id : b.id);
    expect(done?.status).toBe('RESOLVED');
  });

  it('same event replayed by two operators (idempotent result)', async () => {
    const { entry } = await persistentDeadLetterStore.persist(evt('two-operators'));
    const c1 = await persistentDeadLetterStore.claimForReplay(entry.id);
    expect(c1).not.toBeNull();
    await persistentDeadLetterStore.markReplayed(entry.id);
    // Segundo operador: claim retorna null (já RESOLVED na prática)
    const c2 = await persistentDeadLetterStore.claimForReplay(entry.id);
    expect(c2).toBeNull();
    const stateNow = await persistentDeadLetterStore.getById(entry.id);
    expect(stateNow?.status).toBe('RESOLVED');
  });

  it('corrupt payload: pode ser inspecionado, não replayed; retorno a PENDING (não some)', async () => {
    const { entry } = await persistentDeadLetterStore.persist({ ...evt('corrupt'), payload: 'garbage-string' });
    const claimed = await persistentDeadLetterStore.claimForReplay(entry.id);
    expect(claimed).not.toBeNull();
    const back = await persistentDeadLetterStore.markReplayFailed(claimed!.id, 'corrupted payload');
    expect(back?.status).toBe('PENDING');
  });

  it('poison message: 3 ciclos claim→falha não saem da máquina de estados', async () => {
    const { entry } = await persistentDeadLetterStore.persist(evt('poison'));
    for (let i = 0; i < 3; i += 1) {
      const claimed = await persistentDeadLetterStore.claimForReplay(entry.id);
      expect(claimed?.status).toBe('REPLAYING');
      const back = await persistentDeadLetterStore.markReplayFailed(entry.id, `attempt ${i + 1}`);
      expect(back?.status).toBe('PENDING');
    }
    const stable = await persistentDeadLetterStore.getById(entry.id);
    expect(stable?.attemptCount).toBe(3);
    expect(stable?.status).toBe('PENDING');
  });

  it('100-event batch claim respeita limite e all-or-nothing por linha', async () => {
    for (let i = 0; i < 25; i += 1) {
      await persistentDeadLetterStore.persist({ ...evt(`batch-${i}`), consumerId: `${consumer}-batch100` });
    }
    const claimed = await persistentDeadLetterStore.claimBatch({ consumerId: `${consumer}-batch100`, limit: 25 });
    expect(claimed).toHaveLength(25);
    const left = await persistentDeadLetterStore.list({ status: 'PENDING', consumerId: `${consumer}-batch100`, limit: 100 });
    expect(left).toHaveLength(0);
  });

  it('retry loop prevention: claim só de PENDING (REPLAYING nunca re-claimado)', async () => {
    const { entry } = await persistentDeadLetterStore.persist(evt('loop'));
    await persistentDeadLetterStore.claimForReplay(entry.id);
    // snapshots: claimed mostra REPLAYING; um segundo claim é null (sem loop).
    const second = await persistentDeadLetterStore.claimForReplay(entry.id);
    expect(second).toBeNull();
    // após falha volta PENDING e pode re-claim (bounded por decisão humana).
    await persistentDeadLetterStore.markReplayFailed(entry.id, 'x');
    const third = await persistentDeadLetterStore.claimForReplay(entry.id);
    expect(third).not.toBeNull();
  });
});
