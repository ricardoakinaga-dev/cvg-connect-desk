import 'dotenv/config';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { EventEnvelope } from '@cvg/events';
import { initTracing, withSpan, correlationAttributes } from '@cvg/tracing';
import {
  projectEvent,
  shouldProject,
  type RealtimeMessage,
  type RealtimeProjection
} from '@cvg/realtime';
import { ConsumerAwareOutboxReader, CONSUMER_IDS } from '@cvg/events';

interface Client {
  id: string;
  ws: WebSocket;
  userId?: string;
  token?: string;
  subscriptions: Set<string>;
  authenticated: boolean;
  revalidateTimer?: NodeJS.Timeout;
}

interface AuthResult {
  valid: boolean;
  userId?: string;
  error?: string;
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
    this.revalidateIntervalMs = Number(process.env.REALTIME_AUTH_REVALIDATE_MS) || 300000; // 5 minutes default
  }

  start(): void {
    this.wss = new WebSocketServer({ port: this.port });

    this.wss.on('listening', () => {
      console.info(JSON.stringify({
        msg: '[Realtime] WebSocket server listening',
        port: this.port,
        level: 'info',
      }));
    });

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

    this.startEventPolling();
    console.info(JSON.stringify({
      msg: '[Realtime] Event polling started',
      level: 'info',
    }));
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

  private handleConnectionWithAuth(clientId: string, ws: WebSocket, token: string): void {
    console.warn(JSON.stringify({
      msg: '[Realtime] Legacy connection with token in URL',
      client_id: clientId,
      auth_method: 'url-token',
      level: 'warn',
    }));

    const client: Client = {
      id: clientId,
      ws,
      userId: undefined,
      token,
      subscriptions: new Set(['global']),
      authenticated: false,
    };

    this.clients.set(clientId, client);

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

    const client: Client = {
      id: clientId,
      ws,
      userId: undefined,
      subscriptions: new Set(['global']),
      authenticated: false,
    };

    this.clients.set(clientId, client);

    ws.on('message', (data: Buffer) => {
      this.handleMessage(clientId, data);
    });

    ws.on('close', () => {
      console.info(JSON.stringify({
        msg: '[Realtime] Connection closed',
        client_id: clientId,
        level: 'info',
      }));
      this.clearClient(clientId);
    });

    ws.on('error', (error) => {
      console.error(JSON.stringify({
        msg: '[Realtime] Client error',
        client_id: clientId,
        error: error.message,
        level: 'error',
      }));
      this.clients.delete(clientId);
    });

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
        payload: { error: 'Authentication required. Send {type: "auth", token: "<jwt>"} after connecting.' },
      },
    });
  }

  private async validateTokenAndAuthenticate(clientId: string, token: string): Promise<void> {
    try {
      const response = await fetch(`${this.deskApiUrl}/auth/me`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json() as { user: { id: string; email: string; name: string; roles: string[] } };
        this.completeAuthentication(clientId, data.user.id);
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

    console.info(JSON.stringify({
      msg: '[Realtime] Client authenticated',
      client_id: clientId,
      user_id: userId,
      level: 'info',
    }));

    // Start periodic token revalidation
    if (client.token) {
      this.startRevalidationTimer(clientId);
    }

    this.setupClientHandlers(clientId);

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

  private setupClientHandlers(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    client.ws.on('message', (data: Buffer) => {
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
      this.clients.delete(clientId);
    });

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
          this.handleSubscribe(clientId, message);
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
      level: 'info',
    }));

    client.revalidateTimer = setInterval(async () => {
      await this.revalidateToken(clientId);
    }, this.revalidateIntervalMs);
  }

  private async revalidateToken(clientId: string): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client || !client.token || !client.authenticated) {
      // Client no longer needs revalidation
      this.clearRevalidationTimer(clientId);
      return;
    }

    try {
      const response = await fetch(`${this.deskApiUrl}/auth/me`, {
        headers: {
          'Authorization': `Bearer ${client.token}`,
        },
      });

      if (!response.ok) {
        console.warn(JSON.stringify({
          msg: '[Realtime] Token revalidation failed',
          client_id: clientId,
          http_status: response.status,
          level: 'warn',
        }));
        this.handleRevalidationFailure(clientId, `Token revoked: ${response.status}`);
      } else {
        console.debug(JSON.stringify({
          msg: '[Realtime] Token revalidated',
          client_id: clientId,
          level: 'debug',
        }));
      }
    } catch (error) {
      // Network errors don't necessarily mean token is invalid
      // Be lenient: log but don't disconnect on network issues
      console.error(JSON.stringify({
        msg: '[Realtime] Token revalidation error',
        client_id: clientId,
        error: error instanceof Error ? error.message : String(error),
        level: 'error',
      }));
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

  private handleSubscribe(clientId: string, message: { channel: string }): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    if (!client.authenticated) {
      this.sendToClient(clientId, {
        event: 'error',
        data: {
          type: 'subscribe.error' as any,
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
          type: 'subscribe.error' as any,
          aggregateType: 'Client',
          aggregateId: clientId,
          occurredAt: new Date().toISOString(),
          payload: { error: 'Missing channel' },
        },
      });
      return;
    }

    client.subscriptions.add(channel);
    console.info(JSON.stringify({
      msg: '[Realtime] Client subscribed to channel',
      client_id: clientId,
      channel,
      level: 'info',
    }));

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

  private handleUnsubscribe(clientId: string, message: { channel: string }): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    const channel = message.channel;
    client.subscriptions.delete(channel);
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

    console.info(JSON.stringify({
      msg: '[Realtime] Using consumer-aware outbox for event polling',
      consumer: CONSUMER_IDS.REALTIME,
      level: 'info',
    }));

    this.pollInterval = setInterval(async () => {
      try {
        const pendingEvents = await reader.fetchPendingEvents();

        if (pendingEvents.length > 0) {
          console.info(JSON.stringify({
            msg: '[Realtime] Processing events from outbox',
            count: pendingEvents.length,
            level: 'info',
          }));

          for (const outboxEvent of pendingEvents) {
            const event = reader.toEventEnvelope(outboxEvent);
            const shouldProcess = this.processEvent(event);

            if (shouldProcess) {
              await reader.acknowledge(outboxEvent.eventId);
            } else {
              // Evento não é projetável para realtime; ack normal evita ruído de retry/dead-letter.
              console.debug(JSON.stringify({
                msg: '[Realtime] Skipping non-projectable event',
                event_type: event.event_type,
                event_id: event.event_id,
                level: 'debug',
              }));
              await reader.acknowledge(outboxEvent.eventId);
            }
          }
        }
      } catch (error) {
        console.error(JSON.stringify({
          msg: '[Realtime] Error polling outbox',
          error: error instanceof Error ? error.message : String(error),
          level: 'error',
        }));
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

    this.pollInterval = setInterval(async () => {
      try {
        const url = new URL(`${this.deskApiUrl}/events`);
        if (lastServerTime) {
          url.searchParams.set('since', lastServerTime);
        }
        url.searchParams.set('limit', '50');

        const response = await fetch(url.toString());

        if (!response.ok) {
          console.warn(JSON.stringify({
            msg: '[Realtime] Failed to fetch events from API',
            api_url: url.toString(),
            http_status: response.status,
            level: 'warn',
          }));
          return;
        }

        const data = await response.json() as { events: EventEnvelope[]; serverTime: string };

        if (data.events.length > 0) {
          console.info(JSON.stringify({
            msg: '[Realtime] Processing events from API',
            count: data.events.length,
            level: 'info',
          }));
          lastServerTime = data.serverTime;

          for (const event of data.events) {
            this.processEvent(event);
          }
        }
      } catch (error) {
        console.error(JSON.stringify({
          msg: '[Realtime] Error polling events from API',
          error: error instanceof Error ? error.message : String(error),
          level: 'error',
        }));
      }
    }, intervalMs);

    console.info(JSON.stringify({
      msg: '[Realtime] HTTP polling started',
      api_url: this.deskApiUrl,
      level: 'info',
    }));
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

    // Span síncrona de publicação (Final-2): broadcast é fan-out local;
    // correlação preservada via event/correlation ids.
    void withSpan(
      'realtime.publish',
      async () => {
        const aggregateId = projection.aggregateId;
        const aggregateType = projection.aggregateType.toLowerCase();

        this.broadcast('global', message);
        this.broadcast(`${aggregateType}:${aggregateId}`, message);

        if (event.correlation_id) {
          this.broadcast(`correlation:${event.correlation_id}`, message);
        }
      },
      correlationAttributes({
        event_id: event.event_id,
        event_type: event.event_type,
        correlation_id: event.correlation_id,
        causation_id: event.causation_id,
      }),
    ).catch(() => {
      // Broadcast nunca falha o polling por causa de tracing.
    });

    console.info(JSON.stringify({
      msg: '[Realtime] Projected event',
      event_type: projection.type,
      aggregate_id: projection.aggregateId,
      aggregate_type: projection.aggregateType,
      level: 'info',
    }));
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
