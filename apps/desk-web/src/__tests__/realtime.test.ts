import { afterEach, describe, expect, it, vi } from 'vitest';
import { RealtimeClient } from '../lib/realtime.ts';

type SentMessage = { type: string; channel?: string };

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
  });

  it('connects without token in the WebSocket URL and waits for cookie auth', () => {
    const { client, sockets } = createHarness();

    client.connect();

    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toBe('ws://realtime.test');
    expect(sockets[0].url).not.toContain('token=');

    sockets[0].open();

    expect(parseSentMessages(sockets[0])).toEqual([]);
  });

  it('keeps channel subscriptions queued until auth.success and then resubscribes', () => {
    const { client, sockets } = createHarness();

    client.connect();
    client.subscribeToChannel('conversation:conv_1');

    sockets[0].open();

    expect(parseSentMessages(sockets[0])).toEqual([]);

    sockets[0].receive({
      event: 'auth.success',
      data: {
        type: 'auth.success',
        payload: { userId: 'user_1' },
      },
    });

    expect(parseSentMessages(sockets[0])).toEqual([
      { type: 'subscribe', channel: 'conversation:conv_1' },
    ]);

    client.subscribeToChannel('conversation:conv_2');

    expect(parseSentMessages(sockets[0])).toEqual([
      { type: 'subscribe', channel: 'conversation:conv_1' },
      { type: 'subscribe', channel: 'conversation:conv_2' },
    ]);
  });

  it('blocks channel subscription while auth is absent or invalid', () => {
    const { client, sockets } = createHarness();

    client.connect();
    client.subscribeToChannel('conversation:conv_1');

    sockets[0].open();
    sockets[0].receive({
      event: 'auth.error',
      data: {
        type: 'auth.error',
        payload: { error: 'Invalid session' },
      },
    });

    expect(parseSentMessages(sockets[0])).toEqual([]);
  });

  it('reconnects, authenticates again, and resubscribes queued channels', () => {
    vi.useFakeTimers();
    const { client, sockets } = createHarness(50);

    client.connect();
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
    vi.advanceTimersByTime(50);

    expect(sockets).toHaveLength(2);

    sockets[1].open();
    expect(parseSentMessages(sockets[1])).toEqual([]);

    sockets[1].receive({
      event: 'auth.success',
      data: {
        type: 'auth.success',
        payload: { userId: 'user_1' },
      },
    });

    expect(parseSentMessages(sockets[1])).toEqual([
      { type: 'subscribe', channel: 'conversation:conv_1' },
    ]);
  });

  it('routes realtime payloads to subscribed handlers after auth', () => {
    const { client, sockets } = createHarness();
    const handler = vi.fn();

    client.subscribe('message.persisted', handler);
    client.connect();
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

  it('handles malformed wire messages and guards channel operations before authentication', () => {
    const { client, sockets, logger } = createHarness();
    const handler = vi.fn(() => {
      throw new Error('handler failed');
    });

    client.subscribe('message.persisted', handler);
    client.unsubscribe('missing.event', handler);
    client.unsubscribe('message.persisted', vi.fn());
    client.connect();
    sockets[0].open();

    client.subscribeToChannel('conversation:queued');
    sockets[0].receive({ event: 'auth.required' });
    sockets[0].receive({ event: 'message.persisted', data: {} });
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      event_type: 'message.persisted',
      payload: {},
    }));
    expect(logger.error).toHaveBeenCalledWith(
      '[Realtime] Handler error for message.persisted:',
      expect.any(Error),
    );

    sockets[0].receive({ event: 'auth.success' });
    expect(parseSentMessages(sockets[0])).toContainEqual({
      type: 'subscribe',
      channel: 'conversation:queued',
    });
    client.unsubscribeFromChannel('conversation:queued');
    expect(parseSentMessages(sockets[0])).toContainEqual({
      type: 'unsubscribe',
      channel: 'conversation:queued',
    });

    sockets[0].onmessage?.({ data: 'not-json' } as MessageEvent<string>);
    expect(logger.error).toHaveBeenCalledWith(
      '[Realtime] Failed to parse message:',
      expect.any(Error),
    );
    client.disconnect();
  });
});
