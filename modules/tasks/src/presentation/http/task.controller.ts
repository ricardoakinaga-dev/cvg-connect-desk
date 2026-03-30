import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
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
    async (request: FastifyRequest<{ Body: CreateTaskBody }>, reply: FastifyReply) => {
      try {
        const userId = request.user?.id;
        const result = await createTask({
          ...request.body,
          dueAt: request.body.dueAt ? new Date(request.body.dueAt) : undefined,
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

  app.get('/tasks', { preHandler: [authenticate, requirePermission('tasks:read')] }, async (request: FastifyRequest<{ Querystring: { status?: string; assignedTo?: string; priority?: string } }>, reply: FastifyReply) => {
    try {
      const { status, assignedTo, priority } = request.query;
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
    async (request: FastifyRequest<{ Params: TaskParams }>, reply: FastifyReply) => {
      try {
        const task = await taskRepository.findById(request.params.id);
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
    async (request: FastifyRequest<{ Params: TaskParams; Body: UpdateStatusBody }>, reply: FastifyReply) => {
      try {
        const userId = request.user?.id;
        const result = await updateTaskStatus({
          taskId: request.params.id,
          status: request.body.status,
          changedBy: request.body.changedBy,
          reason: request.body.reason,
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
