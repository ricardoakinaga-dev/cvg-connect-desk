import { db, schema } from '@cvg/database';
import { and, eq } from 'drizzle-orm';
import { taskRepository } from '../../infrastructure/repositories/task.repository';
import { insertOperationalAudit } from '../../infrastructure/audit';
import { ok, err, type Result } from '@cvg/shared';
import { BadRequestError, NotFoundError } from '@cvg/shared';
import { persistOutboxEventIntent, publishRealtimeHintsAfterCommit, createEvent, type EventEnvelope } from '@cvg/events';

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
  userId?: string; // Principal autenticado: fonte de verdade da autoria
  correlationId?: string;
}

export interface CreateTaskOutput {
  id: string;
  title: string;
  status: string;
  createdBy: string | null;
  assignedTo: string | null;
  createdAt: Date;
}

/**
 * PROD-18/AC1: tarefa + histórico + auditoria + evento outbox na MESMA
 * transação. `createdBy` deriva da sessão, nunca do corpo.
 */
export async function createTask(input: CreateTaskInput): Promise<Result<CreateTaskOutput>> {
  try {
    if (!input.title) {
      return err(new BadRequestError('Title is required'));
    }

    const createdBy = input.userId ?? input.createdBy;

    const events: EventEnvelope[] = [];
    const task = await db.transaction(async (tx) => {
      // SA-015/AC1: vínculos são validados NO SERVIDOR dentro do mesmo commit.
      // Referência inexistente/inativa ⇒ 4xx sem linha órfã (antes: 500 por FK
      // do Postgres ou responsável fora do setor aceito em silêncio).
      if (input.tutorId) {
        const [tutor] = await tx.select({ id: schema.tutors.id }).from(schema.tutors)
          .where(eq(schema.tutors.id, input.tutorId));
        if (!tutor) throw new NotFoundError('Tutor não encontrado');
      }
      if (input.patientId) {
        const [patient] = await tx.select({ id: schema.patients.id }).from(schema.patients)
          .where(eq(schema.patients.id, input.patientId));
        if (!patient) throw new NotFoundError('Paciente não encontrado');
      }

      let conversationSectorId: string | null = null;
      if (input.conversationId) {
        const [conversation] = await tx
          .select({ id: schema.conversations.id, sectorId: schema.conversations.sectorId })
          .from(schema.conversations)
          .where(eq(schema.conversations.id, input.conversationId));
        if (!conversation) throw new NotFoundError('Conversa não encontrada');
        conversationSectorId = conversation.sectorId ?? null;
      }

      if (input.assignedTo) {
        const [assignee] = await tx
          .select({ id: schema.users.id, isActive: schema.users.isActive })
          .from(schema.users)
          .where(eq(schema.users.id, input.assignedTo));
        if (!assignee || !assignee.isActive) {
          throw new BadRequestError('Responsável inválido ou inativo', 'INVALID_ASSIGNEE');
        }
        if (conversationSectorId) {
          const [membership] = await tx
            .select({ id: schema.userSectors.id })
            .from(schema.userSectors)
            .where(and(
              eq(schema.userSectors.userId, input.assignedTo),
              eq(schema.userSectors.sectorId, conversationSectorId),
            ))
            .limit(1);
          if (!membership) {
            const [admin] = await tx
              .select({ userId: schema.userRoles.userId })
              .from(schema.userRoles)
              .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
              .where(and(
                eq(schema.userRoles.userId, input.assignedTo),
                eq(schema.roles.name, 'Admin'),
              ))
              .limit(1);
            if (!admin) {
              throw new BadRequestError(
                'Responsável não pertence ao setor da conversa',
                'INVALID_ASSIGNEE',
              );
            }
          }
        }
      }

      const created = await taskRepository.create({
        conversationId: input.conversationId,
        tutorId: input.tutorId,
        patientId: input.patientId,
        title: input.title,
        description: input.description,
        priority: input.priority || 'medium',
        status: 'pending',
        assignedTo: input.assignedTo,
        createdBy,
        dueAt: input.dueAt,
        metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
      }, tx);

      await taskRepository.addStatusHistory(created.id, 'pending', createdBy, 'Task created', tx);

      if (input.userId) {
        await insertOperationalAudit(tx, {
          userId: input.userId,
          action: 'task.created',
          entityType: 'task',
          entityId: created.id,
          newValue: {
            title: created.title,
            priority: created.priority,
            assignedTo: created.assignedTo,
            dueAt: created.dueAt,
          },
          metadata: {
            conversationId: input.conversationId,
            createdBy,
          },
          correlationId: input.correlationId,
        });
      }

      const event = createEvent(
        'task.created',
        'Task',
        created.id,
        {
          taskId: created.id,
          conversationId: created.conversationId,
          title: created.title,
          priority: created.priority,
          assignedTo: created.assignedTo,
          createdBy,
        },
        { correlationId: input.correlationId },
      );
      await persistOutboxEventIntent(tx, event);
      events.push(event);

      return created;
    });

    await publishRealtimeHintsAfterCommit(events);

    return ok({
      id: task.id,
      title: task.title,
      status: task.status,
      createdBy: task.createdBy,
      assignedTo: task.assignedTo,
      createdAt: task.createdAt,
    });
  } catch (error) {
    return err(error as Error);
  }
}
