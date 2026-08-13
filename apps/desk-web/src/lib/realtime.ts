export interface RealtimeEvent {
  event_type: string;
  payload: Record<string, unknown>;
  occurred_at: string;
  correlation_id?: string;
}

export type RealtimeHandler = (event: RealtimeEvent) => void;

interface RealtimeSocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent<string>) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
}

interface RealtimeClientOptions {
  baseUrl?: string;
  reconnectDelayMs?: number;
  socketFactory?: (url: string) => RealtimeSocketLike;
  logger?: Pick<Console, 'log' | 'warn' | 'error' | 'debug'>;
}

interface RealtimeWireMessage {
  event?: string;
  data?: {
    type?: string;
    payload?: Record<string, unknown>;
    occurredAt?: string;
    correlationId?: string;
  } & Record<string, unknown>;
}

const defaultLogger: Pick<Console, 'log' | 'warn' | 'error' | 'debug'> = console;

export class RealtimeClient {
  private ws: RealtimeSocketLike | null = null;
  private url: string;
  private authenticated = false;
  private handlers: Map<string, RealtimeHandler[]> = new Map();
  private reconnectInterval: ReturnType<typeof setInterval> | null = null;
  private subscribedChannels: Set<string> = new Set();
  private shouldReconnect = true;
  private readonly reconnectDelayMs: number;
  private readonly socketFactory: (url: string) => RealtimeSocketLike;
  private readonly logger: Pick<Console, 'log' | 'warn' | 'error' | 'debug'>;

  constructor(options: RealtimeClientOptions = {}) {
    this.url = options.baseUrl || import.meta.env.VITE_REALTIME_URL || 'ws://localhost:8080';
    this.reconnectDelayMs = options.reconnectDelayMs ?? 5000;
    this.socketFactory = options.socketFactory ?? ((url: string) => new WebSocket(url) as unknown as RealtimeSocketLike);
    this.logger = options.logger ?? defaultLogger;
  }

  connect() {
    this.shouldReconnect = true;
    this.attemptConnect();
  }

  private attemptConnect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    this.clearReconnectTimer();
    const wsUrl = this.url;
    this.logger.log('[Realtime] Connecting to', wsUrl);

    try {
      this.authenticated = false;
      this.ws = this.socketFactory(wsUrl);

      this.ws.onopen = () => {
        this.logger.log('[Realtime] Connected');
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as RealtimeWireMessage;
          this.handleServerMessage(message);
        } catch (error) {
          this.logger.error('[Realtime] Failed to parse message:', error);
        }
      };

      this.ws.onclose = () => {
        this.logger.log('[Realtime] Disconnected');
        this.ws = null;
        this.authenticated = false;

        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (error) => {
        this.logger.error('[Realtime] WebSocket error:', error);
      };
    } catch (error) {
      this.logger.error('[Realtime] Failed to create WebSocket:', error);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    this.clearReconnectTimer();
    this.reconnectInterval = setInterval(() => {
      this.logger.log('[Realtime] Reconnecting...');
      this.attemptConnect();
    }, this.reconnectDelayMs);
  }

  private handleServerMessage(message: RealtimeWireMessage) {
    if (message.event === 'auth.success' || message.data?.type === 'auth.success') {
      this.authenticated = true;
      this.logger.log('[Realtime] Authenticated via message-based auth');
      this.resubscribe();
      return;
    }

    if (message.event === 'auth.error' || message.data?.type === 'auth.error') {
      this.logger.warn('[Realtime] Authentication rejected by realtime service');
      return;
    }

    if (message.event === 'auth.required' || message.data?.type === 'auth.required') {
      this.logger.log('[Realtime] Realtime service requested message-based auth');
      return;
    }

    if (message.event && message.data) {
      this.handleEvent({ event: message.event, data: message.data });
    }
  }

  private handleEvent(rawEvent: { event: string; data: RealtimeWireMessage['data'] }) {
    const event: RealtimeEvent = {
      event_type: rawEvent.data?.type || rawEvent.event,
      payload: rawEvent.data?.payload || rawEvent.data || {},
      occurred_at: rawEvent.data?.occurredAt || new Date().toISOString(),
      correlation_id: rawEvent.data?.correlationId,
    };

    const handlers = this.handlers.get(event.event_type) || [];
    handlers.forEach((handler) => {
      try {
        handler(event);
      } catch (error) {
        this.logger.error(`[Realtime] Handler error for ${event.event_type}:`, error);
      }
    });
  }

  subscribe(eventType: string, handler: RealtimeHandler) {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }
    this.handlers.get(eventType)!.push(handler);
  }

  unsubscribe(eventType: string, handler: RealtimeHandler) {
    const handlers = this.handlers.get(eventType);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) handlers.splice(index, 1);
    }
  }

  subscribeToChannel(channel: string) {
    this.subscribedChannels.add(channel);

    if (this.ws?.readyState === WebSocket.OPEN && this.authenticated) {
      this.ws.send(JSON.stringify({ type: 'subscribe', channel }));
    }
  }

  unsubscribeFromChannel(channel: string) {
    this.subscribedChannels.delete(channel);

    if (this.ws?.readyState === WebSocket.OPEN && this.authenticated) {
      this.ws.send(JSON.stringify({ type: 'unsubscribe', channel }));
    }
  }

  private resubscribe() {
    if (this.ws?.readyState !== WebSocket.OPEN || !this.authenticated) {
      return;
    }

    for (const channel of this.subscribedChannels) {
      this.ws.send(JSON.stringify({ type: 'subscribe', channel }));
    }
  }

  private clearReconnectTimer() {
    if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval);
      this.reconnectInterval = null;
    }
  }

  disconnect() {
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    this.authenticated = false;
    this.ws?.close();
    this.ws = null;
  }
}

export const realtimeClient = new RealtimeClient();
