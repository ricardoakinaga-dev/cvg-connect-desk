import { db, schema } from '@cvg/database';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

/**
 * Persistent Dead Letter Queue (Final-1).
 * Backed por PostgreSQL (`dead_letter_events`, migration 0015):
 * restart do processo NÃO perde eventos.
 *
 * Semântica de status:
 * - PENDING: aguardando ação operacional;
 * - REPLAYING: claim atômico para replay (concorrência segura);
 * - RESOLVED: tratado (replay OK ou resolução manual);
 * - DISCARDED: descartado conscientemente (auditado).
 */

export type DeadLetterStatus = 'PENDING' | 'REPLAYING' | 'RESOLVED' | 'DISCARDED';

export interface PersistDeadLetterInput {
  originalEventId: string;
  consumerId: string;
  eventType: string;
  payload: unknown;
  errorCode?: string;
  errorMessage?: string;
  attemptCount?: number;
}

export type PersistentDeadLetter = typeof schema.deadLetterEvents.$inferSelect;

export interface DeadLetterFilters {
  status?: DeadLetterStatus | DeadLetterStatus[];
  consumerId?: string;
  eventType?: string;
  limit?: number;
  offset?: number;
}

function toJsonb(payload: unknown): unknown {
  if (payload === undefined) return null;
  if (typeof payload === 'string') {
    try {
      return JSON.parse(payload);
    } catch {
      return { _raw: payload };
    }
  }
  return payload as Record<string, unknown>;
}

export const persistentDeadLetterStore = {
  /**
   * Persiste falha terminal. Idempotente por (original_event_id, consumer_id):
   * duplicata retorna a entrada existente (nunca duplica).
   */
  async persist(input: PersistDeadLetterInput): Promise<{ entry: PersistentDeadLetter; isDuplicate: boolean }> {
    const [inserted] = await db
      .insert(schema.deadLetterEvents)
      .values({
        originalEventId: input.originalEventId,
        consumerId: input.consumerId,
        eventType: input.eventType,
        payload: toJsonb(input.payload),
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
        attemptCount: input.attemptCount ?? 0,
      })
      .onConflictDoNothing({
        target: [schema.deadLetterEvents.originalEventId, schema.deadLetterEvents.consumerId],
      })
      .returning();

    if (inserted) return { entry: inserted, isDuplicate: false };

    const existing = await this.findByEvent(input.originalEventId, input.consumerId);
    return { entry: existing!, isDuplicate: true };
  },

  async findByEvent(originalEventId: string, consumerId: string): Promise<PersistentDeadLetter | null> {
    const [row] = await db
      .select()
      .from(schema.deadLetterEvents)
      .where(
        and(
          eq(schema.deadLetterEvents.originalEventId, originalEventId),
          eq(schema.deadLetterEvents.consumerId, consumerId),
        ),
      )
      .limit(1);
    return row || null;
  },

  async getById(id: string): Promise<PersistentDeadLetter | null> {
    const [row] = await db
      .select()
      .from(schema.deadLetterEvents)
      .where(eq(schema.deadLetterEvents.id, id))
      .limit(1);
    return row || null;
  },

  async list(filters: DeadLetterFilters = {}): Promise<PersistentDeadLetter[]> {
    const conditions = [];
    if (filters.status) {
      const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
      conditions.push(inArray(schema.deadLetterEvents.status, statuses as Array<'PENDING' | 'REPLAYING' | 'RESOLVED' | 'DISCARDED'>));
    }
    if (filters.consumerId) conditions.push(eq(schema.deadLetterEvents.consumerId, filters.consumerId));
    if (filters.eventType) conditions.push(eq(schema.deadLetterEvents.eventType, filters.eventType));

    let query = db.select().from(schema.deadLetterEvents).$dynamic();
    if (conditions.length > 0) query = query.where(and(...conditions));
    return query
      .orderBy(desc(schema.deadLetterEvents.lastFailedAt))
      .limit(filters.limit ?? 50)
      .offset(filters.offset ?? 0);
  },

  async countByStatus(): Promise<Record<string, number>> {
    const rows = await db
      .select({ status: schema.deadLetterEvents.status, count: sql<number>`count(*)::int` })
      .from(schema.deadLetterEvents)
      .groupBy(schema.deadLetterEvents.status);
    return Object.fromEntries(rows.map((r) => [r.status, r.count]));
  },

  /**
   * Claim atômico PENDING → REPLAYING. Concorrência segura:
   * apenas um claimant recebe a linha (RETURNING); demais recebem null (409).
   */
  async claimForReplay(id: string): Promise<PersistentDeadLetter | null> {
    const [claimed] = await db
      .update(schema.deadLetterEvents)
      .set({ status: 'REPLAYING', updatedAt: new Date() })
      .where(
        and(eq(schema.deadLetterEvents.id, id), eq(schema.deadLetterEvents.status, 'PENDING')),
      )
      .returning();
    return claimed || null;
  },

  /**
   * Claim em lote: até `limit` PENDING → REPLAYING, ordenados por falha mais antiga.
   */
  async claimBatch(filters: Omit<DeadLetterFilters, 'status' | 'limit' | 'offset'> & { limit?: number }): Promise<PersistentDeadLetter[]> {
    const candidates = await this.list({ ...filters, status: 'PENDING', limit: filters.limit ?? 25 });
    // Ascendente por lastFailedAt para priorizar os mais antigos.
    candidates.sort((a, b) => new Date(a.lastFailedAt).getTime() - new Date(b.lastFailedAt).getTime());
    const claimed: PersistentDeadLetter[] = [];
    for (const candidate of candidates) {
      const row = await this.claimForReplay(candidate.id);
      if (row) claimed.push(row);
    }
    return claimed;
  },

  async markReplayed(id: string): Promise<PersistentDeadLetter | null> {
    const [row] = await db
      .update(schema.deadLetterEvents)
      .set({
        status: 'RESOLVED',
        replayCount: sql`${schema.deadLetterEvents.replayCount} + 1`,
        replayedAt: new Date(),
        resolvedAt: new Date(),
        resolutionReason: 'replayed',
        updatedAt: new Date(),
      })
      .where(and(eq(schema.deadLetterEvents.id, id), eq(schema.deadLetterEvents.status, 'REPLAYING')))
      .returning();
    return row || null;
  },

  async markReplayFailed(id: string, errorMessage?: string): Promise<PersistentDeadLetter | null> {
    const [row] = await db
      .update(schema.deadLetterEvents)
      .set({
        status: 'PENDING',
        attemptCount: sql`${schema.deadLetterEvents.attemptCount} + 1`,
        lastFailedAt: new Date(),
        errorMessage: errorMessage ?? undefined,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.deadLetterEvents.id, id), eq(schema.deadLetterEvents.status, 'REPLAYING')))
      .returning();
    return row || null;
  },

  async resolve(id: string, resolvedBy?: string, reason?: string): Promise<PersistentDeadLetter | null> {
    const [row] = await db
      .update(schema.deadLetterEvents)
      .set({
        status: 'RESOLVED',
        resolvedAt: new Date(),
        resolvedBy: resolvedBy ?? undefined,
        resolutionReason: reason || 'manual-resolve',
        updatedAt: new Date(),
      })
      .where(eq(schema.deadLetterEvents.id, id))
      .returning();
    return row || null;
  },

  async discard(id: string, resolvedBy?: string, reason?: string): Promise<PersistentDeadLetter | null> {
    const [row] = await db
      .update(schema.deadLetterEvents)
      .set({
        status: 'DISCARDED',
        resolvedAt: new Date(),
        resolvedBy: resolvedBy ?? undefined,
        resolutionReason: reason || 'manual-discard',
        updatedAt: new Date(),
      })
      .where(eq(schema.deadLetterEvents.id, id))
      .returning();
    return row || null;
  },

  async oldestPendingAge(): Promise<{ count: number; oldestAgeSeconds: number | null }> {
    const [row] = await db
      .select({
        count: sql<number>`count(*)::int`,
        oldest: sql<Date | null>`min(${schema.deadLetterEvents.lastFailedAt})`,
      })
      .from(schema.deadLetterEvents)
      .where(eq(schema.deadLetterEvents.status, 'PENDING'));
    if (!row || row.count === 0 || !row.oldest) return { count: 0, oldestAgeSeconds: null };
    return { count: row.count, oldestAgeSeconds: Math.floor((Date.now() - new Date(row.oldest).getTime()) / 1000) };
  },

  /** Apenas para testes: remove entradas por prefixo de event id. */
  async deleteByEventPrefix(prefix: string): Promise<void> {
    await db.execute(sql`DELETE FROM ${schema.deadLetterEvents} WHERE ${schema.deadLetterEvents.originalEventId} LIKE ${`${prefix}%`}`);
  },
};

export async function listPendingDeadLetters(limit = 50): Promise<PersistentDeadLetter[]> {
  return persistentDeadLetterStore.list({ status: 'PENDING', limit });
}
