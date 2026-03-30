import 'dotenv/config';
import { WebSocketServer, WebSocket } from 'ws';
import { eventPublisher, type EventEnvelope } from '@cvg/events';
import { 
  projectEvent, 
  shouldProject, 
  type RealtimeMessage, 
  type RealtimeProjection 
} from '@cvg/realtime';
import { ok, err } from '@cvg/shared';

interface Client {
  id: string;
  ws: WebSocket;
  userId?: string;
  subscriptions: Set<string>;
}

class RealtimeServer {
  private clients: Map<string, Client> = new Map();
  private wss: WebSocketServer | null = null;
  private pollInterval: NodeJS.Timeout | null = null;

  constructor(private port: number = 8080) {}

  start(): void {
    this.wss = new WebSocketServer({ port: this.port });

    this.wss.on('listening', () => {
      console.log(`[Realtime] WebSocket server listening on port ${this.port}`);
    });

    this.wss.on('connection', (ws: WebSocket) => {
      const clientId = this.generateClientId();
      this.handleConnection(clientId, ws);
    });

    this.wss.on('error', (error) => {
      console.error('[Realtime] WebSocket server error:', error);
    });

    this.startEventPolling();
    console.log('[Realtime] Event polling started');
  }

  private generateClientId(): string {
    return `client_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  private handleConnection(clientId: string, ws: WebSocket): void {
    console.log(`[Realtime] New connection: ${clientId}`);

    const client: Client = {
      id: clientId,
      ws,
      userId: undefined,
      subscriptions: new Set(['global']),
    };

    this.clients.set(clientId, client);

    ws.on('message', (data: Buffer) => {
      this.handleMessage(clientId, data);
    });

    ws.on('close', () => {
      console.log(`[Realtime] Connection closed: ${clientId}`);
      this.clients.delete(clientId);
    });

    ws.on('error', (error) => {
      console.error(`[Realtime] Client error (${clientId}):`, error);
      this.clients.delete(clientId);
    });

    this.sendToClient(clientId, {
      event: 'connected',
      data: {
        type: 'connection.established',
        aggregateType: 'Client',
        aggregateId: clientId,
        occurredAt: new Date().toISOString(),
        payload: { clientId },
      },
    });
  }

  private handleMessage(clientId: string, data: Buffer): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case 'auth':
          this.handleAuth(clientId, message);
          break;
        case 'subscribe':
          this.handleSubscribe(clientId, message);
          break;
        case 'unsubscribe':
          this.handleUnsubscribe(clientId, message);
          break;
        default:
          console.log(`[Realtime] Unknown message type: ${message.type}`);
      }
    } catch (error) {
      console.error(`[Realtime] Error handling message:`, error);
    }
  }

  private handleAuth(clientId: string, message: { userId: string }): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    const userId = message.userId;
    if (!userId) {
      this.sendToClient(clientId, {
        event: 'error',
        data: {
          type: 'auth.error',
          aggregateType: 'Client',
          aggregateId: clientId,
          occurredAt: new Date().toISOString(),
          payload: { error: 'Missing userId' },
        },
      });
      return;
    }

    client.userId = userId;
    client.subscriptions.add(`user:${userId}`);

    console.log(`[Realtime] Client ${clientId} authenticated as user ${userId}`);

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

  private handleSubscribe(clientId: string, message: { channel: string }): void {
    const client = this.clients.get(clientId);
    if (!client) return;

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
    console.log(`[Realtime] Client ${clientId} subscribed to ${channel}`);

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
    console.log(`[Realtime] Client ${clientId} unsubscribed from ${channel}`);
  }

  private sendToClient(clientId: string, message: RealtimeMessage): void {
    const client = this.clients.get(clientId);
    if (!client || client.ws.readyState !== WebSocket.OPEN) return;

    try {
      client.ws.send(JSON.stringify(message));
    } catch (error) {
      console.error(`[Realtime] Error sending to client ${clientId}:`, error);
    }
  }

  private broadcast(channel: string, message: RealtimeMessage): void {
    let recipientCount = 0;

    for (const client of this.clients.values()) {
      if (client.subscriptions.has(channel)) {
        this.sendToClient(client.id, message);
        recipientCount++;
      }
    }

    if (recipientCount > 0) {
      console.log(`[Realtime] Broadcast to channel ${channel}: ${recipientCount} clients`);
    }
  }

  private startEventPolling(): void {
    const intervalMs = Number(process.env.REALTIME_POLL_INTERVAL_MS) || 500;

    this.pollInterval = setInterval(() => {
      const events = eventPublisher.getEvents();

      if (events.length > 0) {
        console.log(`[Realtime] Processing ${events.length} events`);

        for (const event of events) {
          this.processEvent(event);
        }

        eventPublisher.clear();
      }
    }, intervalMs);
  }

  private processEvent(event: EventEnvelope): void {
    if (!shouldProject(event)) {
      return;
    }

    const projection = projectEvent(event);
    if (!projection) {
      return;
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

    console.log(`[Realtime] Projected event: ${projection.type} (${projection.aggregateId})`);
  }

  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    for (const client of this.clients.values()) {
      client.ws.close();
    }
    this.clients.clear();

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    console.log('[Realtime] Server stopped');
  }
}

const PORT = Number(process.env.REALTIME_PORT) || 8080;
const server = new RealtimeServer(PORT);

process.on('SIGTERM', () => {
  console.log('[Realtime] Received SIGTERM, shutting down');
  server.stop();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[Realtime] Received SIGINT, shutting down');
  server.stop();
  process.exit(0);
});

server.start();

export { RealtimeServer };
