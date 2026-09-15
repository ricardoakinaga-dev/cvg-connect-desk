import { db, schema } from '@cvg/database';
import { and, eq } from 'drizzle-orm';
import { alertRepository, type Alert } from '../../infrastructure/repositories/alert.repository';
import { insertOperationalAudit } from '../../infrastructure/audit';
import { ok, err, type Result, BadRequestError } from '@cvg/shared';
import { persistOutboxEventIntent, publishRealtimeHintsAfterCommit, createEvent, type EventEnvelope } from '@cvg/events';

export type AlertType = 'message' | 'deadline' | 'assignment' | 'system' | 'handoff';

export interface CreateAlertInput {
  conversationId?: string;
  taskId?: string;
  type: string;
  title: string;
  message?: string;
  severity?: 'info' | 'warning' | 'error' | 'critical';
  triggeredBy?: string;
  metadata?: Record<string, unknown>;
  userId?: string; // Para auditoria
  correlationId?: string;
}

/**
 * Chave durável de efeito (PROD-09/C04): replay do mesmo
 * `(eventId, consumerId, effectType)` retorna o MESMO alerta, sem recriar
 * alerta/evento de alerta nem repetir a auditoria.
 */
export interface AlertEffectKey {
  eventId: string;
  consumerId: string;
  effectType: string;
}

export interface CreateAlertOptions {
  /** Quando presente, aplica o efeito sob a chave durável (transacional). */
  idempotency?: AlertEffectKey;
}

export interface CreateAlertOutput {
  id: string;
  title: string;
  type: string;
  severity: string;
  status: string;
  createdAt: Date;
  /** true quando o efeito já havia sido aplicado (replay/dedup). */
  deduplicated?: boolean;
}

function toOutput(alert: Alert, deduplicated?: boolean): CreateAlertOutput {
  return {
    id: alert.id,
    title: alert.title,
    type: alert.type,
    severity: alert.severity,
    status: alert.status,
    createdAt: alert.createdAt,
    ...(deduplicated === undefined ? {} : { deduplicated }),
  };
}

function toRow(input: CreateAlertInput) {
  return {
    conversationId: input.conversationId,
    taskId: input.taskId,
    type: input.type as AlertType,
    title: input.title,
    message: input.message,
    severity: input.severity || 'info',
    status: 'active' as const,
    triggeredBy: input.triggeredBy,
    metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
  };
}

function alertCreatedEvent(alert: Alert, input: CreateAlertInput): EventEnvelope {
  return createEvent(
    'alert.created',
    'Alert',
    alert.id,
    {
      alertId: alert.id,
      conversationId: alert.conversationId,
      taskId: alert.taskId,
      type: alert.type,
      severity: alert.severity,
      triggeredBy: input.triggeredBy,
    },
    { correlationId: input.correlationId },
  );
}

/**
 * Efeito de alerta sob `idempotency` (PROD-09): em UMA transação reserva o
 * recibo, grava alerta + evento + auditoria + intenção outbox e ancora o
 * resultado. Replay retorna o alerta ancorado, sem novas escritas.
 */
async function createAlertIdempotent(
  input: CreateAlertInput,
  key: AlertEffectKey,
): Promise<Result<CreateAlertOutput>> {
  const outcome = await db.transaction(async (tx) => {
    const [claimed] = await tx
      .insert(schema.workerEffectReceipts)
      .values({ eventId: key.eventId, consumerId: key.consumerId, effectType: key.effectType })
      .onConflictDoNothing({
        target: [
          schema.workerEffectReceipts.eventId,
          schema.workerEffectReceipts.consumerId,
          schema.workerEffectReceipts.effectType,
        ],
      })
      .returning({ id: schema.workerEffectReceipts.id });

    if (!claimed) {
      const [receipt] = await tx
        .select({ resultRef: schema.workerEffectReceipts.resultRef })
        .from(schema.workerEffectReceipts)
        .where(
          and(
            eq(schema.workerEffectReceipts.eventId, key.eventId),
            eq(schema.workerEffectReceipts.consumerId, key.consumerId),
            eq(schema.workerEffectReceipts.effectType, key.effectType),
          ),
        )
        .limit(1);
      const existing = receipt?.resultRef
        ? await alertRepository.findById(receipt.resultRef, tx)
        : null;
      if (!existing) {
        throw new Error(
          `[alerts] recibo de efeito ${key.effectType} para ${key.eventId} sem referência de resultado`,
        );
      }
      return { alert: existing, deduplicated: true, event: null as EventEnvelope | null };
    }

    const alert = await alertRepository.create(toRow(input), tx);
    await alertRepository.addEvent(alert.id, 'created', undefined, 'active', input.triggeredBy, tx);
    if (input.userId) {
      await insertOperationalAudit(tx, {
        userId: input.userId,
        action: 'alert.created',
        entityType: 'alert',
        entityId: alert.id,
        newValue: { type: alert.type, title: alert.title, severity: alert.severity },
        metadata: {
          conversationId: input.conversationId,
          taskId: input.taskId,
          triggeredBy: input.triggeredBy,
        },
        correlationId: input.correlationId,
      });
    }
    const event = alertCreatedEvent(alert, input);
    await persistOutboxEventIntent(tx, event);
    await tx
      .update(schema.workerEffectReceipts)
      .set({ resultRef: alert.id })
      .where(eq(schema.workerEffectReceipts.id, claimed.id));

    return { alert, deduplicated: false, event };
  });

  if (outcome.event) {
    await publishRealtimeHintsAfterCommit([outcome.event]);
  }
  return ok(toOutput(outcome.alert, outcome.deduplicated));
}

export async function createAlert(
  input: CreateAlertInput,
  options: CreateAlertOptions = {},
): Promise<Result<CreateAlertOutput>> {
  try {
    if (!input.title || !input.type) {
      return err(new BadRequestError('Title and type are required'));
    }

    if (options.idempotency) {
      return await createAlertIdempotent(input, options.idempotency);
    }

    // PROD-18/AC1: alerta + evento do alerta + auditoria + intenção outbox na
    // MESMA transação. Falha em qualquer escrita faz rollback completo.
    const events: EventEnvelope[] = [];
    const alert = await db.transaction(async (tx) => {
      const created = await alertRepository.create(toRow(input), tx);
      await alertRepository.addEvent(created.id, 'created', undefined, 'active', input.triggeredBy, tx);
      if (input.userId) {
        await insertOperationalAudit(tx, {
          userId: input.userId,
          action: 'alert.created',
          entityType: 'alert',
          entityId: created.id,
          newValue: { type: created.type, title: created.title, severity: created.severity },
          metadata: {
            conversationId: input.conversationId,
            taskId: input.taskId,
            triggeredBy: input.triggeredBy,
          },
          correlationId: input.correlationId,
        });
      }
      const event = alertCreatedEvent(created, input);
      await persistOutboxEventIntent(tx, event);
      events.push(event);
      return created;
    });

    await publishRealtimeHintsAfterCommit(events);

    return ok(toOutput(alert));
  } catch (error) {
    return err(error as Error);
  }
}
