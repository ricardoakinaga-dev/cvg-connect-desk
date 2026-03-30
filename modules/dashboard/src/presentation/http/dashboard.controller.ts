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
} from '../../application/use-cases';
import { authenticate, requirePermission } from '@cvg/auth';

export async function registerDashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/metrics/summary', { preHandler: [authenticate, requirePermission('dashboard:read')] }, async () => {
    const result = await getDashboardSummary();
    if (result.isErr()) {
      throw result.error;
    }
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
    { preHandler: [authenticate, requirePermission('dashboard:read')] },
    async (request) => {
      const { startDate, endDate, groupBy = 'day' } = request.query;

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
