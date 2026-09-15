import { db, schema, type DatabaseExecutor } from '@cvg/database';
import { eq, and, ne, desc, sql, type SQL } from 'drizzle-orm';

const { contactTransfers, conversations, contactSectors, contacts, sectors } = schema;

export interface TransferListOptions {
  limit?: number;
  offset?: number;
}

/**
 * Repositório de transferências com executor transacional (PROD-18/AC1).
 * Todas as escritas relevantes aceitam o `tx` de `db.transaction` para
 * participar da MESMA transação do uso de caso (transferência + vínculos +
 * auditoria + outbox).
 */
export class TransferRepository {
  async create(data: {
    contactId: string;
    conversationId?: string;
    fromSectorId?: string;
    toSectorId: string;
    fromUserId?: string;
    toUserId?: string;
    reason?: string;
    status?: typeof contactTransfers.$inferInsert.status;
    resolvedAt?: Date;
  }, executor: DatabaseExecutor = db) {
    const [transfer] = await executor.insert(contactTransfers).values(data).returning();
    return transfer;
  }

  async findAll(options?: TransferListOptions) {
    const limit = Math.min(Math.max(options?.limit ?? 100, 1), 200);
    const offset = Math.max(options?.offset ?? 0, 0);
    return db.select().from(contactTransfers)
      .orderBy(desc(contactTransfers.createdAt), desc(contactTransfers.id))
      .limit(limit)
      .offset(offset);
  }

  async findById(id: string, executor: DatabaseExecutor = db) {
    const [transfer] = await executor.select().from(contactTransfers).where(eq(contactTransfers.id, id));
    return transfer || null;
  }

  async findByContact(contactId: string) {
    return db.select().from(contactTransfers)
      .where(eq(contactTransfers.contactId, contactId))
      .orderBy(desc(contactTransfers.createdAt), desc(contactTransfers.id));
  }

  async findContact(contactId: string, executor: DatabaseExecutor = db) {
    const [contact] = await executor
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.id, contactId));
    return contact ?? null;
  }

  async findSector(sectorId: string, executor: DatabaseExecutor = db) {
    const [sector] = await executor
      .select({ id: sectors.id, isActive: sectors.isActive })
      .from(sectors)
      .where(eq(sectors.id, sectorId));
    return sector ?? null;
  }

  async findActiveUser(userId: string, executor: DatabaseExecutor = db) {
    const [user] = await executor
      .select({ id: schema.users.id, isActive: schema.users.isActive })
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    return user ?? null;
  }

  async findConversation(conversationId: string, executor: DatabaseExecutor = db) {
    const [conversation] = await executor
      .select({
        id: conversations.id,
        contactId: conversations.contactId,
        sectorId: conversations.sectorId,
      })
      .from(conversations)
      .where(eq(conversations.id, conversationId));
    return conversation ?? null;
  }

  /**
   * Serializa transferências do mesmo contato (`pg_advisory_xact_lock`):
   * duas transferências simultâneas executam em série; a segunda enxerga o
   * estado commitado pela primeira (sem vínculo/setor contraditório).
   */
  async lockContact(contactId: string, executor: DatabaseExecutor) {
    await executor.execute(sql`select pg_advisory_xact_lock(hashtext(${`prod18-transfer:${contactId}`}))`);
  }

  async findPendingDuplicate(
    contactId: string,
    conversationId: string | null,
    toSectorId: string,
    executor: DatabaseExecutor,
  ) {
    const conditions: SQL[] = [
      eq(contactTransfers.contactId, contactId),
      eq(contactTransfers.toSectorId, toSectorId),
      eq(contactTransfers.status, 'pending'),
    ];
    if (conversationId) {
      conditions.push(eq(contactTransfers.conversationId, conversationId));
    } else {
      conditions.push(sql`${contactTransfers.conversationId} is null`);
    }
    const [pending] = await executor
      .select()
      .from(contactTransfers)
      .where(and(...conditions))
      .orderBy(desc(contactTransfers.createdAt))
      .limit(1);
    return pending ?? null;
  }

  async findLatestAccepted(contactId: string, toSectorId: string, executor: DatabaseExecutor) {
    const [accepted] = await executor
      .select()
      .from(contactTransfers)
      .where(and(
        eq(contactTransfers.contactId, contactId),
        eq(contactTransfers.toSectorId, toSectorId),
        eq(contactTransfers.status, 'accepted'),
      ))
      .orderBy(desc(contactTransfers.createdAt))
      .limit(1);
    return accepted ?? null;
  }

  /** CAS: só aceita/rejeita com o status AINDA pendente; null = corrida perdida. */
  async transition(id: string, toStatus: 'accepted' | 'rejected', executor: DatabaseExecutor = db) {
    const [transfer] = await executor
      .update(contactTransfers)
      .set({ status: toStatus, resolvedAt: new Date() })
      .where(and(eq(contactTransfers.id, id), eq(contactTransfers.status, 'pending')))
      .returning();
    return transfer || null;
  }

  async accept(id: string, executor: DatabaseExecutor = db) {
    return this.transition(id, 'accepted', executor);
  }

  async reject(id: string, executor: DatabaseExecutor = db) {
    return this.transition(id, 'rejected', executor);
  }

  async updateConversationSector(conversationId: string, sectorId: string, executor: DatabaseExecutor = db) {
    const [conversation] = await executor
      .update(conversations)
      .set({ sectorId, updatedAt: new Date() })
      .where(eq(conversations.id, conversationId))
      .returning();
    return conversation ?? null;
  }

  async updateContactSector(
    contactId: string,
    _fromSectorId: string,
    toSectorId: string,
    executor: DatabaseExecutor = db,
  ) {
    // Desativa QUALQUER outro vínculo ativo (não só o setor informado):
    // convergência garantida mesmo se a origem lida pelo cliente estiver
    // defasada (dois transfers concorrentes para destinos diferentes).
    await executor.update(contactSectors)
      .set({ status: 'transferred', updatedAt: new Date() })
      .where(and(
        eq(contactSectors.contactId, contactId),
        eq(contactSectors.status, 'active'),
        ne(contactSectors.sectorId, toSectorId),
      ));

    // Cria ou reativa o vínculo de destino
    const [existing] = await executor.select().from(contactSectors)
      .where(and(
        eq(contactSectors.contactId, contactId),
        eq(contactSectors.sectorId, toSectorId),
      ));

    if (existing) {
      await executor.update(contactSectors)
        .set({ status: 'active', updatedAt: new Date() })
        .where(eq(contactSectors.id, existing.id));
    } else {
      await executor.insert(contactSectors).values({
        contactId,
        sectorId: toSectorId,
        status: 'active',
      });
    }
  }
}
