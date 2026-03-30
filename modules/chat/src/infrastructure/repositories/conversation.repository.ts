import { db, schema } from '@cvg/database';
import { eq, desc, and, count, inArray } from 'drizzle-orm';

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
    return db.select().from(schema.conversations)
      .where(and(eq(schema.conversations.contactId, contactId), eq(schema.conversations.isActive, true)));
  },

  async findAll(filters?: { status?: string; statusV2?: string; queueId?: string; teamId?: string; sectorId?: string; assignedUserId?: string; userId?: string }) {
    let query = db.select().from(schema.conversations).$dynamic();
    const conditions = [];

    if (filters?.status) conditions.push(eq(schema.conversations.status, filters.status as any));
    if (filters?.statusV2) conditions.push(eq(schema.conversations.statusV2, filters.statusV2 as any));
    if (filters?.queueId) conditions.push(eq(schema.conversations.queueId, filters.queueId));
    if (filters?.teamId) conditions.push(eq(schema.conversations.teamId, filters.teamId));
    if (filters?.sectorId) conditions.push(eq(schema.conversations.sectorId, filters.sectorId));
    if (filters?.assignedUserId) conditions.push(eq(schema.conversations.assignedUserId, filters.assignedUserId));

    // Filtro por setores do usuário (se userId fornecido e não for filtro específico de setor)
    if (filters?.userId && !filters?.sectorId) {
      const { userSectors } = schema;
      const userSectorIds = await db.select({ sectorId: userSectors.sectorId })
        .from(userSectors)
        .where(eq(userSectors.userId, filters.userId));

      if (userSectorIds.length > 0) {
        // Usuário tem setores definidos — filtrar apenas por eles
        conditions.push(inArray(schema.conversations.sectorId, userSectorIds.map(s => s.sectorId)));
      }
      // Se não tem setores definidos, pode ser admin global — não filtra
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
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

  async updateStatusV2(id: string, statusV2: string, userId?: string) {
    const updateData: any = { statusV2, updatedAt: new Date() };

    // Mapear statusV2 para status legado
    const statusMap: Record<string, string> = {
      'novo': 'open',
      'em_atendimento': 'open',
      'pendente': 'pending',
      'em_espera': 'pending',
      'finalizado': 'closed',
      'arquivado': 'archived',
    };
    updateData.status = statusMap[statusV2] || 'open';

    if (statusV2 === 'finalizado' || statusV2 === 'arquivado') {
      updateData.isActive = false;
      updateData.closedAt = new Date();
    }

    if (userId) updateData.assignedUserId = userId;

    const [conversation] = await db
      .update(schema.conversations)
      .set(updateData)
      .where(eq(schema.conversations.id, id))
      .returning();
    return conversation;
  },

  async updateSector(id: string, sectorId: string) {
    const [conversation] = await db
      .update(schema.conversations)
      .set({ sectorId, updatedAt: new Date() })
      .where(eq(schema.conversations.id, id))
      .returning();
    return conversation;
  },

  async assignUser(id: string, userId: string) {
    const [conversation] = await db
      .update(schema.conversations)
      .set({ assignedUserId: userId, updatedAt: new Date() })
      .where(eq(schema.conversations.id, id))
      .returning();
    return conversation;
  },

  async close(id: string) {
    const [conversation] = await db
      .update(schema.conversations)
      .set({ isActive: false, status: 'closed', statusV2: 'finalizado', closedAt: new Date(), updatedAt: new Date() })
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
      .set({ currentHandler: handler, updatedAt: new Date() })
      .where(eq(schema.conversations.id, conversationId))
      .returning();
    return conversation;
  },

  // Kanban: contar por statusV2
  async countByStatusV2(sectorId?: string) {
    const conditions = sectorId ? [eq(schema.conversations.sectorId, sectorId)] : [];

    const result = await db.select({
      statusV2: schema.conversations.statusV2,
      count: count(),
    })
      .from(schema.conversations)
      .where(conditions.length ? and(...conditions) : undefined)
      .groupBy(schema.conversations.statusV2);

    return result;
  },

  // Kanban: contar por setor
  async countBySector() {
    return db.select({
      sectorId: schema.conversations.sectorId,
      count: count(),
    })
      .from(schema.conversations)
      .where(eq(schema.conversations.isActive, true))
      .groupBy(schema.conversations.sectorId);
  },
};
