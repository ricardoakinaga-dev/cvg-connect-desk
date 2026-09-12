import { FastifyInstance } from 'fastify';
import { getAuditLogs, getEntityAuditHistory } from '../../application/use-cases';
import { authenticate, requirePermission } from '@cvg/auth';

interface AuditQuery {
  userId?: string;
  entityType?: string;
  entityId?: string;
  action?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
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
            entityType: { type: 'string' },
            entityId: { type: 'string', format: 'uuid' },
            action: { type: 'string' },
            startDate: { type: 'string' },
            endDate: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 1000 },
            offset: { type: 'integer', minimum: 0 },
          },
        },
      },
    },
    async (request) => {
      const { userId, entityType, entityId, action, startDate, endDate, limit = 100, offset = 0 } = request.query;

      const filter = {
        userId,
        entityType,
        entityId,
        action,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
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
