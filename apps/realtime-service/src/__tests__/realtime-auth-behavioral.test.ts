import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { AddressInfo } from 'net';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { RealtimeServer } from '../index.ts';

interface TestClient {
  ws: WebSocket;
  messages: any[];
  closeCode?: number;
  closeReason?: string;
}

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
  const tokenState = new Map<string, { userId: string; status: number }>();
  const tokenCalls = new Map<string, number>();

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url === '/auth/me') {
      const authorization = req.headers.authorization || '';
      const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
      const callCount = (tokenCalls.get(token) || 0) + 1;
      tokenCalls.set(token, callCount);

      const state = tokenState.get(token);
      if (state) {
        res.writeHead(state.status, { 'content-type': 'application/json' });
        res.end(
          state.status === 200
            ? JSON.stringify({
                user: {
                  id: state.userId,
                  email: `${state.userId}@example.com`,
                  name: 'Realtime User',
                  roles: ['agent'],
                },
              })
            : JSON.stringify({ error: 'UNAUTHORIZED' }),
        );
        return;
      }

      if (token === 'revoking-token') {
        const status = callCount === 1 ? 200 : 401;
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(
          status === 200
            ? JSON.stringify({
                user: {
                  id: 'user-revalidate',
                  email: 'user-revalidate@example.com',
                  name: 'Realtime User',
                  roles: ['agent'],
                },
              })
            : JSON.stringify({ error: 'UNAUTHORIZED' }),
        );
        return;
      }

      if (token === 'legacy-token' || token === 'message-token') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            user: {
              id: token === 'legacy-token' ? 'user-legacy' : 'user-message',
              email: `${token}@example.com`,
              name: 'Realtime User',
              roles: ['agent'],
            },
          }),
        );
        return;
      }

      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'UNAUTHORIZED' }));
      return;
    }

    if (req.url?.startsWith('/events')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ events: [], serverTime: new Date().toISOString() }));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'NOT_FOUND' }));
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve(address.port);
    });
  });

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    server,
    setTokenStatus(token: string, userId: string, status: number) {
      tokenState.set(token, { userId, status });
    },
  };
}

async function connectClient(url: string): Promise<TestClient> {
  return await new Promise<TestClient>((resolve, reject) => {
    const messages: any[] = [];
    const client: TestClient = {
      ws: new WebSocket(url),
      messages,
    };

    client.ws.on('message', (data: Buffer) => {
      try {
        messages.push(JSON.parse(data.toString()));
      } catch {
        messages.push(data.toString());
      }
    });

    client.ws.on('close', (code, reason) => {
      client.closeCode = code;
      client.closeReason = reason.toString();
    });

    client.ws.on('open', () => resolve(client));
    client.ws.on('error', reject);
  });
}

async function waitForMessage(client: TestClient, predicate: (message: any) => boolean, timeoutMs = 15000) {
  const startedAt = Date.now();

  while (!client.messages.some(predicate)) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for websocket message. Received: ${JSON.stringify(client.messages)}`);
    }
    await wait(25);
  }
}

async function closeClient(client: TestClient) {
  if (client.ws.readyState === WebSocket.CLOSED) {
    return;
  }

  await new Promise<void>((resolve) => {
    client.ws.once('close', () => resolve());
    client.ws.close();
  });
}

async function waitForCloseCode(client: TestClient, code: number, timeoutMs = 15000) {
  const startedAt = Date.now();

  while (client.closeCode !== code) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for close code ${code}. Got: ${client.closeCode ?? 'none'}`);
    }
    await wait(25);
  }
}

describe('RealtimeServer behavioral auth flow', () => {
  let authServer: Awaited<ReturnType<typeof startAuthServer>>;
  let realtimeServer: RealtimeServer | undefined;
  let realtimePort: number;
  let realtimeBaseUrl: string;

  beforeEach(async () => {
    process.env.DESK_API_URL = '';
    process.env.USE_DATABASE_OUTBOX = 'false';
    process.env.REALTIME_POLL_INTERVAL_MS = '60000';
    process.env.REALTIME_AUTH_REVALIDATE_MS = '50';
    process.env.NODE_ENV = 'test';

    authServer = await startAuthServer();
    process.env.DESK_API_URL = authServer.baseUrl;

    realtimePort = await getFreePort();
    realtimeBaseUrl = `ws://127.0.0.1:${realtimePort}`;
    realtimeServer = new RealtimeServer(realtimePort);
    realtimeServer.start();

    await wait(100);
  });

  afterEach(async () => {
    realtimeServer?.stop();
    if (authServer) {
      await new Promise<void>((resolve) => authServer.server.close(() => resolve()));
    }
    delete process.env.DESK_API_URL;
    delete process.env.USE_DATABASE_OUTBOX;
    delete process.env.REALTIME_POLL_INTERVAL_MS;
    delete process.env.REALTIME_AUTH_REVALIDATE_MS;
  });

  it('blocks subscribe before auth and emits subscribe.error', async () => {
    authServer.setTokenStatus('message-token', 'user-message', 200);
    const client = await connectClient(realtimeBaseUrl);

    await waitForMessage(client, (message) => message.event === 'auth.required');

    client.ws.send(JSON.stringify({ type: 'subscribe', channel: 'global' }));

    await waitForMessage(client, (message) => message.event === 'error' && message.data?.type === 'subscribe.error');

    expect(client.messages.some((message) => message.event === 'subscribed')).toBe(false);

    await closeClient(client);
  });

  it('accepts message-based auth and allows subscribe after auth.success', async () => {    authServer.setTokenStatus('message-token', 'user-message', 200);
    const client = await connectClient(realtimeBaseUrl);

    await waitForMessage(client, (message) => message.event === 'auth.required');

    client.ws.send(JSON.stringify({ type: 'auth', token: 'message-token' }));

    await waitForMessage(client, (message) => message.event === 'auth.success');

    client.ws.send(JSON.stringify({ type: 'subscribe', channel: 'global' }));

    await waitForMessage(client, (message) => message.event === 'subscribed');

    expect(client.messages.find((message) => message.event === 'auth.success')?.data?.payload?.userId).toBe('user-message');

    await closeClient(client);
  });

  it('answers app-level ping with pong (heartbeat)', async () => {
    authServer.setTokenStatus('message-token', 'user-message', 200);
    const client = await connectClient(realtimeBaseUrl);

    await waitForMessage(client, (message) => message.event === 'auth.required');

    client.ws.send(JSON.stringify({ type: 'auth', token: 'message-token' }));

    await waitForMessage(client, (message) => message.event === 'auth.success');

    client.ws.send(JSON.stringify({ type: 'ping', at: new Date().toISOString() }));

    await waitForMessage(client, (message) => message.event === 'pong');

    await closeClient(client);
  });

  it('revalidates the stored token and closes the connection on failure', async () => {
    const client = await connectClient(realtimeBaseUrl);

    await waitForMessage(client, (message) => message.event === 'auth.required');

    client.ws.send(JSON.stringify({ type: 'auth', token: 'revoking-token' }));

    await waitForMessage(client, (message) => message.event === 'auth.success');

    await waitForMessage(client, (message) => message.event === 'auth.revalidate.error');
    await waitForCloseCode(client, 4002);

    expect(client.closeCode).toBe(4002);
    expect(client.messages.some((message) => message.event === 'auth.revalidate.error')).toBe(true);

    await closeClient(client);
  });

  it('keeps legacy URL-token authentication working for compatibility', async () => {
    authServer.setTokenStatus('legacy-token', 'user-legacy', 200);
    const client = await connectClient(`${realtimeBaseUrl}?token=legacy-token`);

    await waitForMessage(client, (message) => message.event === 'auth.success');

    client.ws.send(JSON.stringify({ type: 'subscribe', channel: 'global' }));

    await waitForMessage(client, (message) => message.event === 'subscribed');

    expect(client.messages.find((message) => message.event === 'auth.success')?.data?.payload?.userId).toBe('user-legacy');

    await closeClient(client);
  });
});
