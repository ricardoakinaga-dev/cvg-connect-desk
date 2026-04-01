import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  getAuditLogs,
  getEntityAuditHistory,
  getConversationAudit,
  getCorrelationTrail,
  searchAuditActions,
} from '../../application/use-cases';
import { authenticate, requirePermission } from '@cvg/auth';

interface AuditQuery {
  userId?: string;
  entityType?: string;
  entityId?: string;
  action?: string;
  startDate?: string;
  endDate?: string;
  correlationId?: string;
  limit?: number;
  offset?: number;
}

export async function registerAuditRoutes(app: FastifyInstance) {
  app.get(
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
            correlationId: { type: 'string', format: 'uuid' },
            startDate: { type: 'string' },
            endDate: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 1000 },
            offset: { type: 'integer', minimum: 0 },
          },
        },
      },
    },
    async (request) => {
      const query = request.query as AuditQuery;
      const { userId, entityType, entityId, action, correlationId, startDate, endDate, limit = 100, offset = 0 } = query;

      const filter = {
        userId,
        entityType,
        entityId,
        action,
        correlationId,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
      };

      const logs = await getAuditLogs(filter, limit, offset);
      return logs;
    }
  );

  app.get(
    '/audit/entity/:entityType',
    async (request) => {
      const params = request.params as { entityType: string };
      const query = request.query as { entityId: string };
      const { entityType } = params;
      const { entityId } = query;

      if (!entityId) {
        throw new Error('entityId is required');
      }

      const logs = await getEntityAuditHistory(entityType, entityId);
      return logs;
    }
  );

  app.get(
    '/audit/conversation/:conversationId',
    { preHandler: [authenticate, requirePermission('admin:read')] },
    async (request) => {
      const params = request.params as { conversationId: string };
      const logs = await getConversationAudit(params.conversationId);
      return logs;
    }
  );

  app.get(
    '/audit/correlation/:correlationId',
    { preHandler: [authenticate, requirePermission('admin:read')] },
    async (request) => {
      const params = request.params as { correlationId: string };
      const query = request.query as { limit?: number };
      const limit = query.limit ? Number(query.limit) : 50;
      const logs = await getCorrelationTrail(params.correlationId, limit);
      return logs;
    }
  );

  app.get(
    '/audit/actions/search',
    { preHandler: [authenticate, requirePermission('admin:read')] },
    async (request) => {
      const query = request.query as { q: string; limit?: number };
      const { q, limit = 50 } = query;
      if (!q) {
        throw new Error('q (search pattern) is required');
      }
      const logs = await searchAuditActions(q, limit);
      return logs;
    }
  );
}
