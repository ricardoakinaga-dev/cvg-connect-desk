import { db, schema } from '@cvg/database';
import { eq, and, gte, lt, inArray, sql, desc } from 'drizzle-orm';
import type {
  ConversationMetrics,
  ConversationVolume,
  TaskMetrics,
  AlertMetrics,
  DashboardSummary,
  TimeRange,
} from '../types';

export class DashboardRepository {
  async getConversationMetrics(): Promise<ConversationMetrics> {
    const results = await db
      .select({
        status: schema.conversations.status,
        count: sql<number>`count(*)`,
      })
      .from(schema.conversations)
      .groupBy(schema.conversations.status);

    const metrics: ConversationMetrics = {
      open: 0,
      pending: 0,
      closed: 0,
      archived: 0,
      total: 0,
    };

    for (const row of results) {
      const count = Number(row.count);
      metrics.total += count;
      if (row.status === 'open') metrics.open = count;
      else if (row.status === 'pending') metrics.pending = count;
      else if (row.status === 'closed') metrics.closed = count;
      else if (row.status === 'archived') metrics.archived = count;
    }

    return metrics;
  }

  async getConversationVolume(timeRange: TimeRange, groupBy: 'day' | 'week' | 'month' = 'day'): Promise<ConversationVolume[]> {
    const format = groupBy === 'day' ? 'YYYY-MM-DD' : groupBy === 'week' ? 'IYYY-IW' : 'YYYY-MM';

    const results = await db
      .select({
        date: sql<string>`to_char(${schema.conversations.createdAt}, ${format})`,
        count: sql<number>`count(*)`,
      })
      .from(schema.conversations)
      .where(and(
        gte(schema.conversations.createdAt, timeRange.start),
        lt(schema.conversations.createdAt, timeRange.end)
      ))
      .groupBy(sql`to_char(${schema.conversations.createdAt}, ${format})`)
      .orderBy(sql`to_char(${schema.conversations.createdAt}, ${format})`);

    return results.map(r => ({
      date: r.date,
      count: Number(r.count),
    }));
  }

  async getTaskMetrics(): Promise<TaskMetrics> {
    const results = await db
      .select({
        status: schema.tasks.status,
        count: sql<number>`count(*)`,
      })
      .from(schema.tasks)
      .groupBy(schema.tasks.status);

    const metrics: TaskMetrics = {
      total: 0,
      pending: 0,
      inProgress: 0,
      completed: 0,
      cancelled: 0,
      overdue: 0,
    };

    for (const row of results) {
      const count = Number(row.count);
      metrics.total += count;
      if (row.status === 'pending') metrics.pending = count;
      else if (row.status === 'in_progress') metrics.inProgress = count;
      else if (row.status === 'completed') metrics.completed = count;
      else if (row.status === 'cancelled') metrics.cancelled = count;
    }

    const overdueResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.tasks)
      .where(and(
        lt(schema.tasks.dueAt, new Date()),
        sql`${schema.tasks.status} NOT IN ('completed', 'cancelled')`
      ));
    metrics.overdue = Number(overdueResult[0]?.count || 0);

    return metrics;
  }

  async getAlertMetrics(): Promise<AlertMetrics> {
    const statusResults = await db
      .select({
        status: schema.alerts.status,
        count: sql<number>`count(*)`,
      })
      .from(schema.alerts)
      .groupBy(schema.alerts.status);

    const severityResults = await db
      .select({
        severity: schema.alerts.severity,
        count: sql<number>`count(*)`,
      })
      .from(schema.alerts)
      .groupBy(schema.alerts.severity);

    const metrics: AlertMetrics = {
      total: 0,
      active: 0,
      acknowledged: 0,
      resolved: 0,
      bySeverity: {
        info: 0,
        warning: 0,
        error: 0,
        critical: 0,
      },
    };

    for (const row of statusResults) {
      const count = Number(row.count);
      metrics.total += count;
      if (row.status === 'active') metrics.active = count;
      else if (row.status === 'acknowledged') metrics.acknowledged = count;
      else if (row.status === 'resolved') metrics.resolved = count;
    }

    for (const row of severityResults) {
      if (row.severity === 'info') metrics.bySeverity.info = Number(row.count);
      else if (row.severity === 'warning') metrics.bySeverity.warning = Number(row.count);
      else if (row.severity === 'error') metrics.bySeverity.error = Number(row.count);
      else if (row.severity === 'critical') metrics.bySeverity.critical = Number(row.count);
    }

    return metrics;
  }

  async getDashboardSummary(): Promise<DashboardSummary> {
    const [conversations, tasks, alerts] = await Promise.all([
      this.getConversationMetrics(),
      this.getTaskMetrics(),
      this.getAlertMetrics(),
    ]);

    return {
      conversations,
      tasks,
      alerts,
      generatedAt: new Date().toISOString(),
    };
  }

  async getConversationsByStatus(statuses: ('open' | 'pending' | 'closed' | 'archived')[]): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.conversations)
      .where(inArray(schema.conversations.status, statuses));

    return Number(result[0]?.count || 0);
  }

  async getTasksOverdue(asOf: Date = new Date()): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.tasks)
      .where(and(
        lt(schema.tasks.dueAt, asOf),
        sql`${schema.tasks.status} NOT IN ('completed', 'cancelled')`
      ));

    return Number(result[0]?.count || 0);
  }

  async getAlertsActive(statuses: ('active' | 'acknowledged')[] = ['active']): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.alerts)
      .where(inArray(schema.alerts.status, statuses));

    return Number(result[0]?.count || 0);
  }
}

export const dashboardRepository = new DashboardRepository();
