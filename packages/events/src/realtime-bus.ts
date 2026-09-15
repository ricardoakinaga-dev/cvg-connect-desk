import { randomUUID } from 'node:crypto';
import type { EventEnvelope } from './envelope';

/**
 * Realtime fan-out bus (Final-8).
 * Decisão (ADR-005): Redis Pub/Sub como FAST path; o polling do outbox
 * continua como path DURÁVEL (se o Redis cair, eventos chegam no próximo
 * poll — latência degradada, nunca perda). Durabilidade já é garantida
 * pelos consumer acks idempotentes; aqui há ainda dedup de broadcast
 * por instância (visto recentemente).
 */

export const REALTIME_BUS_CHANNEL = process.env.REALTIME_BUS_CHANNEL || 'cvg:realtime';

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise.finally(() => clearTimeout(timer)), timeout]);
}

export interface RealtimeBus {
  readonly instanceId: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  publish(envelope: EventEnvelope): Promise<boolean>;
  onEnvelope(callback: (envelope: EventEnvelope) => void): () => void;
  isConnected(): boolean;
}

type RedisClient = {
  connect(): Promise<unknown>;
  quit(): Promise<unknown>;
  disconnect(): Promise<unknown>;
  duplicate(): RedisClient;
  subscribe(channel: string, listener: (message: string) => void): Promise<unknown>;
  unSubscribe(channel?: string): Promise<unknown>;
  publish(channel: string, message: string): Promise<unknown>;
  on(event: string, listener: (error: Error) => void): RedisClient;
  get isOpen(): boolean;
};

async function createRedisClient(url: string, logger: (message: string) => void): Promise<RedisClient> {  const { createClient } = (await import('redis')) as typeof import('redis');
  const client = createClient({
    url,
    socket: {
      connectTimeout: 5000,
      reconnectStrategy: (retries: number) => {
        if (retries > 10) return new Error('Redis reconnect exhausted');
        return Math.min(retries * 200, 3000);
      },
    },
    disableOfflineQueue: true,
  }) as unknown as RedisClient;
  client.on('error', (error: Error) => {
    logger(`[RealtimeBus] redis error (degraded, outbox poll covers): ${error.message}`);
  });
  return client;
}

export class RedisRealtimeBus implements RealtimeBus {
  readonly instanceId: string;
  private readonly url: string;
  private readonly channel: string;
  private readonly logger: (message: string) => void;
  private publisher: RedisClient | null = null;
  private subscriber: RedisClient | null = null;
  private listeners = new Set<(envelope: EventEnvelope) => void>();
  private started = false;

  constructor(options: { url: string; channel?: string; instanceId?: string; logger?: (message: string) => void } = { url: '' }) {
    this.url = options.url;
    this.channel = options.channel || REALTIME_BUS_CHANNEL;
    this.instanceId = options.instanceId || `rt-${randomUUID().slice(0, 8)}`;
    this.logger = options.logger || (() => {});
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.publisher = await createRedisClient(this.url, this.logger);
    this.subscriber = this.publisher.duplicate();
    // O `duplicate()` do node-redis não herda listeners: sem handler próprio,
    // o socket do subscriber emite 'error' sem tratamento quando o Redis cai
    // ou é encerrado e derruba o processo (F4). O caminho durável segue no
    // polling do outbox.
    this.subscriber.on('error', (error: Error) => {
      this.logger(`[RealtimeBus] redis subscriber error (degraded, outbox poll covers): ${error.message}`);
    });
    const timeoutMs = Number(process.env.REALTIME_BUS_CONNECT_TIMEOUT_MS) || 8000;
    try {
      await withTimeout(this.publisher.connect(), timeoutMs, 'realtime bus publisher connect timed out');
      await withTimeout(this.subscriber.connect(), timeoutMs, 'realtime bus subscriber connect timed out');
    } catch (error) {
      await this.stop().catch(() => {});
      throw error;
    }
    await this.subscriber.subscribe(this.channel, (message: string) => {
      try {
        const parsed = JSON.parse(message) as { instanceId?: string; envelope?: EventEnvelope };
        if (!parsed || parsed.instanceId === this.instanceId || !parsed.envelope) return;
        for (const listener of this.listeners) {
          try {
            listener(parsed.envelope);
          } catch (error) {
            this.logger(`[RealtimeBus] listener failed: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      } catch {
        // Mensagem malformada no canal: ignorar (durável via outbox poll).
      }
    });
    this.started = true;
  }

  async stop(): Promise<void> {
    this.started = false;
    this.listeners.clear();
    const sub = this.subscriber;
    const pub = this.publisher;
    this.subscriber = null;
    this.publisher = null;
    // quit() pode travar em cliente nunca conectado: timeout + disconnect forçado.
    for (const client of [sub, pub]) {
      if (!client) continue;
      try {
        await withTimeout(client.quit().catch(() => {}), 2000, 'redis quit timed out');
      } catch {
        try {
          await client.disconnect().catch(() => {});
        } catch {
          // best-effort
        }
      }
    }
  }

  isConnected(): boolean {
    return this.started && !!this.publisher?.isOpen && !!this.subscriber?.isOpen;
  }

  async publish(envelope: EventEnvelope): Promise<boolean> {
    if (!this.started || !this.publisher?.isOpen) return false;
    try {
      await this.publisher.publish(this.channel, JSON.stringify({ instanceId: this.instanceId, envelope }));
      return true;
    } catch {
      return false;
    }
  }

  onEnvelope(callback: (envelope: EventEnvelope) => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }
}

/** Barramento desligado (sem REDIS_URL): polling do outbox cobre tudo. */
export class NoopRealtimeBus implements RealtimeBus {
  readonly instanceId = 'noop';
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  async publish(): Promise<boolean> {
    return false;
  }
  onEnvelope(): () => void {
    return () => {};
  }
  isConnected(): boolean {
    return false;
  }
}

let sharedBus: RealtimeBus | null = null;

/**
 * Configura o barramento do processo (D-C03-2). `null` restaura o singleton
 * preguiçoso baseado em `REDIS_URL`. Usado pelos hosts e por testes da
 * fronteira "hint só após commit" / "hint perdido não perde o evento".
 */
export function setSharedRealtimeBus(bus: RealtimeBus | null): void {
  sharedBus = bus;
}

/**
 * Para o barramento compartilhado, se existir, SEM criá-lo. Fechamento
 * explícito para hosts/testes que precisam encerrar o subscriber antes de
 * derrubar o Redis (senão o socket cai com o serviço ainda aberto).
 */
export async function stopSharedRealtimeBus(): Promise<void> {
  const bus = sharedBus;
  sharedBus = null;
  if (bus) {
    await bus.stop().catch(() => {});
  }
}

/** Singleton preguiçoso do processo publicador (API). Best-effort, nunca lança. */
export async function getSharedRealtimeBus(): Promise<RealtimeBus> {
  if (!sharedBus) {
    const url = process.env.REDIS_URL || '';
    sharedBus = url ? new RedisRealtimeBus({ url }) : new NoopRealtimeBus();
    try {
      await sharedBus.start();
    } catch {
      sharedBus = new NoopRealtimeBus();
    }
  }
  return sharedBus;
}

/** Hint de evento novo (fast path). Falha silenciosa → poll cobre. */
export async function publishRealtimeHint(envelope: EventEnvelope): Promise<boolean> {
  try {
    const bus = await getSharedRealtimeBus();
    return await bus.publish(envelope);
  } catch {
    return false;
  }
}
