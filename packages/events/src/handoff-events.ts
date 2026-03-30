import { createEvent, type EventEnvelope } from './envelope';

export interface HandoffRequestedPayload {
  conversationId: string;
  previousHandler: 'bot' | 'human';
  newHandler: 'bot' | 'human';
  reason: string;
  triggeredBy?: string;
  metadata?: Record<string, unknown>;
}

export interface HandoffCompletedPayload {
  conversationId: string;
  previousHandler: 'bot' | 'human';
  newHandler: 'bot' | 'human';
  reason: string;
  triggeredBy?: string;
  completedAt: string;
}

export interface SecretaryInvocationPayload {
  conversationId: string;
  messageId?: string;
  invocationId: string;
  action: string;
  status: 'requested' | 'success' | 'failed';
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

export type HandoffRequestedEvent = EventEnvelope<HandoffRequestedPayload>;
export type HandoffCompletedEvent = EventEnvelope<HandoffCompletedPayload>;
export type SecretaryInvocationEvent = EventEnvelope<SecretaryInvocationPayload>;

export function createHandoffRequestedEvent(
  payload: HandoffRequestedPayload,
  correlationId?: string
): HandoffRequestedEvent {
  return createEvent('handoff.requested', 'Conversation', payload.conversationId, payload, { correlationId });
}

export function createHandoffCompletedEvent(
  payload: HandoffCompletedPayload,
  correlationId?: string
): HandoffCompletedEvent {
  return createEvent('handoff.completed', 'Conversation', payload.conversationId, payload, { correlationId });
}

export function createSecretaryInvocationEvent(
  payload: SecretaryInvocationPayload,
  correlationId?: string
): SecretaryInvocationEvent {
  return createEvent('secretary.invocation', 'Conversation', payload.conversationId, payload, { correlationId });
}
