import { describe, expect, it } from 'vitest';
import { createWorkerHealthServer, createWorkerHealthTracker } from '../health';

describe('message worker health endpoint', () => {
  it('returns a real liveness response and rejects unknown paths', async () => {
    const server = createWorkerHealthServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Health server did not expose a TCP address');
    }

    const health = await fetch(`http://127.0.0.1:${address.port}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: 'ok', service: 'message-worker' });

    const missing = await fetch(`http://127.0.0.1:${address.port}/missing`);
    expect(missing.status).toBe(404);

    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it('readiness follows the real polling loop and reports queue age', async () => {
    let now = 1_000_000;
    const tracker = createWorkerHealthTracker({
      pollIntervalMs: 100,
      maxQueueAgeSeconds: 10,
      clock: () => now,
    });
    const server = createWorkerHealthServer(() => tracker.snapshot());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Health server did not expose a TCP address');
    }

    try {
      const beforeLoop = await fetch(`http://127.0.0.1:${address.port}/readiness`);
      expect(beforeLoop.status).toBe(503);

      tracker.markLoopStarted();
      tracker.markLoopSucceeded({ pendingCount: 2, oldestPendingAt: new Date(now - 4_000) });
      const healthy = await fetch(`http://127.0.0.1:${address.port}/readiness`);
      expect(healthy.status).toBe(200);
      expect(await healthy.json()).toMatchObject({
        ready: true,
        checks: { loop: { status: 'ok' }, queue: { pendingCount: 2, oldestAgeSeconds: 4 } },
      });

      now += 11_000;
      const staleQueue = await fetch(`http://127.0.0.1:${address.port}/readiness`);
      expect(staleQueue.status).toBe(503);
      expect((await staleQueue.json()).checks.queue.status).toBe('degraded');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('exposes worker metrics with the production token gate', async () => {
    const previousToken = process.env.METRICS_TOKEN;
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    process.env.METRICS_TOKEN = 'worker-metrics-test-token';
    const server = createWorkerHealthServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));

    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Health server did not expose a TCP address');
    try {
      const anonymous = await fetch(`http://127.0.0.1:${address.port}/metrics`);
      expect(anonymous.status).toBe(401);
      const authorized = await fetch(`http://127.0.0.1:${address.port}/metrics`, {
        headers: { authorization: 'Bearer worker-metrics-test-token' },
      });
      expect(authorized.status).toBe(200);
      expect(await authorized.text()).toContain('media_recovery_claims_total');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      if (previousToken === undefined) delete process.env.METRICS_TOKEN;
      else process.env.METRICS_TOKEN = previousToken;
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });
});
