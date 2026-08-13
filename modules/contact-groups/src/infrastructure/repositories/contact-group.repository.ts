import { db } from '@cvg/database';
import { contactGroups, contactGroupMembers, contacts } from '@cvg/database';
import { eq, and, count } from 'drizzle-orm';
import type { CreateGroupInput } from '../../types';

export class ContactGroupRepository {
  async findAll() {
    const groups = await db.select({
      group: contactGroups,
      memberCount: count(contactGroupMembers.id),
    })
      .from(contactGroups)
      .leftJoin(contactGroupMembers, eq(contactGroups.id, contactGroupMembers.groupId))
      .groupBy(contactGroups.id)
      .orderBy(contactGroups.name);

    return groups.map(g => ({ ...g.group, memberCount: g.memberCount }));
  }

  async findById(id: string) {
    const [group] = await db.select().from(contactGroups).where(eq(contactGroups.id, id));
    return group || null;
  }

  async create(input: CreateGroupInput, userId?: string) {
    const [group] = await db.insert(contactGroups).values({
      ...input,
      createdBy: userId,
    }).returning();
    return group;
  }

  async update(id: string, input: Partial<CreateGroupInput>) {
    const [group] = await db.update(contactGroups)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(contactGroups.id, id))
      .returning();
    return group;
  }

  async delete(id: string) {
    await db.delete(contactGroups).where(eq(contactGroups.id, id));
  }

  async getMembers(groupId: string) {
    return db.select({
      id: contactGroupMembers.id,
      contactId: contacts.id,
      contactName: contacts.name,
      contactPhone: contacts.phone,
      contactEmail: contacts.email,
      addedAt: contactGroupMembers.addedAt,
    })
      .from(contactGroupMembers)
      .innerJoin(contacts, eq(contactGroupMembers.contactId, contacts.id))
      .where(eq(contactGroupMembers.groupId, groupId));
  }

  async addMember(groupId: string, contactId: string, userId?: string) {
    await db.insert(contactGroupMembers).values({
      groupId,
      contactId,
      addedBy: userId,
    });
  }

  async removeMember(groupId: string, contactId: string) {
    await db.delete(contactGroupMembers).where(
      and(
        eq(contactGroupMembers.groupId, groupId),
        eq(contactGroupMembers.contactId, contactId)
      )
    );
  }

  async getContactGroups(contactId: string) {
    return db.select({ group: contactGroups })
      .from(contactGroupMembers)
      .innerJoin(contactGroups, eq(contactGroupMembers.groupId, contactGroups.id))
      .where(eq(contactGroupMembers.contactId, contactId));
  }
}
