import type { EventEnvelope, DeadLetterEntry, DeadLetterFailureContext } from '@cvg/events';
import { deadLetterStore } from '@cvg/events';
import { redactErrorForLog } from './errors';

function buildFailureContext(params: {
  event: EventEnvelope;
  error: string;
  retryCount: number;
  handlerName: string;
  errorCode?: string;
}): DeadLetterFailureContext {
  return {
    stage: 'worker-terminal',
    decision: 'dead-letter',
    handlerName: params.handlerName,
    eventType: params.event.event_type,
    eventId: params.event.event_id,
    retryCount: params.retryCount,
    retryable: params.errorCode !== 'HANDLER_PERMANENT' && params.errorCode !== 'MALFORMED_PAYLOAD',
    reason: params.errorCode ? `[${params.errorCode}] ${params.error}` : params.error,
    eventVersion: params.event.event_version,
    correlationId: params.event.correlation_id,
    causationId: params.event.causation_id,
  };
}

/**
 * Espelho em memória do dead-letter terminal do worker.
 *
 * A durabilidade é garantida pelo `nack` do lease (packages/events): ele grava
 * `dead_letter_events` com o ENVELOPE íntegro e a causa na MESMA transação do
 * incremento de retry. Este espelho não deve engolir erro de persistência nem
 * duplicar a escrita durável — por isso não chama o store persistente. O erro
 * vai REDIGIDO (sem `params:` do driver) porque o store emite log; o registro
 * durável mantém a causa completa.
 */
export function recordWorkerDeadLetter(params: {
  event: EventEnvelope;
  error: string;
  retryCount: number;
  handlerName: string;
  errorCode?: string;
}): DeadLetterEntry {
  const loggedError = redactErrorForLog(params.error);
  return deadLetterStore.add({
    eventType: params.event.event_type,
    eventId: params.event.event_id,
    payload: params.event.payload,
    error: loggedError,
    retryCount: params.retryCount,
    handlerName: params.handlerName,
    sourceEvent: params.event,
    failureContext: buildFailureContext({ ...params, error: loggedError }),
  });
}
