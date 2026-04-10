import type { EventEnvelope, DeadLetterEntry, DeadLetterFailureContext } from '@cvg/events';
import { deadLetterStore } from '@cvg/events';

function buildFailureContext(params: {
  event: EventEnvelope;
  error: string;
  retryCount: number;
  handlerName: string;
}): DeadLetterFailureContext {
  return {
    stage: 'worker-terminal',
    decision: 'dead-letter',
    handlerName: params.handlerName,
    eventType: params.event.event_type,
    eventId: params.event.event_id,
    retryCount: params.retryCount,
    retryable: true,
    reason: params.error,
    eventVersion: params.event.event_version,
    correlationId: params.event.correlation_id,
    causationId: params.event.causation_id,
  };
}

export function recordWorkerDeadLetter(params: {
  event: EventEnvelope;
  error: string;
  retryCount: number;
  handlerName: string;
}): DeadLetterEntry {
  return deadLetterStore.add({
    eventType: params.event.event_type,
    eventId: params.event.event_id,
    payload: params.event.payload,
    error: params.error,
    retryCount: params.retryCount,
    handlerName: params.handlerName,
    sourceEvent: params.event,
    failureContext: buildFailureContext(params),
  });
}
