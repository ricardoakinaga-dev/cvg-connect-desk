import { db, schema } from '@cvg/database';
import { and, count, desc, eq, ilike, isNotNull, or, type SQL } from 'drizzle-orm';
import type { CreatePatientInput, UpdatePatientInput } from '../../types';

export class PatientRepository {
  async findAll(filters?: { search?: string; tutorId?: string; species?: string }) {
    const conditions: SQL[] = [];
    const search = filters?.search?.trim();

    if (search) {
      const term = `%${search}%`;
      conditions.push(or(
        ilike(schema.patients.name, term),
        ilike(schema.patients.species, term),
        ilike(schema.patients.breed, term),
      )!);
    }
    if (filters?.tutorId) conditions.push(eq(schema.patients.tutorId, filters.tutorId));
    if (filters?.species?.trim()) conditions.push(ilike(schema.patients.species, `%${filters.species.trim()}%`));

    let query = db.select({
      id: schema.patients.id,
      externalId: schema.patients.externalId,
      name: schema.patients.name,
      species: schema.patients.species,
      breed: schema.patients.breed,
      tutorId: schema.patients.tutorId,
      createdAt: schema.patients.createdAt,
      updatedAt: schema.patients.updatedAt,
      tutorRecordId: schema.tutors.id,
      tutorName: schema.tutors.name,
      tutorPhone: schema.tutors.phone,
    }).from(schema.patients)
      .leftJoin(schema.tutors, eq(schema.patients.tutorId, schema.tutors.id))
      .$dynamic();

    if (conditions.length > 0) query = query.where(and(...conditions));

    const rows = await query.orderBy(desc(schema.patients.createdAt)).limit(100);
    return rows.map((row) => ({
      id: row.id,
      externalId: row.externalId,
      name: row.name,
      species: row.species,
      breed: row.breed,
      tutorId: row.tutorId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      tutor: row.tutorRecordId ? {
        id: row.tutorRecordId,
        name: row.tutorName!,
        phone: row.tutorPhone,
      } : null,
    }));
  }

  async findById(id: string) {
    const [patient] = await db.select().from(schema.patients).where(eq(schema.patients.id, id));
    return patient || null;
  }

  async tutorExists(id: string) {
    const [tutor] = await db.select({ id: schema.tutors.id }).from(schema.tutors).where(eq(schema.tutors.id, id));
    return Boolean(tutor);
  }

  async create(input: CreatePatientInput) {
    const [patient] = await db.insert(schema.patients).values({
      name: input.name,
      species: input.species ?? null,
      breed: input.breed ?? null,
      tutorId: input.tutorId ?? null,
      externalId: input.externalId ?? null,
    }).returning();
    return patient;
  }

  async update(id: string, input: UpdatePatientInput) {
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) updateData.name = input.name;
    if (input.species !== undefined) updateData.species = input.species;
    if (input.breed !== undefined) updateData.breed = input.breed;
    if (input.tutorId !== undefined) updateData.tutorId = input.tutorId;
    if (input.externalId !== undefined) updateData.externalId = input.externalId;

    const [patient] = await db.update(schema.patients)
      .set(updateData)
      .where(eq(schema.patients.id, id))
      .returning();
    return patient || null;
  }

  async delete(id: string) {
    await db.delete(schema.patients).where(eq(schema.patients.id, id));
  }

  async getWithDetails(id: string) {
    const patient = await this.findById(id);
    if (!patient) return null;

    const [tutor, conversationCount, taskCount] = await Promise.all([
      patient.tutorId
        ? db.select({ id: schema.tutors.id, name: schema.tutors.name, phone: schema.tutors.phone })
          .from(schema.tutors)
          .where(eq(schema.tutors.id, patient.tutorId))
          .then((rows) => rows[0] || null)
        : Promise.resolve(null),
      db.select({ count: count() })
        .from(schema.conversations)
        .innerJoin(schema.contacts, eq(schema.conversations.contactId, schema.contacts.id))
        .where(eq(schema.contacts.patientId, id)),
      db.select({ count: count() })
        .from(schema.tasks)
        .where(eq(schema.tasks.patientId, id)),
    ]);

    return {
      ...patient,
      tutor,
      conversationCount: Number(conversationCount[0]?.count || 0),
      taskCount: Number(taskCount[0]?.count || 0),
    };
  }

  async getReferenceCounts(id: string) {
    const [contacts, tasks, notes] = await Promise.all([
      db.select({ count: count() }).from(schema.contacts).where(eq(schema.contacts.patientId, id)),
      db.select({ count: count() }).from(schema.tasks).where(eq(schema.tasks.patientId, id)),
      db.select({ count: count() }).from(schema.internalNotes).where(and(
        eq(schema.internalNotes.referenceType, 'patient'),
        eq(schema.internalNotes.referenceId, id),
      )),
    ]);

    return {
      contacts: Number(contacts[0]?.count || 0),
      tasks: Number(tasks[0]?.count || 0),
      notes: Number(notes[0]?.count || 0),
    };
  }

  async getStats() {
    const [total] = await db.select({ count: count() }).from(schema.patients);
    const bySpecies = await db.select({
      species: schema.patients.species,
      count: count(),
    })
      .from(schema.patients)
      .where(isNotNull(schema.patients.species))
      .groupBy(schema.patients.species)
      .orderBy(desc(count()));

    return {
      total: Number(total?.count || 0),
      bySpecies: bySpecies.map((row) => ({ species: row.species!, count: Number(row.count) })),
    };
  }
}
