import { db, schema } from '@cvg/database';
import { eq, sql } from 'drizzle-orm';

export async function resolveInboundContact(phoneValue: string, name?: string) {
  const phone = phoneValue.replace(/\D/g, '');
  if (!phone) return null;

  const [byPhone] = await db
    .select()
    .from(schema.contacts)
    .where(eq(schema.contacts.phone, phone))
    .limit(1);
  if (byPhone) return byPhone;

  const externalId = `whatsapp:${phone}`;
  const [contact] = await db
    .insert(schema.contacts)
    .values({ externalId, phone, name: name?.trim() || null })
    .onConflictDoUpdate({
      target: schema.contacts.externalId,
      set: {
        phone,
        name: sql`COALESCE(${schema.contacts.name}, ${name?.trim() || null})`,
        updatedAt: new Date(),
      },
    })
    .returning();
  return contact;
}
