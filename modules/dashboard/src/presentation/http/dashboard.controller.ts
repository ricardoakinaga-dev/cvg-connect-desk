import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
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

export async function registerDashboardRoutes(app: FastifyInstance): Promise<void> {
  const auth = [authenticate as any, requirePermission('dashboard:read') as any];

  app.get('/metrics/summary', { preHandler: auth }, async (_request, _reply) => {
    const result = await getDashboardSummary();
    if (result.isErr()) {
      throw result.error;
    }
    return result.value;
  });

  // Premium dashboard endpoint
  app.get('/metrics/premium', { preHandler: auth }, async (_request, _reply) => {
    const result = await getPremiumDashboardSummary();
    if (result.isErr()) {
      throw result.error;
    }
    return result.value;
  });

  // KPIs individuais
  app.get('/metrics/response-time', { preHandler: auth }, async (_request, _reply) => {
    const result = await getResponseTimeMetrics();
    if (result.isErr()) throw result.error;
    return result.value;
  });

  app.get('/metrics/handoff', { preHandler: auth }, async (_request, _reply) => {
    const result = await getHandoffMetrics();
    if (result.isErr()) throw result.error;
    return result.value;
  });

  app.get('/metrics/sector-backlog', { preHandler: auth }, async (_request, _reply) => {
    const result = await getSectorBacklog();
    if (result.isErr()) throw result.error;
    return result.value;
  });

  app.get('/metrics/aging', { preHandler: auth }, async (request: FastifyRequest, _reply: FastifyReply) => {
    const query = request.query as { limit?: string };
    const limit = query?.limit ? Number(query.limit) : 20;
    const result = await getAgingConversations(limit);
    if (result.isErr()) throw result.error;
    return result.value;
  });

  app.get('/metrics/alerts/criticality', { preHandler: auth }, async (_request, _reply) => {
    const result = await getAlertsByCriticality();
    if (result.isErr()) throw result.error;
    return result.value;
  });

  app.get('/metrics/conversations', { preHandler: auth }, async (_request, _reply) => {
    const result = await getConversationMetrics();
    if (result.isErr()) {
      throw result.error;
    }
    return result.value;
  });

  app.get('/metrics/conversations/open', { preHandler: auth }, async (_request, _reply) => {
    const result = await getOpenConversationsCount();
    if (result.isErr()) {
      throw result.error;
    }
    return { count: result.value };
  });

  app.get('/metrics/conversations/volume', { preHandler: auth }, async (request: FastifyRequest, _reply: FastifyReply) => {
    const query = request.query as { startDate?: string; endDate?: string; groupBy?: 'day' | 'week' | 'month' };
    const { startDate, endDate, groupBy = 'day' } = query;

    if (!startDate || !endDate) {
      throw new Error('startDate and endDate are required');
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new Error('Invalid date format. Use ISO 8601.');
    }

    const result = await getConversationVolume(start, end, groupBy);
    if (result.isErr()) {
      throw result.error;
    }
    return result.value;
  });

  app.get('/metrics/tasks', { preHandler: auth }, async (_request, _reply) => {
    const result = await getTaskMetrics();
    if (result.isErr()) {
      throw result.error;
    }
    return result.value;
  });

  app.get('/metrics/tasks/overdue', { preHandler: auth }, async (_request, _reply) => {
    const result = await getOverdueTasksCount();
    if (result.isErr()) {
      throw result.error;
    }
    return { count: result.value };
  });

  app.get('/metrics/alerts', { preHandler: auth }, async (_request, _reply) => {
    const result = await getAlertMetrics();
    if (result.isErr()) {
      throw result.error;
    }
    return result.value;
  });

  app.get('/metrics/alerts/active', { preHandler: auth }, async (_request, _reply) => {
    const result = await getActiveAlertsCount();
    if (result.isErr()) {
      throw result.error;
    }
    return { count: result.value };
  });
}
