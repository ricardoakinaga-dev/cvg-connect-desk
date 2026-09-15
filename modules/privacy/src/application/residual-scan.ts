import { db, schema } from '@cvg/database';
import { inArray } from 'drizzle-orm';
import { loadContactGraph } from './contact-graph';
import { identifierList, textContainsAny, type DirectIdentifiers } from './redaction';

/**
 * AAA-17 / C07 — teste de reidentificação residual.
 *
 * Varre as cópias no banco procurando os identificadores diretos do titular.
 * O resultado vazio é a evidência de que a pseudonimização cobriu o escopo
 * prometido; resíduos fora do banco (backups e bytes de mídia) são declarados
 * pela própria operação, nunca omitidos.
 */

export interface ResidualHit {
  copy: string;
  id: string;
  field: string;
}

function hit(copy: string, id: string, field: string, value: unknown, identifiers: string[]): ResidualHit | null {
  if (typeof value === 'string' && textContainsAny(value, identifiers)) return { copy, id, field };
  return null;
}

export async function scanResidualIdentifiers(
  contactId: string,
  identifiers: Partial<DirectIdentifiers>,
): Promise<ResidualHit[]> {
  return scanResidualIdentifierList(contactId, identifierList(identifiers));
}

/**
 * Variante para quem já tem a lista de identificadores capturada ANTES da
 * operação (ex.: relatório de eliminação) — a varredura usa exatamente os
 * identificadores originais, sem reler o contato já pseudonimizado.
 */
export async function scanResidualIdentifierList(
  contactId: string,
  list: string[],
): Promise<ResidualHit[]> {
  if (list.length === 0) return [];
  const graph = await loadContactGraph(contactId, { all: true });
  if (!graph) return [];

  const hits: Array<ResidualHit | null> = [];

  hits.push(hit('contact', graph.contact.id, 'phone', graph.contact.phone, list));
  hits.push(hit('contact', graph.contact.id, 'name', graph.contact.name, list));
  hits.push(hit('contact', graph.contact.id, 'email', graph.contact.email, list));
  hits.push(hit('contact', graph.contact.id, 'externalId', graph.contact.externalId, list));
  hits.push(hit('contact', graph.contact.id, 'metadata', graph.contact.metadata, list));

  for (const conversation of graph.allConversations) {
    hits.push(hit('conversation', conversation.id, 'metadata', conversation.metadata, list));
    hits.push(hit('conversation', conversation.id, 'externalConversationId', conversation.externalConversationId, list));
    hits.push(hit('conversation', conversation.id, 'externalChannelId', conversation.externalChannelId, list));
  }

  for (const message of graph.allMessages) {
    hits.push(hit('message', message.id, 'content', message.content, list));
    hits.push(hit('message', message.id, 'sender', message.sender, list));
    hits.push(hit('message', message.id, 'recipient', message.recipient, list));
    hits.push(hit('message', message.id, 'metadata', message.metadata, list));
    hits.push(hit('message', message.id, 'mediaFilename', message.mediaFilename, list));
    hits.push(hit('message', message.id, 'externalMessageId', message.externalMessageId, list));
  }

  for (const note of graph.allNotes) {
    hits.push(hit('note', note.id, 'content', note.content, list));
    hits.push(hit('note', note.id, 'metadata', note.metadata, list));
  }

  for (const event of graph.allOutbox) {
    hits.push(hit('outbox', event.id, 'payload', event.payload, list));
    hits.push(hit('outbox', event.id, 'metadata', event.metadata, list));
  }

  for (const event of graph.allDlq) {
    hits.push(hit('dlq', event.id, 'payload', JSON.stringify(event.payload), list));
    hits.push(hit('dlq', event.id, 'errorMessage', event.errorMessage, list));
  }

  for (const asset of graph.allMedia) {
    hits.push(hit('media-asset', asset.id, 'filename', asset.filename, list));
    hits.push(hit('media-asset', asset.id, 'storageKey', asset.storageKey, list));
  }

  for (const row of graph.allAudit) {
    hits.push(hit('audit', row.id, 'oldValue', row.oldValue, list));
    hits.push(hit('audit', row.id, 'newValue', row.newValue, list));
    hits.push(hit('audit', row.id, 'metadata', row.metadata, list));
  }

  // Vínculos tutor/paciente: registros de OUTROS titulares que podem conter os
  // identificadores do titular em análise (cópia residual declarada).
  if (graph.linkedTutorIds.length > 0) {
    const tutorRows = await db.select().from(schema.tutors).where(inArray(schema.tutors.id, graph.linkedTutorIds));
    for (const row of tutorRows) {
      hits.push(hit('tutor-link', row.id, 'name', row.name, list));
      hits.push(hit('tutor-link', row.id, 'phone', row.phone, list));
      hits.push(hit('tutor-link', row.id, 'email', row.email, list));
      hits.push(hit('tutor-link', row.id, 'externalId', row.externalId, list));
    }
  }
  if (graph.linkedPatientIds.length > 0) {
    const patientRows = await db.select().from(schema.patients).where(inArray(schema.patients.id, graph.linkedPatientIds));
    for (const row of patientRows) {
      hits.push(hit('tutor-link', row.id, 'name', row.name, list));
      hits.push(hit('tutor-link', row.id, 'externalId', row.externalId, list));
    }
  }

  return hits.filter((entry): entry is ResidualHit => entry !== null);
}
