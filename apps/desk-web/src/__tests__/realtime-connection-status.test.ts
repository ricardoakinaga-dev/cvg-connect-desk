import { afterEach, describe, expect, it, vi } from 'vitest';
import { RealtimeClient, type RealtimeConnectionState } from '../lib/realtime.ts';

type SentMessage = { type: string; token?: string; channel?: string };

class MockWebSocket {
  static readonly OPEN = 1;
  readonly url: string;
  readyState = 0;
  sent: string[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.(new Event('open'));
  }

  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent<string>);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(code = 1000, reason = 'normal closure') {
    this.readyState = 3;
    this.onclose?.({ code, reason } as unknown as CloseEvent);
  }
}

function createLogger() {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function createHarness(reconnectDelayMs = 25) {
  const sockets: MockWebSocket[] = [];
  const logger = createLogger();
  const client = new RealtimeClient({
    baseUrl: 'ws://realtime.test',
    reconnectDelayMs,
    logger,
    socketFactory: (url) => {
      const socket = new MockWebSocket(url);
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
  });
  return { client, sockets, logger };
}

const authSuccess = { event: 'auth.success', data: { type: 'auth.success', payload: {} } };
const authError = { event: 'auth.error', data: { type: 'auth.error', payload: { error: 'invalid' } } };

describe('RealtimeClient connection state (AAA-20, additive)', () => {
  const clients: RealtimeClient[] = [];

  afterEach(() => {
    clients.forEach((client) => client.disconnect());
    clients.length = 0;
    vi.useRealTimers();
  });

  function harness(reconnectDelayMs = 25) {
    const result = createHarness(reconnectDelayMs);
    clients.push(result.client);
    return result;
  }

  it('starts idle and reports connecting while the socket/authentication is pending', () => {
    const { client, sockets } = harness();
    expect(client.getConnectionState()).toMatchObject({ status: 'idle', connected: false, attempt: 0 });

    client.connect('jwt-123');

    expect(sockets).toHaveLength(1);
    expect(client.getConnectionState().status).toBe('connecting');
  });

  it('reports connected only after auth.success', () => {
    const { client, sockets } = harness();
    client.connect('jwt-123');
    sockets[0].open();
    expect(client.getConnectionState().status).toBe('connecting');

    sockets[0].receive(authSuccess);

    const state = client.getConnectionState();
    expect(state.status).toBe('connected');
    expect(state.connected).toBe(true);
    expect(state.reason).toBe('authenticated');
  });

  it('reports reconnecting (degraded) after an unexpected close and tells attempted retries', () => {
    const { client, sockets } = harness();
    client.connect('jwt-123');
    sockets[0].open();
    sockets[0].receive(authSuccess);

    sockets[0].close(1006, 'network');

    const state = client.getConnectionState();
    expect(state.status).toBe('reconnecting');
    expect(state.connected).toBe(false);
    expect(state.attempt).toBeGreaterThan(0);
  });

  it('returns to idle after intentional disconnect', () => {
    const { client, sockets } = harness();
    client.connect('jwt-123');
    sockets[0].open();
    sockets[0].receive(authSuccess);

    client.disconnect();

    expect(client.getConnectionState()).toMatchObject({ status: 'idle', connected: false, reason: 'client-disconnect' });
  });

  it('reports offline/unauthorized on auth.error without creating another socket', () => {
    const { client, sockets } = harness();
    client.connect('jwt-123');
    sockets[0].open();
    sockets[0].receive(authError);

    expect(client.getConnectionState()).toMatchObject({ status: 'offline', connected: false, reason: 'unauthorized' });
    expect(sockets).toHaveLength(1);
  });

  it('reports offline with reason when token or URL is missing', () => {
    const { client } = harness();
    client.connect('');
    expect(client.getConnectionState()).toMatchObject({ status: 'offline', reason: 'missing-token' });

    const noUrl = new RealtimeClient({
      envUrl: '',
      location: null,
      dev: false,
      logger: createLogger(),
      socketFactory: () => {
        throw new Error('must not connect without URL');
      },
    });
    clients.push(noUrl);
    noUrl.connect('jwt-123');
    expect(noUrl.getConnectionState()).toMatchObject({ status: 'offline', reason: 'missing-url' });
  });

  it('notifies subscribers on each transition and stops after unsubscribe', () => {
    const { client, sockets } = harness();
    const listener = vi.fn();
    const unsubscribe = client.subscribeConnectionState(listener);

    client.connect('jwt-123');
    sockets[0].open();
    sockets[0].receive(authSuccess);

    const statuses = listener.mock.calls.map((call) => (call[0] as RealtimeConnectionState).status);
    expect(statuses).toContain('connecting');
    expect(statuses).toContain('connected');

    const beforeUnsubscribe = listener.mock.calls.length;
    unsubscribe();
    client.disconnect();
    expect(listener.mock.calls.length).toBe(beforeUnsubscribe);
  });

  it('reports stale reconnection reason when heartbeat closes an idle socket', () => {
    vi.useFakeTimers();
    const { client, sockets } = harness(25);
    client.connect('jwt-123');
    sockets[0].open();
    sockets[0].receive(authSuccess);

    vi.advanceTimersByTime(75_000);

    expect(sockets[0].sent.some((raw) => (JSON.parse(raw) as SentMessage).type === 'ping')).toBe(true);
    expect(client.getConnectionState()).toMatchObject({ status: 'reconnecting', reason: 'stale' });
  });
});
