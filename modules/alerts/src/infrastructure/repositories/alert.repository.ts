import { db, schema } from '@cvg/database';
import { eq, desc } from 'drizzle-orm';

export type Alert = typeof schema.alerts.$inferSelect;
export type NewAlert = typeof schema.alerts.$inferInsert;
type AlertStatus = typeof schema.alerts.status.enumValues[number];
type AlertSeverity = typeof schema.alerts.severity.enumValues[number];
type AlertType = typeof schema.alerts.type.enumValues[number];

export const alertRepository = {
  async create(data: NewAlert) {
    const [alert] = await db.insert(schema.alerts).values(data).returning();
    return alert;
  },

  async findById(id: string) {
    const [alert] = await db.select().from(schema.alerts).where(eq(schema.alerts.id, id));
    return alert || null;
  },

  async findByConversationId(conversationId: string) {
    return db
      .select()
      .from(schema.alerts)
      .where(eq(schema.alerts.conversationId, conversationId))
      .orderBy(desc(schema.alerts.createdAt));
  },

  async findByTaskId(taskId: string) {
    return db
      .select()
      .from(schema.alerts)
      .where(eq(schema.alerts.taskId, taskId))
      .orderBy(desc(schema.alerts.createdAt));
  },

  async findAll(filters?: { status?: string; severity?: string; type?: string }) {
    let query = db.select().from(schema.alerts).$dynamic();

    if (filters?.status) {
      query = query.where(eq(schema.alerts.status, filters.status as AlertStatus));
    }
    if (filters?.severity) {
      query = query.where(eq(schema.alerts.severity, filters.severity as AlertSeverity));
    }
    if (filters?.type) {
      query = query.where(eq(schema.alerts.type, filters.type as AlertType));
    }

    return query.orderBy(desc(schema.alerts.createdAt));
  },

  async update(id: string, data: Partial<NewAlert>) {
    const [alert] = await db
      .update(schema.alerts)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.alerts.id, id))
      .returning();
    return alert;
  },

  async acknowledge(id: string, acknowledgedBy: string) {
    const [alert] = await db
      .update(schema.alerts)
      .set({
        status: 'acknowledged',
        acknowledgedBy,
        acknowledgedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.alerts.id, id))
      .returning();
    return alert;
  },

  async resolve(id: string, resolvedBy: string) {
    const [alert] = await db
      .update(schema.alerts)
      .set({
        status: 'resolved',
        resolvedBy,
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.alerts.id, id))
      .returning();
    return alert;
  },

  async addEvent(alertId: string, eventType: string, oldValue?: string, newValue?: string, changedBy?: string) {
    const [event] = await db
      .insert(schema.alertEvents)
      .values({ alertId, eventType, oldValue, newValue, changedBy })
      .returning();
    return event;
  },
};
