import { loadPrivacyPolicy, policyFor, type PrivacyCopyType, type PrivacyCopyPolicy } from './privacy-policy';
import { loadContactGraph, normalizeScope, type InventoryScope } from './contact-graph';

/**
 * AAA-17 / C07 — inventário de cópias do titular.
 *
 * Cobre contato, vínculo tutor/paciente, conversa, mensagem, nota, outbox,
 * DLQ, asset de mídia, auditoria e backup. O inventário NUNCA devolve PII:
 * apenas ids, chaves de storage e contagens. Cópias fora do escopo
 * autorizado aparecem somente como contagem (`outOfScopeCount`).
 */

export interface InventoryItem {
  copy: PrivacyCopyType;
  id?: string;
  refs: Record<string, string | boolean | null>;
}

export interface InventorySection {
  copy: PrivacyCopyType;
  purpose: string;
  retention: string;
  exportable: boolean;
  pseudonymizable: boolean;
  deletable: boolean;
  backup: boolean;
  pendingDecision: 'D02' | null;
  observed: boolean;
  count: number;
  inScopeCount: number;
  outOfScopeCount: number;
  items: InventoryItem[];
}

export interface ContactInventory {
  contactId: string;
  generatedAt: string;
  scope: { mode: 'all' | 'sectors'; sectorIds: string[] };
  /** O titular tem ao menos uma cópia no escopo autorizado do ator. */
  contactInScope: boolean;
  sections: InventorySection[];
  totals: { copies: number; inScope: number; outOfScope: number };
  policy: { version: string; mode: string; irreversibleDeleteAllowed: boolean };
}

function section(
  policy: PrivacyCopyPolicy,
  counts: { count: number; inScopeCount: number; outOfScopeCount: number; items: InventoryItem[] },
): InventorySection {
  return {
    copy: policy.copy,
    purpose: policy.purpose,
    retention: policy.retention,
    exportable: policy.exportable,
    pseudonymizable: policy.pseudonymizable,
    deletable: policy.deletable,
    backup: policy.backup,
    pendingDecision: policy.pendingDecision,
    observed: true,
    ...counts,
  };
}

export async function buildContactInventory(input: {
  contactId: string;
  scope?: InventoryScope;
}): Promise<ContactInventory | null> {
  const policy = loadPrivacyPolicy();
  const scope = normalizeScope(input.scope);
  const graph = await loadContactGraph(input.contactId, input.scope);
  if (!graph) return null;

  const contactSection = section(policyFor('contact'), {
    count: 1,
    inScopeCount: graph.contactInScope ? 1 : 0,
    outOfScopeCount: graph.contactInScope ? 0 : 1,
    items: [{
      copy: 'contact',
      id: graph.contact.id,
      refs: {
        hasPhone: Boolean(graph.contact.phone),
        hasName: Boolean(graph.contact.name),
        hasEmail: Boolean(graph.contact.email),
        hasExternalId: Boolean(graph.contact.externalId),
        hasMetadata: Boolean(graph.contact.metadata),
      },
    }],
  });

  const tutorItems: InventoryItem[] = [
    ...graph.linkedTutorIds.map((id) => ({ copy: 'tutor-link' as const, id, refs: { kind: 'tutor' } })),
    ...graph.linkedPatientIds.map((id) => ({ copy: 'tutor-link' as const, id, refs: { kind: 'patient' } })),
  ];
  const tutorSection = section(policyFor('tutor-link'), {
    count: tutorItems.length,
    inScopeCount: graph.contactInScope ? tutorItems.length : 0,
    outOfScopeCount: graph.contactInScope ? 0 : tutorItems.length,
    items: graph.contactInScope ? tutorItems : [],
  });

  const conversationSection = section(policyFor('conversation'), {
    count: graph.allConversations.length,
    inScopeCount: graph.inScopeConversations.length,
    outOfScopeCount: graph.outOfScopeConversationIds.length,
    items: graph.inScopeConversations.map((conversation) => ({
      copy: 'conversation' as const,
      id: conversation.id,
      refs: { sectorId: conversation.sectorId ?? null, status: conversation.status, hasMetadata: Boolean(conversation.metadata) },
    })),
  });

  const messageSection = section(policyFor('message'), {
    count: graph.allMessages.length,
    inScopeCount: graph.inScopeMessages.length,
    outOfScopeCount: graph.outOfScopeMessageIds.length,
    items: graph.inScopeMessages.map((message) => ({
      copy: 'message' as const,
      id: message.id,
      refs: { conversationId: message.conversationId, direction: message.direction, hasMedia: Boolean(message.mediaUrl) },
    })),
  });

  const noteSection = section(policyFor('note'), {
    count: graph.allNotes.length,
    inScopeCount: graph.inScopeNotes.length,
    outOfScopeCount: graph.outOfScopeNoteIds.length,
    items: graph.inScopeNotes.map((note) => ({
      copy: 'note' as const,
      id: note.id,
      refs: { conversationId: note.conversationId ?? null, referenceType: note.referenceType ?? null, referenceId: note.referenceId ?? null },
    })),
  });

  const outboxSection = section(policyFor('outbox'), {
    count: graph.allOutbox.length,
    inScopeCount: graph.inScopeOutbox.length,
    outOfScopeCount: graph.outOfScopeOutboxIds.length,
    items: graph.inScopeOutbox.map((event) => ({
      copy: 'outbox' as const,
      id: event.id,
      refs: { eventId: event.eventId, eventType: event.eventType, processed: Boolean(event.processedAt) },
    })),
  });

  const dlqSection = section(policyFor('dlq'), {
    count: graph.allDlq.length,
    inScopeCount: graph.inScopeDlq.length,
    outOfScopeCount: graph.allDlq.length - graph.inScopeDlq.length,
    items: graph.inScopeDlq.map((event) => ({
      copy: 'dlq' as const,
      id: event.id,
      refs: { originalEventId: event.originalEventId, consumerId: event.consumerId, eventType: event.eventType, status: event.status },
    })),
  });

  const mediaSection = section(policyFor('media-asset'), {
    count: graph.allMedia.length,
    inScopeCount: graph.inScopeMedia.length,
    outOfScopeCount: graph.allMedia.length - graph.inScopeMedia.length,
    items: graph.inScopeMedia.map((asset) => ({
      copy: 'media-asset' as const,
      id: asset.id,
      refs: {
        messageId: asset.messageId ?? null,
        storageKey: asset.storageKey ?? null,
        storageStatus: asset.storageStatus,
        scanStatus: asset.scanStatus,
        retentionUntil: asset.retentionUntil ? asset.retentionUntil.toISOString() : null,
        hasFilename: Boolean(asset.filename),
      },
    })),
  });

  const auditSection = section(policyFor('audit'), {
    count: graph.allAudit.length,
    inScopeCount: graph.inScopeAudit.length,
    outOfScopeCount: graph.allAudit.length - graph.inScopeAudit.length,
    items: graph.inScopeAudit.map((row) => ({
      copy: 'audit' as const,
      id: row.id,
      refs: { action: row.action, entityType: row.entityType, entityId: row.entityId ?? null },
    })),
  });

  const backupPolicy = policyFor('backup');
  const backupSection: InventorySection = {
    ...section(backupPolicy, { count: 0, inScopeCount: 0, outOfScopeCount: 0, items: [] }),
    // Backups pertencem ao provedor de infraestrutura e não são enumeráveis
    // pelo app: o inventário declara a existência e a retenção, não a lista.
    observed: false,
  };

  const sections = [
    contactSection,
    tutorSection,
    conversationSection,
    messageSection,
    noteSection,
    outboxSection,
    dlqSection,
    mediaSection,
    auditSection,
    backupSection,
  ];

  const totals = sections.reduce(
    (acc, current) => ({
      copies: acc.copies + current.count,
      inScope: acc.inScope + current.inScopeCount,
      outOfScope: acc.outOfScope + current.outOfScopeCount,
    }),
    { copies: 0, inScope: 0, outOfScope: 0 },
  );

  return {
    contactId: graph.contact.id,
    generatedAt: new Date().toISOString(),
    scope: { mode: scope.all ? 'all' : 'sectors', sectorIds: scope.sectorIds },
    contactInScope: graph.contactInScope,
    sections,
    totals,
    policy: { version: policy.version, mode: policy.mode, irreversibleDeleteAllowed: policy.irreversibleDeleteAllowed },
  };
}
