import type { EventEnvelope } from './envelope';

export interface EventPublisher {
  publish<T>(event: EventEnvelope<T>): Promise<void>;
  publishBatch<T>(events: EventEnvelope<T>[]): Promise<void>;
}

export class InMemoryEventPublisher implements EventPublisher {
  private events: EventEnvelope[] = [];

  async publish<T>(event: EventEnvelope<T>): Promise<void> {
    this.events.push(event as EventEnvelope);
  }

  async publishBatch<T>(events: EventEnvelope<T>[]): Promise<void> {
    this.events.push(...(events as EventEnvelope[]));
  }

  getEvents(): EventEnvelope[] {
    return [...this.events];
  }

  clear(): void {
    this.events = [];
  }
}

export const eventPublisher = new InMemoryEventPublisher();
