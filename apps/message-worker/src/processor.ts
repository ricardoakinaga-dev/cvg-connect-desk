import {
  calculateNextDelay,
  createRetryContext,
  isPermanentError,
  shouldRetry,
  type AckResult,
  type EventEnvelope,
  type LeaseToken,
  type NackResult,
  type RetryConfig,
} from '@cvg/events';
import { WORKER_EVENT_CONTRACT, type WorkerLogger } from './contract';
import { describeError, permanentErrorCodeOf, redactErrorForLog } from './errors';
import type { HandlerEffectReport, WorkerEventHandler } from './handlers';

export type ProcessOutcomeKind = 'acked' | 'stale' | 'not_found' | 'retry' | 'dead-letter';

export interface WorkerProcessorPorts {
  ack(input: { eventId: string; owner: string; generation: number }): Promise<AckResult>;
  nack(input: {
    eventId: string;
    owner: string;
    generation: number;
    error: string;
    errorCode?: string;
    permanent?: boolean;
  }): Promise<NackResult>;
}

export interface ProcessEventOutcome {
  eventId: string;
  eventType: string;
  outcome: ProcessOutcomeKind;
  attempts: number;
  effect?: HandlerEffectReport;
  error?: string;
  errorCode?: string;
}

export interface DeadLetterHandoff {
  event: EventEnvelope;
  error: string;
  attempts: number;
  errorCode?: string;
  handlerName: string;
}

export interface WorkerProcessorOptions {
  handlers: Record<string, WorkerEventHandler>;
  ports: WorkerProcessorPorts;
  retryConfig: RetryConfig;
  logger: WorkerLogger;
  sleep?: (delayMs: number) => Promise<void>;
  /**
   * Gancho de injeção de falha ANTES do efeito (crash entre o claim/commit do
   * inbound e a invocação, usado pela prova de retomada do PROD-10). Só é
   * acionado por env dedicada no bootstrap; em produção fica ausente.
   */
  onBeforeEffect?: (event: EventEnvelope) => void | Promise<void>;
  /**
   * Gancho de injeção de falha APÓS o efeito e ANTES do ACK (usado para provar
   * crash/retomada com processo real). Só é acionado por env dedicada no
   * bootstrap; em produção fica ausente.
   */
  onAfterEffect?: (event: EventEnvelope) => void | Promise<void>;
  /** Espelho operacional em memória quando a DLQ durável é gravada pelo NACK. */
  onDeadLetter?: (handoff: DeadLetterHandoff) => void | Promise<void>;
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/**
 * Processa UM evento sob lease com semântica PROD-09/C04:
 *
 * - `Err`/throw do handler NUNCA resulta em ACK: falha transitória entra no
 *   retry em processo (backoff exponencial) e, esgotado o orçamento, NACK no
 *   lease; falha permanente (poison/malformed/versão não suportada) NACK
 *   imediato com `permanent: true`;
 * - o NACK grava a DLQ durável com envelope íntegro e causa;
 * - o resultado do ACK é OBSERVADO: `stale`/`not_found` não são relatados como
 *   concluído (lease fencing owner+generation);
 * - logs só carregam identificadores/estado — nunca conteúdo do payload.
 */
export function createEventProcessor(options: WorkerProcessorOptions) {
  const { handlers, ports, retryConfig, logger } = options;
  const sleep = options.sleep ?? defaultSleep;

  return async function processEvent(
    event: EventEnvelope,
    lease: LeaseToken,
  ): Promise<ProcessEventOutcome> {
    const base = {
      event_type: event.event_type,
      event_id: event.event_id,
      event_version: event.event_version,
      correlation_id: event.correlation_id,
      causation_id: event.causation_id,
    };

    const handler = handlers[event.event_type];
    const handlerName = handler?.name || event.event_type;

    async function terminalFailure(params: {
      attempts: number;
      reason: string;
      errorCode?: string;
      permanent: boolean;
    }): Promise<ProcessEventOutcome> {
      const nackResult = await ports.nack({
        eventId: lease.eventId,
        owner: lease.owner,
        generation: lease.generation,
        error: params.reason,
        errorCode: params.errorCode,
        permanent: params.permanent,
      });

      const record = {
        ...base,
        handler: handlerName,
        attempts: params.attempts,
        nack_result: nackResult,
        retry_decision: nackResult === 'dead-letter' ? 'dead-letter' : nackResult,
        failure_stage: 'worker-terminal',
        error_code: params.errorCode ?? 'NACK_MAX_RETRIES',
        // Log redigido; o registro durável (DLQ/ack) guarda a causa completa.
        error: redactErrorForLog(params.reason),
      };

      if (nackResult === 'dead-letter') {
        logger.error({ msg: '[Worker] Event dead-lettered (durable)', ...record });
        await options.onDeadLetter?.({
          event,
          error: params.reason,
          attempts: params.attempts,
          errorCode: params.errorCode,
          handlerName,
        });
      } else {
        logger.warn({
          msg:
            nackResult === 'retry'
              ? '[Worker] Event failure recorded; consumer retry pending'
              : '[Worker] NACK rejected (lease fenced or unknown)',
          ...record,
        });
      }

      return {
        eventId: lease.eventId,
        eventType: event.event_type,
        outcome: nackResult,
        attempts: params.attempts,
        error: params.reason,
        errorCode: params.errorCode,
      };
    }

    if (!handler) {
      // Defensivo: o claim do worker já filtra por WORKER_EVENT_CONTRACT.
      return terminalFailure({
        attempts: 0,
        reason: `unsupported event type: ${event.event_type}`,
        errorCode: 'UNSUPPORTED_EVENT_TYPE',
        permanent: true,
      });
    }

    const maxVersion = WORKER_EVENT_CONTRACT[event.event_type]?.maxVersion;
    const eventVersion = event.event_version ?? 1;
    if (maxVersion !== undefined && eventVersion > maxVersion) {
      return terminalFailure({
        attempts: 0,
        reason: `unsupported event version ${eventVersion} (max ${maxVersion})`,
        errorCode: 'UNSUPPORTED_EVENT_VERSION',
        permanent: true,
      });
    }

    let attempt = 0;
    logger.info({ msg: '[Worker] Processing event', ...base, handler: handlerName });

    while (true) {
      try {
        await options.onBeforeEffect?.(event);
        const effect = await handler(event);
        await options.onAfterEffect?.(event);

        const ackResult = await ports.ack({
          eventId: lease.eventId,
          owner: lease.owner,
          generation: lease.generation,
        });

        if (ackResult === 'acked') {
          logger.info({
            msg: '[Worker] Successfully processed event',
            ...base,
            handler: handlerName,
            attempts: attempt + 1,
            ack_result: ackResult,
            effect_type: effect?.effectType ?? null,
            effect_status: effect ? (effect.deduplicated ? 'deduplicated' : 'applied') : 'none',
            recovered: effect?.deduplicated === true,
          });
        } else {
          logger.warn({
            msg: '[Worker] ACK rejected (lease fenced or unknown); event not completed',
            ...base,
            handler: handlerName,
            attempts: attempt + 1,
            ack_result: ackResult,
            outcome: ackResult,
          });
        }

        return {
          eventId: lease.eventId,
          eventType: event.event_type,
          outcome: ackResult,
          attempts: attempt + 1,
          effect: effect ?? undefined,
        };
      } catch (error) {
        attempt += 1;
        const err = error as Error;
        const reason = describeError(err);
        const retryable = shouldRetry(
          createRetryContext(event, event.event_type, attempt, err),
          retryConfig,
        );

        if (!retryable) {
          const permanent = isPermanentError(err);
          return terminalFailure({
            attempts: attempt,
            reason,
            errorCode:
              permanentErrorCodeOf(err) ?? (permanent ? 'HANDLER_PERMANENT' : 'RETRY_BUDGET_EXHAUSTED'),
            permanent,
          });
        }

        const delay = calculateNextDelay(retryConfig, attempt);
        logger.warn({
          msg: '[Worker] Retrying event after error',
          ...base,
          handler: handlerName,
          attempt,
          max_retries: retryConfig.maxRetries,
          delay_ms: delay,
          error: redactErrorForLog(reason),
          retry_decision: 'retry',
          failure_stage: 'handler',
        });
        await sleep(delay);
      }
    }
  };
}
