import { FastifyInstance, FastifyReply } from 'fastify';
import { createAlert, acknowledgeAlert, resolveAlert } from '../../application/use-cases';
import { alertRepository } from '../../infrastructure/repositories/alert.repository';
import { AppError } from '@cvg/shared';
import { authenticate, requirePermission } from '@cvg/auth';

interface CreateAlertBody {
  conversationId?: string;
  taskId?: string;
  type: string;
  title: string;
  message?: string;
  severity?: 'info' | 'warning' | 'error' | 'critical';
  triggeredBy?: string;
}

interface AlertActionBody {
  acknowledgedBy?: string;
  resolvedBy?: string;
}

interface AlertParams {
  id: string;
}

export async function registerAlertRoutes(app: FastifyInstance) {
  app.post(
    '/alerts',
    {
      preHandler: [authenticate, requirePermission('alerts:write')],
      schema: {
        body: {
          type: 'object',
          properties: {
            conversationId: { type: 'string' },
            taskId: { type: 'string' },
            type: { type: 'string' },
            title: { type: 'string' },
            message: { type: 'string' },
            severity: { type: 'string', enum: ['info', 'warning', 'error', 'critical'] },
            triggeredBy: { type: 'string' },
          },
          required: ['type', 'title'],
        },
      },
    },
    async (request, reply) => {
      try {
        const userId = (request as any).user?.id;
        const result = await createAlert({
          ...(request.body as CreateAlertBody),
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
          return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to create alert' });
        }

        return reply.status(201).send(result.value);
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to create alert' });
      }
    }
  );

  app.get('/alerts', { preHandler: [authenticate, requirePermission('alerts:read')] }, async (request, reply) => {
    try {
      const { status, severity, type } = request.query as { status?: string; severity?: string; type?: string };
      const alerts = await alertRepository.findAll({ status, severity, type });
      return reply.status(200).send(alerts);
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to fetch alerts' });
    }
  });

  app.get(
    '/alerts/:id',
    { preHandler: [authenticate, requirePermission('alerts:read')] },
    async (request, reply) => {
      try {
        const alert = await alertRepository.findById((request.params as AlertParams).id);
        if (!alert) {
          return reply.status(404).send({ error: 'NOT_FOUND', message: 'Alert not found' });
        }
        return reply.status(200).send(alert);
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to fetch alert' });
      }
    }
  );

  app.post(
    '/alerts/:id/acknowledge',
    {
      preHandler: [authenticate, requirePermission('alerts:write')],
      schema: {
        body: {
          type: 'object',
          properties: {
            acknowledgedBy: { type: 'string' },
          },
          required: ['acknowledgedBy'],
        },
      },
    },
    async (request, reply) => {
      try {
        const userId = (request as any).user?.id;
        const params = request.params as AlertParams;
        const body = request.body as AlertActionBody;
        const result = await acknowledgeAlert({
          alertId: params.id,
          acknowledgedBy: body.acknowledgedBy!,
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
          return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to acknowledge alert' });
        }

        return reply.status(200).send(result.value);
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to acknowledge alert' });
      }
    }
  );

  app.post(
    '/alerts/:id/resolve',
    {
      preHandler: [authenticate, requirePermission('alerts:write')],
      schema: {
        body: {
          type: 'object',
          properties: {
            resolvedBy: { type: 'string' },
          },
          required: ['resolvedBy'],
        },
      },
    },
    async (request, reply) => {
      try {
        const userId = (request as any).user?.id;
        const params = request.params as AlertParams;
        const body = request.body as AlertActionBody;
        const result = await resolveAlert({
          alertId: params.id,
          resolvedBy: body.resolvedBy!,
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
          return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to resolve alert' });
        }

        return reply.status(200).send(result.value);
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to resolve alert' });
      }
    }
  );
}
