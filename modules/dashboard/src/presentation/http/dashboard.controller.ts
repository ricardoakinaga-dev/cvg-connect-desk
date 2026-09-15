import type { FastifyInstance } from 'fastify';
import {
  getDashboardSummary,
  getConversationMetrics,
  getConversationVolume,
  getOpenConversationsCount,
  getTaskMetrics,
  getOverdueTasksCount,
  getAlertMetrics,
  getActiveAlertsCount,
  getPremiumDashboardSummary,
  getResponseTimeMetrics,
  getHandoffMetrics,
  getSectorBacklog,
  getAgingConversations,
  getAlertsByCriticality,
} from '../../application/use-cases';
import { authenticate, requirePermission } from '@cvg/auth';
import { BadRequestError } from '@cvg/shared';

export async function registerDashboardRoutes(app: FastifyInstance): Promise<void> {
  const dashboardAuth = [authenticate, requirePermission('dashboard:read')];

  app.get('/metrics/summary', { preHandler: [authenticate, requirePermission('dashboard:read')] }, async () => {
    const result = await getDashboardSummary();
    if (result.isErr()) {
      throw result.error;
    }
    return result.value;
  });

  app.get('/metrics/premium', { preHandler: dashboardAuth }, async () => {
    const result = await getPremiumDashboardSummary();
    if (result.isErr()) throw result.error;
    return result.value;
  });

  app.get('/metrics/response-time', { preHandler: dashboardAuth }, async () => {
    const result = await getResponseTimeMetrics();
    if (result.isErr()) throw result.error;
    return result.value;
  });

  app.get('/metrics/handoff', { preHandler: dashboardAuth }, async () => {
    const result = await getHandoffMetrics();
    if (result.isErr()) throw result.error;
    return result.value;
  });

  app.get('/metrics/sector-backlog', { preHandler: dashboardAuth }, async () => {
    const result = await getSectorBacklog();
    if (result.isErr()) throw result.error;
    return result.value;
  });

  app.get<{ Querystring: { limit?: string } }>('/metrics/aging', {
    preHandler: dashboardAuth,
    schema: {
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
      },
    },
  }, async (request) => {
    const rawLimit = request.query.limit;
    const limit = rawLimit === undefined ? 20 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BadRequestError('limit deve ser um inteiro entre 1 e 100');
    }
    const result = await getAgingConversations(limit);
    if (result.isErr()) throw result.error;
    return result.value;
  });

  app.get('/metrics/alerts/criticality', { preHandler: dashboardAuth }, async () => {
    const result = await getAlertsByCriticality();
    if (result.isErr()) throw result.error;
    return result.value;
  });

  app.get('/metrics/conversations', { preHandler: [authenticate, requirePermission('dashboard:read')] }, async () => {
    const result = await getConversationMetrics();
    if (result.isErr()) {
      throw result.error;
    }
    return result.value;
  });

  app.get('/metrics/conversations/open', { preHandler: [authenticate, requirePermission('dashboard:read')] }, async () => {
    const result = await getOpenConversationsCount();
    if (result.isErr()) {
      throw result.error;
    }
    return { count: result.value };
  });

  app.get<{ Querystring: { startDate: string; endDate: string; groupBy?: 'day' | 'week' | 'month' } }>(
    '/metrics/conversations/volume',
    {
      preHandler: [authenticate, requirePermission('dashboard:read')],
      // SA-022/A08: entradas validadas no schema (400 previsível) e intervalo
      // consistente; nada de erro genérico nem agrupamento silencioso.
      schema: {
        querystring: {
          type: 'object',
          required: ['startDate', 'endDate'],
          additionalProperties: false,
          properties: {
            startDate: { type: 'string', format: 'date-time' },
            endDate: { type: 'string', format: 'date-time' },
            groupBy: { type: 'string', enum: ['day', 'week', 'month'], default: 'day' },
          },
        },
      },
    },
    async (request) => {
      const { startDate, endDate, groupBy = 'day' } = request.query;

      const start = new Date(startDate);
      const end = new Date(endDate);

      if (start.getTime() > end.getTime()) {
        throw new BadRequestError('startDate deve ser anterior ou igual a endDate', 'INVALID_RANGE');
      }
      if (end.getTime() - start.getTime() > 366 * 24 * 60 * 60 * 1000) {
        throw new BadRequestError('Intervalo máximo de 366 dias', 'INVALID_RANGE');
      }

      const result = await getConversationVolume(start, end, groupBy);
      if (result.isErr()) {
        throw result.error;
      }
      return result.value;
    }
  );

  app.get('/metrics/tasks', { preHandler: [authenticate, requirePermission('dashboard:read')] }, async () => {
    const result = await getTaskMetrics();
    if (result.isErr()) {
      throw result.error;
    }
    return result.value;
  });

  app.get('/metrics/tasks/overdue', { preHandler: [authenticate, requirePermission('dashboard:read')] }, async () => {
    const result = await getOverdueTasksCount();
    if (result.isErr()) {
      throw result.error;
    }
    return { count: result.value };
  });

  app.get('/metrics/alerts', { preHandler: [authenticate, requirePermission('dashboard:read')] }, async () => {
    const result = await getAlertMetrics();
    if (result.isErr()) {
      throw result.error;
    }
    return result.value;
  });

  app.get('/metrics/alerts/active', { preHandler: [authenticate, requirePermission('dashboard:read')] }, async () => {
    const result = await getActiveAlertsCount();
    if (result.isErr()) {
      throw result.error;
    }
    return { count: result.value };
  });
}
