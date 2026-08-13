import { desc, eq } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import type { EventEnvelope } from './envelope';
import type {
  DeadLetterEntry,
  DeadLetterFailureContext,
  DeadLetterOperationalStats,
} from './dead-letter';
import { deadLetterStore } from './dead-letter';

type DeadLetterInput = Omit<DeadLetterEntry, 'id' | 'failedAt' | 'resolved'> & { id?: string };
type DeadLetterRow = typeof schema.deadLetterEvents.$inferSelect;

function toEntry(row: DeadLetterRow): DeadLetterEntry {
  return {
    id: row.id,
    eventType: row.eventType,
    eventId: row.eventId,
    payload: JSON.parse(row.payload) as unknown,
    error: row.error,
    failedAt: row.failedAt,
    retryCount: row.retryCount,
    handlerName: row.handlerName,
    sourceEvent: row.sourceEvent ? JSON.parse(row.sourceEvent) as EventEnvelope : undefined,
    failureContext: row.failureContext ? JSON.parse(row.failureContext) as DeadLetterFailureContext : undefined,
    resolved: row.resolved,
    ...(row.resolvedAt ? { resolvedAt: row.resolvedAt } : {}),
  };
}

function summarize(entries: DeadLetterEntry[]): DeadLetterOperationalStats {
  const resolved = entries.filter(entry => entry.resolved).length;
  const unresolvedEntries = entries.filter(entry => !entry.resolved);
  const byHandler = new Map<string, DeadLetterOperationalStats['byHandler'][number]>();
  const byReason = new Map<string, DeadLetterOperationalStats['byReason'][number]>();

  for (const entry of entries) {
    const handlerName = entry.handlerName || 'unknown';
    const reason = entry.failureContext?.reason || entry.error || 'unknown';
    const handler = byHandler.get(handlerName) ?? {
      handlerName,
      total: 0,
      unresolved: 0,
      resolved: 0,
      replayable: 0,
      manualOnly: 0,
    };
    const reasonSummary = byReason.get(reason) ?? {
      reason,
      total: 0,
      unresolved: 0,
      resolved: 0,
      replayable: 0,
      manualOnly: 0,
    };

    handler.total += 1;
    reasonSummary.total += 1;
    if (entry.resolved) {
      handler.resolved += 1;
      reasonSummary.resolved += 1;
    } else {
      handler.unresolved += 1;
      reasonSummary.unresolved += 1;
      if (entry.sourceEvent) {
        handler.replayable += 1;
        reasonSummary.replayable += 1;
      } else {
        handler.manualOnly += 1;
        reasonSummary.manualOnly += 1;
      }
    }
    byHandler.set(handlerName, handler);
    byReason.set(reason, reasonSummary);
  }

  const total = entries.length;
  const sorted = <T extends { total: number }>(items: T[]) => items.sort((a, b) => b.total - a.total).slice(0, 5);
  const lastFailedAt = entries.reduce<number>((latest, entry) => Math.max(latest, entry.failedAt.getTime()), 0);

  return {
    total,
    unresolved: unresolvedEntries.length,
    resolved,
    replayable: unresolvedEntries.filter(entry => !!entry.sourceEvent).length,
    manualOnly: unresolvedEntries.filter(entry => !entry.sourceEvent).length,
    byHandler: sorted(Array.from(byHandler.values())),
    byReason: sorted(Array.from(byReason.values())),
    lastFailedAt: lastFailedAt ? new Date(lastFailedAt).toISOString() : null,
  };
}

export class PersistentDeadLetterStore {
  async add(entry: DeadLetterInput): Promise<DeadLetterEntry> {
    const sourceEvent = entry.sourceEvent;
    const failureContext = entry.failureContext ?? {
      stage: 'worker-terminal' as const,
      decision: 'dead-letter' as const,
      handlerName: entry.handlerName || sourceEvent?.event_type || entry.eventType,
      eventType: sourceEvent?.event_type ?? entry.eventType,
      eventId: sourceEvent?.event_id ?? entry.eventId,
      retryCount: entry.retryCount,
      retryable: !!sourceEvent,
      reason: entry.error,
      eventVersion: sourceEvent?.event_version,
      correlationId: sourceEvent?.correlation_id,
      causationId: sourceEvent?.causation_id,
    } satisfies DeadLetterFailureContext;
    const [row] = await db.insert(schema.deadLetterEvents).values({
      ...(entry.id ? { id: entry.id } : {}),
      eventType: sourceEvent?.event_type ?? entry.eventType,
      eventId: sourceEvent?.event_id ?? entry.eventId,
      payload: JSON.stringify(sourceEvent?.payload ?? entry.payload),
      error: entry.error,
      retryCount: entry.retryCount,
      handlerName: entry.handlerName || sourceEvent?.event_type || entry.eventType,
      sourceEvent: sourceEvent ? JSON.stringify(sourceEvent) : null,
      failureContext: JSON.stringify(failureContext),
      resolved: false,
    }).returning();

    if (!row) {
      throw new Error('Dead-letter entry was not persisted');
    }
    return toEntry(row);
  }

  async getAll(options?: { resolved?: boolean; limit?: number }): Promise<DeadLetterEntry[]> {
    const query = db.select().from(schema.deadLetterEvents);
    const filtered = options?.resolved === undefined
      ? query
      : query.where(eq(schema.deadLetterEvents.resolved, options.resolved));
    const ordered = filtered.orderBy(desc(schema.deadLetterEvents.failedAt));
    const rows = await ordered.limit(options?.limit || 1000);
    return rows.map(toEntry);
  }

  async getById(id: string): Promise<DeadLetterEntry | undefined> {
    const [row] = await db.select()
      .from(schema.deadLetterEvents)
      .where(eq(schema.deadLetterEvents.id, id))
      .limit(1);
    return row ? toEntry(row) : undefined;
  }

  async resolve(id: string): Promise<boolean> {
    const existing = await this.getById(id);
    if (!existing) return false;
    await db.update(schema.deadLetterEvents)
      .set({ resolved: true, resolvedAt: existing.resolvedAt || new Date() })
      .where(eq(schema.deadLetterEvents.id, id));
    return true;
  }

  async canRetry(id: string): Promise<boolean> {
    const entry = await this.getById(id);
    return !!entry?.sourceEvent;
  }

  async getStats(): Promise<{ total: number; unresolved: number; resolved: number }> {
    const entries = await this.getAll();
    return {
      total: entries.length,
      unresolved: entries.filter(entry => !entry.resolved).length,
      resolved: entries.filter(entry => entry.resolved).length,
    };
  }

  async getOperationalStats(): Promise<DeadLetterOperationalStats> {
    return summarize(await this.getAll());
  }
}

export class AsyncDeadLetterStoreAdapter {
  constructor(private readonly store: {
    add(entry: DeadLetterInput): DeadLetterEntry;
    getAll(options?: { resolved?: boolean; limit?: number }): DeadLetterEntry[];
    getById(id: string): DeadLetterEntry | undefined;
    resolve(id: string): boolean;
    canRetry(id: string): boolean;
    getStats(): { total: number; unresolved: number; resolved: number };
    getOperationalStats(): DeadLetterOperationalStats;
  }) {}

  async add(entry: DeadLetterInput) { return this.store.add(entry); }
  async getAll(options?: { resolved?: boolean; limit?: number }) { return this.store.getAll(options); }
  async getById(id: string) { return this.store.getById(id); }
  async resolve(id: string) { return this.store.resolve(id); }
  async canRetry(id: string) { return this.store.canRetry(id); }
  async getStats() { return this.store.getStats(); }
  async getOperationalStats() { return this.store.getOperationalStats(); }
}

export type RuntimeDeadLetterStore = PersistentDeadLetterStore | AsyncDeadLetterStoreAdapter;

/**
 * Production processes use PostgreSQL. Unit tests deliberately use the in-memory
 * adapter so they remain isolated and do not silently claim database coverage.
 */
export function getRuntimeDeadLetterStore(): RuntimeDeadLetterStore {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
    return new AsyncDeadLetterStoreAdapter(deadLetterStore);
  }
  return new PersistentDeadLetterStore();
}
