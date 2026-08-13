import { db, schema } from '@cvg/database';
import { and, gte, lt, inArray, sql, lt as lessThan } from 'drizzle-orm';
import type {
  ConversationMetrics,
  ConversationVolume,
  TaskMetrics,
  AlertMetrics,
  DashboardSummary,
  TimeRange,
  FirstResponseTimeMetric,
  HandoffRateMetric,
  HandoffMetrics,
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
        lessThan(schema.tasks.dueAt, new Date()),
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
        lessThan(schema.tasks.dueAt, asOf),
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

  /**
   * D1: Tempo Médio de Primeira Resposta
   * Calcula o tempo entre a primeira mensagem inbound e a primeira resposta
   * outbound classificada explicitamente como humana. Respostas de bot e
   * sistema não entram no D1.
   */
  async getFirstResponseTimeMetric(timeRange: TimeRange): Promise<FirstResponseTimeMetric> {
    const result = await db.execute(sql`
      WITH first_inbound AS (
        SELECT DISTINCT ON (conversation_id)
          conversation_id,
          created_at as first_inbound_at
        FROM messages
        WHERE direction = 'inbound'
          AND created_at >= ${timeRange.start}
          AND created_at < ${timeRange.end}
        ORDER BY conversation_id, created_at ASC
      ),
      first_outbound AS (
        SELECT DISTINCT ON (conversation_id)
          conversation_id,
          created_at as first_outbound_at
        FROM messages
        WHERE direction = 'outbound'
          AND sender_type IN ('human', 'user', 'agent')
          AND created_at >= ${timeRange.start}
          AND created_at < ${timeRange.end}
        ORDER BY conversation_id, created_at ASC
      )
      SELECT
        COUNT(*) as count,
        COALESCE(
          AVG(EXTRACT(EPOCH FROM (fo.first_outbound_at - fi.first_inbound_at)) * 1000),
          0
        ) as avg_response_time_ms
      FROM first_inbound fi
      INNER JOIN first_outbound fo
        ON fi.conversation_id = fo.conversation_id
      WHERE fo.first_outbound_at > fi.first_inbound_at
    `);

    const row = result.rows[0] as { count: number; avg_response_time_ms: number } | undefined;

    return {
      avgResponseTimeMs: Number(row?.avg_response_time_ms || 0),
      count: Number(row?.count || 0),
      period: `${timeRange.start.toISOString()} - ${timeRange.end.toISOString()}`,
      calculatedAt: new Date().toISOString(),
    };
  }

  /**
   * D2: Taxa de Handoff (bot -> human)
   * Calcula o percentual de conversas que transitaram de bot para human
   */
  async getHandoffRateMetric(timeRange: TimeRange): Promise<HandoffRateMetric> {
    // Total de conversas na janela
    const totalResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.conversations)
      .where(and(
        gte(schema.conversations.createdAt, timeRange.start),
        lt(schema.conversations.createdAt, timeRange.end)
      ));

    const totalConversations = Number(totalResult[0]?.count || 0);

    // Uma conversa teve handoff quando uma resposta humana explícita ocorreu
    // depois do primeiro inbound.
    const handoffResult = await db.execute(sql`
      WITH conversation_first_inbound AS (
        SELECT DISTINCT ON (conversation_id)
          conversation_id,
          created_at as first_inbound_at
        FROM messages
        WHERE direction = 'inbound'
          AND created_at >= ${timeRange.start}
          AND created_at < ${timeRange.end}
        ORDER BY conversation_id, created_at ASC
      ),
      conversation_first_human_outbound AS (
        SELECT DISTINCT ON (conversation_id)
          conversation_id,
          created_at as first_outbound_at
        FROM messages
        WHERE direction = 'outbound'
          AND sender_type IN ('human', 'user', 'agent')
          AND created_at >= ${timeRange.start}
          AND created_at < ${timeRange.end}
        ORDER BY conversation_id, created_at ASC
      )
      SELECT COUNT(*) as handoff_count
      FROM conversation_first_inbound fi
      INNER JOIN conversation_first_human_outbound fo
        ON fi.conversation_id = fo.conversation_id
      WHERE fo.first_outbound_at > fi.first_inbound_at
    `);

    const conversationsWithHandoff = Number(
      (handoffResult.rows[0] as { handoff_count: number } | undefined)?.handoff_count || 0
    );

    const handoffRate = totalConversations > 0
      ? (conversationsWithHandoff / totalConversations) * 100
      : 0;

    return {
      handoffRate: Math.round(handoffRate * 100) / 100,
      totalConversations,
      conversationsWithHandoff,
      period: `${timeRange.start.toISOString()} - ${timeRange.end.toISOString()}`,
      calculatedAt: new Date().toISOString(),
    };
  }

  /**
   * D2: Métricas detalhadas de Handoff
   */
  async getHandoffMetrics(timeRange: TimeRange): Promise<HandoffMetrics> {
    // Total de handoffs (conversas com inbound E outbound humano explícito)
    const totalResult = await db.execute(sql`
      WITH conversation_first_inbound AS (
        SELECT DISTINCT ON (conversation_id)
          conversation_id,
          created_at as first_inbound_at
        FROM messages
        WHERE direction = 'inbound'
          AND created_at >= ${timeRange.start}
          AND created_at < ${timeRange.end}
        ORDER BY conversation_id, created_at ASC
      ),
      conversation_first_human_outbound AS (
        SELECT DISTINCT ON (conversation_id)
          conversation_id,
          created_at as first_outbound_at
        FROM messages
        WHERE direction = 'outbound'
          AND sender_type IN ('human', 'user', 'agent')
          AND created_at >= ${timeRange.start}
          AND created_at < ${timeRange.end}
        ORDER BY conversation_id, created_at ASC
      )
      SELECT COUNT(*) as total
      FROM conversation_first_inbound fi
      INNER JOIN conversation_first_human_outbound fo
        ON fi.conversation_id = fo.conversation_id
      WHERE fo.first_outbound_at > fi.first_inbound_at
    `);

    const total = Number((totalResult.rows[0] as { total: number } | undefined)?.total || 0);

    return {
      total,
      botToHuman: total, // Simplified: bot->human is when inbound (bot) then outbound human
      humanToBot: 0, // Not tracked in current model
      period: `${timeRange.start.toISOString()} - ${timeRange.end.toISOString()}`,
      calculatedAt: new Date().toISOString(),
    };
  }
}

export const dashboardRepository = new DashboardRepository();
