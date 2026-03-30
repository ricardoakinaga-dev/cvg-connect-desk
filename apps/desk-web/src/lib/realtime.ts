interface RealtimeEvent {
  event_type: string;
  payload: Record<string, unknown>;
  occurred_at: string;
  correlation_id?: string;
}

type RealtimeHandler = (event: RealtimeEvent) => void;

class RealtimeClient {
  private ws: WebSocket | null = null;
  private url: string;
  private userId: string | null = null;
  private token: string | null = null;
  private handlers: Map<string, RealtimeHandler[]> = new Map();
  private reconnectInterval: NodeJS.Timeout | null = null;
  private subscribedChannels: string[] = [];

  constructor() {
    const base = import.meta.env.VITE_REALTIME_URL || 'ws://localhost:8080';
    this.url = base;
  }

  connect(userId: string, token: string) {
    this.userId = userId;
    this.token = token;

    this.attemptConnect();
  }

  private attemptConnect() {
    if (!this.userId || !this.token) {
      console.warn('[Realtime] Cannot connect: missing userId or token');
      return;
    }

    const wsUrl = `${this.url}?token=${this.token}`;
    console.log('[Realtime] Connecting to', wsUrl);

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('[Realtime] Connected');
        this.sendAuth();
        this.resubscribe();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as RealtimeEvent;
          this.handleEvent(data);
        } catch (err) {
          console.error('[Realtime] Failed to parse message:', err);
        }
      };

      this.ws.onclose = () => {
        console.log('[Realtime] Disconnected');
        this.ws = null;
        this.scheduleReconnect();
      };

      this.ws.onerror = (error) => {
        console.error('[Realtime] WebSocket error:', error);
      };
    } catch (error) {
      console.error('[Realtime] Failed to create WebSocket:', error);
      this.scheduleReconnect();
    }
  }

  private sendAuth() {
    if (this.ws?.readyState === WebSocket.OPEN && this.userId) {
      this.ws.send(
        JSON.stringify({
          type: 'auth',
          userId: this.userId,
        })
      );
    }
  }

  private scheduleReconnect() {
    if (this.reconnectInterval) clearInterval(this.reconnectInterval);
    this.reconnectInterval = setInterval(() => {
      console.log('[Realtime] Reconnecting...');
      this.attemptConnect();
    }, 5000);
  }

  private handleEvent(event: RealtimeEvent) {
    const handlers = this.handlers.get(event.event_type) || [];
    handlers.forEach((handler) => {
      try {
        handler(event);
      } catch (err) {
        console.error(`[Realtime] Handler error for ${event.event_type}:`, err);
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
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'subscribe', channel }));
      this.subscribedChannels.push(channel);
    }
  }

  unsubscribeFromChannel(channel: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'unsubscribe', channel }));
    }
    this.subscribedChannels = this.subscribedChannels.filter((c) => c !== channel);
  }

  private resubscribe() {
    for (const channel of this.subscribedChannels) {
      this.subscribeToChannel(channel);
    }
  }

  disconnect() {
    if (this.reconnectInterval) clearInterval(this.reconnectInterval);
    this.ws?.close();
    this.ws = null;
  }
}

export const realtimeClient = new RealtimeClient();
