import { FastifyInstance } from 'fastify';
import { getAuditLogs, getEntityAuditHistory } from '../../application/use-cases';
import { authenticate, requirePermission } from '@cvg/auth';

interface AuditQuery {
  userId?: string;
  entityType?: string;
  entityId?: string;
  action?: string;
  correlationId?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

/** DTO de período estável: data inválida responde 400, nunca 500. */
function parseDate(value: string | undefined, field: string): Date | undefined | { error: string } {
  if (value === undefined) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return { error: `INVALID_${field.toUpperCase()}` };
  }
  return parsed;
}

export async function registerAuditRoutes(app: FastifyInstance) {
  app.get<{ Querystring: AuditQuery }>(
    '/audit/logs',
    {
      preHandler: [authenticate, requirePermission('admin:read')],
      schema: {
        querystring: {
          type: 'object',
          properties: {
            userId: { type: 'string', format: 'uuid' },
            entityType: { type: 'string', maxLength: 64 },
            entityId: { type: 'string', format: 'uuid' },
            action: { type: 'string', maxLength: 128 },
            correlationId: { type: 'string', maxLength: 128 },
            startDate: { type: 'string' },
            endDate: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 1000, default: 100 },
            offset: { type: 'integer', minimum: 0, default: 0 },
          },
        },
      },
    },
    async (request, reply) => {
      const { userId, entityType, entityId, action, correlationId, startDate, endDate, limit = 100, offset = 0 } = request.query;

      const parsedStart = parseDate(startDate, 'start_date');
      if (parsedStart && 'error' in parsedStart) {
        return reply.status(400).send({ error: parsedStart.error, message: 'startDate inválida' });
      }
      const parsedEnd = parseDate(endDate, 'end_date');
      if (parsedEnd && 'error' in parsedEnd) {
        return reply.status(400).send({ error: parsedEnd.error, message: 'endDate inválida' });
      }

      const filter = {
        userId,
        entityType,
        entityId,
        action,
        correlationId,
        startDate: parsedStart,
        endDate: parsedEnd,
      };

      const logs = await getAuditLogs(filter, limit, offset);
      return logs;
    }
  );

  app.get<{ Params: { entityType: string }; Querystring: { entityId: string } }>(
    '/audit/entity/:entityType',
    {
      preHandler: [authenticate, requirePermission('admin:read')],
      schema: {
        params: {
          type: 'object',
          properties: { entityType: { type: 'string', minLength: 1, maxLength: 64 } },
          required: ['entityType'],
        },
        querystring: {
          type: 'object',
          properties: { entityId: { type: 'string', format: 'uuid' } },
          required: ['entityId'],
        },
      },
    },
    async (request) => {
      const { entityType } = request.params;
      const { entityId } = request.query;

      const logs = await getEntityAuditHistory(entityType, entityId);
      return logs;
    }
  );
}
