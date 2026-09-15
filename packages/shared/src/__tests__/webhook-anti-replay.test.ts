import { describe, it, expect } from 'vitest';
import { InMemoryWebhookReplayStore } from '../webhook-anti-replay';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

describe('InMemoryWebhookReplayStore (recibo em duas fases)', () => {
  it('reivindica evento novo uma única vez e bloqueia concorrente imediato', async () => {
    const store = new InMemoryWebhookReplayStore();

    expect(await store.claim('evt-1', HASH_A, HASH_A)).toEqual({ action: 'claimed_new' });
    expect(await store.claim('evt-1', HASH_A, HASH_A)).toEqual({ action: 'in_progress' });
    expect(await store.has('evt-1')).toBe(true);
    expect(await store.has('evt-outro')).toBe(false);
  });

  it('permite retry imediato depois de falha marcada', async () => {
    const store = new InMemoryWebhookReplayStore();
    await store.claim('evt-2', HASH_A, HASH_A);
    await store.fail('evt-2');

    expect(await store.claim('evt-2', HASH_A, HASH_A)).toEqual({ action: 'claimed_retry' });
    expect(await store.claim('evt-2', HASH_A, HASH_A)).toEqual({ action: 'in_progress' });
  });

  it('aceita retry com nova assinatura quando o payload permanece igual', async () => {
    const store = new InMemoryWebhookReplayStore();

    expect(await store.claim('evt-renewed', HASH_A, HASH_A)).toEqual({ action: 'claimed_new' });
    await store.fail('evt-renewed');

    expect(await store.claim('evt-renewed', HASH_B, HASH_A)).toEqual({ action: 'claimed_retry' });
    expect(await store.claim('evt-renewed', HASH_B, HASH_A)).toEqual({ action: 'in_progress' });
  });

  it('rejeita replay de recibo concluído e mismatch de payload', async () => {
    const store = new InMemoryWebhookReplayStore();
    await store.claim('evt-3', HASH_A, HASH_A);
    expect(await store.complete('evt-3')).toBe(true);
    expect(await store.complete('evt-3')).toBe(false);

    expect(await store.claim('evt-3', HASH_A, HASH_A)).toEqual({ action: 'duplicate' });
    expect(await store.claim('evt-3', HASH_B, HASH_B)).toEqual({ action: 'mismatch' });
  });

  it('recupera pending além da janela de stale e não rebaixa completed', async () => {
    let now = 1_000_000;
    const store = new InMemoryWebhookReplayStore(() => now);
    process.env.WEBHOOK_REPLAY_STALE_SECONDS = '10';

    try {
      await store.claim('evt-4', HASH_A, HASH_A);
      now += 5_000;
      expect(await store.claim('evt-4', HASH_A, HASH_A)).toEqual({ action: 'in_progress' });

      now += 6_000;
      expect(await store.claim('evt-4', HASH_A, HASH_A)).toEqual({ action: 'claimed_retry' });

      await store.fail('evt-4');
      expect(await store.complete('evt-4')).toBe(true);
      await store.fail('evt-4');

      now += 3_600_000;
      expect(await store.claim('evt-4', HASH_A, HASH_A)).toEqual({ action: 'duplicate' });
    } finally {
      delete process.env.WEBHOOK_REPLAY_STALE_SECONDS;
    }
  });
});
