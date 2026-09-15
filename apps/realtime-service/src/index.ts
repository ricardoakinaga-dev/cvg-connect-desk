import 'dotenv/config';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { EventEnvelope, LeaseToken } from '@cvg/events';
import * as tracingNamespace from '@cvg/tracing';
import * as realtimeNamespace from '@cvg/realtime';
import type {
  AuthorizationDecision,
  DeliveryTarget,
  ParsedChannel,
  RealtimeAuthorizationPort,
  RealtimeMessage,
  RealtimePrincipal,
  RealtimeProjection,
} from '@cvg/realtime';
import * as eventsNamespace from '@cvg/events';
import type { RealtimeBus } from '@cvg/events';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createDatabaseAuthorizationPort } from './authorization';
import * as sharedNamespace from '@cvg/shared';

// Internal workspace packages are currently published as CommonJS. This
// service is ESM, so runtime exports can arrive through the default namespace.
function unwrapCommonJs<T>(namespace: T): T {
  return ((namespace as unknown as { default?: T }).default ?? namespace) as T;
}

const eventsModule = unwrapCommonJs(eventsNamespace);
const realtimeModule = unwrapCommonJs(realtimeNamespace);
const tracingModule = unwrapCommonJs(tracingNamespace);
const sharedModule = unwrapCommonJs(sharedNamespace);
const {
  ConsumerAwareOutboxReader,
  CONSUMER_IDS,
  RedisRealtimeBus,
  NoopRealtimeBus,
  REALTIME_BUS_CHANNEL,
} = eventsModule;
const { projectEvent, shouldProject, planDelivery, parseChannel } = realtimeModule;
const { initTracing, withSpan, correlationAttributes } = tracingModule;
const { metrics } = sharedModule;

/**
 * Deadline de revogação (C02 D-C02-7 / C00): interrupção de entrega em <= 5 s.
 *
 * O orçamento é fechado para QUALQUER combinação de env aceita:
 *   cacheAge + SESSION_FETCH + AUTHZ_FETCH <= AUTH_DEADLINE_MS  (caminho de entrega)
 *   revalidateInterval + SESSION_FETCH + AUTHZ_FETCH <= AUTH_DEADLINE_MS (timer/sweep)
 * onde SESSION_FETCH e AUTHZ_FETCH são sequenciais e limitados por
 * `authFetchTimeoutMs` (cada um). O timeout é clampeado a
 * `(AUTH_DEADLINE_MS - MIN_AUTHZ_CACHE_MS) / 2`; com ele fixado, cache e
 * intervalo são clampeados a `AUTH_DEADLINE_MS - 2 * authFetchTimeoutMs`.
 * Não existe piso de cache que estoure o orçamento.
 */
const AUTH_DEADLINE_MS = 5000;
const SEQUENTIAL_FETCHES_ON_DELIVERY_PATH = 2;
const MIN_REVALIDATE_MS = 250;
const MIN_AUTHZ_CACHE_MS = 250;
const DEFAULT_REVALIDATE_MS = 2000;
const DEFAULT_AUTHZ_CACHE_MS = 2000;
const DEFAULT_AUTH_TIMEOUT_MS = 1500;
const MIN_AUTH_TIMEOUT_MS = 50;
const MAX_AUTH_TIMEOUT_MS = Math.floor(
  (AUTH_DEADLINE_MS - MIN_AUTHZ_CACHE_MS) / SEQUENTIAL_FETCHES_ON_DELIVERY_PATH,
);
const DEFAULT_MAX_MESSAGE_BYTES = 16384;
const DEFAULT_MAX_SUBSCRIPTIONS = 64;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return max;
  return Math.min(Math.max(value, min), max);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

function safeEqualStrings(provided: string, expected: string): boolean {
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  if (providedBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(providedBytes, expectedBytes);
}

function isProduction(): boolean {
  return ['production', 'prod'].includes((process.env.NODE_ENV || process.env.DESK_ENV || '').toLowerCase());
}

type RevalidationStatus = 'valid' | 'invalid' | 'unavailable';

interface Client {
  id: string;
  ws: WebSocket;
  userId?: string;
  roles: string[];
  token?: string;
  subscriptions: Set<string>;
  channelKinds: Map<string, ParsedChannel>;
  authenticated: boolean;
  revalidateTimer?: NodeJS.Timeout;
  revalidationInFlight?: Promise<RevalidationStatus>;
  sessionValidUntil: number;
  authorizationCache: Map<string, { allowed: boolean; reason: string; checkedAt: number }>;
}

export interface RealtimeServerOptions {
  /** Porta de autorização por destinatário; default usa banco via @cvg/auth. */
  authorizationPort?: RealtimeAuthorizationPort;
  authorizationCacheMaxAgeMs?: number;
  authRevalidateIntervalMs?: number;
  authFetchTimeoutMs?: number;
  maxMessageBytes?: number;
  maxSubscriptions?: number;
  deskApiUrl?: string;
  clock?: () => number;
}

class RealtimeServer {
  private clients: Map<string, Client> = new Map();
  private wss: WebSocketServer | null = null;
  private httpServer: Server | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private startedAt: number | null = null;
  private lastPollStartedAt: number | null = null;
  private lastPollSucceededAt: number | null = null;
  private lastPollErrorCode: string | undefined;
  private pollConsecutiveFailures = 0;
  private pollStaleAfterMs = 5000;
  private pollMode: 'database' | 'http' = 'database';
  private deskApiUrl: string;
  private authTimeout: number = 5000;
  private pendingAuth: Map<string, NodeJS.Timeout> = new Map();
  private httpPollingConfigWarned = false;
  private revalidateIntervalMs: number;
  private readonly authorizationPort: RealtimeAuthorizationPort;
  private readonly authorizationCacheMaxAgeMs: number;
  private readonly authFetchTimeoutMs: number;
  private readonly maxMessageBytes: number;
  private readonly maxSubscriptions: number;
  private readonly clock: () => number;
  private readonly instanceId: string;
  private bus: RealtimeBus;
  private busUnsubscribe: (() => void) | null = null;
  private recentlyBroadcast = new Map<string, number>();
  private static readonly DEDUP_WINDOW_MS = 60_000;
  private static readonly DEDUP_MAX = 2000;

  constructor(private port: number = 8080, options: RealtimeServerOptions = {}) {
    this.deskApiUrl = options.deskApiUrl ?? (process.env.DESK_API_URL || 'http://localhost:3000');
    this.authorizationPort = options.authorizationPort ?? createDatabaseAuthorizationPort();
    this.authFetchTimeoutMs = clamp(
      options.authFetchTimeoutMs ?? (Number(process.env.REALTIME_AUTH_TIMEOUT_MS) || DEFAULT_AUTH_TIMEOUT_MS),
      MIN_AUTH_TIMEOUT_MS,
      MAX_AUTH_TIMEOUT_MS,
    );
    // Orçamento do deadline: no pior caso o caminho de entrega faz sessão +
    // authz sequenciais (2 fetches limitados por authFetchTimeoutMs), então
    // cache/intervalo ficam com AUTH_DEADLINE_MS - 2 * timeout.
    const deadlineBudgetMs = AUTH_DEADLINE_MS - SEQUENTIAL_FETCHES_ON_DELIVERY_PATH * this.authFetchTimeoutMs;
    this.authorizationCacheMaxAgeMs = clamp(
      options.authorizationCacheMaxAgeMs ?? (Number(process.env.REALTIME_AUTHZ_CACHE_MS) || DEFAULT_AUTHZ_CACHE_MS),
      MIN_AUTHZ_CACHE_MS,
      deadlineBudgetMs,
    );
    // C01 §10: o período de revalidação de conexão persistente deve ser <= 5 s.
    this.revalidateIntervalMs = clamp(
      options.authRevalidateIntervalMs ?? (Number(process.env.REALTIME_AUTH_REVALIDATE_MS) || DEFAULT_REVALIDATE_MS),
      MIN_REVALIDATE_MS,
      deadlineBudgetMs,
    );
    this.maxMessageBytes = options.maxMessageBytes ?? (Number(process.env.REALTIME_MAX_MESSAGE_BYTES) || DEFAULT_MAX_MESSAGE_BYTES);
    this.maxSubscriptions = options.maxSubscriptions ?? (Number(process.env.REALTIME_MAX_SUBSCRIPTIONS) || DEFAULT_MAX_SUBSCRIPTIONS);
    this.clock = options.clock ?? (() => Date.now());
    this.instanceId = `rt-${randomUUID().slice(0, 8)}`;
    const pollIntervalMs = Number(process.env.REALTIME_POLL_INTERVAL_MS) || 500;
    this.pollStaleAfterMs = Math.max(pollIntervalMs * 3, 5000);
    const redisUrl = process.env.REDIS_URL || '';
    this.bus = redisUrl ? new RedisRealtimeBus({ url: redisUrl, channel: REALTIME_BUS_CHANNEL, instanceId: this.instanceId }) : new NoopRealtimeBus();
  }

  start(): void {
    this.startedAt = Date.now();
    this.httpServer = createServer((request, response) => this.handleHealthRequest(request, response));
    this.httpServer.on('error', (error) => {
      console.error(JSON.stringify({
        msg: '[Realtime] HTTP server error',
        error: error.message,
        level: 'error',
      }));
    });
    this.httpServer.on('listening', () => {
      console.info(JSON.stringify({
        msg: '[Realtime] HTTP/WebSocket server listening',
        port: this.port,
        level: 'info',
      }));
    });

    this.wss = new WebSocketServer({ server: this.httpServer });

    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      const clientId = this.generateClientId();
      const token = this.extractTokenFromUrl(req.url || '');
      
      if (token) {
        this.handleConnectionWithAuth(clientId, ws, token);
      } else {
        this.handleConnectionWithoutAuth(clientId, ws);
      }
    });

    this.wss.on('error', (error) => {
      console.error(JSON.stringify({
        msg: '[Realtime] WebSocket server error',
        error: error.message,
        level: 'error',
      }));
    });

    this.httpServer.listen(this.port, '0.0.0.0');
    this.startEventPolling();
    this.startRealtimeBus().catch(() => {});
    console.info(JSON.stringify({
      msg: '[Realtime] Event polling started',
      level: 'info',
    }));
  }

  private handleHealthRequest(request: IncomingMessage, response: ServerResponse): void {
    const path = (request.url ?? '').split('?', 1)[0];
    if (request.method !== 'GET' || !['/health', '/readiness', '/metrics'].includes(path)) {
      response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'NOT_FOUND' }));
      return;
    }

    if (path === '/metrics') {
      const token = (process.env.METRICS_TOKEN ?? '').trim();
      if (token.length === 0 && isProduction()) {
        response.writeHead(503, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'METRICS_UNAVAILABLE' }));
        return;
      }
      if (token.length > 0 && !safeEqualStrings(request.headers.authorization ?? '', `Bearer ${token}`)) {
        response.writeHead(401, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'UNAUTHORIZED' }));
        return;
      }
      response.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' });
      response.end(metrics.render());
      return;
    }

    if (path === '/health') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({
        status: 'ok',
        service: 'realtime-service',
        uptime: this.startedAt === null ? process.uptime() : (Date.now() - this.startedAt) / 1000,
      }));
      return;
    }

    const snapshot = this.realtimeHealthSnapshot();
    response.writeHead(snapshot.ready ? 200 : 503, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(snapshot));
  }

  private realtimeHealthSnapshot(): {
    status: 'ok' | 'not_ready';
    ready: boolean;
    service: 'realtime-service';
    uptime: number;
    checks: {
      process: { status: 'ok' };
      websocket: { status: 'ok' | 'error' };
      poller: {
        status: 'ok' | 'error' | 'not_started';
        mode: 'database' | 'http';
        lastStartedAt: string | null;
        lastSucceededAt: string | null;
        ageMs: number | null;
        consecutiveFailures: number;
        lastErrorCode?: string;
      };
    };
  } {
    const now = Date.now();
    const ageMs = this.lastPollSucceededAt === null ? null : Math.max(0, now - this.lastPollSucceededAt);
    const pollReady = this.lastPollSucceededAt !== null
      && ageMs !== null
      && ageMs <= this.pollStaleAfterMs
      && this.pollConsecutiveFailures === 0;
    const ready = this.httpServer !== null && this.wss !== null && pollReady;

    return {
      status: ready ? 'ok' : 'not_ready',
      ready,
      service: 'realtime-service',
      uptime: this.startedAt === null ? process.uptime() : (now - this.startedAt) / 1000,
      checks: {
        process: { status: 'ok' },
        websocket: { status: this.wss === null ? 'error' : 'ok' },
        poller: {
          status: this.lastPollStartedAt === null ? 'not_started' : pollReady ? 'ok' : 'error',
          mode: this.pollMode,
          lastStartedAt: this.lastPollStartedAt === null ? null : new Date(this.lastPollStartedAt).toISOString(),
          lastSucceededAt: this.lastPollSucceededAt === null ? null : new Date(this.lastPollSucceededAt).toISOString(),
          ageMs,
          consecutiveFailures: this.pollConsecutiveFailures,
          ...(this.lastPollErrorCode ? { lastErrorCode: this.lastPollErrorCode } : {}),
        },
      },
    };
  }

  private markPollStarted(): void {
    this.lastPollStartedAt = Date.now();
  }

  private markPollSucceeded(): void {
    this.lastPollSucceededAt = Date.now();
    this.lastPollErrorCode = undefined;
    this.pollConsecutiveFailures = 0;
  }

  private markPollFailed(code: string): void {
    this.lastPollErrorCode = code;
    this.pollConsecutiveFailures += 1;
  }

  private extractTokenFromUrl(url: string): string | null {
    try {
      const urlObj = new URL(url, `http://localhost:${this.port}`);
      const token = urlObj.searchParams.get('token');
      // Compatibilidade legada: o token nunca é ecoado nem logado; o caminho
      // preferencial é o auth por mensagem.
      return token;
    } catch {
      return null;
    }
  }

  private generateClientId(): string {
    return `client_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  private newClient(clientId: string, ws: WebSocket, token?: string): Client {
    return {
      id: clientId,
      ws,
      userId: undefined,
      roles: [],
      token,
      subscriptions: new Set<string>(),
      channelKinds: new Map<string, ParsedChannel>(),
      authenticated: false,
      sessionValidUntil: 0,
      authorizationCache: new Map(),
    };
  }

  private attachMessageHandler(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    client.ws.on('message', (data: Buffer) => {
      if (data.length > this.maxMessageBytes) {
        console.warn(JSON.stringify({
          msg: '[Realtime] Message exceeds payload limit, closing connection',
          client_id: clientId,
          max_message_bytes: this.maxMessageBytes,
          received_bytes: data.length,
          level: 'warn',
        }));
        try {
          client.ws.close(1009, 'Message too large');
        } catch {
          // best-effort
        }
        this.clearClient(clientId);
        return;
      }
      this.handleMessage(clientId, data);
    });

    client.ws.on('close', () => {
      console.info(JSON.stringify({
        msg: '[Realtime] Connection closed',
        client_id: clientId,
        level: 'info',
      }));
      this.clearClient(clientId);
    });

    client.ws.on('error', (error) => {
      console.error(JSON.stringify({
        msg: '[Realtime] Client error',
        client_id: clientId,
        error: error.message,
        level: 'error',
      }));
      this.clearClient(clientId);
    });
  }

  private handleConnectionWithAuth(clientId: string, ws: WebSocket, token: string): void {
    console.warn(JSON.stringify({
      msg: '[Realtime] Legacy connection with token in URL',
      client_id: clientId,
      auth_method: 'url-token',
      level: 'warn',
    }));

    const client = this.newClient(clientId, ws, token);
    this.clients.set(clientId, client);
    this.attachMessageHandler(clientId);

    const timeout = setTimeout(() => {
      if (!client.authenticated) {
        console.warn(JSON.stringify({
          msg: '[Realtime] Auth timeout, closing connection',
          client_id: clientId,
          level: 'warn',
        }));
        ws.close(4001, 'Authentication timeout');
        this.clearClient(clientId);
      }
      this.pendingAuth.delete(clientId);
    }, this.authTimeout);

    this.pendingAuth.set(clientId, timeout);

    this.validateTokenAndAuthenticate(clientId, token);
  }

  private handleConnectionWithoutAuth(clientId: string, ws: WebSocket): void {
    console.info(JSON.stringify({
      msg: '[Realtime] New connection awaiting message-based auth',
      client_id: clientId,
      level: 'info',
    }));

    const client = this.newClient(clientId, ws);
    this.clients.set(clientId, client);
    this.attachMessageHandler(clientId);

    this.sendToClient(clientId, {
      event: 'connected',
      data: {
        type: 'connection.established' as any,
        aggregateType: 'Client',
        aggregateId: clientId,
        occurredAt: new Date().toISOString(),
        payload: { clientId, requiresAuth: true },
      },
    });

    this.sendToClient(clientId, {
      event: 'auth.required',
      data: {
        type: 'auth.required' as any,
        aggregateType: 'Client',
        aggregateId: clientId,
        occurredAt: new Date().toISOString(),
        payload: { error: 'Authentication required. Send {type: "auth", token: "<token>"} after connecting.' },
      },
    });
  }

  private async validateTokenAndAuthenticate(clientId: string, token: string): Promise<void> {
    try {
      const response = await fetch(`${this.deskApiUrl}/auth/me`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        signal: AbortSignal.timeout(this.authFetchTimeoutMs),
      });

      if (response.ok) {
        const data = await response.json() as { user: { id: string; email: string; name: string; roles: string[] } };
        this.completeAuthentication(clientId, data.user.id, data.user.roles ?? []);
      } else {
        this.rejectAuthentication(clientId, `Invalid token: ${response.status}`);
      }
    } catch (error) {
      console.error(JSON.stringify({
        msg: '[Realtime] Auth validation failed',
        client_id: clientId,
        error: error instanceof Error ? error.message : String(error),
        level: 'error',
      }));
      this.rejectAuthentication(clientId, 'Authentication service unavailable');
    }
  }

  private completeAuthentication(clientId: string, userId: string, roles: string[]): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    const timeout = this.pendingAuth.get(clientId);
    if (timeout) {
      clearTimeout(timeout);
      this.pendingAuth.delete(clientId);
    }

    client.userId = userId;
    client.roles = roles;
    client.authenticated = true;
    client.sessionValidUntil = this.clock() + this.revalidateIntervalMs;
    client.subscriptions.add('global');
    client.channelKinds.set('global', { channel: 'global', kind: 'global' });
    const userParsed = parseChannel(`user:${userId}`);
    if (userParsed) {
      client.subscriptions.add(userParsed.channel);
      client.channelKinds.set(userParsed.channel, userParsed);
    }

    console.info(JSON.stringify({
      msg: '[Realtime] Client authenticated',
      client_id: clientId,
      user_id: userId,
      level: 'info',
    }));

    // Revalidação contínua de sessão/membership enquanto a conexão durar.
    if (client.token) {
      this.startRevalidationTimer(clientId);
    }

    this.sendToClient(clientId, {
      event: 'connected',
      data: {
        type: 'connection.established' as any,
        aggregateType: 'Client',
        aggregateId: clientId,
        occurredAt: new Date().toISOString(),
        payload: { clientId, authenticated: true },
      },
    });

    this.sendToClient(clientId, {
      event: 'auth.success',
      data: {
        type: 'auth.success' as any,
        aggregateType: 'Client',
        aggregateId: clientId,
        occurredAt: new Date().toISOString(),
        payload: { userId },
      },
    });
  }

  private rejectAuthentication(clientId: string, reason: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    console.warn(JSON.stringify({
      msg: '[Realtime] Authentication rejected',
      client_id: clientId,
      reason,
      close_code: 4003,
      level: 'warn',
    }));

    this.sendToClient(clientId, {
      event: 'auth.error',
      data: {
        type: 'auth.error' as any,
        aggregateType: 'Client',
        aggregateId: clientId,
        occurredAt: new Date().toISOString(),
        payload: { error: reason },
      },
    });

    client.ws.close(4003, 'Authentication failed');
    this.clearClient(clientId);
  }

  private handleMessage(clientId: string, data: Buffer): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case 'ping':
          // Heartbeat app-level (Phase 10): responde pong para detecção de stale.
          this.sendToClient(clientId, {
            event: 'pong',
            data: {
              type: 'pong' as any,
              aggregateType: 'Client',
              aggregateId: clientId,
              occurredAt: new Date().toISOString(),
              payload: {},
            },
          });
          break;
        case 'subscribe':
          void this.handleSubscribe(clientId, message);
          break;
        case 'unsubscribe':
          this.handleUnsubscribe(clientId, message);
          break;
        case 'auth':
          // Message-based auth: client sends token via message instead of URL
          // Only processed if client is not already authenticated
          if (!client.authenticated && message.token) {
            console.info(JSON.stringify({
              msg: '[Realtime] Message-based auth',
              client_id: clientId,
              auth_method: 'message-token',
              level: 'info',
            }));
            client.token = message.token;
            this.validateTokenAndAuthenticate(clientId, message.token);
          } else if (client.authenticated) {
            this.sendToClient(clientId, {
              event: 'auth.error',
              data: {
                type: 'auth.error' as any,
                aggregateType: 'Client',
                aggregateId: clientId,
                occurredAt: new Date().toISOString(),
                payload: { error: 'Already authenticated' },
              },
            });
          }
          break;
        default:
          console.info(JSON.stringify({
            msg: '[Realtime] Unknown message type',
            client_id: clientId,
            message_type: message.type,
            level: 'info',
          }));
      }
    } catch (error) {
      console.error(JSON.stringify({
        msg: '[Realtime] Error handling message',
        client_id: clientId,
        error: error instanceof Error ? error.message : String(error),
        level: 'error',
      }));
    }
  }

  private startRevalidationTimer(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client || !client.token) return;

    // Clear any existing timer
    if (client.revalidateTimer) {
      clearInterval(client.revalidateTimer);
    }

    console.info(JSON.stringify({
      msg: '[Realtime] Starting token revalidation timer',
      client_id: clientId,
      interval_ms: this.revalidateIntervalMs,
      deadline_ms: AUTH_DEADLINE_MS,
      level: 'info',
    }));

    client.revalidateTimer = setInterval(async () => {
      const status = await this.revalidateToken(clientId);
      if (status === 'valid') {
        await this.sweepAuthorizations(clientId);
      }
    }, this.revalidateIntervalMs);
  }

  private async revalidateToken(clientId: string): Promise<RevalidationStatus> {
    const client = this.clients.get(clientId);
    if (!client || !client.token || !client.authenticated) {
      // Client no longer needs revalidation
      this.clearRevalidationTimer(clientId);
      return 'invalid';
    }

    if (client.revalidationInFlight) {
      return await client.revalidationInFlight;
    }

    const inFlight = (async (): Promise<RevalidationStatus> => {
      try {
        const response = await fetch(`${this.deskApiUrl}/auth/me`, {
          headers: {
            'Authorization': `Bearer ${client.token}`,
          },
          signal: AbortSignal.timeout(this.authFetchTimeoutMs),
        });

        if (response.status === 401 || response.status === 403) {
          console.warn(JSON.stringify({
            msg: '[Realtime] Token revalidation failed',
            client_id: clientId,
            http_status: response.status,
            level: 'warn',
          }));
          this.handleRevalidationFailure(clientId, `Token revoked: ${response.status}`);
          return 'invalid';
        }

        if (!response.ok) {
          console.warn(JSON.stringify({
            msg: '[Realtime] Token revalidation failed',
            client_id: clientId,
            http_status: response.status,
            level: 'warn',
          }));
          client.sessionValidUntil = 0;
          return 'unavailable';
        }

        const data = await response.json() as { user?: { id?: string; roles?: string[] } };
        if (data.user?.id && data.user.id !== client.userId) {
          this.handleRevalidationFailure(clientId, 'Principal changed');
          return 'invalid';
        }
        if (Array.isArray(data.user?.roles)) {
          client.roles = data.user.roles;
        }
        client.sessionValidUntil = this.clock() + this.revalidateIntervalMs;
        console.debug(JSON.stringify({
          msg: '[Realtime] Token revalidated',
          client_id: clientId,
          level: 'debug',
        }));
        return 'valid';
      } catch (error) {
        // Erro de rede não prova revogação: não encerra a conexão, mas o
        // caminho de entrega falha fechado enquanto a sessão não for provada.
        console.error(JSON.stringify({
          msg: '[Realtime] Token revalidation error',
          client_id: clientId,
          error: error instanceof Error ? error.message : String(error),
          level: 'error',
        }));
        client.sessionValidUntil = 0;
        return 'unavailable';
      }
    })();

    client.revalidationInFlight = inFlight;
    try {
      return await inFlight;
    } finally {
      if (client.revalidationInFlight === inFlight) {
        client.revalidationInFlight = undefined;
      }
    }
  }

  private handleRevalidationFailure(clientId: string, reason: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    console.warn(JSON.stringify({
      msg: '[Realtime] Revalidation failure — closing connection',
      client_id: clientId,
      reason,
      close_code: 4002,
      level: 'warn',
    }));

    this.sendToClient(clientId, {
      event: 'auth.revalidate.error',
      data: {
        type: 'auth.revalidate.error' as any,
        aggregateType: 'Client',
        aggregateId: clientId,
        occurredAt: new Date().toISOString(),
        payload: { error: 'Session invalid or expired' },
      },
    });

    client.ws.close(4002, 'Session expired');
    this.clearClient(clientId);
  }

  private clearRevalidationTimer(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client?.revalidateTimer) {
      clearInterval(client.revalidateTimer);
      client.revalidateTimer = undefined;
    }
  }

  private clearClient(clientId: string): void {
    this.clearRevalidationTimer(clientId);
    this.clients.delete(clientId);
  }

  private principalOf(client: Client): RealtimePrincipal {
    return { id: client.userId as string, roles: client.roles };
  }

  private targetFromChannel(parsed: ParsedChannel): DeliveryTarget | null {
    switch (parsed.kind) {
      case 'conversation':
        return { channel: parsed.channel, resource: { kind: 'conversation', conversationId: parsed.conversationId } };
      case 'sector':
        return { channel: parsed.channel, resource: { kind: 'sector', sectorId: parsed.sectorId } };
      case 'user':
        return { channel: parsed.channel, resource: { kind: 'user', userId: parsed.userId } };
      default:
        return null;
    }
  }

  private async authorizeSubscription(client: Client, parsed: ParsedChannel): Promise<AuthorizationDecision> {
    const decision = await withTimeout(
      this.authorizationPort.authorizeSubscription(this.principalOf(client), parsed),
      this.authFetchTimeoutMs,
      { allowed: false, reason: 'authorization-timeout' },
    );
    client.authorizationCache.set(parsed.channel, { ...decision, checkedAt: this.clock() });
    return decision;
  }

  private async authorizeDelivery(
    client: Client,
    target: DeliveryTarget,
    options: { force?: boolean } = {},
  ): Promise<AuthorizationDecision> {
    const cached = client.authorizationCache.get(target.channel);
    const now = this.clock();
    if (!options.force && cached && now - cached.checkedAt <= this.authorizationCacheMaxAgeMs) {
      return { allowed: cached.allowed, reason: cached.reason };
    }

    const decision = await withTimeout(
      this.authorizationPort.authorizeDelivery(this.principalOf(client), target),
      this.authFetchTimeoutMs,
      { allowed: false, reason: 'authorization-timeout' },
    );
    client.authorizationCache.set(target.channel, { ...decision, checkedAt: now });
    return decision;
  }

  private async ensureDeliveryAllowed(client: Client, target: DeliveryTarget): Promise<AuthorizationDecision> {
    if (this.clock() >= client.sessionValidUntil) {
      const status = await this.revalidateToken(client.id);
      if (status !== 'valid' || !this.clients.has(client.id)) {
        return { allowed: false, reason: `session-${status}` };
      }
    }

    return await this.authorizeDelivery(client, target);
  }

  private revokeChannel(client: Client, channel: string, reason: string): void {
    if (!client.subscriptions.delete(channel)) {
      return;
    }
    client.channelKinds.delete(channel);
    client.authorizationCache.delete(channel);

    console.warn(JSON.stringify({
      msg: '[Realtime] Channel revoked after revalidation',
      client_id: client.id,
      channel,
      reason,
      level: 'warn',
    }));

    this.sendToClient(client.id, {
      event: 'subscription.revoked',
      data: {
        type: 'subscription.revoked' as any,
        aggregateType: 'Client',
        aggregateId: client.id,
        occurredAt: new Date().toISOString(),
        payload: { channel, reason: 'not-authorized' },
      },
    });
  }

  private async sweepAuthorizations(clientId: string): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client || !client.authenticated) return;

    // Autorizações em paralelo: o sweep fica limitado a
    // revalidateInterval + 2 * authFetchTimeoutMs (<= 5 s) mesmo com muitas
    // inscrições, pois os fetches de authz concorrem em vez de somar.
    const targets: Array<{ channel: string; target: DeliveryTarget }> = [];
    for (const channel of [...client.subscriptions]) {
      const parsed = client.channelKinds.get(channel);
      if (!parsed) continue;
      const target = this.targetFromChannel(parsed);
      if (!target) continue;
      targets.push({ channel, target });
    }

    await Promise.all(
      targets.map(async ({ channel, target }) => {
        const decision = await this.authorizeDelivery(client, target, { force: true });
        if (!decision.allowed && this.clients.has(clientId) && !this.isTransientDenial(decision.reason)) {
          this.revokeChannel(client, channel, decision.reason);
        }
      }),
    );
  }

  private async handleSubscribe(clientId: string, message: { channel?: unknown }): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) return;

    if (!client.authenticated) {
      this.sendSubscribeError(clientId, message?.channel, 'Not authenticated');
      return;
    }

    const channel = typeof message?.channel === 'string' ? message.channel : '';
    const parsed = parseChannel(channel);
    if (!parsed) {
      this.sendSubscribeError(clientId, channel, 'Invalid channel');
      return;
    }

    if (client.subscriptions.has(parsed.channel)) {
      this.sendSubscribed(clientId, parsed.channel);
      return;
    }

    if (client.subscriptions.size >= this.maxSubscriptions) {
      this.sendSubscribeError(clientId, parsed.channel, 'Subscription limit reached');
      return;
    }

    const decision = await this.authorizeSubscription(client, parsed);
    if (!decision.allowed) {
      console.warn(JSON.stringify({
        msg: '[Realtime] Subscribe rejected by authorization',
        client_id: clientId,
        channel: parsed.channel,
        reason: decision.reason,
        level: 'warn',
      }));
      this.sendSubscribeError(clientId, parsed.channel, 'Channel not authorized');
      return;
    }

    const current = this.clients.get(clientId);
    if (!current || !current.authenticated) return;

    current.subscriptions.add(parsed.channel);
    current.channelKinds.set(parsed.channel, parsed);
    console.info(JSON.stringify({
      msg: '[Realtime] Client subscribed to channel',
      client_id: clientId,
      channel: parsed.channel,
      kind: parsed.kind,
      level: 'info',
    }));

    this.sendSubscribed(clientId, parsed.channel);
  }

  private sendSubscribed(clientId: string, channel: string): void {
    this.sendToClient(clientId, {
      event: 'subscribed',
      data: {
        type: 'subscription.success' as any,
        aggregateType: 'Client',
        aggregateId: clientId,
        occurredAt: new Date().toISOString(),
        payload: { channel },
      },
    });
  }

  private sendSubscribeError(clientId: string, channel: unknown, error: string): void {
    this.sendToClient(clientId, {
      event: 'error',
      data: {
        type: 'subscribe.error' as any,
        aggregateType: 'Client',
        aggregateId: clientId,
        occurredAt: new Date().toISOString(),
        payload: { error, channel: typeof channel === 'string' ? channel : undefined },
      },
    });
  }

  private handleUnsubscribe(clientId: string, message: { channel: string }): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    const channel = message.channel;
    client.subscriptions.delete(channel);
    client.channelKinds.delete(channel);
    client.authorizationCache.delete(channel);
    console.info(JSON.stringify({
      msg: '[Realtime] Client unsubscribed from channel',
      client_id: clientId,
      channel,
      level: 'info',
    }));
  }

  private sendToClient(clientId: string, message: RealtimeMessage): void {
    const client = this.clients.get(clientId);
    if (!client || client.ws.readyState !== WebSocket.OPEN) return;

    try {
      client.ws.send(JSON.stringify(message));
    } catch (error) {
      console.error(JSON.stringify({
        msg: '[Realtime] Error sending to client',
        client_id: clientId,
        error: error instanceof Error ? error.message : String(error),
        level: 'error',
      }));
    }
  }

  private broadcast(channel: string, message: RealtimeMessage): void {
    let recipientCount = 0;

    for (const client of this.clients.values()) {
      if (client.authenticated && client.subscriptions.has(channel)) {
        this.sendToClient(client.id, message);
        recipientCount++;
      }
    }

    if (recipientCount > 0) {
      console.info(JSON.stringify({
        msg: '[Realtime] Broadcast to channel',
        channel,
        recipient_count: recipientCount,
        level: 'info',
      }));
    }
  }

  private async deliverToTarget(target: DeliveryTarget, message: RealtimeMessage): Promise<void> {
    for (const client of [...this.clients.values()]) {
      if (!client.authenticated || !client.subscriptions.has(target.channel)) {
        continue;
      }

      const decision = await this.ensureDeliveryAllowed(client, target);
      if (!this.clients.has(client.id)) {
        continue;
      }
      if (!decision.allowed) {
        // Negação transitória (rede/timeout) não revoga o canal: a entrega é
        // fail-closed e o próximo ciclo reavalia; revogação só é definitiva.
        if (!this.isTransientDenial(decision.reason)) {
          this.revokeChannel(client, target.channel, decision.reason);
        } else {
          console.warn(JSON.stringify({
            msg: '[Realtime] Delivery skipped on transient authorization failure',
            client_id: client.id,
            channel: target.channel,
            reason: decision.reason,
            level: 'warn',
          }));
        }
        continue;
      }

      this.sendToClient(client.id, message);
    }
  }

  private isTransientDenial(reason: string): boolean {
    return reason === 'session-unavailable' || reason === 'authorization-timeout';
  }

  private startEventPolling(): void {
    const useDatabaseOutbox = process.env.USE_DATABASE_OUTBOX !== 'false';

    if (useDatabaseOutbox) {
      this.pollMode = 'database';
      this.startOutboxPolling();
    } else {
      this.pollMode = 'http';
      this.startHttpPolling();
    }
  }

  private startOutboxPolling(): void {
    const intervalMs = Number(process.env.REALTIME_POLL_INTERVAL_MS) || 500;
    const leaseSeconds = Number(process.env.REALTIME_LEASE_SECONDS) || 120;
    const reader = new ConsumerAwareOutboxReader({
      consumerId: CONSUMER_IDS.REALTIME,
      batchSize: 50,
      maxRetries: 3,
    });

    console.info(JSON.stringify({
      msg: '[Realtime] Using consumer-aware outbox for event polling',
      consumer: CONSUMER_IDS.REALTIME,
      owner: this.instanceId,
      lease_seconds: leaseSeconds,
      level: 'info',
    }));

    let pollInFlight = false;
    this.pollInterval = setInterval(async () => {
      if (pollInFlight) return;
      pollInFlight = true;
      this.markPollStarted();

      try {
        // Lease atômico por (event_id, realtime): duas réplicas nunca recebem
        // o mesmo evento ao mesmo tempo; ACK exige owner+generation (C03).
        const claimed = await reader.claim({ owner: this.instanceId, leaseSeconds, limit: 50 });

        if (claimed.length > 0) {
          console.info(JSON.stringify({
            msg: '[Realtime] Processing events from outbox',
            count: claimed.length,
            level: 'info',
          }));

          for (const { event, lease } of claimed) {
            const shouldProcess = await this.processEvent(event);

            if (!shouldProcess) {
              // Evento não é projetável para realtime; ack normal evita ruído de retry/dead-letter.
              console.debug(JSON.stringify({
                msg: '[Realtime] Skipping non-projectable event',
                event_type: event.event_type,
                event_id: event.event_id,
                level: 'debug',
              }));
            }

            await reader.acknowledge(lease.eventId, {
              owner: lease.owner,
              generation: lease.generation,
            });
          }
        }
        this.markPollSucceeded();
      } catch (error) {
        this.markPollFailed('OUTBOX_POLL_FAILED');
        console.error(JSON.stringify({
          msg: '[Realtime] Error polling outbox',
          error: error instanceof Error ? error.message : String(error),
          level: 'error',
        }));
      } finally {
        pollInFlight = false;
      }
    }, intervalMs);

    console.info(JSON.stringify({
      msg: '[Realtime] Outbox polling started',
      level: 'info',
    }));
  }

  private startHttpPolling(): void {
    const intervalMs = Number(process.env.REALTIME_POLL_INTERVAL_MS) || 500;
    let lastServerTime: string | null = null;
    let pollInFlight = false;

    this.pollInterval = setInterval(async () => {
      if (pollInFlight) return;
      pollInFlight = true;
      this.markPollStarted();

      try {
        const url = new URL(`${this.deskApiUrl}/events`);
        if (lastServerTime) {
          url.searchParams.set('since', lastServerTime);
        }
        url.searchParams.set('limit', '50');

        // Credencial de serviço do plano interno (C02 D-C02-8), separada de
        // sessões de usuário; nunca é colocada em URL.
        const internalEventsSecret = (
          process.env.REALTIME_INTERNAL_SECRET ||
          process.env.INTERNAL_EVENTS_SECRET ||
          process.env.EVENTS_API_KEY
        )?.trim();
        if (!internalEventsSecret) {
          if (!this.httpPollingConfigWarned) {
            console.error(JSON.stringify({
              msg: '[Realtime] INTERNAL_EVENTS_SECRET is not configured; HTTP event polling disabled',
              level: 'error',
            }));
            this.httpPollingConfigWarned = true;
          }
          this.markPollFailed('INTERNAL_EVENTS_SECRET_MISSING');
          return;
        }

        const response = await fetch(url.toString(), {
          headers: { 'x-internal-service-key': internalEventsSecret },
        });

        if (!response.ok) {
          console.warn(JSON.stringify({
            msg: '[Realtime] Failed to fetch events from API',
            api_url: url.toString(),
            http_status: response.status,
            level: 'warn',
          }));
          this.markPollFailed(`DESK_API_HTTP_${response.status}`);
          return;
        }

        const data = await response.json() as {
          events: EventEnvelope[];
          serverTime: string;
          ackEndpoint?: string;
          leases?: LeaseToken[];
        };

        if (data.events.length > 0) {
          console.info(JSON.stringify({
            msg: '[Realtime] Processing events from API',
            count: data.events.length,
            level: 'info',
          }));
          const leaseByEvent = new Map((data.leases ?? []).map((lease) => [lease.eventId, lease]));
          for (const event of data.events) {
            await this.processEvent(event);
            // ACK cercado: envia owner+generation quando o lease veio do claim HTTP.
            await this.acknowledgeHttpEvent(
              event.event_id,
              internalEventsSecret,
              data.ackEndpoint,
              leaseByEvent.get(event.event_id),
            );
          }

          // Só avança o cursor depois de confirmar todos os eventos. Se um
          // ACK falhar, o lease poderá ser recuperado no próximo ciclo.
          lastServerTime = data.serverTime;
        }
        this.markPollSucceeded();
      } catch (error) {
        this.markPollFailed('HTTP_POLL_FAILED');
        console.error(JSON.stringify({
          msg: '[Realtime] Error polling events from API',
          error: error instanceof Error ? error.message : String(error),
          level: 'error',
        }));
      } finally {
        pollInFlight = false;
      }
    }, intervalMs);

    console.info(JSON.stringify({
      msg: '[Realtime] HTTP polling started',
      api_url: this.deskApiUrl,
      level: 'info',
    }));
  }

  private async acknowledgeHttpEvent(
    eventId: string,
    secret: string,
    ackEndpoint?: string,
    lease?: LeaseToken,
  ): Promise<void> {
    const path = ackEndpoint?.replace(':eventId', encodeURIComponent(eventId))
      || `/events/${encodeURIComponent(eventId)}/ack`;
    const ackUrl = new URL(path, `${this.deskApiUrl.replace(/\/$/, '')}/`);
    const headers: Record<string, string> = { 'x-internal-service-key': secret };
    if (lease) {
      headers['content-type'] = 'application/json';
    }
    const response = await fetch(ackUrl.toString(), {
      method: 'POST',
      headers,
      body: lease ? JSON.stringify({ owner: lease.owner, generation: lease.generation }) : undefined,
    });

    if (!response.ok) {
      throw new Error(`Event ACK failed with HTTP ${response.status}`);
    }
  }

  /** Fast path (Final-8): hints via Redis; polling continua como path durável. */
  private async startRealtimeBus(): Promise<void> {
    try {
      await this.bus.start();
    } catch {
      return;
    }
    this.busUnsubscribe = this.bus.onEnvelope((envelope) => {
      void this.processEvent(envelope).catch(() => {
        // Broadcast nunca derruba o subscriber.
      });
    });
    console.info(JSON.stringify({
      msg: '[Realtime] Redis bus subscribed',
      instance_id: this.instanceId,
      channel: REALTIME_BUS_CHANNEL,
      level: 'info',
    }));
  }

  /** Dedup de broadcast: poll + bus podem entregar o mesmo evento. */
  private markBroadcasted(eventId: string): boolean {
    const now = Date.now();
    const seenAt = this.recentlyBroadcast.get(eventId);
    if (seenAt !== undefined && now - seenAt < RealtimeServer.DEDUP_WINDOW_MS) {
      return false;
    }
    this.recentlyBroadcast.set(eventId, now);
    if (this.recentlyBroadcast.size > RealtimeServer.DEDUP_MAX) {
      const oldest = [...this.recentlyBroadcast.entries()].sort((a, b) => a[1] - b[1])[0];
      if (oldest) this.recentlyBroadcast.delete(oldest[0]);
    }
    return true;
  }

  private async dispatchProjection(
    event: EventEnvelope,
    projection: RealtimeProjection,
    plan: ReturnType<typeof planDelivery>,
  ): Promise<void> {
    // Sinal global: nunca carrega payload de conteúdo (D-C02-5).
    if (plan.globalSignal) {
      const signal = plan.globalSignal;
      this.broadcast('global', { event: signal.type, data: signal });
      if (event.correlation_id) {
        this.broadcast(`correlation:${event.correlation_id}`, { event: signal.type, data: signal });
      }
    }

    // Conteúdo: somente canais canônicos autorizados por destinatário.
    const contentMessage: RealtimeMessage = { event: projection.type, data: projection };
    for (const target of plan.contentTargets) {
      await this.deliverToTarget(target, contentMessage);
    }
  }

  private async processEvent(event: EventEnvelope): Promise<boolean> {
    if (!shouldProject(event)) {
      return false;
    }

    const projection = projectEvent(event);
    if (!projection) {
      return false;
    }

    // Dedup (Final-8): poll + bus podem entregar o mesmo evento; só o
    // primeiro faz broadcast (o ack do outbox continua no path de poll).
    if (!this.markBroadcasted(event.event_id)) {
      return true;
    }

    const plan = planDelivery(event, projection);

    try {
      await withSpan(
        'realtime.publish',
        async () => {
          await this.dispatchProjection(event, projection, plan);
        },
        correlationAttributes({
          event_id: event.event_id,
          event_type: event.event_type,
          correlation_id: event.correlation_id,
          causation_id: event.causation_id,
        }),
      );
    } catch {
      // Broadcast nunca falha o polling por causa de tracing/entrega.
    }

    console.info(JSON.stringify({
      msg: '[Realtime] Projected event',
      event_type: projection.type,
      aggregate_id: projection.aggregateId,
      aggregate_type: projection.aggregateType,
      content_targets: plan.contentTargets.length,
      level: 'info',
    }));
    return true;
  }

  stop(): void {
    // Graceful shutdown (Final-8): parar polling, unsubscribe do bus,
    // fechar timers, drenar sockets.
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    if (this.busUnsubscribe) {
      try {
        this.busUnsubscribe();
      } catch {
        // best-effort
      }
      this.busUnsubscribe = null;
    }
    void this.bus.stop().catch(() => {});

    for (const timeout of this.pendingAuth.values()) {
      clearTimeout(timeout);
    }
    this.pendingAuth.clear();

    for (const client of this.clients.values()) {
      this.clearRevalidationTimer(client.id);
      client.ws.close();
    }
    this.clients.clear();

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    if (this.httpServer) {
      try {
        this.httpServer.close();
      } catch {
        // O servidor pode ainda não ter concluído o listen.
      }
      this.httpServer = null;
    }

    console.info(JSON.stringify({
      msg: '[Realtime] Server stopped',
      level: 'info',
    }));
  }
}

const PORT = Number(process.env.REALTIME_PORT) || 8080;
const server = new RealtimeServer(PORT);

const shouldAutoStart =
  process.env.REALTIME_AUTOSTART !== 'false' &&
  !(import.meta as ImportMeta & { vitest?: unknown }).vitest &&
  process.env.NODE_ENV !== 'test';

if (shouldAutoStart) {
  void initTracing().then(() => {
    server.start();
  });

  process.on('SIGTERM', () => {
    console.info(JSON.stringify({
      msg: '[Realtime] Received SIGTERM, shutting down',
      level: 'info',
    }));
    server.stop();
    process.exit(0);
  });

  process.on('SIGINT', () => {
    console.info(JSON.stringify({
      msg: '[Realtime] Received SIGINT, shutting down',
      level: 'info',
    }));
    server.stop();
    process.exit(0);
  });
}

export { RealtimeServer };
