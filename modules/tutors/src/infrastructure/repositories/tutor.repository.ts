import { db, schema } from '@cvg/database';
import { eq, desc, ilike, or, count } from 'drizzle-orm';
import type { CreateTutorInput, UpdateTutorInput } from '../types';

export class TutorRepository {
  async findAll(search?: string) {
    let query = db.select().from(schema.tutors).$dynamic();

    if (search) {
      query = query.where(or(
        ilike(schema.tutors.name, `%${search}%`),
        ilike(schema.tutors.phone, `%${search}%`),
        ilike(schema.tutors.email, `%${search}%`)
      ));
    }

    return query.orderBy(desc(schema.tutors.createdAt)).limit(100);
  }

  async findById(id: string) {
    const [tutor] = await db.select().from(schema.tutors).where(eq(schema.tutors.id, id));
    return tutor || null;
  }

  async findByPhone(phone: string) {
    const cleanPhone = phone.replace(/\D/g, '');
    const [tutor] = await db.select().from(schema.tutors).where(eq(schema.tutors.phone, cleanPhone));
    return tutor || null;
  }

  async create(input: CreateTutorInput) {
    const cleanPhone = input.phone ? input.phone.replace(/\D/g, '') : null;
    const [tutor] = await db.insert(schema.tutors).values({
      name: input.name,
      phone: cleanPhone,
      email: input.email,
      externalId: input.externalId,
    }).returning();
    return tutor;
  }

  async update(id: string, input: UpdateTutorInput) {
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name) updateData.name = input.name;
    if (input.phone) updateData.phone = input.phone.replace(/\D/g, '');
    if (input.email !== undefined) updateData.email = input.email;

    const [tutor] = await db.update(schema.tutors).set(updateData).where(eq(schema.tutors.id, id)).returning();
    return tutor;
  }

  async delete(id: string) {
    await db.delete(schema.tutors).where(eq(schema.tutors.id, id));
  }

  async getWithPatients(id: string) {
    const tutor = await this.findById(id);
    if (!tutor) return null;

    const patientsList = await db.select({
      id: schema.patients.id,
      name: schema.patients.name,
      species: schema.patients.species,
      breed: schema.patients.breed,
    })
      .from(schema.patients)
      .where(eq(schema.patients.tutorId, id))
      .orderBy(schema.patients.name);

    const [convCount] = await db.select({ count: count() })
      .from(schema.conversations)
      .where(eq(schema.conversations.contactId, id));

    return {
      ...tutor,
      patients: patientsList,
      conversationCount: convCount?.count || 0,
    };
  }

  async getStats() {
    const [total] = await db.select({ count: count() }).from(schema.tutors);
    return { total: total?.count || 0 };
  }
}
