import { taskRepository } from '../../infrastructure/repositories/task.repository';
import { ok, err, type Result } from '@cvg/shared';
import { NotFoundError, BadRequestError } from '@cvg/shared';
import { createAuditLog } from '@cvg/audit';

export interface UpdateTaskStatusInput {
  taskId: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  changedBy?: string;
  reason?: string;
  userId?: string; // Para auditoria
}

export interface UpdateTaskStatusOutput {
  id: string;
  status: string;
  completedAt: Date | null;
}

export async function updateTaskStatus(input: UpdateTaskStatusInput): Promise<Result<UpdateTaskStatusOutput>> {
  try {
    const task = await taskRepository.findById(input.taskId);
    if (!task) {
      return err(new NotFoundError('Task not found'));
    }

    const previousStatus = task.status;
    const updatedTask = await taskRepository.updateStatus(input.taskId, input.status);

    await taskRepository.addStatusHistory(input.taskId, input.status, input.changedBy, input.reason);

    // Audit: registrar mudança de status da tarefa
    if (input.userId) {
      await createAuditLog({
        userId: input.userId,
        action: 'task.status.changed',
        entityType: 'task',
        entityId: input.taskId,
        oldValue: { status: previousStatus },
        newValue: { status: input.status },
        metadata: {
          reason: input.reason,
          changedBy: input.changedBy,
        },
      });
    }

    return ok({
      id: updatedTask.id,
      status: updatedTask.status,
      completedAt: updatedTask.completedAt,
    });
  } catch (error) {
    return err(error as Error);
  }
}
