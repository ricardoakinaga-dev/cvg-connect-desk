import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { EventEnvelope } from '@cvg/events';
import { RealtimeServer } from '../index.ts';

const originalEnv = {
  deskApiUrl: process.env.DESK_API_URL,
  outboxMode: process.env.USE_DATABASE_OUTBOX,
  interval: process.env.REALTIME_POLL_INTERVAL_MS,
  internalSecret: process.env.INTERNAL_EVENTS_SECRET,
};

function restoreEnv(): void {
  if (originalEnv.deskApiUrl === undefined) delete process.env.DESK_API_URL;
  else process.env.DESK_API_URL = originalEnv.deskApiUrl;
  if (originalEnv.outboxMode === undefined) delete process.env.USE_DATABASE_OUTBOX;
  else process.env.USE_DATABASE_OUTBOX = originalEnv.outboxMode;
  if (originalEnv.interval === undefined) delete process.env.REALTIME_POLL_INTERVAL_MS;
  else process.env.REALTIME_POLL_INTERVAL_MS = originalEnv.interval;
  if (originalEnv.internalSecret === undefined) delete process.env.INTERNAL_EVENTS_SECRET;
  else process.env.INTERNAL_EVENTS_SECRET = originalEnv.internalSecret;
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('Timed out waiting for HTTP polling ACK');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('Realtime HTTP event polling', () => {
  afterEach(restoreEnv);

  it('authenticates and ACKs leased events before advancing the cursor', async () => {
    const requests: Array<{ method: string; url: string; key: string | undefined }> = [];
    const event: EventEnvelope = {
      event_id: 'evt-http-ack',
      event_type: 'message.persisted',
      aggregate_type: 'Message',
      aggregate_id: 'message-1',
      occurred_at: new Date().toISOString(),
      payload: { conversationId: 'conversation-1', messageId: 'message-1', content: 'hello' },
      version: 1,
    };
    let servedEvent = false;

    const api = createServer((request: IncomingMessage, response: ServerResponse) => {
      const rawKey = request.headers['x-internal-service-key'];
      requests.push({
        method: request.method || 'UNKNOWN',
        url: request.url || '',
        key: Array.isArray(rawKey) ? rawKey[0] : rawKey,
      });

      if (request.method === 'GET' && request.url?.startsWith('/events')) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          events: servedEvent ? [] : [event],
          ackEndpoint: '/events/:eventId/ack',
          serverTime: '2026-09-12T15:00:00.000Z',
        }));
        servedEvent = true;
        return;
      }

      if (request.method === 'POST' && request.url === '/events/evt-http-ack/ack') {
        setTimeout(() => {
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ acknowledged: true, eventId: event.event_id }));
        }, 80);
        return;
      }

      response.writeHead(404);
      response.end();
    });

    await new Promise<void>((resolve, reject) => {
      api.once('error', reject);
      api.listen(0, '127.0.0.1', () => resolve());
    });
    const address = api.address() as AddressInfo;

    process.env.DESK_API_URL = `http://127.0.0.1:${address.port}`;
    process.env.USE_DATABASE_OUTBOX = 'false';
    process.env.REALTIME_POLL_INTERVAL_MS = '20';
    process.env.INTERNAL_EVENTS_SECRET = 'http-poll-secret';

    const realtime = new RealtimeServer(0);
    realtime.start();

    try {
      await waitFor(() => requests.some((request) => request.method === 'POST'));

      const getRequests = requests.filter((request) => request.method === 'GET');
      const ackRequests = requests.filter((request) => request.method === 'POST');
      expect(getRequests[0]?.key).toBe('http-poll-secret');
      expect(ackRequests).toHaveLength(1);
      expect(ackRequests[0]?.key).toBe('http-poll-secret');
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(requests.filter((request) => request.method === 'GET')).toHaveLength(1);
      await waitFor(() => requests.some((request) => request.method === 'GET' && request.url.includes('since=')));
    } finally {
      realtime.stop();
      await new Promise<void>((resolve, reject) => api.close((error) => error ? reject(error) : resolve()));
    }
  });
});
