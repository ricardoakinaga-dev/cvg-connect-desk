import { db, schema, type DatabaseExecutor } from '@cvg/database';
import { eq, sql } from 'drizzle-orm';

/**
 * Upsert idempotente por telefone. Aceita o `tx` de uma transação de banco
 * (AAA-08) para que a criação do contato role junto com a mensagem/estado:
 * um rollback não deixa contato órfão.
 */
export async function resolveInboundContact(
  phoneValue: string,
  name?: string,
  executor: DatabaseExecutor = db,
) {
  const phone = phoneValue.replace(/\D/g, '');
  if (!phone) return null;

  const [byPhone] = await executor
    .select()
    .from(schema.contacts)
    .where(eq(schema.contacts.phone, phone))
    .limit(1);
  if (byPhone) return byPhone;

  const externalId = `whatsapp:${phone}`;
  const [contact] = await executor
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
