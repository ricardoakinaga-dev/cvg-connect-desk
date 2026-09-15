import { db, schema } from '@cvg/database';
import { eq } from 'drizzle-orm';
import { createAuditLog } from '@cvg/audit';
import { randomUUID } from 'node:crypto';
import { loadPrivacyPolicy } from './privacy-policy';
import { getPrivacyMediaStorage } from './media-copy-port';
import { loadContactGraph, normalizeScope, type InventoryScope } from './contact-graph';

/**
 * AAA-17 / C07 — exportação por escopo autorizado.
 *
 * Diferente do export integral (admin), esta rota devolve apenas as cópias
 * cujas conversas pertencem aos setores do ator. Cópias fora do escopo são
 * omitidas e contadas — nunca devolvidas. Quando o titular só tem cópias fora
 * do escopo, a resposta é `out_of_scope` (a rota responde 404, sem revelar
 * existência). A auditoria é minimizada: ator, resultado, correlação, escopo
 * e contagens — sem PII.
 */

export interface ScopedExportActor {
  userId: string;
  reason: string;
  requestId?: string;
}

export interface ScopedExportMediaArtifact {
  id: string;
  messageId: string | null;
  filename: string | null;
  storageStatus: string;
  scanStatus: string;
  retentionUntil: string | null;
  /** Presença do objeto no storage via media-copy-port; null = porta ausente/não gerencia. */
  objectPresent: boolean | null;
}

export interface ScopedExportPackage {
  exportedAt: string;
  scope: { mode: 'all' | 'sectors'; sectorIds: string[]; authorized: true };
  contact: unknown;
  conversations: unknown[];
  messages: unknown[];
  notes: unknown[];
  mediaAssets: ScopedExportMediaArtifact[];
  labels: unknown[];
  groups: unknown[];
  sectors: unknown[];
  transfers: unknown[];
  linked: { tutorIds: string[]; patientIds: string[] };
  auditReferences: Array<{ action: string; entityType: string; entityId: string | null; createdAt: Date }>;
  copies: Record<string, number>;
  omitted: Record<string, number>;
  partial: boolean;
  policy: { version: string; mode: string };
}

export type ScopedExportResult =
  | { ok: true; data: ScopedExportPackage }
  | { ok: false; reason: 'not_found' | 'out_of_scope' };

export async function exportContactDataScoped(input: {
  contactId: string;
  actor: ScopedExportActor;
  scope?: InventoryScope;
}): Promise<ScopedExportResult> {
  const policy = loadPrivacyPolicy();
  const scope = normalizeScope(input.scope);
  const graph = await loadContactGraph(input.contactId, input.scope);
  if (!graph) return { ok: false, reason: 'not_found' };
  if (!scope.all && !graph.contactInScope) return { ok: false, reason: 'out_of_scope' };

  const inScopeMessageIds = graph.inScopeMessageIds;
  const inScopeNoteIds = graph.inScopeNoteIds;
  const inScopeOutboxIds = graph.inScopeOutbox.map((event) => event.id);
  const inScopeDlqIds = graph.inScopeDlq.map((event) => event.id);
  const inScopeMediaIds = graph.inScopeMedia.map((asset) => asset.id);
  const inScopeAuditIds = graph.inScopeAudit.map((row) => row.id);

  const labels = await db
    .select({ id: schema.labels.id, name: schema.labels.name })
    .from(schema.contactLabels)
    .innerJoin(schema.labels, eq(schema.labels.id, schema.contactLabels.labelId))
    .where(eq(schema.contactLabels.contactId, graph.contact.id));

  const groups = await db
    .select({ id: schema.contactGroups.id, name: schema.contactGroups.name })
    .from(schema.contactGroupMembers)
    .innerJoin(schema.contactGroups, eq(schema.contactGroups.id, schema.contactGroupMembers.groupId))
    .where(eq(schema.contactGroupMembers.contactId, graph.contact.id));

  const sectors = await db
    .select({ id: schema.sectors.id, name: schema.sectors.name, status: schema.contactSectors.status })
    .from(schema.contactSectors)
    .innerJoin(schema.sectors, eq(schema.sectors.id, schema.contactSectors.sectorId))
    .where(eq(schema.contactSectors.contactId, graph.contact.id));

  const transfers = await db
    .select()
    .from(schema.contactTransfers)
    .where(eq(schema.contactTransfers.contactId, graph.contact.id));

  // Artefatos de mídia no escopo: metadados sempre; presença de bytes apenas
  // através da media-copy-port (nunca lê/expõe conteúdo).
  const mediaPort = getPrivacyMediaStorage();
  const mediaAssets: ScopedExportMediaArtifact[] = await Promise.all(
    graph.inScopeMedia.map(async (asset) => {
      let objectPresent: boolean | null = null;
      if (mediaPort && asset.storageKey) {
        try {
          objectPresent = await mediaPort.exists(asset.storageKey);
        } catch {
          objectPresent = null;
        }
      }
      return {
        id: asset.id,
        messageId: asset.messageId ?? null,
        filename: asset.filename ?? null,
        storageStatus: asset.storageStatus,
        scanStatus: asset.scanStatus,
        retentionUntil: asset.retentionUntil ? asset.retentionUntil.toISOString() : null,
        objectPresent,
      };
    }),
  );

  const auditReferences = graph.inScopeAudit.map((row) => ({
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId as string | null,
    createdAt: row.createdAt,
  }));

  const copies = {
    conversations: graph.inScopeConversations.length,
    messages: inScopeMessageIds.length,
    notes: inScopeNoteIds.length,
    outbox: inScopeOutboxIds.length,
    dlq: inScopeDlqIds.length,
    mediaAssets: inScopeMediaIds.length,
    auditRows: inScopeAuditIds.length,
  };
  const omitted = {
    conversations: graph.outOfScopeConversationIds.length,
    messages: graph.outOfScopeMessageIds.length,
    notes: graph.outOfScopeNoteIds.length,
    outbox: graph.allOutbox.length - graph.inScopeOutbox.length,
    dlq: graph.allDlq.length - graph.inScopeDlq.length,
    mediaAssets: graph.allMedia.length - graph.inScopeMedia.length,
    auditRows: graph.allAudit.length - graph.inScopeAudit.length,
  };
  const partial = Object.values(omitted).some((count) => count > 0);

  const data: ScopedExportPackage = {
    exportedAt: new Date().toISOString(),
    scope: { mode: scope.all ? 'all' : 'sectors', sectorIds: scope.sectorIds, authorized: true },
    contact: graph.contact,
    conversations: graph.inScopeConversations,
    messages: graph.inScopeMessages,
    notes: graph.inScopeNotes,
    mediaAssets,
    labels,
    groups,
    sectors,
    transfers,
    linked: { tutorIds: graph.linkedTutorIds, patientIds: graph.linkedPatientIds },
    auditReferences,
    copies,
    omitted,
    partial,
    policy: { version: policy.version, mode: policy.mode },
  };

  await createAuditLog({
    userId: input.actor.userId,
    action: 'lgpd.export',
    entityType: 'contact',
    entityId: graph.contact.id,
    metadata: {
      requestId: input.actor.requestId?.trim() || randomUUID(),
      reason: input.actor.reason,
      scope: { mode: scope.all ? 'all' : 'sectors', sectorIds: scope.sectorIds },
      counts: copies,
      omitted,
      partial,
      result: 'exported-scoped',
    },
  });

  return { ok: true, data };
}
