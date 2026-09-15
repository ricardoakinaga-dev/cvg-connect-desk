import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createAllowAllAuthorizationPort } from '@cvg/realtime';
import { RealtimeServer } from '../index.ts';

const originalEnv = {
  nodeEnv: process.env.NODE_ENV,
  deskApiUrl: process.env.DESK_API_URL,
  outboxMode: process.env.USE_DATABASE_OUTBOX,
  interval: process.env.REALTIME_POLL_INTERVAL_MS,
  internalSecret: process.env.INTERNAL_EVENTS_SECRET,
  redisUrl: process.env.REDIS_URL,
  metricsToken: process.env.METRICS_TOKEN,
};

function restoreEnv(): void {
  if (originalEnv.nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalEnv.nodeEnv;
  if (originalEnv.deskApiUrl === undefined) delete process.env.DESK_API_URL;
  else process.env.DESK_API_URL = originalEnv.deskApiUrl;
  if (originalEnv.outboxMode === undefined) delete process.env.USE_DATABASE_OUTBOX;
  else process.env.USE_DATABASE_OUTBOX = originalEnv.outboxMode;
  if (originalEnv.interval === undefined) delete process.env.REALTIME_POLL_INTERVAL_MS;
  else process.env.REALTIME_POLL_INTERVAL_MS = originalEnv.interval;
  if (originalEnv.internalSecret === undefined) delete process.env.INTERNAL_EVENTS_SECRET;
  else process.env.INTERNAL_EVENTS_SECRET = originalEnv.internalSecret;
  if (originalEnv.redisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = originalEnv.redisUrl;
  if (originalEnv.metricsToken === undefined) delete process.env.METRICS_TOKEN;
  else process.env.METRICS_TOKEN = originalEnv.metricsToken;
}

async function freePort(): Promise<number> {
  const probe = createServer();
  return await new Promise<number>((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = (probe.address() as AddressInfo).port;
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForHealth(port: number, path: string, expectedStatus: number, timeoutMs = 1000): Promise<Response> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      if (response.status === expectedStatus) return response;
    } catch {
      // The listener may still be binding.
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${path} HTTP ${expectedStatus}`);
}

async function closeServer(server: Server | undefined): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

describe('Realtime health and readiness', () => {
  afterEach(restoreEnv);

  it('keeps liveness green while readiness fails without a working poller', async () => {
    process.env.USE_DATABASE_OUTBOX = 'false';
    process.env.REALTIME_POLL_INTERVAL_MS = '20';
    process.env.DESK_API_URL = 'http://127.0.0.1:9';
    delete process.env.INTERNAL_EVENTS_SECRET;
    delete process.env.REDIS_URL;

    const port = await freePort();
    const realtime = new RealtimeServer(port, { authorizationPort: createAllowAllAuthorizationPort() });
    realtime.start();
    try {
      const liveness = await waitForHealth(port, '/health', 200);
      expect((await liveness.json()).service).toBe('realtime-service');

      await new Promise((resolve) => setTimeout(resolve, 60));
      const readiness = await waitForHealth(port, '/readiness', 503);
      const body = await readiness.json();
      expect(body.ready).toBe(false);
      expect(body.checks.websocket.status).toBe('ok');
      expect(body.checks.poller.status).toBe('error');
    } finally {
      realtime.stop();
    }
  });

  it('reports readiness only after the real HTTP polling loop succeeds', async () => {
    const api = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ events: [], serverTime: new Date().toISOString() }));
    });
    const apiPort = await new Promise<number>((resolve) => {
      api.listen(0, '127.0.0.1', () => resolve((api.address() as AddressInfo).port));
    });

    process.env.USE_DATABASE_OUTBOX = 'false';
    process.env.REALTIME_POLL_INTERVAL_MS = '20';
    process.env.DESK_API_URL = `http://127.0.0.1:${apiPort}`;
    process.env.INTERNAL_EVENTS_SECRET = 'health-test-internal-secret';
    delete process.env.REDIS_URL;

    const port = await freePort();
    const realtime = new RealtimeServer(port, { authorizationPort: createAllowAllAuthorizationPort() });
    realtime.start();
    try {
      const readiness = await waitForHealth(port, '/readiness', 200);
      const body = await readiness.json();
      expect(body.ready).toBe(true);
      expect(body.checks.poller).toMatchObject({ mode: 'http', status: 'ok', consecutiveFailures: 0 });
    } finally {
      realtime.stop();
      await closeServer(api);
    }
  });

  it('protects the Prometheus endpoint in production and allows a configured bearer token', async () => {
    process.env.NODE_ENV = 'production';
    process.env.USE_DATABASE_OUTBOX = 'false';
    process.env.REALTIME_POLL_INTERVAL_MS = '20';
    process.env.DESK_API_URL = 'http://127.0.0.1:9';
    delete process.env.INTERNAL_EVENTS_SECRET;
    delete process.env.REDIS_URL;
    delete process.env.METRICS_TOKEN;

    const port = await freePort();
    const realtime = new RealtimeServer(port, { authorizationPort: createAllowAllAuthorizationPort() });
    realtime.start();
    try {
      const unavailable = await waitForHealth(port, '/metrics', 503);
      expect(await unavailable.json()).toEqual({ error: 'METRICS_UNAVAILABLE' });

      process.env.METRICS_TOKEN = 'realtime-health-metrics-secret';
      const anonymous = await waitForHealth(port, '/metrics', 401);
      expect(await anonymous.json()).toEqual({ error: 'UNAUTHORIZED' });

      const wrong = await fetch(`http://127.0.0.1:${port}/metrics`, {
        headers: { authorization: 'Bearer wrong-secret' },
      });
      expect(wrong.status).toBe(401);

      const authorized = await fetch(`http://127.0.0.1:${port}/metrics?probe=1`, {
        headers: { authorization: 'Bearer realtime-health-metrics-secret' },
      });
      expect(authorized.status).toBe(200);
      expect(authorized.headers.get('content-type')).toContain('text/plain; version=0.0.4');
      expect(await authorized.text()).toContain('# TYPE http_requests_total counter');
    } finally {
      realtime.stop();
    }
  });
});
