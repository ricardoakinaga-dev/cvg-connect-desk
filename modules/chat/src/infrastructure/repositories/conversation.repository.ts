import { db, schema } from '@cvg/database';
import { eq, desc, and } from 'drizzle-orm';

export type Conversation = typeof schema.conversations.$inferSelect;
export type NewConversation = typeof schema.conversations.$inferInsert;

export const conversationRepository = {
  async create(data: NewConversation) {
    const [conversation] = await db.insert(schema.conversations).values(data).returning();
    return conversation;
  },

  async findById(id: string) {
    const [conversation] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, id));
    return conversation || null;
  },

  async findByExternalId(externalConversationId: string) {
    const [conversation] = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.externalConversationId, externalConversationId));
    return conversation || null;
  },

  async findByContactId(contactId: string) {
    return db.select().from(schema.conversations).where(eq(schema.conversations.contactId, contactId));
  },

  async findActiveByContactId(contactId: string) {
    const result = await db
      .select()
      .from(schema.conversations)
      .where(and(eq(schema.conversations.contactId, contactId), eq(schema.conversations.isActive, true)));
    return result;
  },

  async findAll(filters?: { status?: string; queueId?: string; teamId?: string }) {
    let query = db.select().from(schema.conversations).$dynamic();

    if (filters?.status) {
      query = query.where(eq(schema.conversations.status, filters.status as any));
    }
    if (filters?.queueId) {
      query = query.where(eq(schema.conversations.queueId, filters.queueId));
    }
    if (filters?.teamId) {
      query = query.where(eq(schema.conversations.teamId, filters.teamId));
    }

    return query.orderBy(desc(schema.conversations.createdAt));
  },

  async update(id: string, data: Partial<NewConversation>) {
    const [conversation] = await db
      .update(schema.conversations)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.conversations.id, id))
      .returning();
    return conversation;
  },

  async close(id: string) {
    const [conversation] = await db
      .update(schema.conversations)
      .set({ isActive: false, status: 'closed', closedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.conversations.id, id))
      .returning();
    return conversation;
  },

  async addStatusHistory(conversationId: string, status: string, changedBy?: string, reason?: string) {
    const [history] = await db
      .insert(schema.conversationStatusHistory)
      .values({ conversationId, status: status as any, changedBy, reason })
      .returning();
    return history;
  },

  async updateCurrentHandler(conversationId: string, handler: 'bot' | 'human') {
    const [conversation] = await db
      .update(schema.conversations)
      .set({ current_handler: handler, updatedAt: new Date() })
      .where(eq(schema.conversations.id, conversationId))
      .returning();
    return conversation;
  },
};
