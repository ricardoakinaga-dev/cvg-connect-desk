import type { EventEnvelope } from './envelope';

export interface EventConsumer {
  subscribe(eventType: string, handler: EventHandler): void;
  unsubscribe(eventType: string, handler: EventHandler): void;
  process(event: EventEnvelope): Promise<void>;
}

export type EventHandler = (event: EventEnvelope) => Promise<void>;

export interface EventProcessingResult {
  success: boolean;
  eventId: string;
  processedAt: string;
  error?: string;
}

export interface ProcessedEventStore {
  markProcessed(eventId: string, handlerName: string): Promise<void>;
  isProcessed(eventId: string, handlerName: string): Promise<boolean>;
}

export class InMemoryProcessedEventStore implements ProcessedEventStore {
  private processed = new Map<string, Set<string>>();

  async markProcessed(eventId: string, handlerName: string): Promise<void> {
    const key = this.getKey(eventId, handlerName);
    if (!this.processed.has(key)) {
      this.processed.set(key, new Set());
    }
    this.processed.get(key)!.add(eventId);
  }

  async isProcessed(eventId: string, handlerName: string): Promise<boolean> {
    const key = this.getKey(eventId, handlerName);
    return this.processed.get(key)?.has(eventId) ?? false;
  }

  private getKey(eventId: string, handlerName: string): string {
    return `${handlerName}:${eventId}`;
  }

  clear(): void {
    this.processed.clear();
  }
}

export class EventConsumerImpl implements EventConsumer {
  private handlers = new Map<string, EventHandler[]>();
  private store: ProcessedEventStore;

  constructor(store?: ProcessedEventStore) {
    this.store = store || new InMemoryProcessedEventStore();
  }

  subscribe(eventType: string, handler: EventHandler): void {
    const handlers = this.handlers.get(eventType) || [];
    handlers.push(handler);
    this.handlers.set(eventType, handlers);
  }

  unsubscribe(eventType: string, handler: EventHandler): void {
    const handlers = this.handlers.get(eventType) || [];
    const index = handlers.indexOf(handler);
    if (index > -1) {
      handlers.splice(index, 1);
      this.handlers.set(eventType, handlers);
    }
  }

  async process(event: EventEnvelope): Promise<void> {
    const handlers = this.handlers.get(event.event_type) || [];
    
    for (const handler of handlers) {
      const handlerName = handler.name || 'anonymous';
      const isProcessed = await this.store.isProcessed(event.event_id, handlerName);
      
      if (isProcessed) {
        console.log(`[Events] Event ${event.event_id} already processed by ${handlerName}, skipping`);
        continue;
      }

      try {
        await handler(event);
        await this.store.markProcessed(event.event_id, handlerName);
        console.log(`[Events] Event ${event.event_type} (${event.event_id}) processed by ${handlerName}`);
      } catch (error) {
        console.error(`[Events] Error processing event ${event.event_id} in ${handlerName}:`, error);
        throw error;
      }
    }
  }
}

export const eventConsumer = new EventConsumerImpl();
