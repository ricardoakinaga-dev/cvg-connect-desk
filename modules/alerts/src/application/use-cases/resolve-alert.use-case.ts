import { db } from '@cvg/database';
import { alertRepository } from '../../infrastructure/repositories/alert.repository';
import { insertOperationalAudit } from '../../infrastructure/audit';
import { ok, err, type Result, NotFoundError, BadRequestError, ConflictError } from '@cvg/shared';
import { persistOutboxEventIntent, publishRealtimeHintsAfterCommit, createEvent, type EventEnvelope } from '@cvg/events';

export interface ResolveAlertInput {
  alertId: string;
  /** Principal autenticado (fonte de verdade do autor). */
  actorId?: string;
  /** @deprecated legado — deve coincidir com o principal quando informado. */
  resolvedBy?: string;
  /** @deprecated legado — alias de actorId. */
  userId?: string;
  correlationId?: string;
  /** CAS opcional sobre o estado lido pelo operador. */
  expectedStatus?: 'active' | 'acknowledged';
}

export interface ResolveAlertOutput {
  id: string;
  status: string;
  resolvedBy: string;
  resolvedAt: Date;
  deduplicated: boolean;
}

/**
 * PROD-18/AC1/AC3: resolver alerta é transacional (alerta + histórico +
 * auditoria + outbox no MESMO tx) e CAS (`active|acknowledged` → `resolved`).
 * Ação repetida é idempotente; corrida perdida responde 409.
 */
export async function resolveAlert(input: ResolveAlertInput): Promise<Result<ResolveAlertOutput>> {
  try {
    const actorId = input.actorId ?? input.userId ?? input.resolvedBy;
    if (!actorId) {
      return err(new BadRequestError('Authenticated user is required'));
    }
    if (input.resolvedBy && input.userId && input.resolvedBy !== input.userId) {
      return err(new BadRequestError('resolvedBy must match the authenticated user'));
    }

    const events: EventEnvelope[] = [];
    const outcome = await db.transaction(async (tx) => {
      // Estado travado dentro do tx: `oldStatus` correto sob corrida.
      const existing = await alertRepository.findByIdForUpdate(input.alertId, tx);
      if (!existing) {
        throw new NotFoundError('Alert not found');
      }

      if (existing.status === 'resolved') {
        return { alert: existing, deduplicated: true as const };
      }
      if (input.expectedStatus && existing.status !== input.expectedStatus) {
        throw new ConflictError(
          `Alert status ${existing.status} differs from expected ${input.expectedStatus}`,
          'ALERT_STATE_CONFLICT',
        );
      }

      const oldStatus = existing.status;
      const resolved = await alertRepository.resolveIfNotResolved(input.alertId, actorId, tx);
      if (!resolved) {
        throw new ConflictError(
          'Alerta alterado por outro operador; releia o estado antes de repetir',
          'ALERT_STATE_CONFLICT',
        );
      }

      await alertRepository.addEvent(resolved.id, 'resolved', oldStatus, 'resolved', actorId, tx);

      await insertOperationalAudit(tx, {
        userId: actorId,
        action: 'alert.resolved',
        entityType: 'alert',
        entityId: resolved.id,
        oldValue: { status: oldStatus },
        newValue: { status: 'resolved' },
        metadata: { resolvedBy: actorId },
        correlationId: input.correlationId,
      });

      const event = createEvent(
        'alert.resolved',
        'Alert',
        resolved.id,
        {
          alertId: resolved.id,
          conversationId: resolved.conversationId,
          taskId: resolved.taskId,
          previousStatus: oldStatus,
          resolvedBy: actorId,
        },
        { correlationId: input.correlationId },
      );
      await persistOutboxEventIntent(tx, event);
      events.push(event);

      return { alert: resolved, deduplicated: false as const };
    });

    if (!outcome.deduplicated) {
      await publishRealtimeHintsAfterCommit(events);
    }

    return ok({
      id: outcome.alert.id,
      status: outcome.alert.status,
      resolvedBy: outcome.alert.resolvedBy ?? actorId,
      resolvedAt: outcome.alert.resolvedAt ?? outcome.alert.updatedAt,
      deduplicated: outcome.deduplicated,
    });
  } catch (error) {
    if (error instanceof ConflictError || error instanceof NotFoundError) {
      return err(error);
    }
    return err(error as Error);
  }
}
