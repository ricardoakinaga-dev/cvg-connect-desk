import { db, schema, type DatabaseExecutor } from '@cvg/database';
import { eq, desc, and } from 'drizzle-orm';

export type InternalNote = typeof schema.internalNotes.$inferSelect;
export type NewInternalNote = typeof schema.internalNotes.$inferInsert;

export interface NoteListOptions {
  limit?: number;
  offset?: number;
}

const NOTE_ORDER = [desc(schema.internalNotes.createdAt), desc(schema.internalNotes.id)] as const;

/** DTO de filtros/paginação estável (PROD-18/AC4): mesma ordem total sempre. */
function bounded(options?: NoteListOptions): { limit: number; offset: number } {
  const limit = Math.min(Math.max(options?.limit ?? 100, 1), 200);
  const offset = Math.max(options?.offset ?? 0, 0);
  return { limit, offset };
}

export const noteRepository = {
  async create(data: NewInternalNote, executor: DatabaseExecutor = db) {
    const [note] = await executor.insert(schema.internalNotes).values(data).returning();
    return note;
  },

  async findById(id: string) {
    const [note] = await db.select().from(schema.internalNotes).where(eq(schema.internalNotes.id, id));
    return note || null;
  },

  async findByConversationId(conversationId: string, options?: NoteListOptions) {
    const { limit, offset } = bounded(options);
    return db
      .select()
      .from(schema.internalNotes)
      .where(eq(schema.internalNotes.conversationId, conversationId))
      .orderBy(...NOTE_ORDER)
      .limit(limit)
      .offset(offset);
  },

  async findByTaskId(taskId: string, options?: NoteListOptions) {
    const { limit, offset } = bounded(options);
    return db
      .select()
      .from(schema.internalNotes)
      .where(eq(schema.internalNotes.taskId, taskId))
      .orderBy(...NOTE_ORDER)
      .limit(limit)
      .offset(offset);
  },

  async findByAuthorId(authorId: string, options?: NoteListOptions) {
    const { limit, offset } = bounded(options);
    return db
      .select()
      .from(schema.internalNotes)
      .where(eq(schema.internalNotes.authorId, authorId))
      .orderBy(...NOTE_ORDER)
      .limit(limit)
      .offset(offset);
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
      .orderBy(...NOTE_ORDER);
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
