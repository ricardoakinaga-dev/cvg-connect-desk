import { db, schema } from '@cvg/database';
import { and, count, desc, eq, ilike, ne, or } from 'drizzle-orm';
import type { CreateTutorInput, UpdateTutorInput } from '../../types';

export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

export class TutorRepository {
  async findAll(search?: string) {
    let query = db.select().from(schema.tutors).$dynamic();

    if (search?.trim()) {
      const term = `%${search.trim()}%`;
      query = query.where(or(
        ilike(schema.tutors.name, term),
        ilike(schema.tutors.phone, term),
        ilike(schema.tutors.email, term),
      ));
    }

    return query.orderBy(desc(schema.tutors.createdAt)).limit(100);
  }

  async findById(id: string) {
    const [tutor] = await db.select().from(schema.tutors).where(eq(schema.tutors.id, id));
    return tutor || null;
  }

  async findByPhone(phone: string, excludeId?: string) {
    const conditions = [eq(schema.tutors.phone, normalizePhone(phone))];
    if (excludeId) conditions.push(ne(schema.tutors.id, excludeId));

    const [tutor] = await db.select().from(schema.tutors).where(and(...conditions));
    return tutor || null;
  }

  async create(input: CreateTutorInput) {
    const [tutor] = await db.insert(schema.tutors).values({
      name: input.name,
      phone: input.phone ? normalizePhone(input.phone) : null,
      email: input.email ?? null,
      externalId: input.externalId ?? null,
    }).returning();
    return tutor;
  }

  async update(id: string, input: UpdateTutorInput) {
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) updateData.name = input.name;
    if (input.phone !== undefined) updateData.phone = input.phone ? normalizePhone(input.phone) : null;
    if (input.email !== undefined) updateData.email = input.email;
    if (input.externalId !== undefined) updateData.externalId = input.externalId;

    const [tutor] = await db.update(schema.tutors)
      .set(updateData)
      .where(eq(schema.tutors.id, id))
      .returning();
    return tutor || null;
  }

  async delete(id: string) {
    await db.delete(schema.tutors).where(eq(schema.tutors.id, id));
  }

  async getWithPatients(id: string) {
    const tutor = await this.findById(id);
    if (!tutor) return null;

    const [patients, conversationCount, taskCount] = await Promise.all([
      db.select({
        id: schema.patients.id,
        name: schema.patients.name,
        species: schema.patients.species,
        breed: schema.patients.breed,
      })
        .from(schema.patients)
        .where(eq(schema.patients.tutorId, id))
        .orderBy(schema.patients.name),
      db.select({ count: count() })
        .from(schema.conversations)
        .innerJoin(schema.contacts, eq(schema.conversations.contactId, schema.contacts.id))
        .where(eq(schema.contacts.tutorId, id)),
      db.select({ count: count() })
        .from(schema.tasks)
        .where(eq(schema.tasks.tutorId, id)),
    ]);

    return {
      ...tutor,
      patients,
      conversationCount: Number(conversationCount[0]?.count || 0),
      taskCount: Number(taskCount[0]?.count || 0),
    };
  }

  async getReferenceCounts(id: string) {
    const [patients, contacts, tasks, notes] = await Promise.all([
      db.select({ count: count() }).from(schema.patients).where(eq(schema.patients.tutorId, id)),
      db.select({ count: count() }).from(schema.contacts).where(eq(schema.contacts.tutorId, id)),
      db.select({ count: count() }).from(schema.tasks).where(eq(schema.tasks.tutorId, id)),
      db.select({ count: count() }).from(schema.internalNotes).where(and(
        eq(schema.internalNotes.referenceType, 'tutor'),
        eq(schema.internalNotes.referenceId, id),
      )),
    ]);

    return {
      patients: Number(patients[0]?.count || 0),
      contacts: Number(contacts[0]?.count || 0),
      tasks: Number(tasks[0]?.count || 0),
      notes: Number(notes[0]?.count || 0),
    };
  }

  async getStats() {
    const [total] = await db.select({ count: count() }).from(schema.tutors);
    return { total: Number(total?.count || 0) };
  }
}
