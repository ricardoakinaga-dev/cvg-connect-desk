import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { RealtimeClient } from '../../lib/realtime';
import { useRealtimeStatus } from '../useRealtimeStatus';

class MockWebSocket {
  static readonly OPEN = 1;
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(readonly url: string) {}

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.(new Event('open'));
  }

  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent<string>);
  }

  send() {
    // noop
  }

  close(code = 1000, reason = 'normal closure') {
    this.readyState = 3;
    this.onclose?.({ code, reason } as unknown as CloseEvent);
  }
}

function createClient() {
  const sockets: MockWebSocket[] = [];
  const client = new RealtimeClient({
    baseUrl: 'ws://realtime.test',
    reconnectDelayMs: 25,
    logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    socketFactory: (url) => {
      const socket = new MockWebSocket(url);
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
  });
  return { client, sockets };
}

describe('useRealtimeStatus', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('exposes idle, connecting, connected, reconnecting and idle again', () => {
    const { client, sockets } = createClient();
    const { result, unmount } = renderHook(() => useRealtimeStatus(client));

    expect(result.current.status).toBe('idle');

    act(() => {
      client.connect('jwt-123');
    });
    expect(result.current.status).toBe('connecting');

    act(() => {
      sockets[0].open();
      sockets[0].receive({ event: 'auth.success', data: { type: 'auth.success', payload: {} } });
    });
    expect(result.current.status).toBe('connected');
    expect(result.current.connected).toBe(true);

    act(() => {
      sockets[0].close(1006, 'network');
    });
    expect(result.current.status).toBe('reconnecting');

    act(() => {
      client.disconnect();
    });
    expect(result.current.status).toBe('idle');

    unmount();
  });

  it('stops updating after unmount', () => {
    const { client, sockets } = createClient();
    const { unmount } = renderHook(() => useRealtimeStatus(client));
    unmount();

    act(() => {
      client.connect('jwt-123');
      sockets[0].open();
      sockets[0].receive({ event: 'auth.success', data: { type: 'auth.success', payload: {} } });
      client.disconnect();
    });
    expect(client.getConnectionState().status).toBe('idle');
  });
});
