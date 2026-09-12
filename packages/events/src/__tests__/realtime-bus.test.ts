import { describe, it, expect } from 'vitest';
import { RedisRealtimeBus, NoopRealtimeBus, REALTIME_BUS_CHANNEL } from '../realtime-bus';
import type { EventEnvelope } from '../envelope';

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

function envelope(id: string): EventEnvelope {
  return {
    event_id: id,
    event_type: 'message.persisted',
    aggregate_type: 'Message',
    aggregate_id: 'm-1',
    occurred_at: new Date().toISOString(),
    payload: { messageId: 'm-1' },
    version: 1,
  };
}

describe('RedisRealtimeBus (real Redis)', () => {
  it('delivers A→B and B→A with instance isolation', async () => {
    const busA = new RedisRealtimeBus({ url: REDIS_URL, channel: `${REALTIME_BUS_CHANNEL}:test-fanout` });
    const busB = new RedisRealtimeBus({ url: REDIS_URL, channel: `${REALTIME_BUS_CHANNEL}:test-fanout` });
    await busA.start();
    await busB.start();
    expect(busA.isConnected()).toBe(true);
    expect(busB.isConnected()).toBe(true);
    expect(busA.instanceId).not.toBe(busB.instanceId);

    try {
      const receivedB: EventEnvelope[] = [];
      const receivedA: EventEnvelope[] = [];
      busB.onEnvelope((envelope) => receivedB.push(envelope));
      busA.onEnvelope((envelope) => receivedA.push(envelope));

      // Sender não recebe o próprio eco (isolamento por instanceId).
      expect(await busA.publish(envelope('evt-a1'))).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(receivedB.map((e) => e.event_id)).toContain('evt-a1');
      expect(receivedA).toHaveLength(0);

      expect(await busB.publish(envelope('evt-b1'))).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(receivedA.map((e) => e.event_id)).toContain('evt-b1');
      expect(receivedB.map((e) => e.event_id)).not.toContain('evt-b1');
    } finally {
      await busA.stop();
      await busB.stop();
    }
  });

  it('malformed channel messages do not break subscriber', async () => {
    const bus = new RedisRealtimeBus({ url: REDIS_URL, channel: `${REALTIME_BUS_CHANNEL}:test-malformed` });
    await bus.start();
    try {
      const received: EventEnvelope[] = [];
      bus.onEnvelope((envelope) => received.push(envelope));
      const { createClient } = await import('redis');
      const raw = createClient({ url: REDIS_URL });
      await raw.connect();
      await raw.publish(`${REALTIME_BUS_CHANNEL}:test-malformed`, 'not-json{{{');
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(received).toHaveLength(0);
      expect(await bus.publish(envelope('evt-after-malformed'))).toBe(true);
    } finally {
      await bus.stop();
    }
  });
  it('redis down → explicit degraded state, never silent (poll covers)', async () => {
    process.env.REALTIME_BUS_CONNECT_TIMEOUT_MS = '1500';
    try {
      const bus = new RedisRealtimeBus({ url: 'redis://127.0.0.1:9' });
      await expect(bus.start()).rejects.toThrow();
      expect(bus.isConnected()).toBe(false);
      // publish sem conexão: false explícito (caller faz fallback para poll).
      expect(await bus.publish(envelope('evt-down'))).toBe(false);
      await bus.stop();
    } finally {
      delete process.env.REALTIME_BUS_CONNECT_TIMEOUT_MS;
    }
  }, 20000);
});

describe('NoopRealtimeBus', () => {  it('never delivers and reports disconnected', async () => {
    const bus = new NoopRealtimeBus();
    await bus.start();
    expect(bus.isConnected()).toBe(false);
    expect(await bus.publish(envelope('x'))).toBe(false);
    let called = 0;
    const unsub = bus.onEnvelope(() => {
      called += 1;
    });
    unsub();
    expect(called).toBe(0);
    await bus.stop();
  });
});
