import { db, schema } from '@cvg/database';
import { and, eq, inArray, or } from 'drizzle-orm';

/**
 * AAA-17 / C07 — carregamento do grafo de cópias de um titular.
 *
 * Um único ponto resolve contato, conversas (e o escopo autorizado), mensagens,
 * notas, outbox, DLQ, mídia, auditoria e vínculos tutor/paciente. Inventário,
 * exportação por escopo e operação de pseudonimização compartilham esta
 * resolução para não divergirem no que consideram "cópia".
 */

export interface InventoryScope {
  all?: boolean;
  sectorIds?: string[];
}

export function normalizeScope(scope?: InventoryScope): Required<InventoryScope> {
  return {
    all: Boolean(scope?.all),
    sectorIds: [...new Set(scope?.sectorIds ?? [])],
  };
}

/** Igualdade de escopo (ordem de setores não importa) para idempotência. */
export function sameScope(a: Required<InventoryScope>, b: Required<InventoryScope>): boolean {
  if (a.all !== b.all) return false;
  const left = [...a.sectorIds].sort();
  const right = [...b.sectorIds].sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Interseção de escopos: o direito de operar é a interseção entre o escopo
 * registrado na operação e o escopo ATUAL do ator. Nunca expande alcance em
 * uma retomada (ex.: operação "all" retomada por ator setorial vira o escopo
 * setorial; operação setorial retomada por global permanece setorial).
 */
export function intersectScopes(
  stored: Required<InventoryScope>,
  current: Required<InventoryScope>,
): Required<InventoryScope> {
  if (stored.all && current.all) return { all: true, sectorIds: [] };
  if (stored.all) return { all: false, sectorIds: [...current.sectorIds] };
  if (current.all) return { all: false, sectorIds: [...stored.sectorIds] };
  const currentSet = new Set(current.sectorIds);
  return { all: false, sectorIds: stored.sectorIds.filter((id) => currentSet.has(id)) };
}

export function conversationInScope(
  conversation: { sectorId?: string | null },
  scope: Required<InventoryScope>,
): boolean {
  if (scope.all) return true;
  return Boolean(conversation.sectorId && scope.sectorIds.includes(conversation.sectorId));
}

export interface ContactGraph {
  contact: typeof schema.contacts.$inferSelect;
  linkedTutorIds: string[];
  linkedPatientIds: string[];
  allConversations: Array<typeof schema.conversations.$inferSelect>;
  inScopeConversations: Array<typeof schema.conversations.$inferSelect>;
  inScopeConversationIds: string[];
  outOfScopeConversationIds: string[];
  allMessages: Array<typeof schema.messages.$inferSelect>;
  inScopeMessages: Array<typeof schema.messages.$inferSelect>;
  inScopeMessageIds: string[];
  outOfScopeMessageIds: string[];
  allNotes: Array<typeof schema.internalNotes.$inferSelect>;
  inScopeNotes: Array<typeof schema.internalNotes.$inferSelect>;
  inScopeNoteIds: string[];
  outOfScopeNoteIds: string[];
  allOutbox: Array<typeof schema.outboxEvents.$inferSelect>;
  inScopeOutbox: Array<typeof schema.outboxEvents.$inferSelect>;
  outOfScopeOutboxIds: string[];
  allDlq: Array<typeof schema.deadLetterEvents.$inferSelect>;
  inScopeDlq: Array<typeof schema.deadLetterEvents.$inferSelect>;
  allMedia: Array<typeof schema.mediaAssets.$inferSelect>;
  inScopeMedia: Array<typeof schema.mediaAssets.$inferSelect>;
  allAudit: Array<typeof schema.auditLogs.$inferSelect>;
  inScopeAudit: Array<typeof schema.auditLogs.$inferSelect>;
  contactInScope: boolean;
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

export async function loadContactGraph(
  contactId: string,
  scopeInput?: InventoryScope,
): Promise<ContactGraph | null> {
  const scope = normalizeScope(scopeInput);
  const [contact] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, contactId));
  if (!contact) return null;

  const linkedTutorIds = unique([contact.tutorId]);
  const linkedPatientIds = unique([contact.patientId]);
  if (linkedTutorIds.length > 0) {
    const tutorPatients = await db
      .select({ id: schema.patients.id })
      .from(schema.patients)
      .where(inArray(schema.patients.tutorId, linkedTutorIds));
    linkedPatientIds.push(...unique(tutorPatients.map((row) => row.id)));
  }

  const allConversations = await db
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.contactId, contactId));
  const inScopeConversations = allConversations.filter((conversation) => conversationInScope(conversation, scope));
  const inScopeConversationIds = inScopeConversations.map((conversation) => conversation.id);
  const outOfScopeConversationIds = allConversations
    .filter((conversation) => !inScopeConversations.includes(conversation))
    .map((conversation) => conversation.id);

  const allMessages = allConversations.length > 0
    ? await db.select().from(schema.messages).where(inArray(schema.messages.conversationId, allConversations.map((c) => c.id)))
    : [];
  const inScopeMessages = allMessages.filter((message) => inScopeConversationIds.includes(message.conversationId));
  const inScopeMessageIds = inScopeMessages.map((message) => message.id);
  const outOfScopeMessageIds = allMessages
    .filter((message) => !inScopeConversationIds.includes(message.conversationId))
    .map((message) => message.id);

  const noteConditions = [];
  if (allConversations.length > 0) {
    noteConditions.push(inArray(schema.internalNotes.conversationId, allConversations.map((c) => c.id)));
  }
  if (linkedTutorIds.length > 0) {
    noteConditions.push(and(eq(schema.internalNotes.referenceType, 'tutor'), inArray(schema.internalNotes.referenceId, linkedTutorIds)));
  }
  if (linkedPatientIds.length > 0) {
    noteConditions.push(and(eq(schema.internalNotes.referenceType, 'patient'), inArray(schema.internalNotes.referenceId, linkedPatientIds)));
  }
  const allNotes = noteConditions.length > 0
    ? await db.select().from(schema.internalNotes).where(noteConditions.length === 1 ? noteConditions[0] : or(...noteConditions))
    : [];
  const noteIsInScope = (note: typeof schema.internalNotes.$inferSelect) =>
    Boolean(note.conversationId && inScopeConversationIds.includes(note.conversationId))
    || (note.referenceType === 'tutor' && Boolean(note.referenceId && linkedTutorIds.includes(note.referenceId)))
    || (note.referenceType === 'patient' && Boolean(note.referenceId && linkedPatientIds.includes(note.referenceId)));
  const inScopeNotes = allNotes.filter(noteIsInScope);
  const inScopeNoteIds = inScopeNotes.map((note) => note.id);
  const outOfScopeNoteIds = allNotes.filter((note) => !noteIsInScope(note)).map((note) => note.id);

  const entityIdsForOutbox = unique([contactId, ...allConversations.map((c) => c.id), ...allMessages.map((m) => m.id)]);
  const allOutbox = entityIdsForOutbox.length > 0
    ? await db.select().from(schema.outboxEvents).where(inArray(schema.outboxEvents.aggregateId, entityIdsForOutbox))
    : [];
  const outboxInScope = (event: typeof schema.outboxEvents.$inferSelect) =>
    event.aggregateId === contactId
      ? true
      : inScopeConversationIds.includes(event.aggregateId) || inScopeMessageIds.includes(event.aggregateId);
  const inScopeOutbox = allOutbox.filter(outboxInScope);
  const outOfScopeOutboxIds = allOutbox.filter((event) => !outboxInScope(event)).map((event) => event.id);

  const outboxEventIds = allOutbox.map((event) => event.eventId);
  const allDlq = outboxEventIds.length > 0
    ? await db.select().from(schema.deadLetterEvents).where(inArray(schema.deadLetterEvents.originalEventId, outboxEventIds))
    : [];
  const inScopeOutboxEventIds = new Set(inScopeOutbox.map((event) => event.eventId));
  const inScopeDlq = allDlq.filter((event) => inScopeOutboxEventIds.has(event.originalEventId));

  const allMedia = inScopeMessageIds.length + outOfScopeMessageIds.length > 0
    ? await db.select().from(schema.mediaAssets).where(inArray(schema.mediaAssets.messageId, [...inScopeMessageIds, ...outOfScopeMessageIds]))
    : [];
  const inScopeMedia = allMedia.filter((asset) => Boolean(asset.messageId && inScopeMessageIds.includes(asset.messageId)));

  const auditEntityIds = unique([contactId, ...allConversations.map((c) => c.id), ...allMessages.map((m) => m.id), ...allNotes.map((n) => n.id)]);
  const allAudit = auditEntityIds.length > 0
    ? await db.select().from(schema.auditLogs).where(inArray(schema.auditLogs.entityId, auditEntityIds))
    : [];
  const inScopeEntityIds = new Set(unique([contactId, ...inScopeConversationIds, ...inScopeMessageIds, ...inScopeNoteIds]));
  const inScopeAudit = allAudit.filter((row) => Boolean(row.entityId && inScopeEntityIds.has(row.entityId)));

  const contactInScope = scope.all || inScopeConversations.length > 0;

  return {
    contact,
    linkedTutorIds,
    linkedPatientIds,
    allConversations,
    inScopeConversations,
    inScopeConversationIds,
    outOfScopeConversationIds,
    allMessages,
    inScopeMessages,
    inScopeMessageIds,
    outOfScopeMessageIds,
    allNotes,
    inScopeNotes,
    inScopeNoteIds,
    outOfScopeNoteIds,
    allOutbox,
    inScopeOutbox,
    outOfScopeOutboxIds,
    allDlq,
    inScopeDlq,
    allMedia,
    inScopeMedia,
    allAudit,
    inScopeAudit,
    contactInScope,
  };
}
