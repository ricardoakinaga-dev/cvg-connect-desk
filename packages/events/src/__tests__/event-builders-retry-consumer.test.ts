import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAlertAcknowledgedEvent,
  createAlertCreatedEvent,
  createAlertResolvedEvent,
} from '../alert-events';
import {
  createConversationCreatedEvent,
  createConversationStatusChangedEvent,
  createMessageInboundEvent,
  createMessagePersistedEvent,
} from '../chat-events';
import {
  createHandoffCompletedEvent,
  createHandoffRequestedEvent,
  createSecretaryInvocationEvent,
} from '../handoff-events';
import {
  EventConsumerImpl,
  InMemoryProcessedEventStore,
} from '../consumer';
import {
  calculateNextDelay,
  createRetryContext,
  defaultRetryConfig,
  isPermanentError,
  isRetryableError,
  shouldRetry,
} from '../retry';
import type { EventEnvelope } from '../envelope';

function expectEvent(event: EventEnvelope, type: string, aggregateType: string, aggregateId: string) {
  expect(event).toMatchObject({
    event_type: type,
    aggregate_type: aggregateType,
    aggregate_id: aggregateId,
    version: 1,
    event_version: 1,
  });
  expect(event.event_id).toEqual(expect.any(String));
  expect(event.occurred_at).toEqual(expect.any(String));
}

function baseEvent(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    event_id: 'event-1',
    event_type: 'message.persisted',
    aggregate_type: 'Message',
    aggregate_id: 'message-1',
    occurred_at: new Date().toISOString(),
    payload: { messageId: 'message-1' },
    version: 1,
    ...overrides,
  };
}

describe('event builders', () => {
  it('creates alert events with expected envelope fields', () => {
    expectEvent(
      createAlertCreatedEvent({ alertId: 'alert-1', type: 'sla', title: 'SLA', severity: 'high' }),
      'alert.created',
      'Alert',
      'alert-1'
    );
    expectEvent(
      createAlertAcknowledgedEvent({ alertId: 'alert-1', acknowledgedBy: 'user-1' }),
      'alert.acknowledged',
      'Alert',
      'alert-1'
    );
    expectEvent(
      createAlertResolvedEvent({ alertId: 'alert-1', resolvedBy: 'user-1' }),
      'alert.resolved',
      'Alert',
      'alert-1'
    );
  });

  it('creates chat events with correlation ids', () => {
    const inbound = createMessageInboundEvent({
      messageId: 'message-1',
      conversationId: 'conversation-1',
      content: 'oi',
      sender: '5511999999999',
      externalMessageId: 'external-1',
      sentAt: '2026-04-28T00:00:00.000Z',
    }, 'corr-1');
    expectEvent(inbound, 'message.inbound.received', 'Message', 'message-1');
    expect(inbound.correlation_id).toBe('corr-1');

    expectEvent(
      createMessagePersistedEvent({
        messageId: 'message-2',
        conversationId: 'conversation-1',
        direction: 'outbound',
        content: 'ok',
        status: 'pending',
        createdAt: '2026-04-28T00:00:00.000Z',
      }),
      'message.persisted',
      'Message',
      'message-2'
    );

    expectEvent(
      createConversationCreatedEvent({
        conversationId: 'conversation-1',
        createdAt: '2026-04-28T00:00:00.000Z',
      }),
      'conversation.created',
      'Conversation',
      'conversation-1'
    );

    expectEvent(
      createConversationStatusChangedEvent({
        conversationId: 'conversation-1',
        previousStatus: 'open',
        newStatus: 'closed',
        changedAt: '2026-04-28T00:00:00.000Z',
      }),
      'conversation.status.changed',
      'Conversation',
      'conversation-1'
    );
  });

  it('creates handoff and secretary invocation events', () => {
    expectEvent(
      createHandoffRequestedEvent({
        conversationId: 'conversation-1',
        previousHandler: 'bot',
        newHandler: 'human',
        reason: 'urgent',
      }),
      'handoff.requested',
      'Conversation',
      'conversation-1'
    );

    expectEvent(
      createHandoffCompletedEvent({
        conversationId: 'conversation-1',
        previousHandler: 'bot',
        newHandler: 'human',
        reason: 'urgent',
        completedAt: '2026-04-28T00:00:00.000Z',
      }),
      'handoff.completed',
      'Conversation',
      'conversation-1'
    );

    expectEvent(
      createSecretaryInvocationEvent({
        conversationId: 'conversation-1',
        invocationId: 'inv-1',
        action: 'classify',
        status: 'success',
      }),
      'secretary.invocation',
      'Conversation',
      'conversation-1'
    );
  });
});

describe('retry policy helpers', () => {
  it('classifies retryable and permanent errors', () => {
    const retryable = new Error('network timeout') as Error & { retryable?: boolean };
    retryable.retryable = true;
    expect(isRetryableError(retryable)).toBe(true);

    const permanent = new Error('bad request') as Error & { permanent?: boolean };
    permanent.permanent = true;
    expect(isRetryableError(permanent)).toBe(false);
    expect(isPermanentError(permanent)).toBe(true);

    const nonRetryable = new Error('validation') as Error & { retryable?: boolean };
    nonRetryable.retryable = false;
    expect(isPermanentError(nonRetryable)).toBe(true);
    expect(isRetryableError('unknown')).toBe(true);
  });

  it('calculates backoff and retry decisions', () => {
    expect(calculateNextDelay(defaultRetryConfig, 1)).toBe(1000);
    expect(calculateNextDelay(defaultRetryConfig, 2)).toBe(2000);
    expect(calculateNextDelay({ ...defaultRetryConfig, maxDelayMs: 1500 }, 3)).toBe(1500);

    const retryContext = createRetryContext(baseEvent(), 'handler', 1, new Error('ECONNREFUSED'));
    expect(retryContext).toMatchObject({ handlerName: 'handler', attempt: 1 });
    expect(shouldRetry(retryContext, defaultRetryConfig)).toBe(true);

    expect(shouldRetry({ ...retryContext, attempt: 3 }, defaultRetryConfig)).toBe(false);

    const permanent = new Error('no') as Error & { permanent?: boolean };
    permanent.permanent = true;
    expect(shouldRetry({ ...retryContext, lastError: permanent }, defaultRetryConfig)).toBe(false);
  });
});

describe('event consumer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('subscribes, processes once per handler, and unsubscribes', async () => {
    const store = new InMemoryProcessedEventStore();
    const consumer = new EventConsumerImpl(store);
    const handled = vi.fn(async function namedHandler() {});
    const skippedLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    consumer.subscribe('message.persisted', handled);
    await consumer.process(baseEvent());
    await consumer.process(baseEvent());

    expect(handled).toHaveBeenCalledTimes(1);
    expect(skippedLog).toHaveBeenCalledWith(expect.stringContaining('already processed by namedHandler, skipping'));

    consumer.unsubscribe('message.persisted', handled);
    await consumer.process(baseEvent({ event_id: 'event-2' }));
    expect(handled).toHaveBeenCalledTimes(1);
  });

  it('propagates handler failures and supports clearing processed store', async () => {
    const store = new InMemoryProcessedEventStore();
    const consumer = new EventConsumerImpl(store);
    const error = new Error('handler failed');
    const failing = vi.fn(async function failingHandler() {
      throw error;
    });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    consumer.subscribe('message.persisted', failing);

    await expect(consumer.process(baseEvent())).rejects.toThrow(error);
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('Error processing event event-1'), error);

    await store.markProcessed('event-1', 'handler');
    expect(await store.isProcessed('event-1', 'handler')).toBe(true);
    store.clear();
    expect(await store.isProcessed('event-1', 'handler')).toBe(false);
  });
});
