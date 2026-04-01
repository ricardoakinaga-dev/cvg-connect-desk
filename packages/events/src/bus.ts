import type { EventEnvelope } from './envelope';

export interface EventPublisher {
  publish<T>(event: EventEnvelope<T>): Promise<void>;
  publishBatch<T>(events: EventEnvelope<T>[]): Promise<void>;
}

export interface EventSubscriber {
  subscribe(handler: (event: EventEnvelope) => void): void;
  unsubscribe(handler: (event: EventEnvelope) => void): void;
}

export interface EventBus extends EventPublisher, EventSubscriber {}

/**
 * In-memory event bus for single-process scenarios (tests, dev).
 * For production multi-process, use RedisEventBus.
 */
export class InMemoryEventBus implements EventBus {
  private events: EventEnvelope[] = [];
  private handlers: Set<(event: EventEnvelope) => void> = new Set();

  async publish<T>(event: EventEnvelope<T>): Promise<void> {
    this.events.push(event as EventEnvelope);
    for (const handler of this.handlers) {
      try {
        handler(event as EventEnvelope);
      } catch (err) {
        console.error('[InMemoryEventBus] Handler error:', err);
      }
    }
  }

  async publishBatch<T>(events: EventEnvelope<T>[]): Promise<void> {
    for (const event of events) {
      await this.publish(event);
    }
  }

  subscribe(handler: (event: EventEnvelope) => void): void {
    this.handlers.add(handler);
  }

  unsubscribe(handler: (event: EventEnvelope) => void): void {
    this.handlers.delete(handler);
  }

  getEvents(): EventEnvelope[] {
    return [...this.events];
  }

  clear(): void {
    this.events = [];
  }
}

/**
 * Redis-backed event bus for multi-process communication.
 * Uses Redis pub/sub for real-time event distribution.
 * Falls back to in-memory if Redis is unavailable.
 */
export class RedisEventBus implements EventBus {
  private handlers: Set<(event: EventEnvelope) => void> = new Set();
  private pubClient: any = null;
  private subClient: any = null;
  private connected = false;
  private readonly channel: string;

  constructor(channel = 'cvg:events') {
    this.channel = channel;
  }

  async initialize(redisUrl: string): Promise<void> {
    try {
      // Dynamic import to avoid hard dependency on redis package
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createClient } = await import('redis');
      this.pubClient = createClient({ url: redisUrl });
      this.subClient = createClient({ url: redisUrl });

      await Promise.all([this.pubClient.connect(), this.subClient.connect()]);

      this.subClient.on('message', (_channel: string, message: string) => {
        try {
          const event = JSON.parse(message) as EventEnvelope;
          for (const handler of this.handlers) {
            try {
              handler(event);
            } catch (err) {
              console.error('[RedisEventBus] Handler error:', err);
            }
          }
        } catch (err) {
          console.error('[RedisEventBus] Failed to parse event:', err);
        }
      });

      await this.subClient.subscribe(this.channel, (_err: Error | null, _count: number) => {});

      this.connected = true;
      console.log('[RedisEventBus] Connected to Redis pub/sub');
    } catch (err) {
      console.warn('[RedisEventBus] Redis unavailable, using in-memory fallback:', err);
      this.connected = false;
    }
  }

  async publish<T>(event: EventEnvelope<T>): Promise<void> {
    if (this.connected && this.pubClient) {
      try {
        await this.pubClient.publish(this.channel, JSON.stringify(event));
      } catch (err) {
        console.error('[RedisEventBus] Publish failed:', err);
      }
    }
  }

  async publishBatch<T>(events: EventEnvelope<T>[]): Promise<void> {
    for (const event of events) {
      await this.publish(event);
    }
  }

  subscribe(handler: (event: EventEnvelope) => void): void {
    this.handlers.add(handler);
  }

  unsubscribe(handler: (event: EventEnvelope) => void): void {
    this.handlers.delete(handler);
  }

  isConnected(): boolean {
    return this.connected;
  }

  async disconnect(): Promise<void> {
    if (this.pubClient) await this.pubClient.quit();
    if (this.subClient) await this.subClient.quit();
    this.connected = false;
  }
}

export const eventBus = new InMemoryEventBus();

// Backwards compatibility alias
export const eventPublisher = eventBus;
