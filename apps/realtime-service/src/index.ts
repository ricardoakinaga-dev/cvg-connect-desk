import 'dotenv/config';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { EventEnvelope } from '@cvg/events';
import type { RealtimeMessage } from '@cvg/realtime';
import * as realtimeModule from '@cvg/realtime';
import * as eventModule from '@cvg/events';
import * as sharedModule from '@cvg/shared';
import * as authModule from '@cvg/auth';

type WorkspaceModule<T> = T & { default?: T };

const unwrapWorkspaceModule = <T>(moduleValue: WorkspaceModule<T>): T => moduleValue.default ?? moduleValue;
const realtimeExports = unwrapWorkspaceModule(
  realtimeModule as WorkspaceModule<typeof import('@cvg/realtime')>,
);
const eventExports = unwrapWorkspaceModule(
  eventModule as WorkspaceModule<typeof import('@cvg/events')>,
);
const sharedExports = unwrapWorkspaceModule(
  sharedModule as WorkspaceModule<typeof import('@cvg/shared')>,
);
const authExports = unwrapWorkspaceModule(
  authModule as WorkspaceModule<typeof import('@cvg/auth')>,
);

const { projectEvent, shouldProject } = realtimeExports;
const { ConsumerAwareOutboxReader, CONSUMER_IDS } = eventExports;
const { createLogger } = sharedExports;
const { SESSION_COOKIE_NAME, parseCookieHeader } = authExports;
const logger = createLogger({ service: 'realtime' });

interface Client {
  id: string;
  ws: WebSocket;
  userId?: string;
  sessionCookie?: string;
  subscriptions: Set<string>;
  authenticated: boolean;
  revalidateTimer?: NodeJS.Timeout;
}

class RealtimeServer {
  private clients: Map<string, Client> = new Map();
  private wss: WebSocketServer | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private deskApiUrl: string;
  private authTimeout: number = 5000;
  private pendingAuth: Map<string, NodeJS.Timeout> = new Map();
  private revalidateIntervalMs: number;

  constructor(private port: number = 8080) {
    this.deskApiUrl = process.env.DESK_API_URL || 'http://localhost:3000';
    this.revalidateIntervalMs = Number(process.env.REALTIME_AUTH_REVALIDATE_MS) || 300000;
  }

  start(): void {
    this.wss = new WebSocketServer({ port: this.port });

    this.wss.on('listening', () => {
      logger.info('[Realtime] WebSocket server listening', { port: this.port });
    });

    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      const clientId = this.generateClientId();
      const legacyToken = this.extractTokenFromUrl(req.url || '');

      if (legacyToken) {
        logger.warn('[Realtime] Rejecting legacy URL-token connection', {
          client_id: clientId,
          auth_method: 'url-token',
        });
        ws.close(4003, 'URL token authentication is disabled');
        return;
      }

      this.handleConnectionWithCookie(clientId, ws, req.headers.cookie);
    });

    this.wss.on('error', (error) => {
      logger.error('[Realtime] WebSocket server error', { error: error.message });
    });

    this.startEventPolling();
    logger.info('[Realtime] Event polling started');
  }

  private extractTokenFromUrl(url: string): string | null {
    try {
      const urlObj = new URL(url, `http://localhost:${this.port}`);
      const token = urlObj.searchParams.get('token');
      return token;
    } catch {
      return null;
    }
  }

  private generateClientId(): string {
    return `client_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  private handleConnectionWithCookie(clientId: string, ws: WebSocket, cookieHeader: string | undefined): void {
    logger.info('[Realtime] New cookie-authenticated connection', { client_id: clientId });
    const cookies = parseCookieHeader(cookieHeader);
    const sessionCookie = cookies[SESSION_COOKIE_NAME];

    const client: Client = {
      id: clientId,
      ws,
      userId: undefined,
      sessionCookie,
      subscriptions: new Set(['global']),
      authenticated: false,
    };

    this.clients.set(clientId, client);

    ws.on('message', (data: Buffer) => {
      this.handleMessage(clientId, data);
    });

    ws.on('close', () => {
      logger.info('[Realtime] Connection closed', { client_id: clientId });
      this.clearClient(clientId);
    });

    ws.on('error', (error) => {
      logger.error('[Realtime] Client error', { client_id: clientId, error: error.message });
      this.clients.delete(clientId);
    });

    const timeout = setTimeout(() => {
      if (!client.authenticated) {
        logger.warn('[Realtime] Auth timeout, closing connection', { client_id: clientId });
        ws.close(4001, 'Authentication timeout');
        this.clearClient(clientId);
      }
      this.pendingAuth.delete(clientId);
    }, this.authTimeout);

    this.pendingAuth.set(clientId, timeout);
    this.validateCookieAndAuthenticate(clientId);
  }

  private async validateCookieAndAuthenticate(clientId: string): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client?.sessionCookie) {
      this.rejectAuthentication(clientId, 'Missing session cookie');
      return;
    }

    try {
      const response = await fetch(`${this.deskApiUrl}/auth/me`, {
        headers: {
          Cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(client.sessionCookie)}`,
        },
      });

      if (response.ok) {
        const data = await response.json() as { user: { id: string; email: string; name: string; roles: string[] } };
        this.completeAuthentication(clientId, data.user.id);
      } else {
        this.rejectAuthentication(clientId, `Invalid token: ${response.status}`);
      }
    } catch (error) {
      logger.error('[Realtime] Auth validation failed', {
        client_id: clientId,
        error: error instanceof Error ? error.message : String(error),
      });
      this.rejectAuthentication(clientId, 'Authentication service unavailable');
    }
  }

  private completeAuthentication(clientId: string, userId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    const timeout = this.pendingAuth.get(clientId);
    if (timeout) {
      clearTimeout(timeout);
      this.pendingAuth.delete(clientId);
    }

    client.userId = userId;
    client.authenticated = true;
    client.subscriptions.add(`user:${userId}`);

    logger.info('[Realtime] Client authenticated', { client_id: clientId, user_id: userId });

    this.startRevalidationTimer(clientId);

    this.sendToClient(clientId, {
      event: 'connected',
      data: {
        type: 'connection.established',
        aggregateType: 'Client',
        aggregateId: clientId,
        occurredAt: new Date().toISOString(),
        payload: { clientId, authenticated: true },
      },
    });

    this.sendToClient(clientId, {
      event: 'auth.success',
      data: {
        type: 'auth.success',
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

    logger.warn('[Realtime] Authentication rejected', { client_id: clientId, reason, close_code: 4003 });

    this.sendToClient(clientId, {
      event: 'auth.error',
      data: {
        type: 'auth.error',
        aggregateType: 'Client',
        aggregateId: clientId,
        occurredAt: new Date().toISOString(),
        payload: { error: reason },
      },
    });

    client.ws.close(4003, 'Authentication failed');
    this.clearClient(clientId);
  }

  private setupClientHandlers(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    client.ws.on('message', (data: Buffer) => {
      this.handleMessage(clientId, data);
    });

    client.ws.on('close', () => {
      logger.info('[Realtime] Connection closed', { client_id: clientId });
      this.clearClient(clientId);
    });

    client.ws.on('error', (error) => {
      logger.error('[Realtime] Client error', { client_id: clientId, error: error.message });
      this.clients.delete(clientId);
    });

    this.sendToClient(clientId, {
      event: 'connected',
      data: {
        type: 'connection.established',
        aggregateType: 'Client',
        aggregateId: clientId,
        occurredAt: new Date().toISOString(),
        payload: { clientId, authenticated: true },
      },
    });
  }

  private handleMessage(clientId: string, data: Buffer): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case 'subscribe':
          this.handleSubscribe(clientId, message);
          break;
        case 'unsubscribe':
          this.handleUnsubscribe(clientId, message);
          break;
        case 'auth':
          this.sendToClient(clientId, {
            event: 'auth.error',
            data: {
              type: 'auth.error',
              aggregateType: 'Client',
              aggregateId: clientId,
              occurredAt: new Date().toISOString(),
              payload: { error: 'Message token authentication is disabled' },
            },
          });
          break;
        default:
          logger.info('[Realtime] Unknown message type', { client_id: clientId, message_type: message.type });
      }
    } catch (error) {
      logger.error('[Realtime] Error handling message', {
        client_id: clientId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private startRevalidationTimer(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client || !client.sessionCookie) return;

    if (client.revalidateTimer) {
      clearInterval(client.revalidateTimer);
    }

    logger.info('[Realtime] Starting token revalidation timer', {
      client_id: clientId,
      interval_ms: this.revalidateIntervalMs,
    });

    client.revalidateTimer = setInterval(async () => {
      await this.revalidateToken(clientId);
    }, this.revalidateIntervalMs);
  }

  private async revalidateToken(clientId: string): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client || !client.sessionCookie || !client.authenticated) {
      this.clearRevalidationTimer(clientId);
      return;
    }

    try {
      const response = await fetch(`${this.deskApiUrl}/auth/me`, {
        headers: {
          Cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(client.sessionCookie)}`,
        },
      });

      if (!response.ok) {
        logger.warn('[Realtime] Token revalidation failed', { client_id: clientId, http_status: response.status });
        this.handleRevalidationFailure(clientId, `Token revoked: ${response.status}`);
      }
    } catch (error) {
      logger.error('[Realtime] Token revalidation error', {
        client_id: clientId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private handleRevalidationFailure(clientId: string, reason: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    logger.warn('[Realtime] Revalidation failure — closing connection', {
      client_id: clientId,
      reason,
      close_code: 4002,
    });

    this.sendToClient(clientId, {
      event: 'auth.revalidate.error',
      data: {
        type: 'auth.revalidate.error',
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

  private handleSubscribe(clientId: string, message: { channel: string }): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    if (!client.authenticated) {
      this.sendToClient(clientId, {
        event: 'error',
        data: {
          type: 'subscribe.error',
          aggregateType: 'Client',
          aggregateId: clientId,
          occurredAt: new Date().toISOString(),
          payload: { error: 'Not authenticated' },
        },
      });
      return;
    }

    const channel = message.channel;
    if (!channel) {
      this.sendToClient(clientId, {
        event: 'error',
        data: {
          type: 'subscribe.error',
          aggregateType: 'Client',
          aggregateId: clientId,
          occurredAt: new Date().toISOString(),
          payload: { error: 'Missing channel' },
        },
      });
      return;
    }

    client.subscriptions.add(channel);
    logger.info('[Realtime] Client subscribed to channel', { client_id: clientId, channel });

    this.sendToClient(clientId, {
      event: 'subscribed',
      data: {
        type: 'subscription.success',
        aggregateType: 'Client',
        aggregateId: clientId,
        occurredAt: new Date().toISOString(),
        payload: { channel },
      },
    });
  }

  private handleUnsubscribe(clientId: string, message: { channel: string }): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    const channel = message.channel;
    client.subscriptions.delete(channel);
    logger.info('[Realtime] Client unsubscribed from channel', { client_id: clientId, channel });
  }

  private sendToClient(clientId: string, message: RealtimeMessage): void {
    const client = this.clients.get(clientId);
    if (!client || client.ws.readyState !== WebSocket.OPEN) return;

    try {
      client.ws.send(JSON.stringify(message));
    } catch (error) {
      logger.error('[Realtime] Error sending to client', {
        client_id: clientId,
        error: error instanceof Error ? error.message : String(error),
      });
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
      logger.debug('[Realtime] Broadcast to channel', { channel, recipient_count: recipientCount });
    }
  }

  private startEventPolling(): void {
    const useDatabaseOutbox = process.env.USE_DATABASE_OUTBOX !== 'false';

    if (useDatabaseOutbox) {
      this.startOutboxPolling();
    } else {
      this.startHttpPolling();
    }
  }

  private startOutboxPolling(): void {
    const intervalMs = Number(process.env.REALTIME_POLL_INTERVAL_MS) || 500;
    const reader = new ConsumerAwareOutboxReader({
      consumerId: CONSUMER_IDS.REALTIME,
      batchSize: 50,
      maxRetries: 3,
    });

    logger.info('[Realtime] Using consumer-aware outbox for event polling', { consumer: CONSUMER_IDS.REALTIME });

    this.pollInterval = setInterval(async () => {
      try {
        const pendingEvents = await reader.fetchPendingEvents();

        if (pendingEvents.length > 0) {
          logger.debug('[Realtime] Processing events from outbox', { count: pendingEvents.length });

          for (const outboxEvent of pendingEvents) {
            const event = reader.toEventEnvelope(outboxEvent);
            const shouldProcess = this.processEvent(event);

            if (shouldProcess) {
              await reader.acknowledge(outboxEvent.eventId);
            } else {
              await reader.acknowledge(outboxEvent.eventId);
            }
          }
        }
      } catch (error) {
        logger.error('[Realtime] Error polling outbox', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, intervalMs);

    logger.info('[Realtime] Outbox polling started');
  }

  private startHttpPolling(): void {
    const intervalMs = Number(process.env.REALTIME_POLL_INTERVAL_MS) || 500;
    let lastServerTime: string | null = null;

    this.pollInterval = setInterval(async () => {
      try {
        const url = new URL(`${this.deskApiUrl}/events`);
        if (lastServerTime) {
          url.searchParams.set('since', lastServerTime);
        }
        url.searchParams.set('limit', '50');

        const internalEventsSecret = process.env.INTERNAL_EVENTS_SECRET;
        if (!internalEventsSecret) {
          logger.error('[Realtime] INTERNAL_EVENTS_SECRET is not configured; event polling disabled');
          return;
        }

        const response = await fetch(url.toString(), {
          headers: { 'x-internal-service-key': internalEventsSecret },
        });

        if (!response.ok) {
          logger.warn('[Realtime] Failed to fetch events from API', {
            api_url: url.toString(),
            http_status: response.status,
          });
          return;
        }

        const data = await response.json() as { events: EventEnvelope[]; serverTime: string };

        if (data.events.length > 0) {
          logger.debug('[Realtime] Processing events from API', { count: data.events.length });
          lastServerTime = data.serverTime;

          for (const event of data.events) {
            this.processEvent(event);
          }
        }
      } catch (error) {
        logger.error('[Realtime] Error polling events from API', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, intervalMs);

    logger.info('[Realtime] HTTP polling started', { api_url: this.deskApiUrl });
  }

  private processEvent(event: EventEnvelope): boolean {
    if (!shouldProject(event)) {
      return false;
    }

    const projection = projectEvent(event);
    if (!projection) {
      return false;
    }

    const message: RealtimeMessage = {
      event: projection.type,
      data: projection,
    };

    const aggregateId = projection.aggregateId;
    const aggregateType = projection.aggregateType.toLowerCase();

    this.broadcast('global', message);
    this.broadcast(`${aggregateType}:${aggregateId}`, message);

    if (event.correlation_id) {
      this.broadcast(`correlation:${event.correlation_id}`, message);
    }

    logger.debug('[Realtime] Projected event', {
      event_type: projection.type,
      aggregate_id: projection.aggregateId,
      aggregate_type: projection.aggregateType,
    });
    return true;
  }

  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

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

    logger.info('[Realtime] Server stopped');
  }
}

const PORT = Number(process.env.REALTIME_PORT) || 8080;
const server = new RealtimeServer(PORT);

const shouldAutoStart =
  process.env.REALTIME_AUTOSTART !== 'false' &&
  !(import.meta as ImportMeta & { vitest?: unknown }).vitest &&
  process.env.NODE_ENV !== 'test';

if (shouldAutoStart) {
  process.on('SIGTERM', () => {
    logger.info('[Realtime] Received SIGTERM, shutting down');
    server.stop();
    process.exit(0);
  });

  process.on('SIGINT', () => {
    logger.info('[Realtime] Received SIGINT, shutting down');
    server.stop();
    process.exit(0);
  });

  server.start();
}

export { RealtimeServer };
