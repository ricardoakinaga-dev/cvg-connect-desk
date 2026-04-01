import { ok, type Result } from '@cvg/shared';
import { db, schema } from '@cvg/database';
import { eq, sql, desc, isNotNull, and, lt, gte, inArray } from 'drizzle-orm';
import type {
  ResponseTimeMetrics,
  HandoffMetrics,
  SectorBacklog,
  ConversationAging,
  AlertsByCriticality,
  PremiumDashboardSummary,
} from '../../types';
import { dashboardRepository } from '../../infrastructure';

export async function getResponseTimeMetrics(): Promise<Result<ResponseTimeMetrics, Error>> {
  // Avg first response time: time between first inbound and first outbound human message
  const firstResponseResult = await db.select({
    avgSeconds: sql<number>`AVG(EXTRACT(EPOCH FROM (first_outbound - first_inbound)))`,
    count: sql<number>`COUNT(*)`,
  }).from(
    db.select({
      conversationId: schema.messages.conversationId,
      firstInbound: sql<Date>`MIN(${schema.messages.createdAt})`.as('first_inbound'),
    }).from(schema.messages)
      .where(eq(schema.messages.direction, 'inbound'))
      .groupBy(schema.messages.conversationId)
      .as('first_inbounds')
  ).innerJoin(
    db.select({
      conversationId: schema.messages.conversationId,
      firstOutbound: sql<Date>`MIN(${schema.messages.createdAt})`.as('first_outbound'),
    }).from(schema.messages)
      .where(and(
        eq(schema.messages.direction, 'outbound'),
        eq(schema.messages.senderType, 'human'),
      ))
      .groupBy(schema.messages.conversationId)
      .as('first_outbounds'),
    eq(sql`first_inbounds.conversationId`, sql`first_outbounds.conversationId`),
  ).where(sql`first_outbounds.first_outbound > first_inbounds.first_inbound`);

  const avgFirstResponseTime = firstResponseResult[0]?.avgSeconds ? Math.round(firstResponseResult[0].avgSeconds) : null;
  const totalConversationsWithResponse = firstResponseResult[0]?.count ? Number(firstResponseResult[0].count) : 0;

  // Avg response time: average time between all inbound->outbound pairs
  const avgResponseResult = await db.select({
    avgSeconds: sql<number>`AVG(EXTRACT(EPOCH FROM (outbound_at - inbound_at)))`,
  }).from(
    db.select({
      conversationId: schema.messages.conversationId,
      inboundAt: schema.messages.createdAt,
    }).from(schema.messages)
      .where(eq(schema.messages.direction, 'inbound'))
      .as('inbounds')
  ).innerJoinLateral(
    db.select({
      outboundAt: sql<Date>`MIN(${schema.messages.createdAt})`.as('outbound_at'),
    }).from(schema.messages)
      .where(and(
        eq(schema.messages.direction, 'outbound'),
        eq(schema.messages.senderType, 'human'),
        sql`${schema.messages.createdAt} > inbounds.inbound_at`,
      ))
      .groupBy(schema.messages.conversationId)
      .as('outbounds'),
    sql`true`,
  ).where(isNotNull(sql`outbounds.outbound_at`));

  const avgResponseTime = avgResponseResult[0]?.avgSeconds ? Math.round(avgResponseResult[0].avgSeconds) : null;

  return ok({
    avgFirstResponseTime,
    avgResponseTime,
    totalConversationsWithResponse,
  });
}

export async function getHandoffMetrics(): Promise<Result<HandoffMetrics, Error>> {
  const handoffResult = await db.select({
    count: sql<number>`COUNT(*)`,
  }).from(schema.auditLogs)
    .where(eq(schema.auditLogs.action, 'handoff.completed'));

  const totalConversations = await db.select({
    count: sql<number>`COUNT(*)`,
  }).from(schema.conversations);

  const totalHandoffs = handoffResult[0]?.count ? Number(handoffResult[0].count) : 0;
  const totalConvs = totalConversations[0]?.count ? Number(totalConversations[0].count) : 0;
  const handoffRate = totalConvs > 0 ? Math.round((totalHandoffs / totalConvs) * 10000) / 100 : null;

  return ok({
    totalHandoffs,
    totalConversations: totalConvs,
    handoffRate,
  });
}

export async function getSectorBacklog(): Promise<Result<SectorBacklog[], Error>> {
  const backlog = await db.select({
    sectorId: schema.sectors.id,
    sectorName: schema.sectors.name,
    openConversations: sql<number>`COUNT(CASE WHEN ${schema.conversations.status} = 'open' THEN 1 END)`,
    pendingConversations: sql<number>`COUNT(CASE WHEN ${schema.conversations.status} = 'pending' THEN 1 END)`,
  }).from(schema.sectors)
    .leftJoin(schema.conversations, eq(schema.conversations.sectorId, schema.sectors.id))
    .groupBy(schema.sectors.id, schema.sectors.name)
    .orderBy(sql`COUNT(CASE WHEN ${schema.conversations.status} IN ('open', 'pending') THEN 1 END) DESC`);

  return ok(backlog.map(b => ({
    sectorId: b.sectorId,
    sectorName: b.sectorName,
    openConversations: Number(b.openConversations),
    pendingConversations: Number(b.pendingConversations),
    totalBacklog: Number(b.openConversations) + Number(b.pendingConversations),
  })));
}

export async function getAgingConversations(limit = 20): Promise<Result<ConversationAging[], Error>> {
  const conversations = await db.select({
    id: schema.conversations.id,
    status: schema.conversations.status,
    sectorName: schema.sectors.name,
    lastMessageAt: sql<Date>`MAX(${schema.messages.createdAt})`,
  }).from(schema.conversations)
    .leftJoin(schema.sectors, eq(schema.conversations.sectorId, schema.sectors.id))
    .leftJoin(schema.messages, eq(schema.messages.conversationId, schema.conversations.id))
    .where(and(
      eq(schema.conversations.isActive, true),
      inArray(schema.conversations.status, ['open', 'pending']),
    ))
    .groupBy(schema.conversations.id, schema.sectors.name)
    .orderBy(sql`MAX(${schema.messages.createdAt}) ASC`)
    .limit(limit);

  const now = Date.now();
  const aging = conversations.map(c => {
    const hoursSinceLastMessage = c.lastMessageAt
      ? Math.round((now - c.lastMessageAt.getTime()) / 3600000 * 10) / 10
      : null;

    let agingBucket: 'fresh' | 'normal' | 'old' | 'critical' = 'fresh';
    if (hoursSinceLastMessage !== null) {
      if (hoursSinceLastMessage > 24) agingBucket = 'critical';
      else if (hoursSinceLastMessage > 8) agingBucket = 'old';
      else if (hoursSinceLastMessage > 2) agingBucket = 'normal';
    }

    return {
      conversationId: c.id,
      status: c.status,
      sectorName: c.sectorName,
      lastMessageAt: c.lastMessageAt?.toISOString() || null,
      hoursSinceLastMessage,
      agingBucket,
    };
  });

  return ok(aging);
}

export async function getAlertsByCriticality(): Promise<Result<AlertsByCriticality, Error>> {
  const result = await db.select({
    severity: schema.alerts.severity,
    count: sql<number>`COUNT(*)`,
  }).from(schema.alerts)
    .where(eq(schema.alerts.status, 'active'))
    .groupBy(schema.alerts.severity);

  const alerts: AlertsByCriticality = { critical: 0, error: 0, warning: 0, info: 0 };
  for (const row of result) {
    if (row.severity === 'critical') alerts.critical = Number(row.count);
    else if (row.severity === 'error') alerts.error = Number(row.count);
    else if (row.severity === 'warning') alerts.warning = Number(row.count);
    else if (row.severity === 'info') alerts.info = Number(row.count);
  }

  return ok(alerts);
}

export async function getPremiumDashboardSummary(): Promise<Result<PremiumDashboardSummary, Error>> {
  const [
    conversations,
    tasks,
    alerts,
    responseTime,
    handoff,
    sectorBacklog,
    agingConversations,
    alertsByCriticality,
  ] = await Promise.all([
    dashboardRepository.getConversationMetrics(),
    dashboardRepository.getTaskMetrics(),
    dashboardRepository.getAlertMetrics(),
    getResponseTimeMetrics().then(r => r.isOk() ? r.value : { avgFirstResponseTime: null, avgResponseTime: null, totalConversationsWithResponse: 0 }),
    getHandoffMetrics().then(r => r.isOk() ? r.value : { totalHandoffs: 0, totalConversations: 0, handoffRate: null }),
    getSectorBacklog().then(r => r.isOk() ? r.value : []),
    getAgingConversations().then(r => r.isOk() ? r.value : []),
    getAlertsByCriticality().then(r => r.isOk() ? r.value : { critical: 0, error: 0, warning: 0, info: 0 }),
  ]);

  return ok({
    conversations,
    tasks,
    alerts,
    responseTime,
    handoff,
    sectorBacklog,
    agingConversations,
    alertsByCriticality,
    generatedAt: new Date().toISOString(),
  });
}
