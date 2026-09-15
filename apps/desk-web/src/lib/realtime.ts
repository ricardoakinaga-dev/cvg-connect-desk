export interface RealtimeEvent {
  event_type: string;
  payload: Record<string, unknown>;
  occurred_at: string;
  correlation_id?: string;
}

export type RealtimeHandler = (event: RealtimeEvent) => void;

/**
 * Estado de conexão observável do cliente (AAA-20). Aditivo ao protocolo
 * AAA-06: não altera resolução de URL, autenticação nem reconexão.
 * - `idle`: sem sessão de tempo real iniciada ou encerrada pelo app;
 * - `connecting`: socket/autenticação em andamento;
 * - `connected`: socket aberto E autenticado (auth.success);
 * - `reconnecting`: queda percebida; reconexão automática agendada/ativa;
 * - `offline`: parado por credencial/URL ausente, auth rejeitada ou queda final.
 */
export type RealtimeConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'offline';

export interface RealtimeConnectionState {
  status: RealtimeConnectionStatus;
  connected: boolean;
  attempt: number;
  reason?: string;
  changedAt: number;
}

export type RealtimeConnectionListener = (state: RealtimeConnectionState) => void;

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
  /**
   * Overrides de embed/teste; quando ausentes o construtor usa
   * `VITE_REALTIME_URL`, `window.location` e `import.meta.env.DEV`.
   */
  envUrl?: string;
  location?: RealtimeUrlLocation | null;
  dev?: boolean;
  /** Base do backoff de reconexão (alias legado: reconnectDelayMs). */
  reconnectDelayMs?: number;
  baseReconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  heartbeatIntervalMs?: number;
  staleTimeoutMs?: number;
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

/**
 * Alvo local de DEV. A condicional é substituída em build (`import.meta.env.DEV`
 * vira `false`), permitindo ao bundler eliminar o literal `ws://localhost:8080`
 * do artefato de produção (C08-AAA06, E5).
 */
const DEV_LOCAL_URL = import.meta.env.DEV ? 'ws://localhost:8080' : '';

export interface RealtimeUrlLocation {
  protocol: string;
  host: string;
}

export interface RealtimeUrlContext {
  baseUrl?: string;
  envUrl?: string;
  location?: RealtimeUrlLocation | null;
  dev?: boolean;
}

function resolveSameOrigin(path: string, location?: RealtimeUrlLocation | null): string | null {
  // `undefined` = usar o window atual; `null` explícito = sem origem → sem URL.
  const loc = location !== undefined
    ? location
    : (typeof window !== 'undefined' ? window.location : null);
  if (!loc?.host) {
    return null;
  }
  const scheme = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${loc.host}${path.startsWith('/') ? path : `/${path}`}`;
}

const EMPTY_URL_WARNING =
  '[Realtime] Cannot connect: realtime URL is not configured (set VITE_REALTIME_URL or provide a browser origin)';

/**
 * C08-AAA06 (DC08-1/2/9): precedência `baseUrl` → `VITE_REALTIME_URL`
 * (absoluto literal; path resolvido na mesma origem) → mesma origem `/ws/`.
 * Em DEV sem configuração, mantém o alvo local; em HTTPS, sempre `wss:`.
 * Sem configuração e sem `location` (produção fora do navegador) devolve `''`
 * como fallback explícito que não lança; `connect()` avisa e não conecta.
 */
export function resolveRealtimeUrl(context: RealtimeUrlContext = {}): string {
  if (context.baseUrl) return context.baseUrl;

  const configured = context.envUrl?.trim();
  if (configured) {
    if (!configured.startsWith('/')) return configured;
    return resolveSameOrigin(configured, context.location) ?? '';
  }

  if (context.dev) return DEV_LOCAL_URL;
  return resolveSameOrigin('/ws/', context.location) ?? '';
}

export class RealtimeClient {
  private ws: RealtimeSocketLike | null = null;
  private url: string;
  private authToken: string | null = null;
  private authenticated = false;
  private handlers: Map<string, RealtimeHandler[]> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private subscribedChannels: Set<string> = new Set();
  private shouldReconnect = true;
  private reconnectAttempt = 0;
  private lastMessageAt = 0;
  private readonly baseReconnectDelayMs: number;
  private readonly maxReconnectDelayMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly staleTimeoutMs: number;
  private readonly socketFactory: (url: string) => RealtimeSocketLike;
  private readonly logger: Pick<Console, 'log' | 'warn' | 'error' | 'debug'>;
  private connectionState: RealtimeConnectionState = {
    status: 'idle',
    connected: false,
    attempt: 0,
    changedAt: Date.now(),
  };
  private connectionListeners: Set<RealtimeConnectionListener> = new Set();

  constructor(options: RealtimeClientOptions = {}) {
    this.url = resolveRealtimeUrl({
      baseUrl: options.baseUrl,
      envUrl: options.envUrl ?? import.meta.env.VITE_REALTIME_URL,
      location: options.location !== undefined
        ? options.location
        : (typeof window !== 'undefined' ? window.location : null),
      dev: options.dev ?? import.meta.env.DEV,
    });
    this.baseReconnectDelayMs = options.baseReconnectDelayMs ?? options.reconnectDelayMs ?? 5000;
    this.maxReconnectDelayMs = options.maxReconnectDelayMs ?? 30000;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 25000;
    this.staleTimeoutMs = options.staleTimeoutMs ?? 60000;
    this.socketFactory = options.socketFactory ?? ((url: string) => new WebSocket(url) as unknown as RealtimeSocketLike);
    this.logger = options.logger ?? defaultLogger;
  }

  getConnectionState(): RealtimeConnectionState {
    return { ...this.connectionState };
  }

  /** Observa mudanças de estado; devolve a função de cancelamento. */
  subscribeConnectionState(listener: RealtimeConnectionListener): () => void {
    this.connectionListeners.add(listener);
    return () => {
      this.connectionListeners.delete(listener);
    };
  }

  private setConnectionState(status: RealtimeConnectionStatus, reason?: string) {
    const next: RealtimeConnectionState = {
      status,
      connected: status === 'connected',
      attempt: this.reconnectAttempt,
      reason,
      changedAt: Date.now(),
    };
    this.connectionState = next;
    for (const listener of this.connectionListeners) {
      try {
        listener({ ...next });
      } catch (error) {
        this.logger.error('[Realtime] Connection state listener failed:', error);
      }
    }
  }

  connect(token: string) {
    if (!token) {
      this.logger.warn('[Realtime] Cannot connect: missing auth token');
      this.setConnectionState('offline', 'missing-token');
      return;
    }

    if (!this.url) {
      this.logger.warn(EMPTY_URL_WARNING);
      this.setConnectionState('offline', 'missing-url');
      return;
    }

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.shouldReconnect = true;
    this.reconnectAttempt = 0;
    this.authToken = token;
    this.setConnectionState('connecting', 'connecting');
    this.attemptConnect();
  }

  private attemptConnect() {
    if (!this.authToken) {
      this.logger.warn('[Realtime] Cannot connect: missing auth token');
      return;
    }

    if (!this.url) {
      this.logger.warn(EMPTY_URL_WARNING);
      return;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    this.clearReconnectTimer();
    const wsUrl = this.url;
    this.logger.log('[Realtime] Connecting to', wsUrl);
    this.setConnectionState(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting', this.reconnectAttempt > 0 ? 'retrying' : 'connecting');

    try {
      this.authenticated = false;
      const socket = this.socketFactory(wsUrl);
      this.ws = socket;

      socket.onopen = () => {
        if (this.ws !== socket) return;
        this.logger.log('[Realtime] Connected');
        this.sendAuth(socket);
      };

      socket.onmessage = (event) => {
        if (this.ws !== socket) return;
        try {
          this.lastMessageAt = Date.now();
          const message = JSON.parse(event.data) as RealtimeWireMessage;
          this.handleServerMessage(message);
        } catch (error) {
          this.logger.error('[Realtime] Failed to parse message:', error);
        }
      };

      socket.onclose = (event?: CloseEvent) => {
        if (this.ws !== socket) return;
        this.logger.log('[Realtime] Disconnected');
        this.ws = null;
        this.authenticated = false;
        this.stopHeartbeat();

        if (this.shouldReconnect) {
          this.scheduleReconnect(event?.code === 4000 ? 'stale' : 'connection-lost');
        } else if (!this.authToken) {
          this.setConnectionState('idle', 'client-disconnect');
        } else {
          this.setConnectionState('offline', 'connection-lost');
        }
      };

      socket.onerror = (error) => {
        if (this.ws !== socket) return;
        this.logger.error('[Realtime] WebSocket error:', error);
      };
    } catch (error) {
      this.logger.error('[Realtime] Failed to create WebSocket:', error);
      this.scheduleReconnect('socket-error');
    }
  }

  private sendAuth(socket: RealtimeSocketLike | null = this.ws) {
    if (socket?.readyState === WebSocket.OPEN && this.authToken) {
      socket.send(JSON.stringify({ type: 'auth', token: this.authToken }));
    }
  }

  /** Backoff exponencial limitado + jitter (bounded, sem thundering herd). */
  private nextReconnectDelayMs(): number {
    const exponential = this.baseReconnectDelayMs * 2 ** this.reconnectAttempt;
    const capped = Math.min(exponential, this.maxReconnectDelayMs);
    const jitter = capped * 0.2 * (Math.random() * 2 - 1);
    return Math.max(0, Math.round(capped + jitter));
  }

  private scheduleReconnect(reason = 'retrying') {
    this.clearReconnectTimer();
    const delay = this.nextReconnectDelayMs();
    this.reconnectAttempt += 1;
    this.setConnectionState('reconnecting', reason);
    this.logger.log(`[Realtime] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.attemptConnect();
    }, delay);
  }

  private handleServerMessage(message: RealtimeWireMessage) {
    if (message.event === 'pong' || message.data?.type === 'pong') {
      return;
    }

    if (message.event === 'auth.success' || message.data?.type === 'auth.success') {
      this.authenticated = true;
      this.reconnectAttempt = 0;
      this.logger.log('[Realtime] Authenticated via message-based auth');
      this.setConnectionState('connected', 'authenticated');
      this.startHeartbeat();
      this.resubscribe();
      return;
    }

    if (message.event === 'auth.error' || message.data?.type === 'auth.error') {
      // Token rejeitado: reconectar não adianta (evita loop infinito).
      this.logger.warn('[Realtime] Authentication rejected by realtime service — not reconnecting');
      this.shouldReconnect = false;
      this.clearReconnectTimer();
      this.setConnectionState('offline', 'unauthorized');
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
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState !== WebSocket.OPEN || !this.authenticated) {
        return;
      }
      if (Date.now() - this.lastMessageAt > this.staleTimeoutMs) {
        this.logger.warn('[Realtime] Stale connection detected — reconnecting');
        try {
          this.ws.close(4000, 'stale connection');
        } catch {
          // Fechamento best-effort; onclose dispara o reconnect.
        }
        return;
      }
      try {
        this.ws.send(JSON.stringify({ type: 'ping', at: new Date().toISOString() }));
      } catch (error) {
        this.logger.error('[Realtime] Heartbeat ping failed:', error);
      }
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  disconnect() {
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    this.stopHeartbeat();
    this.authenticated = false;
    this.authToken = null;
    const hadSocket = !!this.ws;
    this.ws?.close();
    this.ws = null;
    if (!hadSocket) {
      this.setConnectionState('idle', 'client-disconnect');
    }
  }
}

export const realtimeClient = new RealtimeClient();
