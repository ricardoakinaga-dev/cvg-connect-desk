import { db, schema, type DatabaseExecutor } from '@cvg/database';
import { eq, desc, and, inArray, sql, notExists } from 'drizzle-orm';

export type Message = typeof schema.messages.$inferSelect;
export type NewMessage = typeof schema.messages.$inferInsert;

/**
 * Ids da última mensagem de cada conversa via LATERAL + LIMIT 1: uma
 * sondagem de índice por conversa (`Index Scan ... rows=1 loops=N`), sem
 * ler o histórico e sem N+1 — apenas 1 query para toda a página.
 */
async function findLatestMessageIds(conversationIds: string[], direction?: 'inbound' | 'outbound'): Promise<string[]> {
  if (conversationIds.length === 0) return [];
  const directionFilter = direction ? sql`AND m.direction = ${direction}` : sql``;
  const result = await db.execute(sql`
    SELECT m.id
    FROM unnest(${sql.param(conversationIds)}::uuid[]) AS c(conversation_id)
    JOIN LATERAL (
      SELECT m.id
      FROM messages m
      WHERE m.conversation_id = c.conversation_id
      ${directionFilter}
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT 1
    ) m ON true
  `);
  const rows = (result as unknown as { rows: Array<{ id: string }> }).rows ?? [];
  return rows.map((row) => row.id);
}

export const messageRepository = {
  async create(data: NewMessage, executor: DatabaseExecutor = db) {
    const [message] = await executor.insert(schema.messages).values(data).returning();
    return message;
  },

  /**
   * Insert idempotente: concorrência retorna a linha existente (200 idempotente,
   * nunca 500). Aceita o `tx` de uma transação para participar do mesmo
   * executor de escrita (AAA-08/C03 D-C03-1).
   */
  async createIdempotent(
    data: NewMessage & { externalMessageId: string },
    executor: DatabaseExecutor = db,
  ) {
    const [message] = await executor
      .insert(schema.messages)
      .values(data)
      .onConflictDoNothing({ target: schema.messages.externalMessageId })
      .returning();
    if (message) return { message, isDuplicate: false as const };
    const existing = await messageRepository.findByExternalId(data.externalMessageId, executor);
    return { message: existing!, isDuplicate: true as const };
  },

  async findById(id: string, executor: DatabaseExecutor = db) {
    const [message] = await executor.select().from(schema.messages).where(eq(schema.messages.id, id));
    return message || null;
  },

  async findByExternalId(externalMessageId: string, executor: DatabaseExecutor = db) {
    const [message] = await executor
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

  /** Número/JID confiável da mensagem inbound mais recente da conversa. */
  async findLatestInboundSender(conversationId: string): Promise<string | null> {
    const [message] = await db
      .select({ sender: schema.messages.sender })
      .from(schema.messages)
      .where(and(
        eq(schema.messages.conversationId, conversationId),
        eq(schema.messages.direction, 'inbound'),
      ))
      .orderBy(desc(schema.messages.createdAt))
      .limit(1);
    return message?.sender?.trim() || null;
  },

  /**
   * Última mensagem de cada conversa (qualquer direção), selecionada no banco
   * e hidratada com o mapper tipado do Drizzle — DTO preservado. Duas queries
   * limitadas ao tamanho da página; nunca o histórico completo.
   * Índice de suporte: idx_messages_conversation_created_id.
   */
  async findLatestByConversationIds(conversationIds: string[]): Promise<Map<string, Message>> {
    const result = new Map<string, Message>();
    if (conversationIds.length === 0) return result;
    const latestIds = await findLatestMessageIds(conversationIds);
    if (latestIds.length === 0) return result;
    const rows = await db.select().from(schema.messages).where(inArray(schema.messages.id, latestIds));
    for (const row of rows) {
      result.set(row.conversationId as string, row);
    }
    return result;
  },

  /**
   * Última inbound de cada conversa, selecionada no banco com o mesmo
   * LATERAL/index e hidratada tipada.
   * Índice de suporte: idx_messages_conversation_direction_created_id.
   */
  async findLatestInboundByConversationIds(conversationIds: string[]): Promise<Map<string, Message>> {
    const result = new Map<string, Message>();
    if (conversationIds.length === 0) return result;
    const latestIds = await findLatestMessageIds(conversationIds, 'inbound');
    if (latestIds.length === 0) return result;
    const rows = await db.select().from(schema.messages).where(inArray(schema.messages.id, latestIds));
    for (const row of rows) {
      result.set(row.conversationId as string, row);
    }
    return result;
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

  /**
   * AAA-12 / C04: mensagens `pending` SEM resultado ambíguo pendente. Uma
   * intenção em `unknown_reconciling` pode ter sido aceita pelo provider e
   * NÃO pode ser reenviada pelo polling do gateway; ela só sai desse estado
   * por reconciliação explícita (mesma chave devolve o mesmo estado).
   */
  async findPendingOutbound(limit = 10) {
    return db
      .select()
      .from(schema.messages)
      .where(and(
        eq(schema.messages.direction, 'outbound'),
        eq(schema.messages.status, 'pending'),
        notExists(
          db
            .select({ one: sql`1` })
            .from(schema.outboundDeliveries)
            .where(and(
              eq(schema.outboundDeliveries.internalMessageId, schema.messages.id),
              eq(schema.outboundDeliveries.status, 'unknown_reconciling'),
            )),
        ),
      ))
      .orderBy(schema.messages.createdAt)
      .limit(limit);
  },
};
