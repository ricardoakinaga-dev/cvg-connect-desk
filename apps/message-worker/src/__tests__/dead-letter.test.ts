import { beforeEach, describe, expect, it } from 'vitest';
import { deadLetterStore } from '@cvg/events';
import { recordWorkerDeadLetter } from '../dead-letter';

describe('recordWorkerDeadLetter', () => {
  beforeEach(() => {
    deadLetterStore.clear();
  });

  it('stores the original event envelope for replay', async () => {
    const sourceEvent = {
      event_id: 'evt_123',
      event_type: 'handoff.completed',
      event_version: 1,
      aggregate_type: 'Conversation',
      aggregate_id: 'conv_001',
      occurred_at: '2026-04-10T12:00:00.000Z',
      payload: {
        conversationId: 'conv_001',
        previousHandler: 'bot' as const,
        newHandler: 'human' as const,
        reason: 'handoff-request',
      },
      version: 1,
    };

    const entry = await recordWorkerDeadLetter({
      event: sourceEvent,
      error: 'terminal failure',
      retryCount: 3,
      handlerName: 'handleHandoffCompleted',
    });

    expect(entry.sourceEvent).toEqual(sourceEvent);
    expect(entry.eventId).toBe(sourceEvent.event_id);
    expect(entry.eventType).toBe(sourceEvent.event_type);
    expect(entry.payload).toEqual(sourceEvent.payload);
    expect(entry.failureContext).toMatchObject({
      stage: 'worker-terminal',
      decision: 'dead-letter',
      handlerName: 'handleHandoffCompleted',
      eventType: 'handoff.completed',
      eventId: 'evt_123',
      retryCount: 3,
      retryable: true,
      reason: 'terminal failure',
      eventVersion: 1,
      correlationId: undefined,
      causationId: undefined,
    });
    expect(deadLetterStore.getById(entry.id)?.sourceEvent).toEqual(sourceEvent);
  });
});
