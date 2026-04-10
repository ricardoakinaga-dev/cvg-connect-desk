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
      expect(entry.failureContext).toMatchObject({
        stage: 'worker-terminal',
        decision: 'dead-letter',
        handlerName: 'processInbound',
        eventType: 'message.inbound.received',
        eventId: 'evt_123',
        retryCount: 3,
        retryable: false,
        reason: 'Connection timeout',
      });
    });

    it('prioriza sourceEvent como envelope de replay', () => {
      const entry = store.add({
        eventType: 'placeholder.type',
        eventId: 'placeholder-id',
        payload: { placeholder: true },
        error: 'Connection timeout',
        retryCount: 3,
        handlerName: 'processInbound',
        sourceEvent: {
          event_id: 'evt_456',
          event_type: 'message.persisted',
          event_version: 1,
          aggregate_type: 'Message',
          aggregate_id: 'msg_001',
          occurred_at: '2026-04-10T12:00:00.000Z',
          payload: { text: 'oi' },
          version: 1,
        },
      });

      expect(entry.eventId).toBe('evt_456');
      expect(entry.eventType).toBe('message.persisted');
      expect(entry.payload).toEqual({ text: 'oi' });
      expect(entry.handlerName).toBe('processInbound');
      expect(entry.sourceEvent?.event_id).toBe('evt_456');
      expect(entry.failureContext).toMatchObject({
        stage: 'worker-terminal',
        decision: 'dead-letter',
        handlerName: 'processInbound',
        eventType: 'message.persisted',
        eventId: 'evt_456',
        retryCount: 3,
        retryable: true,
        reason: 'Connection timeout',
        eventVersion: 1,
        correlationId: undefined,
        causationId: undefined,
      });
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

  describe('canRetry', () => {
    it('retorna true quando a entrada possui sourceEvent', () => {
      const entry = store.add({
        eventType: 'test',
        eventId: '1',
        payload: {},
        error: 'e',
        retryCount: 1,
        handlerName: 'h',
        sourceEvent: {
          event_id: '1',
          event_type: 'test',
          event_version: 1,
          aggregate_type: 'Test',
          aggregate_id: 'agg_1',
          occurred_at: '2026-04-10T12:00:00.000Z',
          payload: {},
          version: 1,
        },
      });

      expect(store.canRetry(entry.id)).toBe(true);
    });

    it('retorna false quando não há sourceEvent', () => {
      const entry = store.add({ eventType: 'test', eventId: '1', payload: {}, error: 'e', retryCount: 1, handlerName: 'h' });

      expect(store.canRetry(entry.id)).toBe(false);
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

  describe('getOperationalStats', () => {
    it('retorna resumo operacional com replayables e motivos', () => {
      store.add({
        eventType: 'message.persisted',
        eventId: 'evt_1',
        payload: { messageId: 'msg_1' },
        error: 'Timeout',
        retryCount: 2,
        handlerName: 'worker.processMessage',
        sourceEvent: {
          event_id: 'evt_1',
          event_type: 'message.persisted',
          event_version: 1,
          aggregate_type: 'Message',
          aggregate_id: 'msg_1',
          occurred_at: '2026-04-10T12:00:00.000Z',
          payload: { messageId: 'msg_1' },
          version: 1,
        },
      });
      store.add({
        eventType: 'task.created',
        eventId: 'evt_2',
        payload: { taskId: 'task_1' },
        error: 'Persistent failure',
        retryCount: 4,
        handlerName: 'worker.processTask',
      });

      const stats = store.getOperationalStats();
      expect(stats).toMatchObject({
        total: 2,
        unresolved: 2,
        resolved: 0,
        replayable: 1,
        manualOnly: 1,
        byHandler: expect.arrayContaining([
          expect.objectContaining({
            handlerName: 'worker.processMessage',
            replayable: 1,
          }),
          expect.objectContaining({
            handlerName: 'worker.processTask',
            manualOnly: 1,
          }),
        ]),
        byReason: expect.arrayContaining([
          expect.objectContaining({
            reason: 'Timeout',
            replayable: 1,
          }),
          expect.objectContaining({
            reason: 'Persistent failure',
            manualOnly: 1,
          }),
        ]),
      });
      expect(stats.lastFailedAt).toBeTypeOf('string');
    });
  });
});
