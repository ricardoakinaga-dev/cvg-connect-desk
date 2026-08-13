import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq, exists, isNotNull, isNull, like, not, or, sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { schema } from '@cvg/database';
import type { ConsumerId } from '../outbox-reader';

const connectionString = process.env.DATABASE_URL || 'postgresql://connect_desk:root@localhost:5432/connect_desk_db';
const pool = new Pool({ connectionString });

export const requiresRealDatabase = process.env.REQUIRE_REAL_DB === '1' || process.env.CI === 'true';

export function assertRealDatabaseAvailable(result: { available: true } | { available: false; reason: string }): void {
  if (result.available || !requiresRealDatabase) {
    return;
  }

  throw new Error(
    `[real-db] PostgreSQL is required for this test suite but is unavailable: ${result.reason}. ` +
      'Start PostgreSQL, run migrations, and unset no required test gate.',
  );
}

export const db = drizzle(pool, { schema });

export async function closeRealDatabase(): Promise<void> {
  await pool.end();
}

export interface OutboxSeed {
  eventId: string;
  eventType?: string;
  eventVersion?: number;
  aggregateType?: string;
  aggregateId?: string;
  payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  correlationId?: string | null;
  causationId?: string | null;
  version?: number;
  occurredAt?: Date;
  createdAt?: Date;
}

export async function probeRealDatabase(): Promise<{ available: true } | { available: false; reason: string }> {
  try {
    await db.execute(sql`select 1 as ok`);
    // Also verify the outbox tables exist (migrations may not have run)
    try {
      await db.execute(sql`SELECT 1 FROM outbox_events LIMIT 1`);
    } catch {
      const result = {
        available: false,
        reason: 'outbox_events table does not exist (run migrations)',
      } as const;
      assertRealDatabaseAvailable(result);
      return result;
    }
    try {
      await db.execute(sql`SELECT 1 FROM outbox_consumer_acks LIMIT 1`);
    } catch {
      const result = {
        available: false,
        reason: 'outbox_consumer_acks table does not exist (run migrations)',
      } as const;
      assertRealDatabaseAvailable(result);
      return result;
    }
    return { available: true };
  } catch (error) {
    const result = {
      available: false,
      reason: error instanceof Error ? error.message : String(error),
    } as const;
    assertRealDatabaseAvailable(result);
    return result;
  }
}

export async function clearOutboxTestData(prefixes: string[]): Promise<void> {
  if (prefixes.length === 0) {
    return;
  }

  const consumerAckConditions = prefixes.map(prefix => like(schema.outboxConsumerAcks.eventId, `${prefix}%`));
  const eventConditions = prefixes.map(prefix => like(schema.outboxEvents.eventId, `${prefix}%`));

  await db.delete(schema.outboxConsumerAcks).where(
    consumerAckConditions.length === 1 ? consumerAckConditions[0] : or(...consumerAckConditions),
  );
  await db.delete(schema.outboxEvents).where(
    eventConditions.length === 1 ? eventConditions[0] : or(...eventConditions),
  );
}

export async function insertOutboxEvent(seed: OutboxSeed): Promise<void> {
  await db.insert(schema.outboxEvents).values({
    eventId: seed.eventId,
    eventType: seed.eventType ?? 'test.published',
    eventVersion: seed.eventVersion ?? 1,
    aggregateType: seed.aggregateType ?? 'Conversation',
    aggregateId: seed.aggregateId ?? 'conv-001',
    occurredAt: seed.occurredAt ?? new Date(),
    payload: JSON.stringify(seed.payload ?? { content: 'test' }),
    metadata: seed.metadata ? JSON.stringify(seed.metadata) : null,
    correlationId: seed.correlationId ?? null,
    causationId: seed.causationId ?? null,
    version: seed.version ?? 1,
    processedAt: null,
    retryCount: 0,
    lastError: null,
    createdAt: seed.createdAt ?? new Date(),
  });
}

export async function recordConsumerSuccess(eventId: string, consumerId: ConsumerId): Promise<void> {
  await db
    .insert(schema.outboxConsumerAcks)
    .values({
      eventId,
      consumerId,
      processedAt: new Date(),
      retryCount: 0,
      lastError: null,
    })
    .onConflictDoUpdate({
      target: [schema.outboxConsumerAcks.eventId, schema.outboxConsumerAcks.consumerId],
      set: {
        processedAt: new Date(),
        retryCount: 0,
        lastError: null,
      },
    });
}

export async function recordConsumerFailure(
  eventId: string,
  consumerId: ConsumerId,
  error: string,
): Promise<void> {
  const existing = await db
    .select({ retryCount: schema.outboxConsumerAcks.retryCount })
    .from(schema.outboxConsumerAcks)
    .where(
      and(
        eq(schema.outboxConsumerAcks.eventId, eventId),
        eq(schema.outboxConsumerAcks.consumerId, consumerId),
      ),
    )
    .limit(1);

  const retryCount = existing[0]?.retryCount ?? 0;

  await db
    .insert(schema.outboxConsumerAcks)
    .values({
      eventId,
      consumerId,
      processedAt: null,
      retryCount: retryCount + 1,
      lastError: error,
    })
    .onConflictDoUpdate({
      target: [schema.outboxConsumerAcks.eventId, schema.outboxConsumerAcks.consumerId],
      set: {
        processedAt: null,
        retryCount: sql`${schema.outboxConsumerAcks.retryCount} + 1`,
        lastError: error,
      },
    });
}

export async function getConsumerAck(eventId: string, consumerId: ConsumerId): Promise<{
  processedAt: Date | null;
  retryCount: number;
  lastError: string | null;
} | null> {
  const [ack] = await db
    .select({
      processedAt: schema.outboxConsumerAcks.processedAt,
      retryCount: schema.outboxConsumerAcks.retryCount,
      lastError: schema.outboxConsumerAcks.lastError,
    })
    .from(schema.outboxConsumerAcks)
    .where(
      and(
        eq(schema.outboxConsumerAcks.eventId, eventId),
        eq(schema.outboxConsumerAcks.consumerId, consumerId),
      ),
    )
    .limit(1);

  return ack ?? null;
}

export async function isEventVisibleToConsumer(
  eventId: string,
  consumerId: ConsumerId,
  maxRetries = 3,
): Promise<boolean> {
  const hasSuccessfulAck = exists(
    db
      .select({ eventId: schema.outboxConsumerAcks.eventId })
      .from(schema.outboxConsumerAcks)
      .where(
        and(
          eq(schema.outboxConsumerAcks.eventId, schema.outboxEvents.eventId),
          eq(schema.outboxConsumerAcks.consumerId, consumerId),
          isNotNull(schema.outboxConsumerAcks.processedAt),
        ),
      ),
  );

  const hasPermanentFailure = exists(
    db
      .select({ eventId: schema.outboxConsumerAcks.eventId })
      .from(schema.outboxConsumerAcks)
      .where(
        and(
          eq(schema.outboxConsumerAcks.eventId, schema.outboxEvents.eventId),
          eq(schema.outboxConsumerAcks.consumerId, consumerId),
          isNull(schema.outboxConsumerAcks.processedAt),
          sql`${schema.outboxConsumerAcks.retryCount} >= ${maxRetries}`,
        ),
      ),
  );

  const [row] = await db
    .select({ eventId: schema.outboxEvents.eventId })
    .from(schema.outboxEvents)
    .where(
      and(
        eq(schema.outboxEvents.eventId, eventId),
        not(hasSuccessfulAck),
        not(hasPermanentFailure),
      ),
    )
    .limit(1);

  return Boolean(row);
}

export async function hasColumn(tableName: string, columnName: string): Promise<boolean> {
  const result = await db.execute(sql`
    select 1
    from information_schema.columns
    where table_name = ${tableName}
      and column_name = ${columnName}
    limit 1
  `);

  const rows = (result as { rows?: unknown[] }).rows ?? [];
  return rows.length > 0;
}
