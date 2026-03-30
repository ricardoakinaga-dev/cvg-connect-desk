import { db } from '@cvg/database';
import { conversations, contacts, labels, conversationLabels, sectors, users, messages } from '@cvg/database';
import { eq, and, desc, sql, isNotNull } from 'drizzle-orm';

export class KanbanRepository {
  async getCards(filters?: { sectorId?: string; assignedUserId?: string; labelId?: string }) {
    const conditions = [eq(conversations.isActive, true)];

    if (filters?.sectorId) conditions.push(eq(conversations.sectorId, filters.sectorId));
    if (filters?.assignedUserId) conditions.push(eq(conversations.assignedUserId, filters.assignedUserId));

    // Buscar conversas com joins
    let query = db.select({
      id: conversations.id,
      statusV2: conversations.statusV2,
      contactName: contacts.name,
      contactPhone: contacts.phone,
      sectorName: sectors.name,
      sectorColor: sectors.color,
      sectorIcon: sectors.icon,
      assignedUserName: users.name,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
    })
      .from(conversations)
      .leftJoin(contacts, eq(conversations.contactId, contacts.id))
      .leftJoin(sectors, eq(conversations.sectorId, sectors.id))
      .leftJoin(users, eq(conversations.assignedUserId, users.id))
      .where(and(...conditions))
      .orderBy(desc(conversations.updatedAt))
      .limit(200)
      .$dynamic();

    const result = await query;

    // Buscar labels para cada conversa
    const conversationIds = result.map(r => r.id);
    const convLabels = conversationIds.length > 0 ? await db.select({
      conversationId: conversationLabels.conversationId,
      labelName: labels.name,
      labelColor: labels.color,
    })
      .from(conversationLabels)
      .innerJoin(labels, eq(conversationLabels.labelId, labels.id))
      .where(sql`${conversationLabels.conversationId} = ANY(${conversationIds})`)
    : [];

    // Buscar última mensagem para cada conversa
    const lastMessages = conversationIds.length > 0 ? await db.execute(sql`
      SELECT DISTINCT ON (conversation_id) conversation_id, content
      FROM messages
      WHERE conversation_id = ANY(${conversationIds})
      ORDER BY conversation_id, created_at DESC
    `) : { rows: [] };

    const lastMessageMap = new Map<string, string>();
    for (const row of (lastMessages as any).rows || []) {
      lastMessageMap.set(row.conversation_id, row.content?.substring(0, 100) || null);
    }

    const labelMap = new Map<string, { name: string; color: string }[]>();
    for (const cl of convLabels) {
      const existing = labelMap.get(cl.conversationId) || [];
      existing.push({ name: cl.labelName, color: cl.labelColor });
      labelMap.set(cl.conversationId, existing);
    }

    // Montar cards
    const cards = result.map(r => {
      const minutesSinceUpdate = Math.floor((Date.now() - new Date(r.updatedAt).getTime()) / 60000);
      const cardLabels = labelMap.get(r.id) || [];

      let priority: 'low' | 'normal' | 'high' | 'urgent' = 'normal';
      if (cardLabels.some(l => l.name === 'urgente')) priority = 'urgent';
      else if (r.statusV2 === 'em_espera') priority = 'high';
      else if (minutesSinceUpdate > 120) priority = 'high';

      return {
        id: r.id,
        contactName: r.contactName,
        contactPhone: r.contactPhone,
        patientName: null,
        lastMessage: lastMessageMap.get(r.id) || null,
        assignedUserName: r.assignedUserName,
        sectorName: r.sectorName,
        sectorColor: r.sectorColor,
        sectorIcon: r.sectorIcon,
        labels: cardLabels,
        priority,
        minutesSinceUpdate,
        createdAt: r.createdAt,
      };
    });

    return cards;
  }

  async getFilters() {
    const allSectors = await db.select({ id: sectors.id, name: sectors.name, icon: sectors.icon, color: sectors.color })
      .from(sectors).where(eq(sectors.isActive, true));

    const allLabels = await db.select({ id: labels.id, name: labels.name, color: labels.color })
      .from(labels).orderBy(labels.name);

    return { sectors: allSectors, labels: allLabels };
  }

  async getStats(sectorId?: string) {
    const conditions = sectorId ? [eq(conversations.sectorId, sectorId)] : [];
    conditions.push(eq(conversations.isActive, true));

    const byStatus = await db.select({
      statusV2: conversations.statusV2,
      count: sql<number>`count(*)::int`,
    })
      .from(conversations)
      .where(and(...conditions))
      .groupBy(conversations.statusV2);

    const byStatusMap: Record<string, number> = {};
    let total = 0;
    for (const s of byStatus) {
      byStatusMap[s.statusV2] = s.count;
      total += s.count;
    }

    return { total, byStatus: byStatusMap };
  }
}
