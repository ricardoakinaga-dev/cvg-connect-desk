import { db } from '@cvg/database';
import { contactTransfers, conversations, contactSectors } from '@cvg/database';
import { eq, and } from 'drizzle-orm';

type ContactTransferStatus = typeof contactTransfers.status.enumValues[number];

export class TransferRepository {
  async create(data: {
    contactId: string;
    conversationId?: string;
    fromSectorId?: string;
    toSectorId: string;
    fromUserId?: string;
    toUserId?: string;
    reason?: string;
    status?: ContactTransferStatus;
  }) {
    const [transfer] = await db.insert(contactTransfers).values(data).returning();
    return transfer;
  }

  async findAll(limit = 50) {
    return db.select().from(contactTransfers)
      .orderBy(contactTransfers.createdAt)
      .limit(limit);
  }

  async findById(id: string) {
    const [transfer] = await db.select().from(contactTransfers).where(eq(contactTransfers.id, id));
    return transfer || null;
  }

  async findByContact(contactId: string) {
    return db.select().from(contactTransfers)
      .where(eq(contactTransfers.contactId, contactId))
      .orderBy(contactTransfers.createdAt);
  }

  async accept(id: string) {
    const [transfer] = await db.update(contactTransfers)
      .set({ status: 'accepted', resolvedAt: new Date() })
      .where(eq(contactTransfers.id, id))
      .returning();
    return transfer;
  }

  async reject(id: string) {
    const [transfer] = await db.update(contactTransfers)
      .set({ status: 'rejected', resolvedAt: new Date() })
      .where(eq(contactTransfers.id, id))
      .returning();
    return transfer;
  }

  async updateConversationSector(conversationId: string, sectorId: string) {
    await db.update(conversations)
      .set({ sectorId, updatedAt: new Date() })
      .where(eq(conversations.id, conversationId));
  }

  async updateContactSector(contactId: string, fromSectorId: string, toSectorId: string) {
    // Desativa vínculo antigo
    await db.update(contactSectors)
      .set({ status: 'transferred', updatedAt: new Date() })
      .where(and(
        eq(contactSectors.contactId, contactId),
        eq(contactSectors.sectorId, fromSectorId)
      ));

    // Cria ou atualiza vínculo novo
    const [existing] = await db.select().from(contactSectors)
      .where(and(
        eq(contactSectors.contactId, contactId),
        eq(contactSectors.sectorId, toSectorId)
      ));

    if (existing) {
      await db.update(contactSectors)
        .set({ status: 'active', updatedAt: new Date() })
        .where(eq(contactSectors.id, existing.id));
    } else {
      await db.insert(contactSectors).values({
        contactId,
        sectorId: toSectorId,
        status: 'active',
      });
    }
  }
}
