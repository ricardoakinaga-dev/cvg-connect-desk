import { db } from '@cvg/database';
import { sectors, conversations } from '@cvg/database';
import { eq, and, count } from 'drizzle-orm';
import type { CreateSectorInput, UpdateSectorInput } from '../../types';

export class SectorRepository {
  async findAll(activeOnly = true) {
    let query = db.select().from(sectors).$dynamic();
    if (activeOnly) query = query.where(eq(sectors.isActive, true));
    return query.orderBy(sectors.name);
  }

  async findById(id: string) {
    const [sector] = await db.select().from(sectors).where(eq(sectors.id, id));
    return sector || null;
  }

  async findByCode(code: string) {
    const [sector] = await db.select().from(sectors).where(eq(sectors.code, code));
    return sector || null;
  }

  async create(input: CreateSectorInput) {
    const [sector] = await db.insert(sectors).values(input).returning();
    return sector;
  }

  async update(id: string, input: UpdateSectorInput) {
    const [sector] = await db.update(sectors)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(sectors.id, id))
      .returning();
    return sector;
  }

  async delete(id: string) {
    await db.delete(sectors).where(eq(sectors.id, id));
  }

  async getConversations(sectorId: string, status?: string) {
    const conditions = [eq(conversations.sectorId, sectorId)];
    if (status) conditions.push(eq(conversations.statusV2, status as any));
    return db.select().from(conversations).where(and(...conditions));
  }

  async getStats(sectorId: string) {
    const [total] = await db.select({ count: count() })
      .from(conversations)
      .where(eq(conversations.sectorId, sectorId));

    const [active] = await db.select({ count: count() })
      .from(conversations)
      .where(and(
        eq(conversations.sectorId, sectorId),
        eq(conversations.statusV2, 'em_atendimento')
      ));

    const [pending] = await db.select({ count: count() })
      .from(conversations)
      .where(and(
        eq(conversations.sectorId, sectorId),
        eq(conversations.statusV2, 'pendente')
      ));

    return {
      totalConversations: total.count,
      activeConversations: active.count,
      pendingConversations: pending.count,
    };
  }

  async getAllStats() {
    return db.select({
      sectorId: sectors.id,
      sectorName: sectors.name,
      sectorCode: sectors.code,
      sectorColor: sectors.color,
      sectorIcon: sectors.icon,
    }).from(sectors).where(eq(sectors.isActive, true));
  }
}
