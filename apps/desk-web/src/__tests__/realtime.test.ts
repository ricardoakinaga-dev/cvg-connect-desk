import { afterEach, describe, expect, it, vi } from 'vitest';
import { RealtimeClient, resolveRealtimeUrl } from '../lib/realtime.ts';

type SentMessage = { type: string; token?: string; channel?: string };

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly url: string;
  readyState = MockWebSocket.CONNECTING;
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
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code, reason } as CloseEvent);
  }
}

function parseSentMessages(socket: MockWebSocket): SentMessage[] {
  return socket.sent.map((message) => JSON.parse(message) as SentMessage);
}

function effectiveUrl(client: RealtimeClient): string {
  return (client as unknown as { url: string }).url;
}

function createLogger() {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function createHarness(reconnectDelayMs = 25) {
  const sockets: MockWebSocket[] = [];
  const logger = {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

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

describe('RealtimeClient', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('connects without token in the WebSocket URL and authenticates via message', () => {
    const { client, sockets } = createHarness();

    client.connect('jwt-123');

    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toBe('ws://realtime.test');
    expect(sockets[0].url).not.toContain('token=');

    sockets[0].open();

    expect(parseSentMessages(sockets[0])).toEqual([{ type: 'auth', token: 'jwt-123' }]);
  });

  it('keeps channel subscriptions queued until auth.success and then resubscribes', () => {
    const { client, sockets } = createHarness();

    client.connect('jwt-123');
    client.subscribeToChannel('conversation:conv_1');

    sockets[0].open();

    expect(parseSentMessages(sockets[0])).toEqual([{ type: 'auth', token: 'jwt-123' }]);

    sockets[0].receive({
      event: 'auth.success',
      data: {
        type: 'auth.success',
        payload: { userId: 'user_1' },
      },
    });

    expect(parseSentMessages(sockets[0])).toEqual([
      { type: 'auth', token: 'jwt-123' },
      { type: 'subscribe', channel: 'conversation:conv_1' },
    ]);

    client.subscribeToChannel('conversation:conv_2');

    expect(parseSentMessages(sockets[0])).toEqual([
      { type: 'auth', token: 'jwt-123' },
      { type: 'subscribe', channel: 'conversation:conv_1' },
      { type: 'subscribe', channel: 'conversation:conv_2' },
    ]);
  });

  it('blocks channel subscription while auth is absent or invalid', () => {
    const { client, sockets } = createHarness();

    client.connect('jwt-123');
    client.subscribeToChannel('conversation:conv_1');

    sockets[0].open();
    sockets[0].receive({
      event: 'auth.error',
      data: {
        type: 'auth.error',
        payload: { error: 'Invalid token' },
      },
    });

    expect(parseSentMessages(sockets[0])).toEqual([{ type: 'auth', token: 'jwt-123' }]);
  });

  it('reconnects, authenticates again, and resubscribes queued channels', () => {
    vi.useFakeTimers();
    const { client, sockets } = createHarness(50);

    client.connect('jwt-123');
    client.subscribeToChannel('conversation:conv_1');

    sockets[0].open();
    sockets[0].receive({
      event: 'auth.success',
      data: {
        type: 'auth.success',
        payload: { userId: 'user_1' },
      },
    });
    expect(parseSentMessages(sockets[0])).toContainEqual({ type: 'subscribe', channel: 'conversation:conv_1' });

    sockets[0].close();
    vi.advanceTimersByTime(100);

    expect(sockets).toHaveLength(2);

    sockets[1].open();
    expect(parseSentMessages(sockets[1])).toEqual([{ type: 'auth', token: 'jwt-123' }]);

    sockets[1].receive({
      event: 'auth.success',
      data: {
        type: 'auth.success',
        payload: { userId: 'user_1' },
      },
    });

    expect(parseSentMessages(sockets[1])).toEqual([
      { type: 'auth', token: 'jwt-123' },
      { type: 'subscribe', channel: 'conversation:conv_1' },
    ]);
  });

  it('routes realtime payloads to subscribed handlers after auth', () => {    const { client, sockets } = createHarness();
    const handler = vi.fn();

    client.subscribe('message.persisted', handler);
    client.connect('jwt-123');
    sockets[0].open();
    sockets[0].receive({
      event: 'auth.success',
      data: {
        type: 'auth.success',
        payload: { userId: 'user_1' },
      },
    });

    sockets[0].receive({
      event: 'message.persisted',
      data: {
        type: 'message.persisted',
        occurredAt: '2026-04-10T12:00:00Z',
        correlationId: 'corr_123',
        payload: {
          conversationId: 'conv_1',
          content: 'Mensagem nova',
        },
      },
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({
      event_type: 'message.persisted',
      payload: {
        conversationId: 'conv_1',
        content: 'Mensagem nova',
      },
      occurred_at: '2026-04-10T12:00:00Z',
      correlation_id: 'corr_123',
    });
  });

  it('backs off exponentially with cap across attempts', () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const sockets: MockWebSocket[] = [];
    const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const client = new RealtimeClient({
      baseUrl: 'ws://realtime.test',
      baseReconnectDelayMs: 100,
      maxReconnectDelayMs: 250,
      logger,
      socketFactory: (url) => {
        const socket = new MockWebSocket(url);
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
    });

    client.connect('jwt-123');
    // attempt 1: ~100ms (jitter ±20% → 80..120)
    sockets[0].close();
    vi.advanceTimersByTime(80);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(40);
    expect(sockets).toHaveLength(2);

    // attempt 2: ~200ms (160..240)
    sockets[1].close();
    vi.advanceTimersByTime(160);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(80);
    expect(sockets).toHaveLength(3);

    // attempt 3+: capped at ~250ms (200..300)
    sockets[2].close();
    vi.advanceTimersByTime(200);
    expect(sockets).toHaveLength(3);
    vi.advanceTimersByTime(100);
    expect(sockets).toHaveLength(4);
  });

  it('does not reconnect after auth rejection', () => {
    vi.useFakeTimers();
    const { client, sockets } = createHarness(25);

    client.connect('jwt-123');
    sockets[0].open();
    sockets[0].receive({ event: 'auth.error', data: { type: 'auth.error', payload: {} } });

    vi.advanceTimersByTime(10_000);
    expect(sockets).toHaveLength(1);
  });

  it('sends heartbeat pings and ignores pongs', () => {
    vi.useFakeTimers();
    const sockets: MockWebSocket[] = [];
    const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const client = new RealtimeClient({
      baseUrl: 'ws://realtime.test',
      heartbeatIntervalMs: 1000,
      staleTimeoutMs: 60_000,
      logger,
      socketFactory: (url) => {
        const socket = new MockWebSocket(url);
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
    });

    client.connect('jwt-123');
    sockets[0].open();
    sockets[0].receive({ event: 'auth.success', data: { type: 'auth.success', payload: {} } });

    vi.advanceTimersByTime(1000);
    const sent = parseSentMessages(sockets[0]);
    expect(sent).toContainEqual({ type: 'ping', at: expect.any(String) });

    sockets[0].receive({ event: 'pong', data: { type: 'pong' } });
    expect(sockets[0].readyState).toBe(MockWebSocket.OPEN);
  });

  it('reconnects on stale connection without recent messages', () => {
    vi.useFakeTimers();
    const sockets: MockWebSocket[] = [];
    const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const client = new RealtimeClient({
      baseUrl: 'ws://realtime.test',
      baseReconnectDelayMs: 50,
      heartbeatIntervalMs: 1000,
      staleTimeoutMs: 3000,
      logger,
      socketFactory: (url) => {
        const socket = new MockWebSocket(url);
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
    });

    client.connect('jwt-123');
    sockets[0].open();
    sockets[0].receive({ event: 'auth.success', data: { type: 'auth.success', payload: {} } });

    // 4 heartbeats sem resposta contam como staleness apenas pelo relógio:
    // lastMessageAt foi atualizado no auth.success; avançar além do stale.
    vi.advanceTimersByTime(4000);
    // Stale fecha o socket e agenda reconnect (backoff 50ms).
    vi.advanceTimersByTime(100);
    expect(sockets).toHaveLength(2);
  });
});

describe('resolveRealtimeUrl (C08-AAA06)', () => {
  it('U1: origem remota HTTP usa a mesma origem e /ws/', () => {
    expect(resolveRealtimeUrl({ location: { protocol: 'http:', host: 'desk.example:8080' }, dev: false }))
      .toBe('ws://desk.example:8080/ws/');
  });

  it('U2: HTTPS resolve para wss (sem mixed content)', () => {
    expect(resolveRealtimeUrl({ location: { protocol: 'https:', host: 'desk.example' }, dev: false }))
      .toBe('wss://desk.example/ws/');
  });

  it('U3: override absoluto é preservado literalmente', () => {
    expect(resolveRealtimeUrl({ envUrl: 'wss://rt.example/ws', location: { protocol: 'https:', host: 'desk.example' }, dev: false }))
      .toBe('wss://rt.example/ws');
  });

  it('U4: override em path resolve na mesma origem com protocolo da página', () => {
    expect(resolveRealtimeUrl({ envUrl: '/custom/ws', location: { protocol: 'https:', host: 'desk.example' }, dev: false }))
      .toBe('wss://desk.example/custom/ws');
  });

  it('U5: baseUrl vence o env', () => {
    expect(resolveRealtimeUrl({ baseUrl: 'ws://realtime.test', envUrl: 'wss://rt.example', dev: false }))
      .toBe('ws://realtime.test');
  });

  it('U6: DEV sem env mantém localhost:8080 (DC08-9)', () => {
    expect(resolveRealtimeUrl({ location: { protocol: 'https:', host: 'desk.example' }, dev: true }))
      .toBe('ws://localhost:8080');
  });

  it('U7: produção sem location e sem env devolve vazio (fallback explícito, sem lançar)', () => {
    expect(resolveRealtimeUrl({ location: null, dev: false })).toBe('');
    expect(resolveRealtimeUrl({ envUrl: '/custom/ws', location: null, dev: false })).toBe('');
    expect(resolveRealtimeUrl({ envUrl: '   ', location: null, dev: false })).toBe('');
  });

  it('U8: token nunca aparece na URL nem no log; auth segue por mensagem', () => {
    const socket = new MockWebSocket('wss://desk.example/ws/');
    const logs: unknown[][] = [];
    const logger = {
      log: (...args: unknown[]) => { logs.push(args); },
      warn: (...args: unknown[]) => { logs.push(args); },
      error: (...args: unknown[]) => { logs.push(args); },
      debug: (...args: unknown[]) => { logs.push(args); },
    };
    const client = new RealtimeClient({
      baseUrl: 'wss://desk.example/ws/',
      logger,
      socketFactory: () => socket as unknown as WebSocket,
    });

    client.connect('segredo-token-123');
    socket.open();

    expect(effectiveUrl(client)).not.toContain('segredo-token-123');
    expect(JSON.stringify(logs)).not.toContain('segredo-token-123');
    expect(JSON.parse(socket.sent[0])).toEqual({ type: 'auth', token: 'segredo-token-123' });
  });
});

describe('RealtimeClient URL resolution (C08-AAA06)', () => {
  it('C1: envUrl do construtor é usado sem depender do ambiente de teste', () => {
    const client = new RealtimeClient({
      envUrl: 'wss://rt.example/ws',
      location: null,
      dev: false,
      logger: createLogger(),
      socketFactory: (url) => new MockWebSocket(url) as unknown as WebSocket,
    });

    expect(effectiveUrl(client)).toBe('wss://rt.example/ws');
  });

  it('C2: construtor usa window.location para resolver /ws/ na mesma origem', () => {
    const client = new RealtimeClient({
      envUrl: '',
      dev: false,
      logger: createLogger(),
      socketFactory: (url) => new MockWebSocket(url) as unknown as WebSocket,
    });

    const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    expect(effectiveUrl(client)).toBe(`${scheme}//${window.location.host}/ws/`);
  });

  it('C3: baseUrl do construtor vence envUrl', () => {
    const client = new RealtimeClient({
      baseUrl: 'ws://realtime.test',
      envUrl: 'wss://rt.example/ws',
      location: null,
      dev: false,
      logger: createLogger(),
      socketFactory: (url) => new MockWebSocket(url) as unknown as WebSocket,
    });

    expect(effectiveUrl(client)).toBe('ws://realtime.test');
  });

  it('C4: fallback vazio avisa e não tenta conectar nem agenda reconexão', () => {
    vi.useFakeTimers();
    const logger = createLogger();
    const socketFactory = vi.fn((url: string) => new MockWebSocket(url) as unknown as WebSocket);
    const client = new RealtimeClient({
      envUrl: '',
      location: null,
      dev: false,
      reconnectDelayMs: 25,
      logger,
      socketFactory,
    });

    expect(effectiveUrl(client)).toBe('');

    client.connect('jwt-123');

    expect(socketFactory).not.toHaveBeenCalled();
    const warned = logger.warn.mock.calls.flat().join(' ');
    expect(warned).toContain('Cannot connect');
    expect(warned).toContain('realtime URL');

    vi.advanceTimersByTime(60_000);
    expect(socketFactory).not.toHaveBeenCalled();
  });
});
