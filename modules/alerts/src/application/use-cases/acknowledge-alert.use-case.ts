import { db } from '@cvg/database';
import { alertRepository } from '../../infrastructure/repositories/alert.repository';
import { insertOperationalAudit } from '../../infrastructure/audit';
import { ok, err, type Result, NotFoundError, BadRequestError, ConflictError } from '@cvg/shared';
import { persistOutboxEventIntent, publishRealtimeHintsAfterCommit, createEvent, type EventEnvelope } from '@cvg/events';

export interface AcknowledgeAlertInput {
  alertId: string;
  /** Principal autenticado (fonte de verdade do autor). */
  actorId?: string;
  /** @deprecated legado — deve coincidir com o principal quando informado. */
  acknowledgedBy?: string;
  /** @deprecated legado — alias de actorId. */
  userId?: string;
  correlationId?: string;
  /** Repetir o reconhecimento já aplicado é idempotente. */
  expectedStatus?: 'active' | 'acknowledged' | 'resolved';
}

export interface AcknowledgeAlertOutput {
  id: string;
  status: string;
  acknowledgedBy: string;
  acknowledgedAt: Date;
  deduplicated: boolean;
}

/**
 * PROD-18/AC1/AC3: reconhecer alerta é transacional (alerta + histórico +
 * auditoria + outbox no MESMO tx) e CAS (`active` → `acknowledged`). Ação
 * repetida é idempotente; corrida perdida ou alerta resolvido responde 409.
 */
export async function acknowledgeAlert(input: AcknowledgeAlertInput): Promise<Result<AcknowledgeAlertOutput>> {
  try {
    const actorId = input.actorId ?? input.userId ?? input.acknowledgedBy;
    if (!actorId) {
      return err(new BadRequestError('Authenticated user is required'));
    }
    if (input.acknowledgedBy && input.userId && input.acknowledgedBy !== input.userId) {
      return err(new BadRequestError('acknowledgedBy must match the authenticated user'));
    }

    const events: EventEnvelope[] = [];
    const outcome = await db.transaction(async (tx) => {
      // Estado lido DENTRO do tx e travado: o `oldStatus` do histórico/auditoria
      // reflete a linha real mesmo sob corrida ack/resolve (SA-017/AC2).
      const existing = await alertRepository.findByIdForUpdate(input.alertId, tx);
      if (!existing) {
        throw new NotFoundError('Alert not found');
      }

      if (existing.status === 'acknowledged') {
        return { alert: existing, deduplicated: true as const };
      }
      if (existing.status === 'resolved') {
        throw new ConflictError('Cannot acknowledge a resolved alert', 'ALERT_STATE_CONFLICT');
      }
      if (input.expectedStatus && existing.status !== input.expectedStatus) {
        throw new ConflictError(
          `Alert status ${existing.status} differs from expected ${input.expectedStatus}`,
          'ALERT_STATE_CONFLICT',
        );
      }

      const oldStatus = existing.status;
      const acknowledged = await alertRepository.acknowledgeIfActive(input.alertId, actorId, tx);
      if (!acknowledged) {
        throw new ConflictError(
          'Alerta alterado por outro operador; releia o estado antes de repetir',
          'ALERT_STATE_CONFLICT',
        );
      }

      await alertRepository.addEvent(acknowledged.id, 'acknowledged', oldStatus, 'acknowledged', actorId, tx);

      await insertOperationalAudit(tx, {
        userId: actorId,
        action: 'alert.acknowledged',
        entityType: 'alert',
        entityId: acknowledged.id,
        oldValue: { status: oldStatus },
        newValue: { status: 'acknowledged' },
        metadata: { acknowledgedBy: actorId },
        correlationId: input.correlationId,
      });

      const event = createEvent(
        'alert.acknowledged',
        'Alert',
        acknowledged.id,
        {
          alertId: acknowledged.id,
          conversationId: acknowledged.conversationId,
          taskId: acknowledged.taskId,
          acknowledgedBy: actorId,
        },
        { correlationId: input.correlationId },
      );
      await persistOutboxEventIntent(tx, event);
      events.push(event);

      return { alert: acknowledged, deduplicated: false as const };
    });

    if (!outcome.deduplicated) {
      await publishRealtimeHintsAfterCommit(events);
    }

    return ok({
      id: outcome.alert.id,
      status: outcome.alert.status,
      acknowledgedBy: outcome.alert.acknowledgedBy ?? actorId,
      acknowledgedAt: outcome.alert.acknowledgedAt ?? outcome.alert.updatedAt,
      deduplicated: outcome.deduplicated,
    });
  } catch (error) {
    if (error instanceof ConflictError || error instanceof NotFoundError) {
      return err(error);
    }
    return err(error as Error);
  }
}
