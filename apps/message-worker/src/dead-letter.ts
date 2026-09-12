import type { EventEnvelope, DeadLetterEntry, DeadLetterFailureContext } from '@cvg/events';
import { deadLetterStore, persistentDeadLetterStore } from '@cvg/events';

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
  const entry = deadLetterStore.add({
    eventType: params.event.event_type,
    eventId: params.event.event_id,
    payload: params.event.payload,
    error: params.error,
    retryCount: params.retryCount,
    handlerName: params.handlerName,
    sourceEvent: params.event,
    failureContext: buildFailureContext(params),
  });

  // Durabilidade (Final-1): espelha no PostgreSQL. Best-effort e nunca
  // bloqueia o worker — a entrada em memória já foi registrada acima.
  void persistentDeadLetterStore
    .persist({
      originalEventId: params.event.event_id,
      consumerId: 'worker',
      eventType: params.event.event_type,
      payload: params.event,
      errorCode: 'WORKER_TERMINAL',
      errorMessage: params.error,
      attemptCount: params.retryCount,
    })
    .catch((error) => {
      console.error(
        JSON.stringify({
          msg: '[Worker] Failed to persist dead-letter to PostgreSQL',
          event_id: params.event.event_id,
          error: error instanceof Error ? error.message : String(error),
          level: 'error',
        }),
      );
    });

  return entry;
}
