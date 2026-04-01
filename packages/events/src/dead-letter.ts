/**
 * Dead-letter store para eventos que falharam após retry esgotado.
 * Armazena em memória (extensível para banco/Redis em produção).
 */

export interface DeadLetterEntry {
  id: string;
  eventType: string;
  eventId: string;
  payload: unknown;
  error: string;
  failedAt: Date;
  retryCount: number;
  handlerName: string;
  resolved: boolean;
  resolvedAt?: Date;
  correlationId?: string;
}

export class DeadLetterStore {
  private entries: Map<string, DeadLetterEntry> = new Map();
  private maxEntries: number;

  constructor(maxEntries = 1000) {
    this.maxEntries = maxEntries;
  }

  add(entry: Omit<DeadLetterEntry, 'id' | 'failedAt' | 'resolved'>): DeadLetterEntry {
    // Limpar entradas antigas se exceder limite
    if (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey) this.entries.delete(oldestKey);
    }

    const fullEntry: DeadLetterEntry = {
      ...entry,
      id: `dlq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      failedAt: new Date(),
      resolved: false,
    };

    this.entries.set(fullEntry.id, fullEntry);
    console.error(`[DeadLetter] Evento ${entry.eventType} (${entry.eventId}) falhou: ${entry.error}`);
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

  resolve(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    entry.resolved = true;
    entry.resolvedAt = new Date();
    return true;
  }

  getStats(): { total: number; unresolved: number; resolved: number } {
    const entries = Array.from(this.entries.values());
    return {
      total: entries.length,
      unresolved: entries.filter(e => !e.resolved).length,
      resolved: entries.filter(e => e.resolved).length,
    };
  }
}

// Instância global
export const deadLetterStore = new DeadLetterStore();
