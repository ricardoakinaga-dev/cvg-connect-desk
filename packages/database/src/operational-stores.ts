import { and, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { db, schema } from './index';

export interface PersistedWebhookSecurityDecision {
  reason: string;
  allowed: boolean;
  webhookMode: string;
  hasSecret: boolean;
  signaturePresent?: boolean;
  statusCode?: number;
  timestamp: string;
}

export interface PersistentWebhookSecurityStats {
  total: number;
  allowed: number;
  denied: number;
  byReason: Record<string, number>;
  lastDecisionAt: string | null;
  lastDecision: PersistedWebhookSecurityDecision | null;
}

const WEBHOOK_SECURITY_REASONS = [
  'missing_secret',
  'missing_signature',
  'invalid_signature_format',
  'invalid_signature',
  'signature_valid',
] as const;

export async function persistWebhookSecurityDecision(
  decision: PersistedWebhookSecurityDecision,
): Promise<void> {
  await db.insert(schema.webhookSecurityEvents).values({
    reason: decision.reason,
    allowed: decision.allowed,
    webhookMode: decision.webhookMode,
    hasSecret: decision.hasSecret,
    signaturePresent: decision.signaturePresent,
    statusCode: decision.statusCode,
    occurredAt: new Date(decision.timestamp),
  });
}

export async function getPersistentWebhookSecurityStats(): Promise<PersistentWebhookSecurityStats> {
  const grouped = await db
    .select({
      reason: schema.webhookSecurityEvents.reason,
      allowed: schema.webhookSecurityEvents.allowed,
      count: sql<number>`count(*)`,
    })
    .from(schema.webhookSecurityEvents)
    .groupBy(schema.webhookSecurityEvents.reason, schema.webhookSecurityEvents.allowed);

  const byReason: Record<string, number> = Object.fromEntries(
    WEBHOOK_SECURITY_REASONS.map((reason) => [reason, 0]),
  );
  let total = 0;
  let allowed = 0;

  for (const row of grouped) {
    const count = Number(row.count);
    total += count;
    if (row.allowed) {
      allowed += count;
    }
    byReason[row.reason] = (byReason[row.reason] || 0) + count;
  }

  const [last] = await db
    .select()
    .from(schema.webhookSecurityEvents)
    .orderBy(desc(schema.webhookSecurityEvents.occurredAt))
    .limit(1);

  const lastDecision = last
    ? {
      reason: last.reason,
      allowed: last.allowed,
      webhookMode: last.webhookMode,
      hasSecret: last.hasSecret,
      signaturePresent: last.signaturePresent ?? undefined,
      statusCode: last.statusCode ?? undefined,
      timestamp: last.occurredAt.toISOString(),
    }
    : null;

  return {
    total,
    allowed,
    denied: total - allowed,
    byReason,
    lastDecisionAt: lastDecision?.timestamp || null,
    lastDecision,
  };
}

export interface GatewayReplayStore {
  claim(scope: string, nonce: string, expiresAt: Date): Promise<boolean>;
}

/**
 * Claims a gateway nonce in PostgreSQL. A unique constraint makes the claim
 * atomic across API replicas; expired claims are removed before insertion.
 */
export async function claimGatewayRequestNonce(
  scope: string,
  nonce: string,
  expiresAt: Date,
): Promise<boolean> {
  await db
    .delete(schema.gatewayRequestNonces)
    .where(lt(schema.gatewayRequestNonces.expiresAt, new Date()));

  const inserted = await db
    .insert(schema.gatewayRequestNonces)
    .values({ scope, nonce, expiresAt })
    .onConflictDoNothing({
      target: [schema.gatewayRequestNonces.scope, schema.gatewayRequestNonces.nonce],
    })
    .returning({ id: schema.gatewayRequestNonces.id });

  return inserted.length > 0;
}

export async function deleteGatewayRequestNoncesForTest(scope: string): Promise<void> {
  await db
    .delete(schema.gatewayRequestNonces)
    .where(and(eq(schema.gatewayRequestNonces.scope, scope)));
}

export interface PersistentOperationalMetrics {
  generatedAt: string;
  outbox: {
    pending: number;
    retrying: number;
    oldestCreatedAt: string | null;
    oldestAgeMs: number;
  };
  deadLetter: {
    unresolved: number;
    retrying: number;
    oldestFailedAt: string | null;
    oldestAgeMs: number;
  };
  thresholds: {
    outboxPending: number;
    deadLetterUnresolved: number;
    triggered: string[];
  };
}

export async function getPersistentOperationalMetrics(): Promise<PersistentOperationalMetrics> {
  const now = new Date();
  const [outboxPending, outboxRetrying, outboxOldest, deadLetterUnresolved, deadLetterRetrying, deadLetterOldest] = await Promise.all([
    db.select({ count: sql<number>`count(*)` })
      .from(schema.outboxEvents)
      .where(isNull(schema.outboxEvents.processedAt)),
    db.select({ count: sql<number>`count(*)` })
      .from(schema.outboxEvents)
      .where(and(isNull(schema.outboxEvents.processedAt), gt(schema.outboxEvents.retryCount, 0))),
    db.select({ oldest: sql<Date | null>`min(${schema.outboxEvents.createdAt})` })
      .from(schema.outboxEvents)
      .where(isNull(schema.outboxEvents.processedAt)),
    db.select({ count: sql<number>`count(*)` })
      .from(schema.deadLetterEvents)
      .where(eq(schema.deadLetterEvents.resolved, false)),
    db.select({ count: sql<number>`count(*)` })
      .from(schema.deadLetterEvents)
      .where(and(eq(schema.deadLetterEvents.resolved, false), gt(schema.deadLetterEvents.retryCount, 0))),
    db.select({ oldest: sql<Date | null>`min(${schema.deadLetterEvents.failedAt})` })
      .from(schema.deadLetterEvents)
      .where(eq(schema.deadLetterEvents.resolved, false)),
  ]);

  const pending = Number(outboxPending[0]?.count || 0);
  const retrying = Number(outboxRetrying[0]?.count || 0);
  const unresolved = Number(deadLetterUnresolved[0]?.count || 0);
  const deadLetterRetryCount = Number(deadLetterRetrying[0]?.count || 0);
  const oldestCreatedAt = outboxOldest[0]?.oldest ? new Date(outboxOldest[0].oldest).toISOString() : null;
  const oldestFailedAt = deadLetterOldest[0]?.oldest ? new Date(deadLetterOldest[0].oldest).toISOString() : null;
  const outboxPendingThreshold = Number(process.env.OPS_OUTBOX_PENDING_THRESHOLD || 100);
  const deadLetterThreshold = Number(process.env.OPS_DLQ_UNRESOLVED_THRESHOLD || 10);
  const triggered: string[] = [];

  if (pending >= outboxPendingThreshold) triggered.push('outbox_backlog');
  if (unresolved >= deadLetterThreshold) triggered.push('dead_letter_backlog');

  return {
    generatedAt: now.toISOString(),
    outbox: {
      pending,
      retrying,
      oldestCreatedAt,
      oldestAgeMs: oldestCreatedAt ? Math.max(0, now.getTime() - Date.parse(oldestCreatedAt)) : 0,
    },
    deadLetter: {
      unresolved,
      retrying: deadLetterRetryCount,
      oldestFailedAt,
      oldestAgeMs: oldestFailedAt ? Math.max(0, now.getTime() - Date.parse(oldestFailedAt)) : 0,
    },
    thresholds: {
      outboxPending: outboxPendingThreshold,
      deadLetterUnresolved: deadLetterThreshold,
      triggered,
    },
  };
}
