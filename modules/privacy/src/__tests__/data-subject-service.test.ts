import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { exportContactData, anonymizeContactData } from '../application/data-subject-service';

/**
 * Final-9: DSAR em nível de serviço (DB real).
 */
describe('DataSubjectService (real PG)', () => {
  const contactId = randomUUID();
  const phone = `+55119${Date.now().toString().slice(-8)}`;
  let conversationId = '';
  const actorId = randomUUID();
  const actor = { userId: actorId, reason: 'dsar-test', requestId: `req-${Date.now()}` };

  beforeAll(async () => {
    await db.insert(schema.users).values({ id: actorId, name: 'DSAR Operator', email: `dsar.op.${Date.now()}@example.com`, passwordHash: 'x', isActive: true });
    await db.insert(schema.contacts).values({ id: contactId, phone, name: 'DSAR Subject', email: 'dsar@example.com' });
    const [conv] = await db
      .insert(schema.conversations)
      .values({ contactId, status: 'open', statusV2: 'novo', currentHandler: 'bot', isActive: true })
      .returning();
    conversationId = conv.id;
    await db.insert(schema.messages).values({
      conversationId,
      direction: 'inbound',
      content: 'mensagem do titular',
      sender: phone,
      externalMessageId: `dsar-${Date.now()}`,
    });
    await db.insert(schema.messages).values({
      conversationId,
      direction: 'outbound',
      content: 'resposta da equipe',
      sender: 'Atendente',
      recipient: phone,
    });
  });

  afterAll(async () => {
    await db.delete(schema.messages).where(eq(schema.messages.conversationId, conversationId));
    await db.delete(schema.conversationStatusHistory).where(eq(schema.conversationStatusHistory.conversationId, conversationId));
    await db.delete(schema.conversations).where(eq(schema.conversations.id, conversationId));
    await db.delete(schema.auditLogs).where(eq(schema.auditLogs.entityId, contactId));
    await db.delete(schema.contacts).where(eq(schema.contacts.id, contactId));
    await db.delete(schema.auditLogs).where(eq(schema.auditLogs.userId, actorId));
    await db.delete(schema.users).where(eq(schema.users.id, actorId));
  });

  it('export includes all subject sections', async () => {
    const data = await exportContactData(contactId, actor);
    expect(data).not.toBeNull();
    expect((data!.contact as { phone: string }).phone).toBe(phone);
    expect(data!.conversations).toHaveLength(1);
    expect(data!.messages).toHaveLength(2);
    expect(data!.exportedAt).toBeTypeOf('string');
    expect(Array.isArray(data!.auditReferences)).toBe(true);
  });

  it('export of unknown contact returns null', async () => {
    expect(await exportContactData(randomUUID(), actor)).toBeNull();
  });

  it('anonymize scrubs direct PII and preserves history', async () => {
    const result = await anonymizeContactData(contactId, actor);
    expect(result).not.toBeNull();
    expect(result!.fieldsScrubbed).toContain('phone');

    const [contact] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, contactId));
    expect(contact.phone).toContain('ANONYMIZED');
    expect(contact.email).toBeNull();

    // Histórico operacional intacto: conversa + 2 mensagens existem.
    const messages = await db.select().from(schema.messages).where(eq(schema.messages.conversationId, conversationId));
    expect(messages).toHaveLength(2);
    // Sender do titular anonimizado; outbound da equipe intacto.
    const inbound = messages.find((m) => m.direction === 'inbound');
    const outbound = messages.find((m) => m.direction === 'outbound');
    expect(inbound?.sender).toContain('ANONYMIZED');
    expect(outbound?.sender).toBe('Atendente');

    // Audit da operação registrado.
    const logs = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.entityId, contactId));
    expect(logs.some((l) => l.action === 'lgpd.anonymize')).toBe(true);
  });

  it('anonymize of unknown contact returns null', async () => {
    expect(await anonymizeContactData(randomUUID(), actor)).toBeNull();
  });
});
