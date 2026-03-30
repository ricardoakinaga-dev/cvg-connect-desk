import { taskRepository } from '../../infrastructure/repositories/task.repository';
import { ok, err, type Result } from '@cvg/shared';
import { BadRequestError } from '@cvg/shared';
import { createAuditLog } from '@cvg/audit';

export interface CreateTaskInput {
  conversationId?: string;
  tutorId?: string;
  patientId?: string;
  title: string;
  description?: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  assignedTo?: string;
  createdBy?: string;
  dueAt?: Date;
  metadata?: Record<string, unknown>;
  userId?: string; // Para auditoria
}

export interface CreateTaskOutput {
  id: string;
  title: string;
  status: string;
  createdAt: Date;
}

export async function createTask(input: CreateTaskInput): Promise<Result<CreateTaskOutput>> {
  try {
    if (!input.title) {
      return err(new BadRequestError('Title is required'));
    }

    const task = await taskRepository.create({
      conversationId: input.conversationId,
      tutorId: input.tutorId,
      patientId: input.patientId,
      title: input.title,
      description: input.description,
      priority: input.priority || 'medium',
      status: 'pending',
      assignedTo: input.assignedTo,
      createdBy: input.createdBy,
      dueAt: input.dueAt,
      metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
    });

    await taskRepository.addStatusHistory(task.id, 'pending', input.createdBy, 'Task created');

    // Audit: registrar criação de tarefa
    if (input.userId) {
      await createAuditLog({
        userId: input.userId,
        action: 'task.created',
        entityType: 'task',
        entityId: task.id,
        newValue: {
          title: task.title,
          priority: task.priority,
          assignedTo: task.assignedTo,
          dueAt: task.dueAt,
        },
        metadata: {
          conversationId: input.conversationId,
          createdBy: input.createdBy,
        },
      });
    }

    return ok({
      id: task.id,
      title: task.title,
      status: task.status,
      createdAt: task.createdAt,
    });
  } catch (error) {
    return err(error as Error);
  }
}
