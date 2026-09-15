import { db } from '@cvg/database';
import { labels, conversationLabels, contactLabels } from '@cvg/database';
import { eq, and } from 'drizzle-orm';
import type { CreateLabelInput, UpdateLabelInput } from '../../types';

export class LabelRepository {
  async findAll() {
    return db.select().from(labels).orderBy(labels.name);
  }

  async findById(id: string) {
    const [label] = await db.select().from(labels).where(eq(labels.id, id));
    return label || null;
  }

  async findByName(name: string) {
    const [label] = await db.select().from(labels).where(eq(labels.name, name));
    return label || null;
  }

  async findByCategory(category: string) {
    return db.select().from(labels).where(eq(labels.category, category));
  }

  async create(input: CreateLabelInput) {
    const [label] = await db.insert(labels).values({
      name: input.name,
      color: input.color || '#6b7280',
      description: input.description,
      category: input.category,
    }).returning();
    return label;
  }

  async update(id: string, input: UpdateLabelInput) {
    const [label] = await db.update(labels)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(labels.id, id))
      .returning();
    return label;
  }

  async delete(id: string) {
    await db.delete(labels).where(eq(labels.id, id));
  }

  // --- Conversation Labels ---
  async getConversationLabels(conversationId: string) {
    return db.select({ label: labels })
      .from(conversationLabels)
      .innerJoin(labels, eq(conversationLabels.labelId, labels.id))
      .where(eq(conversationLabels.conversationId, conversationId));
  }

  async addConversationLabel(conversationId: string, labelId: string, userId?: string) {
    // SA-019/AC2: vínculo repetido é idempotente (unique idx_conv_labels_unique).
    await db.insert(conversationLabels).values({
      conversationId,
      labelId,
      createdBy: userId,
    }).onConflictDoNothing();
  }

  async removeConversationLabel(conversationId: string, labelId: string) {
    await db.delete(conversationLabels).where(
      and(
        eq(conversationLabels.conversationId, conversationId),
        eq(conversationLabels.labelId, labelId)
      )
    );
  }

  // --- Contact Labels ---
  async getContactLabels(contactId: string) {
    return db.select({ label: labels })
      .from(contactLabels)
      .innerJoin(labels, eq(contactLabels.labelId, labels.id))
      .where(eq(contactLabels.contactId, contactId));
  }

  async addContactLabel(contactId: string, labelId: string, userId?: string) {
    // SA-019/AC2: vínculo repetido é idempotente (unique idx_contact_labels_unique).
    await db.insert(contactLabels).values({
      contactId,
      labelId,
      createdBy: userId,
    }).onConflictDoNothing();
  }

  async removeContactLabel(contactId: string, labelId: string) {
    await db.delete(contactLabels).where(
      and(
        eq(contactLabels.contactId, contactId),
        eq(contactLabels.labelId, labelId)
      )
    );
  }
}
