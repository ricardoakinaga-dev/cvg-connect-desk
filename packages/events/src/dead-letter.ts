/**
 * Dead-letter store para eventos que falharam após retry esgotado.
 * Armazena em memória (extensível para banco/Redis em produção).
 */

import type { EventEnvelope } from './envelope';

export interface DeadLetterFailureContext {
  stage: 'worker-terminal';
  decision: 'dead-letter';
  handlerName: string;
  eventType: string;
  eventId: string;
  retryCount: number;
  retryable: boolean;
  reason: string;
  eventVersion?: number;
  correlationId?: string;
  causationId?: string;
}

export interface DeadLetterEntry {
  id: string;
  eventType: string;
  eventId: string;
  payload: unknown;
  error: string;
  failedAt: Date;
  retryCount: number;
  handlerName: string;
  sourceEvent?: EventEnvelope;
  failureContext?: DeadLetterFailureContext;
  resolved: boolean;
  resolvedAt?: Date;
}

export interface DeadLetterHandlerSummary {
  handlerName: string;
  total: number;
  unresolved: number;
  resolved: number;
  replayable: number;
  manualOnly: number;
}

export interface DeadLetterReasonSummary {
  reason: string;
  total: number;
  unresolved: number;
  resolved: number;
  replayable: number;
  manualOnly: number;
}

export interface DeadLetterOperationalStats {
  total: number;
  unresolved: number;
  resolved: number;
  replayable: number;
  manualOnly: number;
  byHandler: DeadLetterHandlerSummary[];
  byReason: DeadLetterReasonSummary[];
  lastFailedAt: string | null;
}

export class DeadLetterStore {
  private entries: Map<string, DeadLetterEntry> = new Map();
  private maxEntries: number;

  constructor(maxEntries = 1000) {
    this.maxEntries = maxEntries;
  }

  add(entry: Omit<DeadLetterEntry, 'id' | 'failedAt' | 'resolved'> & { id?: string }): DeadLetterEntry {
    // Limpar entradas antigas se exceder limite
    if (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey) this.entries.delete(oldestKey);
    }

    const sourceEvent = entry.sourceEvent;
    const failureContext = entry.failureContext ?? {
      stage: 'worker-terminal',
      decision: 'dead-letter',
      handlerName: entry.handlerName || sourceEvent?.event_type || entry.eventType,
      eventType: sourceEvent?.event_type ?? entry.eventType,
      eventId: sourceEvent?.event_id ?? entry.eventId,
      retryCount: entry.retryCount,
      retryable: !!sourceEvent,
      reason: entry.error,
      eventVersion: sourceEvent?.event_version,
      correlationId: sourceEvent?.correlation_id,
      causationId: sourceEvent?.causation_id,
    };
    const fullEntry: DeadLetterEntry = {
      ...entry,
      eventType: sourceEvent?.event_type ?? entry.eventType,
      eventId: sourceEvent?.event_id ?? entry.eventId,
      payload: sourceEvent?.payload ?? entry.payload,
      handlerName: entry.handlerName || sourceEvent?.event_type || entry.eventType,
      sourceEvent,
      failureContext,
      id: entry.id || `dlq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      failedAt: new Date(),
      resolved: false,
    };

    this.entries.set(fullEntry.id, fullEntry);
    if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
      console.error(JSON.stringify({
        msg: '[DeadLetter] Recorded terminal failure',
        event_type: fullEntry.eventType,
        event_id: fullEntry.eventId,
        handler_name: fullEntry.handlerName,
        retry_count: fullEntry.retryCount,
        retryable: failureContext.retryable,
        reason: failureContext.reason,
        correlation_id: failureContext.correlationId,
        causation_id: failureContext.causationId,
        event_version: failureContext.eventVersion,
        level: 'error',
      }));
    }
    return fullEntry;
  }

  getAll(options?: { resolved?: boolean; limit?: number }): DeadLetterEntry[] {
    let entries = Array.from(this.entries.values());

    if (options?.resolved !== undefined) {
      entries = entries.filter(e => e.resolved === options.resolved);
    }

    entries.sort((a, b) => b.failedAt.getTime() - a.failedAt.getTime());

    if (options?.limit) {
      entries = entries.slice(0, options.limit);
    }

    return entries;
  }

  getById(id: string): DeadLetterEntry | undefined {
    return this.entries.get(id);
  }

  clear(): void {
    this.entries.clear();
  }

  resolve(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    entry.resolved = true;
    entry.resolvedAt = new Date();
    return true;
  }

  canRetry(id: string): boolean {
    const entry = this.entries.get(id);
    return !!entry?.sourceEvent;
  }

  getStats(): { total: number; unresolved: number; resolved: number } {
    const entries = Array.from(this.entries.values());
    return {
      total: entries.length,
      unresolved: entries.filter(e => !e.resolved).length,
      resolved: entries.filter(e => e.resolved).length,
    };
  }

  getOperationalStats(): DeadLetterOperationalStats {
    const entries = Array.from(this.entries.values());
    const total = entries.length;
    const resolved = entries.filter(e => e.resolved).length;
    const unresolvedEntries = entries.filter(e => !e.resolved);
    const unresolved = unresolvedEntries.length;
    const replayable = unresolvedEntries.filter(e => !!e.sourceEvent).length;
    const manualOnly = unresolved - replayable;
    const lastFailedAt = entries.length > 0
      ? entries.reduce((latest, entry) => Math.max(latest, entry.failedAt.getTime()), 0)
      : 0;

    const byHandlerMap = new Map<string, DeadLetterHandlerSummary>();
    const byReasonMap = new Map<string, DeadLetterReasonSummary>();

    for (const entry of entries) {
      const handlerKey = entry.handlerName || 'unknown';
      const handlerSummary = byHandlerMap.get(handlerKey) ?? {
        handlerName: handlerKey,
        total: 0,
        unresolved: 0,
        resolved: 0,
        replayable: 0,
        manualOnly: 0,
      };
      handlerSummary.total += 1;
      if (entry.resolved) {
        handlerSummary.resolved += 1;
      } else {
        handlerSummary.unresolved += 1;
        if (entry.sourceEvent) {
          handlerSummary.replayable += 1;
        } else {
          handlerSummary.manualOnly += 1;
        }
      }
      byHandlerMap.set(handlerKey, handlerSummary);

      const reasonKey = entry.failureContext?.reason || entry.error || 'unknown';
      const reasonSummary = byReasonMap.get(reasonKey) ?? {
        reason: reasonKey,
        total: 0,
        unresolved: 0,
        resolved: 0,
        replayable: 0,
        manualOnly: 0,
      };
      reasonSummary.total += 1;
      if (entry.resolved) {
        reasonSummary.resolved += 1;
      } else {
        reasonSummary.unresolved += 1;
        if (entry.sourceEvent) {
          reasonSummary.replayable += 1;
        } else {
          reasonSummary.manualOnly += 1;
        }
      }
      byReasonMap.set(reasonKey, reasonSummary);
    }

    const sortByTotalDesc = <T extends { total: number }>(items: T[]) => items.sort((a, b) => b.total - a.total);

    return {
      total,
      unresolved,
      resolved,
      replayable,
      manualOnly,
      byHandler: sortByTotalDesc(Array.from(byHandlerMap.values())).slice(0, 5),
      byReason: sortByTotalDesc(Array.from(byReasonMap.values())).slice(0, 5),
      lastFailedAt: lastFailedAt ? new Date(lastFailedAt).toISOString() : null,
    };
  }
}

// Instância global
export const deadLetterStore = new DeadLetterStore();
