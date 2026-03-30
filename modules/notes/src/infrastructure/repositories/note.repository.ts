import { db, schema } from '@cvg/database';
import { eq, desc, and } from 'drizzle-orm';

export type InternalNote = typeof schema.internalNotes.$inferSelect;
export type NewInternalNote = typeof schema.internalNotes.$inferInsert;

export const noteRepository = {
  async create(data: NewInternalNote) {
    const [note] = await db.insert(schema.internalNotes).values(data).returning();
    return note;
  },

  async findById(id: string) {
    const [note] = await db.select().from(schema.internalNotes).where(eq(schema.internalNotes.id, id));
    return note || null;
  },

  async findByConversationId(conversationId: string) {
    return db.select().from(schema.internalNotes).where(eq(schema.internalNotes.conversationId, conversationId)).orderBy(desc(schema.internalNotes.createdAt));
  },

  async findByTaskId(taskId: string) {
    return db.select().from(schema.internalNotes).where(eq(schema.internalNotes.taskId, taskId)).orderBy(desc(schema.internalNotes.createdAt));
  },

  async findByReference(referenceType: string, referenceId: string) {
    return db
      .select()
      .from(schema.internalNotes)
      .where(
        and(
          eq(schema.internalNotes.referenceType, referenceType as any),
          eq(schema.internalNotes.referenceId, referenceId)
        )
      )
      .orderBy(desc(schema.internalNotes.createdAt));
  },

  async update(id: string, data: Partial<NewInternalNote>) {
    const [note] = await db
      .update(schema.internalNotes)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.internalNotes.id, id))
      .returning();
    return note;
  },
};
