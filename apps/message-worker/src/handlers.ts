import { createAlert } from '@cvg/alerts';
import { executeInboundSecretaryInvocation } from '@cvg/chat';
import type { EventEnvelope } from '@cvg/events';
import { WORKER_CONSUMER_ID, type WorkerLogger } from './contract';
import { PermanentEventError, classifyHandlerError } from './errors';

/** Desfecho do efeito persistente de um handler, para log/observabilidade. */
export interface HandlerEffectReport {
  effectType: string;
  /** Presente nos efeitos de alerta (PROD-09). */
  alertId?: string;
  deduplicated: boolean;
  /** PROD-10: identidade/estado da invocação assíncrona da Secretary. */
  invocationId?: string;
  status?: string;
  outboundMessageId?: string;
}

export const WORKER_EFFECTS = {
  HANDOFF_ALERT: 'alert:handoff.completed',
  SECRETARY_FAILURE_ALERT: 'alert:secretary.invocation',
  SECRETARY_INVOKE: 'secretary:invoke',
} as const;

export type WorkerEventHandler = (event: EventEnvelope) => Promise<HandlerEffectReport | null>;

function payloadOf(event: EventEnvelope): Record<string, unknown> {
  const payload = event.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new PermanentEventError('MALFORMED_PAYLOAD', 'malformed payload: expected object');
  }
  return payload as Record<string, unknown>;
}

function requireString(payload: Record<string, unknown>, field: string): string {
  const value = payload[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new PermanentEventError('MALFORMED_PAYLOAD', `malformed payload: missing ${field}`);
  }
  return value;
}

function requireHandler(value: unknown, field: string): 'bot' | 'human' {
  if (value !== 'bot' && value !== 'human') {
    throw new PermanentEventError('MALFORMED_PAYLOAD', `malformed payload: invalid ${field}`);
  }
  return value;
}

async function applyAlertEffect(params: {
  event: EventEnvelope;
  effectType: string;
  conversationId: string;
  type: string;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  triggeredBy?: string;
  metadata: Record<string, unknown>;
}): Promise<HandlerEffectReport> {
  const result = await createAlert(
    {
      conversationId: params.conversationId,
      type: params.type,
      title: params.title,
      message: params.message,
      severity: params.severity,
      triggeredBy: params.triggeredBy,
      metadata: params.metadata,
    },
    {
      idempotency: {
        eventId: params.event.event_id,
        consumerId: WORKER_CONSUMER_ID,
        effectType: params.effectType,
      },
    },
  );

  if (result.isErr()) {
    // Propaga a falha para o processador: Err NUNCA vira ACK.
    throw classifyHandlerError(result.error);
  }

  return {
    effectType: params.effectType,
    alertId: result.value.id,
    deduplicated: result.value.deduplicated === true,
  };
}

export function createHandlers(logger: WorkerLogger): Record<string, WorkerEventHandler> {
  async function handleHandoffCompleted(event: EventEnvelope): Promise<HandlerEffectReport | null> {
    const payload = payloadOf(event);
    const conversationId = requireString(payload, 'conversationId');
    const previousHandler = requireHandler(payload.previousHandler, 'previousHandler');
    const newHandler = requireHandler(payload.newHandler, 'newHandler');
    const reason = payload.reason;
    if (reason !== undefined && typeof reason !== 'string') {
      throw new PermanentEventError('MALFORMED_PAYLOAD', 'malformed payload: invalid reason');
    }

    if (newHandler !== 'human' || !reason) {
      return null;
    }

    return applyAlertEffect({
      event,
      effectType: WORKER_EFFECTS.HANDOFF_ALERT,
      conversationId,
      type: 'handoff',
      title: 'Conversa transferida para atendimento humano',
      message: `Motivo: ${reason}`,
      severity: 'info',
      triggeredBy: typeof payload.triggeredBy === 'string' ? payload.triggeredBy : undefined,
      metadata: {
        previousHandler,
        newHandler,
        eventId: event.event_id,
      },
    });
  }

  async function handleSecretaryInvocation(event: EventEnvelope): Promise<HandlerEffectReport | null> {
    const payload = payloadOf(event);
    const conversationId = requireString(payload, 'conversationId');
    const status = payload.status;
    if (status !== 'requested' && status !== 'success' && status !== 'failed') {
      throw new PermanentEventError('MALFORMED_PAYLOAD', 'malformed payload: invalid status');
    }
    const action = requireString(payload, 'action');
    const errorMessage = payload.errorMessage;

    if (status !== 'failed' || typeof errorMessage !== 'string' || errorMessage.length === 0) {
      return null;
    }

    // Log sem conteúdo do payload (PII): só o suficiente para operar.
    logger.warn({
      msg: '[Worker] Secretary invocation failed',
      event_id: event.event_id,
      correlation_id: event.correlation_id,
      action,
      status,
    });

    return applyAlertEffect({
      event,
      effectType: WORKER_EFFECTS.SECRETARY_FAILURE_ALERT,
      conversationId,
      type: 'system',
      title: 'Falha na chamada à Secretary',
      message: `Action: ${action}, Erro: ${errorMessage}`,
      severity: 'warning',
      metadata: {
        eventId: event.event_id,
        action,
      },
    });
  }

  async function handleMessagePersisted(event: EventEnvelope): Promise<HandlerEffectReport | null> {
    const payload = payloadOf(event);
    const conversationId = requireString(payload, 'conversationId');
    const direction = payload.direction;
    if (direction !== 'inbound' && direction !== 'outbound') {
      throw new PermanentEventError('MALFORMED_PAYLOAD', 'malformed payload: invalid direction');
    }
    if (direction === 'outbound') {
      // Efeito outbound é do produtor (C05); aqui só observabilidade.
      logger.info({
        msg: '[Worker] message.persisted observed',
        event_id: event.event_id,
        correlation_id: event.correlation_id,
        direction,
      });
      return null;
    }

    const messageId = requireString(payload, 'messageId');

    // PROD-10/BE13 — o evento `message.persisted` do inbound é a INTENÇÃO
    // DURÁVEL da invocação da Secretary (commitado na mesma transação da
    // mensagem). O handler executa a invocação sob lease; falha não ambígua
    // relançada vira retry/backoff e, esgotado o orçamento, DLQ com causa.
    // Resultado ambíguo é reconhecido como `unknown`, sem retry cego. Nenhum
    // log leva conteúdo/telefone (PII).
    logger.info({
      msg: '[Worker] Executing durable Secretary invocation for persisted inbound',
      event_id: event.event_id,
      correlation_id: event.correlation_id,
      conversation_id: conversationId,
      message_id: messageId,
    });

    const result = await executeInboundSecretaryInvocation({
      eventId: event.event_id,
      correlationId: event.correlation_id,
      conversationId,
      messageId,
      consumerId: WORKER_CONSUMER_ID,
    });

    return {
      effectType: WORKER_EFFECTS.SECRETARY_INVOKE,
      invocationId: result.invocationId,
      status: result.status,
      deduplicated: result.deduplicated,
      outboundMessageId: result.outboundMessageId,
    };
  }

  return {
    'handoff.completed': handleHandoffCompleted,
    'secretary.invocation': handleSecretaryInvocation,
    'message.persisted': handleMessagePersisted,
  };
}
