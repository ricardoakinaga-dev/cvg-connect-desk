import { db, schema } from '@cvg/database';
import { eq, desc, ilike, or, and, count } from 'drizzle-orm';
import type { CreatePatientInput, UpdatePatientInput } from '../types';

export class PatientRepository {
  async findAll(filters?: { search?: string; tutorId?: string; species?: string }) {
    let query = db.select().from(schema.patients).$dynamic();
    const conditions = [];

    if (filters?.search) {
      conditions.push(or(
        ilike(schema.patients.name, `%${filters.search}%`),
        ilike(schema.patients.species, `%${filters.search}%`),
        ilike(schema.patients.breed, `%${filters.search}%`)
      ));
    }

    if (filters?.tutorId) {
      conditions.push(eq(schema.patients.tutorId, filters.tutorId));
    }

    if (filters?.species) {
      conditions.push(ilike(schema.patients.species, `%${filters.species}%`));
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    return query.orderBy(desc(schema.patients.createdAt)).limit(100);
  }

  async findById(id: string) {
    const [patient] = await db.select().from(schema.patients).where(eq(schema.patients.id, id));
    return patient || null;
  }

  async create(input: CreatePatientInput) {
    const [patient] = await db.insert(schema.patients).values({
      name: input.name,
      species: input.species,
      breed: input.breed,
      tutorId: input.tutorId,
      externalId: input.externalId,
    }).returning();
    return patient;
  }

  async update(id: string, input: UpdatePatientInput) {
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name) updateData.name = input.name;
    if (input.species !== undefined) updateData.species = input.species;
    if (input.breed !== undefined) updateData.breed = input.breed;
    if (input.tutorId !== undefined) updateData.tutorId = input.tutorId;

    const [patient] = await db.update(schema.patients).set(updateData).where(eq(schema.patients.id, id)).returning();
    return patient;
  }

  async delete(id: string) {
    await db.delete(schema.patients).where(eq(schema.patients.id, id));
  }

  async getWithDetails(id: string) {
    const patient = await this.findById(id);
    if (!patient) return null;

    // Buscar tutor
    let tutor = null;
    if (patient.tutorId) {
      const [t] = await db.select({
        id: schema.tutors.id,
        name: schema.tutors.name,
        phone: schema.tutors.phone,
      })
        .from(schema.tutors)
        .where(eq(schema.tutors.id, patient.tutorId));
      tutor = t || null;
    }

    // Contar conversas vinculadas ao tutor
    const [convCount] = patient.tutorId
      ? await db.select({ count: count() })
          .from(schema.conversations)
          .where(eq(schema.conversations.contactId, patient.tutorId))
      : [{ count: 0 }];

    // Contar tasks vinculadas
    const [taskCount] = await db.select({ count: count() })
      .from(schema.tasks)
      .where(eq(schema.tasks.patientId, id));

    return {
      ...patient,
      tutor,
      conversationCount: convCount?.count || 0,
      taskCount: taskCount?.count || 0,
    };
  }

  async getStats() {
    const [total] = await db.select({ count: count() }).from(schema.patients);
    const speciesResult = await db.select({
      species: schema.patients.species,
      count: count(),
    })
      .from(schema.patients)
      .where(ilike(schema.patients.species, '%cachorro%'))
      .groupBy(schema.patients.species);

    return { total: total?.count || 0 };
  }
}
