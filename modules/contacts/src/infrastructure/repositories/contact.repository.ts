import { db, type DatabaseExecutor } from '@cvg/database';
import { contacts, conversations, internalNotes, tasks, contactLabels, labels, contactGroupMembers, contactGroups } from '@cvg/database';
import { eq, desc, ilike, or, count, and, sql } from 'drizzle-orm';
import type { CreateContactInput, UpdateContactInput } from '../../types';

export class ContactRepository {
  async findAll(search?: string) {
    let query = db.select().from(contacts).$dynamic();

    if (search) {
      query = query.where(or(
        ilike(contacts.name, `%${search}%`),
        ilike(contacts.phone, `%${search}%`),
        ilike(contacts.email, `%${search}%`)
      ));
    }

    return query.orderBy(desc(contacts.createdAt)).limit(100);
  }

  async findById(id: string) {
    const [contact] = await db.select().from(contacts).where(eq(contacts.id, id));
    return contact || null;
  }

  async findByPhone(phone: string) {
    const cleanPhone = phone.replace(/\D/g, '');
    const [contact] = await db.select().from(contacts).where(eq(contacts.phone, cleanPhone));
    return contact || null;
  }

  /**
   * SA-007: trava a linha do contato para serializar inícios concorrentes no
   * mesmo executor da transação (o segundo espera e enxerga a conversa criada).
   */
  async lockById(id: string, executor: DatabaseExecutor = db) {
    const [contact] = await executor
      .select()
      .from(contacts)
      .where(eq(contacts.id, id))
      .for('update');
    return contact || null;
  }

  async create(input: CreateContactInput) {
    const cleanPhone = input.phone.replace(/\D/g, '');
    const [contact] = await db.insert(contacts).values({
      name: input.name,
      phone: cleanPhone,
      email: input.email,
      externalId: input.externalId,
      metadata: input.notes ? JSON.stringify({ notes: input.notes }) : undefined,
    }).returning();
    return contact;
  }

  async update(id: string, input: UpdateContactInput) {
    const updateData: any = { updatedAt: new Date() };
    if (input.name) updateData.name = input.name;
    if (input.phone) updateData.phone = input.phone.replace(/\D/g, '');
    if (input.email !== undefined) updateData.email = input.email;
    if (input.notes !== undefined) {
      const existing = await this.findById(id);
      const meta = existing?.metadata ? JSON.parse(existing.metadata) : {};
      meta.notes = input.notes;
      updateData.metadata = JSON.stringify(meta);
    }

    const [contact] = await db.update(contacts).set(updateData).where(eq(contacts.id, id)).returning();
    return contact;
  }

  async delete(id: string) {
    await db.delete(contacts).where(eq(contacts.id, id));
  }

  async getWithDetails(id: string) {
    const contact = await this.findById(id);
    if (!contact) return null;

    // Buscar conversas
    const convos = await db.select({
      id: conversations.id,
      status: conversations.status,
      statusV2: conversations.statusV2,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
    })
      .from(conversations)
      .where(eq(conversations.contactId, id))
      .orderBy(desc(conversations.updatedAt))
      .limit(20);

    // Buscar última mensagem de cada conversa
    const convosWithLastMsg = await Promise.all(convos.map(async (c) => {
      const result = await db.execute(sql`
        SELECT content FROM messages 
        WHERE conversation_id = ${c.id} 
        ORDER BY created_at DESC LIMIT 1
      `);
      const rows = (result as unknown as { rows?: Array<{ content: string | null }> }).rows ?? [];
      return {
        ...c,
        lastMessage: rows[0]?.content ?? null,
      };
    }));

    // Contar notas
    const [notesCount] = convos.length > 0
      ? await db.select({ count: count() })
        .from(internalNotes)
        .where(and(
          eq(internalNotes.referenceType, 'conversation'),
          sql`${internalNotes.referenceId} IN (${sql.join(convos.map((c) => sql`${c.id}`), sql`, `)})`
        ))
      : [{ count: 0 }];

    // Contar tasks
    const [tasksCount] = convos[0]?.id
      ? await db.select({ count: count() })
        .from(tasks)
        .where(eq(tasks.conversationId, convos[0].id))
      : [{ count: 0 }];

    // Buscar labels
    const contactLabelsResult = await db.select({
      id: labels.id,
      name: labels.name,
      color: labels.color,
    })
      .from(contactLabels)
      .innerJoin(labels, eq(contactLabels.labelId, labels.id))
      .where(eq(contactLabels.contactId, id));

    // Buscar grupos
    const contactGroupsResult = await db.select({
      id: contactGroups.id,
      name: contactGroups.name,
      icon: contactGroups.icon,
    })
      .from(contactGroupMembers)
      .innerJoin(contactGroups, eq(contactGroupMembers.groupId, contactGroups.id))
      .where(eq(contactGroupMembers.contactId, id));

    return {
      ...contact,
      conversations: convosWithLastMsg,
      notesCount: notesCount?.count || 0,
      tasksCount: tasksCount?.count || 0,
      labels: contactLabelsResult,
      groups: contactGroupsResult,
    };
  }

  async getActiveConversation(contactId: string) {
    const [conv] = await db.select()
      .from(conversations)
      .where(and(
        eq(conversations.contactId, contactId),
        eq(conversations.isActive, true)
      ))
      .orderBy(desc(conversations.updatedAt))
      .limit(1);
    return conv || null;
  }

  async getStats() {
    const [total] = await db.select({ count: count() }).from(contacts);
    return { total: total?.count || 0 };
  }
}
