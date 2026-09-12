import { db, schema } from '@cvg/database';
import { and, eq, inArray } from 'drizzle-orm';
import { createAuditLog } from '@cvg/audit';
import { randomUUID } from 'node:crypto';

/**
 * DataSubjectService (Final-9, LGPD arts. 18–19).
 * - exportContactData: pacote legível de todos os dados do titular;
 * - anonymizeContactData: anonimização irreversível do PII direto, com
 *   preservação do histórico operacional (FKs intactas);
 * - toda operação gera audit log (actor, reason, requestId, scope, result).
 */

export interface DsarActor {
  userId: string;
  reason: string;
  requestId?: string;
}

export interface ContactDataExport {
  exportedAt: string;
  contact: unknown;
  conversations: unknown[];
  messages: unknown[];
  notes: unknown[];
  labels: unknown[];
  groups: unknown[];
  sectors: unknown[];
  transfers: unknown[];
  auditReferences: Array<{ action: string; entityType: string; entityId: string | null; createdAt: Date }>;
}

async function conversationsOf(contactId: string) {
  return db.select().from(schema.conversations).where(eq(schema.conversations.contactId, contactId));
}

export async function exportContactData(contactId: string, actor: DsarActor): Promise<ContactDataExport | null> {
  const [contact] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, contactId));
  if (!contact) return null;

  const conversations = await conversationsOf(contactId);
  const conversationIds = conversations.map((c) => c.id);

  const messages = conversationIds.length > 0
    ? await db.select().from(schema.messages).where(inArray(schema.messages.conversationId, conversationIds))
    : [];
  const notes = conversationIds.length > 0
    ? await db.select().from(schema.internalNotes).where(inArray(schema.internalNotes.conversationId, conversationIds))
    : [];

  const labels = await db
    .select({ id: schema.labels.id, name: schema.labels.name })
    .from(schema.contactLabels)
    .innerJoin(schema.labels, eq(schema.labels.id, schema.contactLabels.labelId))
    .where(eq(schema.contactLabels.contactId, contactId));

  const groups = await db
    .select({ id: schema.contactGroups.id, name: schema.contactGroups.name })
    .from(schema.contactGroupMembers)
    .innerJoin(schema.contactGroups, eq(schema.contactGroups.id, schema.contactGroupMembers.groupId))
    .where(eq(schema.contactGroupMembers.contactId, contactId));

  const sectors = await db
    .select({ id: schema.sectors.id, name: schema.sectors.name, status: schema.contactSectors.status })
    .from(schema.contactSectors)
    .innerJoin(schema.sectors, eq(schema.sectors.id, schema.contactSectors.sectorId))
    .where(eq(schema.contactSectors.contactId, contactId));

  const transfers = await db
    .select()
    .from(schema.contactTransfers)
    .where(eq(schema.contactTransfers.contactId, contactId));

  const entityIds = [contactId, ...conversationIds, ...messages.map((m) => m.id)];
  const auditReferences = entityIds.length > 0
    ? (
      await db
        .select({
          action: schema.auditLogs.action,
          entityType: schema.auditLogs.entityType,
          entityId: schema.auditLogs.entityId,
          createdAt: schema.auditLogs.createdAt,
        })
        .from(schema.auditLogs)
        .where(inArray(schema.auditLogs.entityId, entityIds))
    ).map((row) => ({ ...row, entityId: row.entityId as string | null }))
    : [];

  const result: ContactDataExport = {
    exportedAt: new Date().toISOString(),
    contact,
    conversations,
    messages,
    notes,
    labels,
    groups,
    sectors,
    transfers,
    auditReferences,
  };

  await createAuditLog({
    userId: actor.userId,
    action: 'lgpd.export',
    entityType: 'contact',
    entityId: contactId,
    metadata: {
      requestId: actor.requestId || randomUUID(),
      reason: actor.reason,
      scope: 'full-export',
      counts: {
        conversations: conversations.length,
        messages: messages.length,
        notes: notes.length,
      },
      result: 'exported',
    },
  });

  return result;
}

export interface AnonymizeResult {
  contactId: string;
  anonymizedAt: string;
  fieldsScrubbed: string[];
  messagesScrubbed: number;
}

/**
 * Anonimiza PII direto do contato. Preserva linhas e FKs (histórico
 * operacional continua íntegro; conteúdo operacional das mensagens é
 * mantido por obrigação operacional — ver retention policy).
 */
export async function anonymizeContactData(contactId: string, actor: DsarActor): Promise<AnonymizeResult | null> {
  const [contact] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, contactId));
  if (!contact) return null;

  const marker = `ANONYMIZED-${contactId.slice(0, 8)}`;
  const fieldsScrubbed = ['phone', 'name', 'email', 'externalId', 'metadata'];

  await db
    .update(schema.contacts)
    .set({
      phone: marker,
      name: 'Titular anonimizado',
      email: null,
      externalId: null,
      metadata: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.contacts.id, contactId));

  // Sender costuma espelhar o telefone: anonimiza apenas as mensagens
  // originadas do titular (sender == telefone antigo). Outbound da equipe
  // é histórico operacional e permanece intacto.
  const conversations = await conversationsOf(contactId);
  const conversationIds = conversations.map((c) => c.id);
  let messagesScrubbed = 0;
  if (contact.phone && conversationIds.length > 0) {
    const updated = await db
      .update(schema.messages)
      .set({ sender: marker })
      .where(and(inArray(schema.messages.conversationId, conversationIds), eq(schema.messages.sender, contact.phone)))
      .returning({ id: schema.messages.id });
    messagesScrubbed = updated.length;
  }

  const requestId = actor.requestId || randomUUID();
  await createAuditLog({
    userId: actor.userId,
    action: 'lgpd.anonymize',
    entityType: 'contact',
    entityId: contactId,
    oldValue: { phone: '[REDACTED]', email: '[REDACTED]' },
    newValue: { marker },
    metadata: { requestId, reason: actor.reason, scope: 'pii-direct', result: 'anonymized', messagesScrubbed },
  });

  return { contactId, anonymizedAt: new Date().toISOString(), fieldsScrubbed, messagesScrubbed };
}
