import { db, schema } from '@cvg/database';
import { eq, desc, and } from 'drizzle-orm';

export type Task = typeof schema.tasks.$inferSelect;
export type NewTask = typeof schema.tasks.$inferInsert;

export const taskRepository = {
  async create(data: NewTask) {
    const [task] = await db.insert(schema.tasks).values(data).returning();
    return task;
  },

  async findById(id: string) {
    const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, id));
    return task || null;
  },

  async findByConversationId(conversationId: string) {
    return db.select().from(schema.tasks).where(eq(schema.tasks.conversationId, conversationId));
  },

  async findByAssignee(userId: string) {
    return db.select().from(schema.tasks).where(eq(schema.tasks.assignedTo, userId));
  },

  async findAll(filters?: { status?: string; assignedTo?: string; priority?: string }) {
    let query = db.select().from(schema.tasks).$dynamic();

    if (filters?.status) {
      query = query.where(eq(schema.tasks.status, filters.status as any));
    }
    if (filters?.assignedTo) {
      query = query.where(eq(schema.tasks.assignedTo, filters.assignedTo));
    }
    if (filters?.priority) {
      query = query.where(eq(schema.tasks.priority, filters.priority as any));
    }

    return query.orderBy(desc(schema.tasks.createdAt));
  },

  async update(id: string, data: Partial<NewTask>) {
    const [task] = await db
      .update(schema.tasks)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.tasks.id, id))
      .returning();
    return task;
  },

  async updateStatus(id: string, status: string) {
    const updateData: Partial<NewTask> = { status: status as any, updatedAt: new Date() };
    if (status === 'completed') {
      updateData.completedAt = new Date();
    }
    const [task] = await db
      .update(schema.tasks)
      .set(updateData)
      .where(eq(schema.tasks.id, id))
      .returning();
    return task;
  },

  async addStatusHistory(taskId: string, status: string, changedBy?: string, reason?: string) {
    const [history] = await db
      .insert(schema.taskStatusHistory)
      .values({ taskId, status: status as any, changedBy, reason })
      .returning();
    return history;
  },
};
