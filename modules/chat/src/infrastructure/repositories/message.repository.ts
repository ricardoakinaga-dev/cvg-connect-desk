import { db, schema } from '@cvg/database';
import { eq, desc, and } from 'drizzle-orm';

export type Message = typeof schema.messages.$inferSelect;
export type NewMessage = typeof schema.messages.$inferInsert;

export const messageRepository = {
  async create(data: NewMessage) {
    const [message] = await db.insert(schema.messages).values(data).returning();
    return message;
  },

  async findById(id: string) {
    const [message] = await db.select().from(schema.messages).where(eq(schema.messages.id, id));
    return message || null;
  },

  async findByExternalId(externalMessageId: string) {
    const [message] = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.externalMessageId, externalMessageId));
    return message || null;
  },

  async findByConversationId(conversationId: string) {
    return db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, conversationId))
      .orderBy(desc(schema.messages.createdAt));
  },

  async findRecentByConversationId(conversationId: string, limit: number = 50) {
    return db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, conversationId))
      .orderBy(desc(schema.messages.createdAt))
      .limit(limit);
  },

  async updateStatus(id: string, status: string) {
    const [message] = await db
      .update(schema.messages)
      .set({ status: status as any })
      .where(eq(schema.messages.id, id))
      .returning();
    return message;
  },

  async updateDeliveryStatus(id: string, deliveredAt?: Date) {
    const [message] = await db
      .update(schema.messages)
      .set({ status: 'delivered', deliveredAt: deliveredAt || new Date() })
      .where(eq(schema.messages.id, id))
      .returning();
    return message;
  },

  async update(id: string, data: Partial<NewMessage>) {
    const [message] = await db
      .update(schema.messages)
      .set(data)
      .where(eq(schema.messages.id, id))
      .returning();
    return message;
  },

  async findPendingOutbound(limit = 10) {
    return db
      .select()
      .from(schema.messages)
      .where(and(
        eq(schema.messages.direction, 'outbound'),
        eq(schema.messages.status, 'pending')
      ))
      .orderBy(schema.messages.createdAt)
      .limit(limit);
  },
};
