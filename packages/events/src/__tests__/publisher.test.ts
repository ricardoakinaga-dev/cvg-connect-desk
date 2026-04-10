import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryEventPublisher } from '../publisher';
import type { EventEnvelope } from '../envelope';

describe('InMemoryEventPublisher', () => {
  let publisher: InMemoryEventPublisher;

  beforeEach(() => {
    publisher = new InMemoryEventPublisher();
  });

  describe('publish', () => {
    it('adiciona evento à lista', async () => {
      const event: EventEnvelope = {
        id: 'evt_1',
        type: 'message.inbound.received',
        occurred_at: new Date().toISOString(),
        aggregateType: 'Conversation',
        aggregateId: 'conv_123',
        payload: { text: 'Olá' },
        metadata: {},
      };

      await publisher.publish(event);

      const events = publisher.getEvents();
      expect(events).toHaveLength(1);
      expect(events[0].id).toBe('evt_1');
    });

    it('preserva eventos anteriores ao publicar novo', async () => {
      const event1: EventEnvelope = {
        id: 'evt_1',
        type: 'message.inbound.received',
        occurred_at: new Date().toISOString(),
        aggregateType: 'Conversation',
        aggregateId: 'conv_1',
        payload: {},
        metadata: {},
      };
      const event2: EventEnvelope = {
        id: 'evt_2',
        type: 'conversation.created',
        occurred_at: new Date().toISOString(),
        aggregateType: 'Conversation',
        aggregateId: 'conv_2',
        payload: {},
        metadata: {},
      };

      await publisher.publish(event1);
      await publisher.publish(event2);

      expect(publisher.getEvents()).toHaveLength(2);
    });
  });

  describe('publishBatch', () => {
    it('adiciona múltiplos eventos de uma vez', async () => {
      const events: EventEnvelope[] = [
        {
          id: 'evt_1',
          type: 'message.inbound.received',
          occurred_at: new Date().toISOString(),
          aggregateType: 'Conversation',
          aggregateId: 'conv_1',
          payload: {},
          metadata: {},
        },
        {
          id: 'evt_2',
          type: 'message.inbound.received',
          occurred_at: new Date().toISOString(),
          aggregateType: 'Conversation',
          aggregateId: 'conv_2',
          payload: {},
          metadata: {},
        },
      ];

      await publisher.publishBatch(events);

      expect(publisher.getEvents()).toHaveLength(2);
    });
  });

  describe('clear', () => {
    it('remove todos os eventos', async () => {
      const event: EventEnvelope = {
        id: 'evt_1',
        type: 'message.inbound.received',
        occurred_at: new Date().toISOString(),
        aggregateType: 'Conversation',
        aggregateId: 'conv_1',
        payload: {},
        metadata: {},
      };

      await publisher.publish(event);
      expect(publisher.getEvents()).toHaveLength(1);

      publisher.clear();
      expect(publisher.getEvents()).toHaveLength(0);
    });
  });

  describe('getEvents', () => {
    it('retorna cópia da lista de eventos', async () => {
      const event: EventEnvelope = {
        id: 'evt_1',
        type: 'message.inbound.received',
        occurred_at: new Date().toISOString(),
        aggregateType: 'Conversation',
        aggregateId: 'conv_1',
        payload: {},
        metadata: {},
      };

      await publisher.publish(event);

      const events1 = publisher.getEvents();
      const events2 = publisher.getEvents();

      expect(events1).toEqual(events2);
      expect(events1).not.toBe(events2); // São cópias diferentes
    });
  });
});
