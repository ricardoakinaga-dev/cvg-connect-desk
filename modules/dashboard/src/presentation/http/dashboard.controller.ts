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
  getFirstResponseTimeMetric,
  getHandoffRateMetric,
} from '../../application/use-cases';
import { authenticate, requirePermission } from '@cvg/auth';
import { BadRequestError } from '@cvg/shared';

let summaryCache: { expiresAtMs: number; value: unknown } | null = null;
let summaryInFlight: Promise<unknown> | null = null;

function getSummaryCacheTtlMs(): number {
  const configured = Number(process.env.DASHBOARD_SUMMARY_CACHE_TTL_MS || '');
  if (Number.isFinite(configured) && configured >= 0) {
    return configured;
  }
  return process.env.VITEST ? 0 : 1_000;
}

async function getCachedDashboardSummary() {
  const ttlMs = getSummaryCacheTtlMs();
  const now = Date.now();
  if (ttlMs > 0 && summaryCache && summaryCache.expiresAtMs > now) {
    return summaryCache.value;
  }

  if (summaryInFlight) {
    return summaryInFlight;
  }

  summaryInFlight = getDashboardSummary().then((result) => {
    if (result.isErr()) {
      throw result.error;
    }
    if (ttlMs > 0) {
      summaryCache = {
        value: result.value,
        expiresAtMs: Date.now() + ttlMs,
      };
    }
    return result.value;
  }).finally(() => {
    summaryInFlight = null;
  });

  return summaryInFlight;
}

const MAX_METRIC_RANGE_MS = 366 * 24 * 60 * 60 * 1000;

function parseMetricTimeRange(startDate: string | undefined, endDate: string | undefined): { start: Date; end: Date } {
  if (!startDate || !endDate) {
    throw new BadRequestError('startDate and endDate are required', 'METRIC_DATE_RANGE_REQUIRED');
  }

  const start = new Date(startDate);
  const end = new Date(endDate);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    throw new BadRequestError('startDate and endDate must be valid ISO 8601 dates', 'METRIC_DATE_INVALID');
  }

  if (end <= start) {
    throw new BadRequestError('endDate must be after startDate', 'METRIC_DATE_RANGE_INVALID');
  }

  if (end.getTime() - start.getTime() > MAX_METRIC_RANGE_MS) {
    throw new BadRequestError('Metric date range cannot exceed 366 days', 'METRIC_DATE_RANGE_TOO_LARGE');
  }

  return { start, end };
}

export async function registerDashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/metrics/summary', { preHandler: [authenticate, requirePermission('dashboard:read')] }, async () => {
    return getCachedDashboardSummary();
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
      schema: {
        querystring: {
          type: 'object',
          required: ['startDate', 'endDate'],
          properties: {
            startDate: { type: 'string', minLength: 1, maxLength: 64 },
            endDate: { type: 'string', minLength: 1, maxLength: 64 },
            groupBy: { type: 'string', enum: ['day', 'week', 'month'], default: 'day' },
          },
          additionalProperties: false,
        },
      },
    },
    async (request) => {
      const { startDate, endDate, groupBy = 'day' } = request.query;
      const { start, end } = parseMetricTimeRange(startDate, endDate);

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

  // D1: Tempo Médio de Primeira Resposta
  app.get<{ Querystring: { startDate: string; endDate: string } }>(
    '/metrics/first-response-time',
    {
      preHandler: [authenticate, requirePermission('dashboard:read')],
      schema: {
        querystring: {
          type: 'object',
          required: ['startDate', 'endDate'],
          properties: {
            startDate: { type: 'string', minLength: 1, maxLength: 64 },
            endDate: { type: 'string', minLength: 1, maxLength: 64 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request) => {
      const { startDate, endDate } = request.query;
      const { start, end } = parseMetricTimeRange(startDate, endDate);

      const result = await getFirstResponseTimeMetric(start, end);
      if (result.isErr()) {
        throw result.error;
      }
      return result.value;
    }
  );

  // D2: Taxa de Handoff
  app.get<{ Querystring: { startDate: string; endDate: string } }>(
    '/metrics/handoff-rate',
    {
      preHandler: [authenticate, requirePermission('dashboard:read')],
      schema: {
        querystring: {
          type: 'object',
          required: ['startDate', 'endDate'],
          properties: {
            startDate: { type: 'string', minLength: 1, maxLength: 64 },
            endDate: { type: 'string', minLength: 1, maxLength: 64 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request) => {
      const { startDate, endDate } = request.query;
      const { start, end } = parseMetricTimeRange(startDate, endDate);

      const result = await getHandoffRateMetric(start, end);
      if (result.isErr()) {
        throw result.error;
      }
      return result.value;
    }
  );
}
