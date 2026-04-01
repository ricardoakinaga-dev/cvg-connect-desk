import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createTask } from '../../application/use-cases/create-task.use-case';
import { updateTaskStatus } from '../../application/use-cases/update-task-status.use-case';
import { taskRepository } from '../../infrastructure/repositories/task.repository';
import { AppError } from '@cvg/shared';
import { authenticate, requirePermission } from '@cvg/auth';

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
  status: string;
  changedBy?: string;
  reason?: string;
}

interface TaskParams {
  id: string;
}

export async function registerTaskRoutes(app: FastifyInstance) {
  app.post(
    '/tasks',
    {
      preHandler: [authenticate, requirePermission('tasks:write')],
      schema: {
        body: {
          type: 'object',
          properties: {
            conversationId: { type: 'string' },
            tutorId: { type: 'string' },
            patientId: { type: 'string' },
            title: { type: 'string' },
            description: { type: 'string' },
            priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
            assignedTo: { type: 'string' },
            createdBy: { type: 'string' },
            dueAt: { type: 'string' },
          },
          required: ['title'],
        },
      },
    },
    async (request, reply) => {
      try {
        const userId = (request as any).user?.id;
        const body = request.body as CreateTaskBody;
        const result = await createTask({
          ...body,
          dueAt: body.dueAt ? new Date(body.dueAt) : undefined,
          userId,
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

  app.get('/tasks', { preHandler: [authenticate, requirePermission('tasks:read')] }, async (request, reply) => {
    try {
      const query = request.query as { status?: string; assignedTo?: string; priority?: string };
      const { status, assignedTo, priority } = query;
      const tasks = await taskRepository.findAll({ status, assignedTo, priority });
      return reply.status(200).send(tasks);
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to fetch tasks' });
    }
  });

  app.get(
    '/tasks/:id',
    { preHandler: [authenticate, requirePermission('tasks:read')] },
    async (request, reply) => {
      try {
        const params = request.params as TaskParams;
        const task = await taskRepository.findById(params.id);
        if (!task) {
          return reply.status(404).send({ error: 'NOT_FOUND', message: 'Task not found' });
        }
        return reply.status(200).send(task);
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to fetch task' });
      }
    }
  );

  app.patch(
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
          },
          required: ['status'],
        },
      },
    },
    async (request, reply) => {
      try {
        const userId = (request as any).user?.id;
        const params = request.params as TaskParams;
        const body = request.body as { status: 'pending' | 'in_progress' | 'completed' | 'cancelled'; changedBy?: string; reason?: string };
        const result = await updateTaskStatus({
          taskId: params.id,
          status: body.status,
          changedBy: body.changedBy,
          reason: body.reason,
          userId,
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
