import { db, schema, type DatabaseExecutor } from '@cvg/database';
import { eq, and, ne, desc, type SQL } from 'drizzle-orm';

export type Alert = typeof schema.alerts.$inferSelect;
export type NewAlert = typeof schema.alerts.$inferInsert;

export interface AlertListFilters {
  status?: string;
  severity?: string;
  type?: string;
  /** C04: consulta contextual autorizada por conversa. */
  conversationId?: string;
  limit?: number;
  offset?: number;
}

const ALERT_ORDER = [desc(schema.alerts.createdAt), desc(schema.alerts.id)] as const;

export const alertRepository = {
  async create(data: NewAlert, executor: DatabaseExecutor = db) {
    const [alert] = await executor.insert(schema.alerts).values(data).returning();
    return alert;
  },

  async findById(id: string, executor: DatabaseExecutor = db) {
    const [alert] = await executor.select().from(schema.alerts).where(eq(schema.alerts.id, id));
    return alert || null;
  },

  /**
   * Leitura com lock de linha para transições de estado (SA-017/AC2): o estado
   * anterior usado no histórico/auditoria vem SEMPRE da linha travada, nunca de
   * uma leitura fora da transação que possa estar defasada.
   */
  async findByIdForUpdate(id: string, executor: DatabaseExecutor = db) {
    const [alert] = await executor
      .select()
      .from(schema.alerts)
      .where(eq(schema.alerts.id, id))
      .for('update');
    return alert || null;
  },

  async findByConversationId(conversationId: string) {
    return db
      .select()
      .from(schema.alerts)
      .where(eq(schema.alerts.conversationId, conversationId))
      .orderBy(...ALERT_ORDER);
  },

  async findByTaskId(taskId: string) {
    return db
      .select()
      .from(schema.alerts)
      .where(eq(schema.alerts.taskId, taskId))
      .orderBy(...ALERT_ORDER);
  },

  /** DTO de filtros/paginação estável (PROD-18/AC4): AND real + ordem total. */
  async findAll(filters?: AlertListFilters) {
    const conditions: SQL[] = [];
    if (filters?.status) {
      conditions.push(eq(schema.alerts.status, filters.status as any));
    }
    if (filters?.severity) {
      conditions.push(eq(schema.alerts.severity, filters.severity as any));
    }
    if (filters?.type) {
      conditions.push(eq(schema.alerts.type, filters.type as any));
    }
    if (filters?.conversationId) {
      conditions.push(eq(schema.alerts.conversationId, filters.conversationId));
    }

    const limit = Math.min(Math.max(filters?.limit ?? 100, 1), 200);
    const offset = Math.max(filters?.offset ?? 0, 0);

    let query = db.select().from(schema.alerts).$dynamic();
    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    return query.orderBy(...ALERT_ORDER).limit(limit).offset(offset);
  },

  async update(id: string, data: Partial<NewAlert>) {
    const [alert] = await db
      .update(schema.alerts)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.alerts.id, id))
      .returning();
    return alert;
  },

  /**
   * CAS transacional (PROD-18/AC3): reconhece apenas enquanto `active`.
   * Retorna null quando outro operador venceu — o chamador responde 409.
   */
  async acknowledgeIfActive(id: string, acknowledgedBy: string, executor: DatabaseExecutor = db) {
    const [alert] = await executor
      .update(schema.alerts)
      .set({
        status: 'acknowledged',
        acknowledgedBy,
        acknowledgedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(schema.alerts.id, id), eq(schema.alerts.status, 'active')))
      .returning();
    return alert || null;
  },

  /** CAS transacional: resolve de `active` ou `acknowledged` (nunca de `resolved`). */
  async resolveIfNotResolved(id: string, resolvedBy: string, executor: DatabaseExecutor = db) {
    const [alert] = await executor
      .update(schema.alerts)
      .set({
        status: 'resolved',
        resolvedBy,
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(schema.alerts.id, id), ne(schema.alerts.status, 'resolved')))
      .returning();
    return alert || null;
  },

  async addEvent(alertId: string, eventType: string, oldValue?: string, newValue?: string, changedBy?: string, executor: DatabaseExecutor = db) {
    const [event] = await executor
      .insert(schema.alertEvents)
      .values({ alertId, eventType, oldValue, newValue, changedBy })
      .returning();
    return event;
  },
};
