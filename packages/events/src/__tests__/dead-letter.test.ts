import { describe, it, expect, beforeEach } from 'vitest';
import { DeadLetterStore } from '../dead-letter';

describe('DeadLetterStore', () => {
  let store: DeadLetterStore;

  beforeEach(() => {
    store = new DeadLetterStore(100);
  });

  describe('add', () => {
    it('adiciona entrada na dead-letter queue', () => {
      const entry = store.add({
        eventType: 'message.inbound.received',
        eventId: 'evt_123',
        payload: { text: 'oi' },
        error: 'Connection timeout',
        retryCount: 3,
        handlerName: 'processInbound',
      });

      expect(entry.id).toMatch(/^dlq_/);
      expect(entry.eventType).toBe('message.inbound.received');
      expect(entry.resolved).toBe(false);
      expect(entry.failedAt).toBeInstanceOf(Date);
    });
  });

  describe('getAll', () => {
    it('retorna todas as entradas', () => {
      store.add({ eventType: 'test', eventId: '1', payload: {}, error: 'e', retryCount: 1, handlerName: 'h' });
      store.add({ eventType: 'test', eventId: '2', payload: {}, error: 'e', retryCount: 1, handlerName: 'h' });

      expect(store.getAll()).toHaveLength(2);
    });

    it('filtra por resolved', () => {
      store.add({ eventType: 'test', eventId: '1', payload: {}, error: 'e', retryCount: 1, handlerName: 'h' });
      const entry2 = store.add({ eventType: 'test', eventId: '2', payload: {}, error: 'e', retryCount: 1, handlerName: 'h' });
      store.resolve(entry2.id);

      expect(store.getAll({ resolved: false })).toHaveLength(1);
      expect(store.getAll({ resolved: true })).toHaveLength(1);
    });

    it('limita resultados', () => {
      for (let i = 0; i < 10; i++) {
        store.add({ eventType: 'test', eventId: `${i}`, payload: {}, error: 'e', retryCount: 1, handlerName: 'h' });
      }

      expect(store.getAll({ limit: 3 })).toHaveLength(3);
    });
  });

  describe('resolve', () => {
    it('marca entrada como resolvida', () => {
      const entry = store.add({ eventType: 'test', eventId: '1', payload: {}, error: 'e', retryCount: 1, handlerName: 'h' });
      const resolved = store.resolve(entry.id);

      expect(resolved).toBe(true);
      expect(store.getById(entry.id)?.resolved).toBe(true);
      expect(store.getById(entry.id)?.resolvedAt).toBeInstanceOf(Date);
    });

    it('retorna false para ID inexistente', () => {
      expect(store.resolve('nao_existe')).toBe(false);
    });
  });

  describe('getStats', () => {
    it('retorna estatísticas corretas', () => {
      const e1 = store.add({ eventType: 'test', eventId: '1', payload: {}, error: 'e', retryCount: 1, handlerName: 'h' });
      store.add({ eventType: 'test', eventId: '2', payload: {}, error: 'e', retryCount: 1, handlerName: 'h' });
      store.resolve(e1.id);

      const stats = store.getStats();
      expect(stats.total).toBe(2);
      expect(stats.resolved).toBe(1);
      expect(stats.unresolved).toBe(1);
    });
  });
});
