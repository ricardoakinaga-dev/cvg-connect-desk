import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { AddressInfo } from 'net';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { RealtimeServer } from '../index.ts';
import { RedisRealtimeBus } from '@cvg/events';
import type { EventEnvelope } from '@cvg/events';

/**
 * Final-8: fan-out multi-réplica via Redis.
 * Cliente no nó A recebe evento publicado pelo nó B (e inverso).
 * Requer Redis real (REDIS_URL ou 127.0.0.1:6379).
 */
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getFreePort(): Promise<number> {
  const probe = createServer();
  return await new Promise<number>((resolve, reject) => {
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address() as AddressInfo;
      probe.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
  });
}

async function startAuthServer() {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url === '/auth/me') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ user: { id: 'fanout-user', email: 'fanout@example.com', name: 'Fanout', roles: ['Receptionist'] } }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'NOT_FOUND' }));
  });
  const port = await new Promise<number>((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
  return { baseUrl: `http://127.0.0.1:${port}`, server };
}

async function connectClient(url: string) {
  return await new Promise<{ ws: WebSocket; messages: any[] }>((resolve, reject) => {
    const messages: any[] = [];
    const ws = new WebSocket(url);
    ws.on('message', (data: Buffer) => {
      try {
        messages.push(JSON.parse(data.toString()));
      } catch {
        messages.push(data.toString());
      }
    });
    ws.on('open', () => resolve({ ws, messages }));
    ws.on('error', reject);
  });
}

async function waitForMessage(client: { messages: any[] }, predicate: (message: any) => boolean, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (!client.messages.some(predicate)) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for message. Received: ${JSON.stringify(client.messages)}`);
    }
    await wait(25);
  }
}

function fanoutEnvelope(id: string): EventEnvelope {
  return {
    event_id: id,
    event_type: 'message.persisted',
    aggregate_type: 'Message',
    aggregate_id: 'fanout-conv-1',
    occurred_at: new Date().toISOString(),
    payload: { messageId: 'm-fanout', conversationId: 'fanout-conv-1', content: 'fanout!' },
    version: 1,
  };
}

describe('Realtime multi-replica fanout (real Redis + WS)', () => {
  let authServer: Awaited<ReturnType<typeof startAuthServer>>;
  let serverA: RealtimeServer | undefined;
  let serverB: RealtimeServer | undefined;

  beforeEach(async () => {
    process.env.DESK_API_URL = '';
    process.env.USE_DATABASE_OUTBOX = 'false';
    process.env.REALTIME_POLL_INTERVAL_MS = '60000';
    process.env.REALTIME_AUTH_REVALIDATE_MS = '60000';
    process.env.REDIS_URL = REDIS_URL;
    process.env.NODE_ENV = 'test';

    authServer = await startAuthServer();
    process.env.DESK_API_URL = authServer.baseUrl;

    serverA = new RealtimeServer(await getFreePort());
    serverB = new RealtimeServer(await getFreePort());
    serverA.start();
    serverB.start();
    await wait(300);
  });

  afterEach(async () => {
    serverA?.stop();
    serverB?.stop();
    await new Promise<void>((resolve) => authServer.server.close(() => resolve()));
    delete process.env.DESK_API_URL;
    delete process.env.USE_DATABASE_OUTBOX;
    delete process.env.REALTIME_POLL_INTERVAL_MS;
    delete process.env.REALTIME_AUTH_REVALIDATE_MS;
    delete process.env.REDIS_URL;
  });

  async function authedSubscribedClient(port: number, channel: string) {
    const client = await connectClient(`ws://127.0.0.1:${port}`);
    await waitForMessage(client, (m) => m.event === 'auth.required');
    client.ws.send(JSON.stringify({ type: 'auth', token: 'fanout-token' }));
    await waitForMessage(client, (m) => m.event === 'auth.success');
    client.ws.send(JSON.stringify({ type: 'subscribe', channel }));
    await waitForMessage(client, (m) => m.event === 'subscribed');
    return client;
  }

  it('client on A receives event published by B (and inverse)', async () => {
    const portA = (serverA as unknown as { port: number }).port;
    const portB = (serverB as unknown as { port: number }).port;

    const clientA = await authedSubscribedClient(portA, 'global');
    const clientB = await authedSubscribedClient(portB, 'global');

    // Publica DIRETAMENTE no bus (equivale ao hint que B emitiria via outbox).
    const busB = new RedisRealtimeBus({ url: REDIS_URL });
    await busB.start();
    try {
      await busB.publish(fanoutEnvelope(`fanout-a-${Date.now()}`));
      await waitForMessage(
        clientA,
        (m) => m.event === 'message.persisted' && m.data?.payload?.content === 'fanout!',
      );

      await busB.publish(fanoutEnvelope(`fanout-b-${Date.now()}`));
      await waitForMessage(
        clientB,
        (m) => m.event === 'message.persisted' && m.data?.payload?.content === 'fanout!',
      );
    } finally {
      await busB.stop();
    }

    clientA.ws.close();
    clientB.ws.close();
  });

  it('no duplicate broadcast when poll and bus deliver the same event', async () => {
    const portA = (serverA as unknown as { port: number }).port;
    const clientA = await authedSubscribedClient(portA, 'global');

    const bus = new RedisRealtimeBus({ url: REDIS_URL });
    await bus.start();
    try {
      const id = `fanout-dedup-${Date.now()}`;
      // Entrega dupla proposital pelo bus (poll faria o mesmo).
      await bus.publish(fanoutEnvelope(id));
      await bus.publish(fanoutEnvelope(id));
      await waitForMessage(
        clientA,
        (m) => m.event === 'message.persisted' && m.data?.payload?.content === 'fanout!',
      );
      await wait(500);
      const deliveries = clientA.messages.filter(
        (m) => m.event === 'message.persisted' && m.data?.payload?.content === 'fanout!',
      );
      expect(deliveries).toHaveLength(1);
    } finally {
      await bus.stop();
    }
    clientA.ws.close();
  });
});
