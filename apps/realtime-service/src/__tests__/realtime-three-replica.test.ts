import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { AddressInfo } from 'net';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { RealtimeServer } from '../index.ts';
import { RedisRealtimeBus } from '@cvg/events';

/**
 * Realtime resilience final (§16): 3 réplicas, morte de nó, reconnect.
 * Requer Redis real. Nós usam polling desabilitado (bus é o alvo).
 */
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getFreePort(): Promise<number> {
  const probe = createServer();
  return await new Promise<number>((resolve) => {
    probe.listen(0, '127.0.0.1', () => {
      const addr = probe.address() as AddressInfo;
      probe.close((error) => (error ? (() => { throw error; })() : resolve(addr.port)));
    });
  });
}

async function startAuthServer() {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url === '/auth/me') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ user: { id: 'u-fan', email: 'f@x.com', name: 'Fan', roles: ['Receptionist'] } }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'NOT_FOUND' }));
  });
  const port = await new Promise<number>((resolve) => {
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

async function waitFor(client: { messages: any[] }, predicate: (m: any) => boolean, timeoutMs = 15000) {
  const started = Date.now();
  while (!client.messages.some(predicate)) {
    if (Date.now() - started > timeoutMs) throw new Error(`timeout: ${JSON.stringify(client.messages.slice(-3))}`);
    await wait(25);
  }
}

function envelope(id: string) {
  return {
    event_id: id,
    event_type: 'message.persisted',
    aggregate_type: 'Message',
    aggregate_id: 'fan-conv',
    occurred_at: new Date().toISOString(),
    payload: { messageId: 'm', conversationId: 'fan-conv', content: 'conn' },
    version: 1,
  };
}

describe('Realtime 3-replica resilience (real Redis)', () => {
  let auth: Awaited<ReturnType<typeof startAuthServer>>;
  let nodes: RealtimeServer[] = [];
  let ports: number[] = [];

  beforeEach(async () => {
    process.env.USE_DATABASE_OUTBOX = 'false';
    process.env.REALTIME_POLL_INTERVAL_MS = '60000';
    process.env.REALTIME_AUTH_REVALIDATE_MS = '60000';
    process.env.REDIS_URL = REDIS_URL;
    process.env.DESK_API_URL = (auth = await startAuthServer()).baseUrl;
    nodes = [];
    ports = [];
    for (let i = 0; i < 3; i += 1) {
      const port = await getFreePort();
      ports.push(port);
      const s = new RealtimeServer(port);
      nodes.push(s);
      s.start();
    }
    await wait(400);
  });

  afterEach(async () => {
    for (const s of nodes) s.stop();
    await new Promise<void>((resolve) => auth.server.close(() => resolve()));
    delete process.env.DESK_API_URL;
    delete process.env.USE_DATABASE_OUTBOX;
    delete process.env.REALTIME_POLL_INTERVAL_MS;
    delete process.env.REALTIME_AUTH_REVALIDATE_MS;
    delete process.env.REDIS_URL;
  });

  async function authedSubscribed(port: number) {
    const client = await connectClient(`ws://127.0.0.1:${port}`);
    await waitFor(client, (m) => m.event === 'auth.required');
    client.ws.send(JSON.stringify({ type: 'auth', token: 't' }));
    await waitFor(client, (m) => m.event === 'auth.success');
    client.ws.send(JSON.stringify({ type: 'subscribe', channel: 'global' }));
    await waitFor(client, (m) => m.event === 'subscribed');
    return client;
  }

  it('3 réplicas: publicador em nó C entrega a cliente no nó A', async () => {
    const clientA = await authedSubscribed(ports[0]);
    const bus = new RedisRealtimeBus({ url: REDIS_URL });
    await bus.start();
    try {
      await bus.publish(envelope(`fan3-${Date.now()}`));
      await waitFor(clientA, (m) => m.event === 'message.persisted');
    } finally {
      await bus.stop();
    }
    clientA.ws.close();
  });

  it('nó B morre: nós A e C continuam recebendo', async () => {
    const clientA = await authedSubscribed(ports[0]);
    const clientC = await authedSubscribed(ports[2]);
    nodes[1].stop(); // B morre

    const bus = new RedisRealtimeBus({ url: REDIS_URL });
    await bus.start();
    try {
      await bus.publish(envelope(`fandeath-${Date.now()}`));
      await waitFor(clientA, (m) => m.event === 'message.persisted');
      await waitFor(clientC, (m) => m.event === 'message.persisted');
    } finally {
      await bus.stop();
    }
    clientA.ws.close();
    clientC.ws.close();
  });

  it('duplicate pubsub (mesmo event) → dedup por instância (1 entrega)', async () => {
    const clientA = await authedSubscribed(ports[0]);
    const bus = new RedisRealtimeBus({ url: REDIS_URL });
    await bus.start();
    try {
      const id = `dupes-${Date.now()}`;
      await bus.publish(envelope(id));
      await bus.publish(envelope(id));
      await waitFor(clientA, (m) => m.event === 'message.persisted');
      await wait(500);
      const deliveries = clientA.messages.filter((m) => m.event === 'message.persisted');
      expect(deliveries).toHaveLength(1);
    } finally {
      await bus.stop();
    }
    clientA.ws.close();
  });
});
