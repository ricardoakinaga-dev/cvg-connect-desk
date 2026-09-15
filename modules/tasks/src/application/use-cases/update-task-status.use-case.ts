import { db } from '@cvg/database';
import { taskRepository, isValidTaskTransition, type TaskStatus } from '../../infrastructure/repositories/task.repository';
import { insertOperationalAudit } from '../../infrastructure/audit';
import { ok, err, type Result, ConflictError, NotFoundError } from '@cvg/shared';
import { persistOutboxEventIntent, publishRealtimeHintsAfterCommit, createEvent, type EventEnvelope } from '@cvg/events';

export interface UpdateTaskStatusInput {
  taskId: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  changedBy?: string;
  reason?: string;
  userId?: string; // Autor da sessão (auditoria e histórico)
  /** CAS opcional: exige que o status atual seja este (senão 409). */
  expectedStatus?: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  correlationId?: string;
}

export interface UpdateTaskStatusOutput {
  id: string;
  status: string;
  completedAt: Date | null;
  previousStatus: string;
  /** true quando a tarefa já estava no status pedido (nenhum efeito novo). */
  deduplicated: boolean;
}

/**
 * PROD-18/AC1/AC3: mudança de status transacional com CAS e idempotência.
 * Tarefa + histórico + auditoria + evento outbox no MESMO `tx`; corrida entre
 * dois operadores (CAS perdido) responde 409 sem efeito parcial; repetir o
 * mesmo status não duplica histórico/evento/auditoria.
 */
export async function updateTaskStatus(input: UpdateTaskStatusInput): Promise<Result<UpdateTaskStatusOutput>> {
  try {
    const task = await taskRepository.findById(input.taskId);
    if (!task) {
      return err(new NotFoundError('Task not found'));
    }

    const previousStatus = task.status;
    const changedBy = input.userId ?? input.changedBy;

    // Ação repetida: mesmo status ⇒ resultado idempotente, sem novas escritas.
    if (previousStatus === input.status) {
      return ok({
        id: task.id,
        status: task.status,
        completedAt: task.completedAt,
        previousStatus,
        deduplicated: true,
      });
    }

    if (!isValidTaskTransition(previousStatus, input.status as TaskStatus)) {
      return err(new ConflictError(
        `Transição de status inválida: ${previousStatus} -> ${input.status}`,
        'INVALID_TASK_STATUS_TRANSITION',
      ));
    }

    if (input.expectedStatus && previousStatus !== input.expectedStatus) {
      return err(new ConflictError(
        `Status atual ${previousStatus} difere do esperado ${input.expectedStatus}`,
        'TASK_STATUS_CONFLICT',
      ));
    }

    const events: EventEnvelope[] = [];
    const updatedTask = await db.transaction(async (tx) => {
      // CAS dentro da transação: quem perder a corrida recebe null.
      const updated = await taskRepository.updateStatusIfCurrent(
        input.taskId,
        previousStatus,
        input.status as TaskStatus,
        tx,
      );
      if (!updated) {
        throw new ConflictError(
          'Tarefa alterada por outro operador; releia o estado antes de repetir',
          'TASK_STATUS_CONFLICT',
        );
      }

      await taskRepository.addStatusHistory(input.taskId, input.status, changedBy, input.reason, tx);

      if (input.userId) {
        await insertOperationalAudit(tx, {
          userId: input.userId,
          action: 'task.status.changed',
          entityType: 'task',
          entityId: input.taskId,
          oldValue: { status: previousStatus },
          newValue: { status: input.status },
          metadata: {
            reason: input.reason,
            changedBy,
          },
          correlationId: input.correlationId,
        });
      }

      const event = createEvent(
        'task.status.changed',
        'Task',
        input.taskId,
        {
          taskId: input.taskId,
          previousStatus,
          newStatus: input.status,
          changedBy,
          reason: input.reason,
          changedAt: new Date().toISOString(),
        },
        { correlationId: input.correlationId },
      );
      await persistOutboxEventIntent(tx, event);
      events.push(event);

      return updated;
    });

    await publishRealtimeHintsAfterCommit(events);

    return ok({
      id: updatedTask.id,
      status: updatedTask.status,
      completedAt: updatedTask.completedAt,
      previousStatus,
      deduplicated: false,
    });
  } catch (error) {
    if (error instanceof ConflictError) {
      return err(error);
    }
    return err(error as Error);
  }
}
