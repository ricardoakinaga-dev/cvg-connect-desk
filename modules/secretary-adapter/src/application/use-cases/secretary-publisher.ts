import { databaseEventPublisher, createSecretaryInvocationEvent, createHandoffRequestedEvent, createHandoffCompletedEvent } from '@cvg/events';

export async function publishSecretaryInvocation(payload: {
  conversationId: string;
  messageId?: string;
  invocationId: string;
  action: string;
  status: 'requested' | 'success' | 'failed';
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}) {
  const event = createSecretaryInvocationEvent({
    conversationId: payload.conversationId,
    messageId: payload.messageId,
    invocationId: payload.invocationId,
    action: payload.action,
    status: payload.status,
    errorMessage: payload.errorMessage,
    metadata: payload.metadata,
  });
  await databaseEventPublisher.publish(event);
}

export async function publishHandoffRequested(payload: {
  conversationId: string;
  previousHandler: 'bot' | 'human';
  newHandler: 'bot' | 'human';
  reason: string;
  triggeredBy?: string;
  metadata?: Record<string, unknown>;
}) {
  const event = createHandoffRequestedEvent({
    conversationId: payload.conversationId,
    previousHandler: payload.previousHandler,
    newHandler: payload.newHandler,
    reason: payload.reason,
    triggeredBy: payload.triggeredBy,
    metadata: payload.metadata,
  });
  await databaseEventPublisher.publish(event);
}

export async function publishHandoffCompleted(payload: {
  conversationId: string;
  previousHandler: 'bot' | 'human';
  newHandler: 'bot' | 'human';
  reason: string;
  triggeredBy?: string;
}) {
  const event = createHandoffCompletedEvent({
    conversationId: payload.conversationId,
    previousHandler: payload.previousHandler,
    newHandler: payload.newHandler,
    reason: payload.reason,
    triggeredBy: payload.triggeredBy,
    completedAt: new Date().toISOString(),
  });
  await databaseEventPublisher.publish(event);
}
