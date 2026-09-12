import { db, schema } from '@cvg/database';
import { eq, and, gte, lt, inArray, sql, desc, isNull, or } from 'drizzle-orm';
import type {
  ConversationMetrics,
  ConversationVolume,
  TaskMetrics,
  AlertMetrics,
  DashboardSummary,
  TimeRange,
  ResponseTimeMetrics,
  HandoffMetrics,
  SectorBacklog,
  ConversationAging,
  ConversationAgingBucket,
  AlertsByCriticality,
} from '../types';

export function classifyConversationAging(hoursSinceLastMessage: number | null): ConversationAgingBucket {
  if (hoursSinceLastMessage === null || hoursSinceLastMessage <= 2) return 'fresh';
  if (hoursSinceLastMessage <= 8) return 'normal';
  if (hoursSinceLastMessage <= 24) return 'old';
  return 'critical';
}

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

  /**
   * Mede o tempo até a primeira resposta humana. As subconsultas são
   * correlacionadas por conversation_id para não misturar mensagens de
   * conversas diferentes.
   */
  async getResponseTimeMetrics(): Promise<ResponseTimeMetrics> {
    const firstInbound = db.select({
      conversationId: schema.messages.conversationId,
      firstInbound: sql<Date>`MIN(${schema.messages.createdAt})`.as('first_inbound'),
    })
      .from(schema.messages)
      .where(eq(schema.messages.direction, 'inbound'))
      .groupBy(schema.messages.conversationId)
      .as('first_inbound');

    const firstResponse = await db.select({
      avgSeconds: sql<number>`AVG(EXTRACT(EPOCH FROM (${sql.raw('first_response.first_outbound')} - ${firstInbound.firstInbound})))`,
      count: sql<number>`COUNT(*)`,
    })
      .from(firstInbound)
      .innerJoinLateral(
        db.select({
          firstOutbound: sql<Date>`MIN(${schema.messages.createdAt})`.as('first_outbound'),
        })
          .from(schema.messages)
          .where(and(
            eq(schema.messages.conversationId, firstInbound.conversationId),
            eq(schema.messages.direction, 'outbound'),
            or(eq(schema.messages.senderType, 'human'), isNull(schema.messages.senderType)),
            sql`${schema.messages.createdAt} > ${firstInbound.firstInbound}`,
          ))
          .as('first_response'),
        sql`true`,
      )
      .where(and(
        sql`${sql.raw('first_response.first_outbound')} IS NOT NULL`,
        sql`${sql.raw('first_response.first_outbound')} > ${firstInbound.firstInbound}`,
      ));

    const averageResponse = await db.select({
      avgSeconds: sql<number>`AVG(EXTRACT(EPOCH FROM (${sql.raw('response.outbound_at')} - ${sql.raw('inbounds.inbound_at')})))`,
    })
      .from(
        db.select({
          conversationId: schema.messages.conversationId,
          inboundAt: schema.messages.createdAt,
        })
          .from(schema.messages)
          .where(eq(schema.messages.direction, 'inbound'))
          .as('inbounds'),
      )
      .innerJoinLateral(
        db.select({
          outboundAt: sql<Date>`MIN(${schema.messages.createdAt})`.as('outbound_at'),
        })
          .from(schema.messages)
          .where(and(
            eq(schema.messages.conversationId, sql.raw('inbounds.conversation_id')),
            eq(schema.messages.direction, 'outbound'),
            or(eq(schema.messages.senderType, 'human'), isNull(schema.messages.senderType)),
            sql`${schema.messages.createdAt} > ${sql.raw('inbounds.inbound_at')}`,
          ))
          .as('response'),
        sql`true`,
      )
      .where(and(
        sql`${sql.raw('response.outbound_at')} IS NOT NULL`,
        sql`${sql.raw('response.outbound_at')} > ${sql.raw('inbounds.inbound_at')}`,
      ));

    const avgFirstResponseTime = firstResponse[0]?.avgSeconds == null
      ? null
      : Math.round(Number(firstResponse[0].avgSeconds));
    const avgResponseTime = averageResponse[0]?.avgSeconds == null
      ? null
      : Math.round(Number(averageResponse[0].avgSeconds));

    return {
      avgFirstResponseTime,
      avgResponseTime,
      totalConversationsWithResponse: Number(firstResponse[0]?.count || 0),
    };
  }

  async getHandoffMetrics(): Promise<HandoffMetrics> {
    const [handoffs, conversations] = await Promise.all([
      db.select({ count: sql<number>`COUNT(DISTINCT ${schema.auditLogs.entityId})` })
        .from(schema.auditLogs)
        .where(and(
          eq(schema.auditLogs.entityType, 'conversation'),
          inArray(schema.auditLogs.action, ['conversation.handoff', 'handoff.completed']),
        )),
      db.select({ count: sql<number>`COUNT(*)` }).from(schema.conversations),
    ]);

    const totalHandoffs = Number(handoffs[0]?.count || 0);
    const totalConversations = Number(conversations[0]?.count || 0);

    return {
      totalHandoffs,
      totalConversations,
      handoffRate: totalConversations > 0
        ? Math.round((totalHandoffs / totalConversations) * 10000) / 100
        : null,
    };
  }

  async getSectorBacklog(): Promise<SectorBacklog[]> {
    const rows = await db.select({
      sectorId: schema.sectors.id,
      sectorName: schema.sectors.name,
      openConversations: sql<number>`COUNT(*) FILTER (WHERE ${schema.conversations.status} = 'open')`,
      pendingConversations: sql<number>`COUNT(*) FILTER (WHERE ${schema.conversations.status} = 'pending')`,
    })
      .from(schema.sectors)
      .leftJoin(schema.conversations, and(
        eq(schema.conversations.sectorId, schema.sectors.id),
        eq(schema.conversations.isActive, true),
        inArray(schema.conversations.status, ['open', 'pending']),
      ))
      .where(eq(schema.sectors.isActive, true))
      .groupBy(schema.sectors.id, schema.sectors.name)
      .orderBy(sql`COUNT(*) FILTER (WHERE ${schema.conversations.status} IN ('open', 'pending')) DESC`, schema.sectors.name);

    return rows.map((row) => {
      const openConversations = Number(row.openConversations || 0);
      const pendingConversations = Number(row.pendingConversations || 0);
      return {
        sectorId: row.sectorId,
        sectorName: row.sectorName,
        openConversations,
        pendingConversations,
        totalBacklog: openConversations + pendingConversations,
      };
    });
  }

  async getAgingConversations(limit = 20): Promise<ConversationAging[]> {
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
    const rows = await db.select({
      id: schema.conversations.id,
      status: schema.conversations.status,
      sectorName: schema.sectors.name,
      lastMessageAt: sql<Date | null>`MAX(${schema.messages.createdAt})`,
    })
      .from(schema.conversations)
      .leftJoin(schema.sectors, eq(schema.conversations.sectorId, schema.sectors.id))
      .leftJoin(schema.messages, eq(schema.messages.conversationId, schema.conversations.id))
      .where(and(
        eq(schema.conversations.isActive, true),
        inArray(schema.conversations.status, ['open', 'pending']),
      ))
      .groupBy(schema.conversations.id, schema.conversations.status, schema.sectors.name)
      .orderBy(sql`MAX(${schema.messages.createdAt}) ASC NULLS FIRST`)
      .limit(safeLimit);

    const now = Date.now();
    return rows.map((row) => {
      const lastMessageAt = row.lastMessageAt instanceof Date ? row.lastMessageAt : null;
      const hoursSinceLastMessage = lastMessageAt
        ? Math.max(0, Math.round(((now - lastMessageAt.getTime()) / 3_600_000) * 10) / 10)
        : null;
      const agingBucket = classifyConversationAging(hoursSinceLastMessage);

      return {
        conversationId: row.id,
        status: row.status as 'open' | 'pending',
        sectorName: row.sectorName,
        lastMessageAt: lastMessageAt?.toISOString() || null,
        hoursSinceLastMessage,
        agingBucket,
      };
    });
  }

  async getAlertsByCriticality(): Promise<AlertsByCriticality> {
    const rows = await db.select({
      severity: schema.alerts.severity,
      count: sql<number>`COUNT(*)`,
    })
      .from(schema.alerts)
      .where(eq(schema.alerts.status, 'active'))
      .groupBy(schema.alerts.severity);

    const result: AlertsByCriticality = { critical: 0, error: 0, warning: 0, info: 0 };
    for (const row of rows) result[row.severity] = Number(row.count);
    return result;
  }
}

export const dashboardRepository = new DashboardRepository();
