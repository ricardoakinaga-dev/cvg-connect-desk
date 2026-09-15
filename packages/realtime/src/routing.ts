import type { EventEnvelope } from '@cvg/events';
import type { RealtimeProjection } from './types';
import {
  conversationChannel,
  correlationChannel,
  sectorChannel,
  userChannel,
} from './channels';

export type DeliveryResource =
  | { kind: 'conversation'; conversationId: string }
  | { kind: 'sector'; sectorId: string }
  | { kind: 'user'; userId: string };

export interface DeliveryTarget {
  channel: string;
  resource: DeliveryResource;
}

export interface DeliveryPlan {
  /** Conteúdo autorizado por destinatário (canal canônico + recurso julgado). */
  contentTargets: DeliveryTarget[];
  /** Sinal sanitizado para `global` (nunca conteúdo). */
  globalSignal: RealtimeProjection | null;
  /** Sinal sanitizado para `correlation:<id>` (nunca conteúdo). */
  correlationSignal: RealtimeProjection | null;
}

type Payload = Record<string, unknown>;

function payloadOf(projection: RealtimeProjection): Payload {
  return (projection.payload ?? {}) as Payload;
}

function stringField(payload: Payload, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.length > 0 && value.length <= 128) {
      return value;
    }
  }
  return undefined;
}

/**
 * Projeção sanitizada (D-C02-5): identidade do agregado + tipo do evento.
 * O payload de conteúdo é removido integralmente para canais de sinal.
 */
export function sanitizeProjection(projection: RealtimeProjection): RealtimeProjection {
  return {
    type: projection.type,
    aggregateType: projection.aggregateType,
    aggregateId: projection.aggregateId,
    occurredAt: projection.occurredAt,
    payload: {},
    ...(projection.correlationId ? { correlationId: projection.correlationId } : {}),
  };
}

function pushTarget(targets: DeliveryTarget[], target: DeliveryTarget): void {
  if (!targets.some((existing) => existing.channel === target.channel)) {
    targets.push(target);
  }
}

/**
 * Roteia uma projeção para canais canônicos. Conteúdo nunca é roteado para
 * `global` nem para `correlation:<id>`; canais legados de agregado deixam de
 * existir como canais de conteúdo.
 */
export function planDelivery(event: EventEnvelope, projection: RealtimeProjection): DeliveryPlan {
  // Metadados de roteamento vêm do payload do EVENTO (fonte interna confiável);
  // a projeção é shape de exibição e pode omitir campos como sectorId.
  const payload: Payload = {
    ...payloadOf(projection),
    ...((event.payload ?? {}) as Payload),
  };
  const targets: DeliveryTarget[] = [];

  const conversationId = stringField(payload, 'conversationId', 'conversation_id');
  const sectorId = stringField(payload, 'sectorId', 'sector_id');

  switch (projection.type) {
    case 'conversation.created': {
      const id = stringField(payload, 'id') ?? projection.aggregateId;
      if (id) {
        pushTarget(targets, { channel: conversationChannel(id), resource: { kind: 'conversation', conversationId: id } });
      }
      break;
    }
    case 'conversation.status.changed':
    case 'handoff.completed': {
      const id = conversationId ?? projection.aggregateId;
      if (id) {
        pushTarget(targets, { channel: conversationChannel(id), resource: { kind: 'conversation', conversationId: id } });
      }
      for (const userId of [
        stringField(payload, 'previousAssignedTo'),
        stringField(payload, 'newAssignedTo'),
        stringField(payload, 'triggeredBy'),
      ]) {
        if (userId) {
          pushTarget(targets, { channel: userChannel(userId), resource: { kind: 'user', userId } });
        }
      }
      break;
    }
    case 'message.persisted': {
      if (conversationId) {
        pushTarget(targets, {
          channel: conversationChannel(conversationId),
          resource: { kind: 'conversation', conversationId },
        });
      }
      const recipient = stringField(payload, 'assignedTo', 'recipientUserId');
      if (recipient) {
        pushTarget(targets, { channel: userChannel(recipient), resource: { kind: 'user', userId: recipient } });
      }
      break;
    }
    case 'task.created':
    case 'task.updated':
    case 'task.status.changed':
    case 'alert.created':
    case 'alert.updated':
    case 'alert.acknowledged':
    case 'alert.resolved': {
      if (conversationId) {
        pushTarget(targets, {
          channel: conversationChannel(conversationId),
          resource: { kind: 'conversation', conversationId },
        });
      }
      const userId = stringField(payload, 'assignedTo', 'userId', 'triggeredBy');
      if (userId) {
        pushTarget(targets, { channel: userChannel(userId), resource: { kind: 'user', userId } });
      }
      break;
    }
    default:
      break;
  }

  if (sectorId) {
    pushTarget(targets, { channel: sectorChannel(sectorId), resource: { kind: 'sector', sectorId } });
  }

  if (event.aggregate_type === 'Conversation' && projection.aggregateId) {
    pushTarget(targets, {
      channel: conversationChannel(projection.aggregateId),
      resource: { kind: 'conversation', conversationId: projection.aggregateId },
    });
  }

  const sanitized = sanitizeProjection(projection);
  return {
    contentTargets: targets,
    globalSignal: sanitized,
    correlationSignal: projection.correlationId ? sanitized : null,
  };
}

export function correlationSignalChannel(projection: RealtimeProjection): string | null {
  return projection.correlationId ? correlationChannel(projection.correlationId) : null;
}
