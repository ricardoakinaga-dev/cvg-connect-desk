import { FastifyInstance, type FastifyRequest } from 'fastify';
import { eq, inArray } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { createTask } from '../../application/use-cases/create-task.use-case';
import { updateTaskStatus } from '../../application/use-cases/update-task-status.use-case';
import { taskRepository, TASK_STATUSES, TASK_PRIORITIES, type TaskStatus, type TaskPriority } from '../../infrastructure/repositories/task.repository';
import { AppError } from '@cvg/shared';
import { authenticate, authorizeConversationResource, authorizeTaskResource, requirePermission, sectorPermissionService, type ResourceAuthz } from '@cvg/auth';

async function authorizeTaskConversation(
  actor: { id?: string; roles?: string[] } | undefined,
  action: string,
  task: { conversationId?: string | null; createdBy?: string | null; assignedTo?: string | null } | null | undefined,
): Promise<ResourceAuthz> {
  if (!task) {
    return { allowed: false, statusCode: 404, error: 'NOT_FOUND', message: 'Task not found' };
  }

  const [conversation] = task.conversationId
    ? await db
        .select({
          id: schema.conversations.id,
          sectorId: schema.conversations.sectorId,
          assignedUserId: schema.conversations.assignedUserId,
        })
        .from(schema.conversations)
        .where(eq(schema.conversations.id, task.conversationId))
    : [];

  const requiredLevel = action.endsWith(':read') ? 'read' : ('write' as const);
  return authorizeTaskResource({ actor, action, task, conversation: conversation ?? null, requiredLevel });
}

async function filterTasksByAccess(
  actor: { id?: string; roles?: string[] } | undefined,
  tasks: Array<{ conversationId?: string | null; createdBy?: string | null; assignedTo?: string | null }>,
) {
  if (!actor?.id) {
    return [];
  }

  if ((actor.roles ?? []).includes('Admin') || (await sectorPermissionService.isGlobalAdmin(actor.id))) {
    return tasks;
  }

  const conversationIds = Array.from(
    new Set(tasks.map((task) => task.conversationId).filter((id): id is string => Boolean(id))),
  );
  const conversations = conversationIds.length > 0
    ? await db
        .select({
          id: schema.conversations.id,
          sectorId: schema.conversations.sectorId,
          assignedUserId: schema.conversations.assignedUserId,
        })
        .from(schema.conversations)
        .where(inArray(schema.conversations.id, conversationIds))
    : [];
  const byId = new Map(conversations.map((conversation) => [conversation.id, conversation]));

  const visible: typeof tasks = [];
  for (const task of tasks) {
    if (task.conversationId) {
      const access = await authorizeConversationResource({
        actor,
        action: 'tasks:read',
        conversation: byId.get(task.conversationId) ?? null,
        requiredLevel: 'read',
      });
      if (access.allowed) {
        visible.push(task);
      }
      continue;
    }
    if (task.createdBy === actor.id || task.assignedTo === actor.id) {
      visible.push(task);
    }
  }

  return visible;
}

interface CreateTaskBody {
  conversationId?: string;
  tutorId?: string;
  patientId?: string;
  title: string;
  description?: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  assignedTo?: string;
  createdBy?: string;
  dueAt?: string;
}

interface UpdateStatusBody {
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  changedBy?: string;
  reason?: string;
  expectedStatus?: 'pending' | 'in_progress' | 'completed' | 'cancelled';
}

interface TaskParams {
  id: string;
}

/** Correlação estável da ação (PROD-18/AC2): header ou request id. */
function requestCorrelationId(request: FastifyRequest): string {
  const header = request.headers['x-correlation-id'];
  return (typeof header === 'string' && header.trim()) || String(request.id);
}

export async function registerTaskRoutes(app: FastifyInstance) {
  app.post<{ Body: CreateTaskBody }>(
    '/tasks',
    {
      preHandler: [authenticate, requirePermission('tasks:write')],
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            conversationId: { type: 'string', format: 'uuid' },
            tutorId: { type: 'string', format: 'uuid' },
            patientId: { type: 'string', format: 'uuid' },
            title: { type: 'string', minLength: 1, maxLength: 300 },
            description: { type: 'string', maxLength: 5000 },
            priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
            assignedTo: { type: 'string', format: 'uuid' },
            createdBy: { type: 'string', format: 'uuid' },
            dueAt: { type: 'string', format: 'date-time' },
          },
          required: ['title'],
        },
      },
    },
    async (request, reply) => {
      try {
        const userId = request.user?.id;

        if (!userId) {
          return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Authentication required' });
        }

        if (request.body.createdBy !== undefined && request.body.createdBy !== userId) {
          return reply.status(400).send({
            error: 'BAD_REQUEST',
            message: 'createdBy must match the authenticated user',
          });
        }

        if (request.body.conversationId) {
          const [conversation] = await db
            .select({
              id: schema.conversations.id,
              sectorId: schema.conversations.sectorId,
              assignedUserId: schema.conversations.assignedUserId,
            })
            .from(schema.conversations)
            .where(eq(schema.conversations.id, request.body.conversationId));
          const access = await authorizeConversationResource({
            actor: request.user,
            action: 'tasks:write',
            conversation: conversation ?? null,
            requiredLevel: 'write',
          });
          if (!access.allowed) {
            return reply.status(access.statusCode).send({ error: access.error, message: access.message });
          }
        }

        const result = await createTask({
          ...request.body,
          createdBy: userId,
          dueAt: request.body.dueAt ? new Date(request.body.dueAt) : undefined,
          userId,
          correlationId: requestCorrelationId(request),
        });

        if (result.isErr()) {
          const error = result.error;
          if (error instanceof AppError) {
            return reply.status(error.statusCode).send({
              error: error.code,
              message: error.message,
            });
          }
          return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to create task' });
        }

        return reply.status(201).send(result.value);
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to create task' });
      }
    }
  );

  app.get<{ Querystring: { status?: TaskStatus; assignedTo?: string; priority?: TaskPriority; conversationId?: string; limit?: number; offset?: number } }>('/tasks', {
    preHandler: [authenticate, requirePermission('tasks:read')],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: [...TASK_STATUSES] },
          assignedTo: { type: 'string', format: 'uuid' },
          priority: { type: 'string', enum: [...TASK_PRIORITIES] },
          conversationId: { type: 'string', format: 'uuid' },
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 100 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const { status, assignedTo, priority, conversationId, limit, offset } = request.query;

      // C04: consulta contextual exige autorização por recurso ANTES de ler e
      // retorna 404 sem conteúdo quando a conversa não é acessível.
      if (conversationId) {
        const conversation = await db
          .select({
            id: schema.conversations.id,
            sectorId: schema.conversations.sectorId,
            assignedUserId: schema.conversations.assignedUserId,
          })
          .from(schema.conversations)
          .where(eq(schema.conversations.id, conversationId))
          .limit(1);
        const row = conversation[0];
        if (!row) {
          return reply.status(404).send({ error: 'NOT_FOUND', message: 'Conversa não encontrada' });
        }
        const access = await authorizeConversationResource({
          actor: request.user,
          action: 'tasks:read',
          conversation: { id: row.id, sectorId: row.sectorId ?? null, assignedUserId: row.assignedUserId ?? null },
          requiredLevel: 'read',
        });
        if (!access.allowed) {
          return reply.status(404).send({ error: 'NOT_FOUND', message: 'Conversa não encontrada' });
        }
      }

      const tasks = await taskRepository.findAll({ status, assignedTo, priority, conversationId, limit, offset });
      const visible = await filterTasksByAccess(request.user, tasks);
      return reply.status(200).send(visible);
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to fetch tasks' });
    }
  });

  app.get<{ Params: TaskParams }>(
    '/tasks/:id',
    { preHandler: [authenticate, requirePermission('tasks:read')] },
    async (request, reply) => {
      try {
        const task = await taskRepository.findById(request.params.id);
        if (!task) {
          return reply.status(404).send({ error: 'NOT_FOUND', message: 'Task not found' });
        }

        const access = await authorizeTaskConversation(request.user, 'tasks:read', task);
        if (!access.allowed) {
          const notFoundMessage = access.statusCode === 404 ? 'Task not found' : access.message;
          return reply.status(access.statusCode).send({ error: access.error, message: notFoundMessage });
        }

        return reply.status(200).send(task);
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to fetch task' });
      }
    }
  );

  app.patch<{ Params: TaskParams; Body: UpdateStatusBody }>(
    '/tasks/:id/status',
    {
      preHandler: [authenticate, requirePermission('tasks:write')],
      schema: {
        body: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
            changedBy: { type: 'string' },
            reason: { type: 'string' },
            expectedStatus: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
          },
          required: ['status'],
        },
      },
    },
    async (request, reply) => {
      try {
        const userId = request.user?.id;
        if (!userId) {
          return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Authentication required' });
        }

        if (request.body.changedBy !== undefined && request.body.changedBy !== userId) {
          return reply.status(400).send({
            error: 'BAD_REQUEST',
            message: 'changedBy must match the authenticated user',
          });
        }

        const existing = await taskRepository.findById(request.params.id);
        if (!existing) {
          return reply.status(404).send({ error: 'NOT_FOUND', message: 'Task not found' });
        }

        const access = await authorizeTaskConversation(request.user, 'tasks:write', existing);
        if (!access.allowed) {
          const notFoundMessage = access.statusCode === 404 ? 'Task not found' : access.message;
          return reply.status(access.statusCode).send({ error: access.error, message: notFoundMessage });
        }

        const result = await updateTaskStatus({
          taskId: request.params.id,
          status: request.body.status,
          changedBy: request.body.changedBy,
          reason: request.body.reason,
          expectedStatus: request.body.expectedStatus,
          userId,
          correlationId: requestCorrelationId(request),
        });

        if (result.isErr()) {
          const error = result.error;
          if (error instanceof AppError) {
            return reply.status(error.statusCode).send({
              error: error.code,
              message: error.message,
            });
          }
          return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to update task status' });
        }

        return reply.status(200).send(result.value);
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to update task status' });
      }
    }
  );
}
