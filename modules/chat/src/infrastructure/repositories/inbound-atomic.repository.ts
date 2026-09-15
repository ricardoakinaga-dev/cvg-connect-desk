import { db, schema } from '@cvg/database';
import { sql } from 'drizzle-orm';
import {
  createConversationCreatedEvent,
  createMessagePersistedEvent,
  outboxIntentWriter,
  publishRealtimeHintsAfterCommit,
  type EventEnvelope,
} from '@cvg/events';
import { conversationRepository } from './conversation.repository';
import { messageRepository, type Message } from './message.repository';
import { resolveInboundContact } from './inbound-contact.repository';

export interface PersistInboundInput {
  externalMessageId: string;
  externalConversationId?: string;
  content: string;
  sender: string;
  senderType?: 'contact' | 'system' | 'unknown';
  sentAt?: Date;
  mediaUrl?: string;
  mediaType?: string;
  mediaMimetype?: string;
  mediaFilename?: string;
  metadata?: Record<string, unknown>;
  /** Contato do inbound: upsert idempotente DENTRO da transação (AAA-08). */
  contactPhone?: string;
  contactName?: string;
}

export interface PersistInboundResult {
  message: Message;
  conversation: typeof schema.conversations.$inferSelect;
  isNewConversation: boolean;
  isDuplicate: boolean;
  /** Envelopes commitados; hints só depois do commit (D-C03-2). */
  committedEvents: EventEnvelope[];
}

function buildConversationCreatedEvent(conversation: typeof schema.conversations.$inferSelect): EventEnvelope {
  return createConversationCreatedEvent({
    conversationId: conversation.id,
    contactId: conversation.contactId ?? undefined,
    externalConversationId: conversation.externalConversationId ?? undefined,
    externalChannelId: conversation.externalChannelId ?? undefined,
    interactionType: conversation.interactionType ?? undefined,
    createdAt: conversation.createdAt.toISOString(),
  });
}

function buildMessagePersistedEvent(message: Message): EventEnvelope {
  return createMessagePersistedEvent({
    messageId: message.id,
    conversationId: message.conversationId,
    direction: message.direction,
    content: message.content,
    sender: message.sender ?? undefined,
    recipient: message.recipient ?? undefined,
    status: message.status,
    createdAt: message.createdAt.toISOString(),
  });
}

/**
 * PROD-08/BE08 — a mensagem já foi persistida por uma transação concorrente.
 *
 * Lançar (em vez de `return`) é o que aborta a transação corrente: sem isso, a
 * conversa/status-history/intenção `conversation.created` criados NESTA
 * transação eram commitados como órfãos (o `return` de um callback de
 * `db.transaction` comita). O chamador reconhece o erro, faz o rollback e
 * devolve a mensagem/conversa já commitadas de forma idempotente.
 */
class DuplicateInboundRaceError extends Error {
  readonly externalMessageId: string;

  constructor(externalMessageId: string) {
    super(`PROD-08: mensagem ${externalMessageId} já persistida em transação concorrente (rollback da perdedora)`);
    this.name = 'DuplicateInboundRaceError';
    this.externalMessageId = externalMessageId;
    Object.setPrototypeOf(this, DuplicateInboundRaceError.prototype);
  }
}

/**
 * Chave de serialização por conversa externa. Dois primeiros inbounds
 * concorrentes do MESMO `externalConversationId` disputam o lock: o segundo
 * espera o commit do primeiro e encontra a conversa já criada, em vez de
 * colidir no índice único (23505) ou duplicar a conversa.
 */
function conversationLockKey(externalConversationId: string): string {
  return JSON.stringify(['c03-inbound-conversation', externalConversationId]);
}

/**
 * Releitura pós-rollback da duplicata: a mensagem vencedora já está
 * commitada (o INSERT concorrente só resolve depois do commit dela), então a
 * conversa retornada é a MESMA do vencedor. Nenhum efeito novo é gravado.
 */
async function resolveCommittedDuplicate(externalMessageId: string): Promise<PersistInboundResult> {
  const message = await messageRepository.findByExternalId(externalMessageId);
  if (!message) {
    throw new Error(`PROD-08: duplicata de ${externalMessageId} detectada, mas a mensagem vencedora não está visível pós-rollback`);
  }
  const conversation = await conversationRepository.findById(message.conversationId);
  if (!conversation) {
    throw new Error(`PROD-08: conversa ${message.conversationId} da mensagem vencedora não encontrada`);
  }
  return { message, conversation, isNewConversation: false, isDuplicate: true, committedEvents: [] };
}

/**
 * AAA-08 / C03 D-C03-1 — persistência atômica do inbound.
 *
 * Em UMA transação de banco:
 *   1. (com `externalConversationId`) serializa a resolução da conversa com
 *      advisory lock transacional;
 *   2. resolve (ou cria) a conversa + histórico de status;
 *   3. grava a intenção `conversation.created` no outbox (mesmo `tx`);
 *   4. insere a mensagem de forma idempotente;
 *   5. grava a intenção `message.persisted` no outbox (mesmo `tx`);
 *   6. atualiza o estado da conversa (unread/updatedAt).
 *
 * Qualquer falha entre as escritas provoca ROLLBACK total: não existe estado
 * intermediário "mensagem sem evento". Corrida perdida no mesmo
 * `externalMessageId` também sofre rollback COMPLETO (PROD-08/BE08) — a
 * transação perdedora não comita conversa, histórico, contato nem outbox
 * órfãos; a resposta idempotente vem da releitura do vencedor. Só depois de
 * `db.transaction` resolver (commit) os hints realtime são disparados,
 * best-effort (D-C03-2).
 */
export async function persistInboundAtomically(input: PersistInboundInput): Promise<PersistInboundResult> {
  let result: PersistInboundResult;
  try {
    result = await db.transaction(async (tx) => {
      const committedEvents: EventEnvelope[] = [];

      if (input.externalConversationId) {
        // Corrida do primeiro inbound da MESMA conversa externa: serializa
        // antes de qualquer escrita para o segundo transação ver a conversa
        // do primeiro (READ COMMITTED relê o snapshot a cada statement).
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${conversationLockKey(input.externalConversationId)}, 0))`);
      }

      const inboundContact = input.contactPhone
        ? await resolveInboundContact(input.contactPhone, input.contactName, tx)
        : null;

      let conversation = input.externalConversationId
        ? await conversationRepository.findByExternalId(input.externalConversationId, tx)
        : null;
      let isNewConversation = false;

      if (!conversation) {
        conversation = await conversationRepository.create(
          {
            contactId: inboundContact?.id,
            externalConversationId: input.externalConversationId,
            externalChannelId: 'whatsapp',
            status: 'open',
            isActive: true,
          },
          tx,
        );
        isNewConversation = true;
        await conversationRepository.addStatusHistory(
          conversation.id,
          'open',
          undefined,
          'Created from inbound message',
          tx,
        );
        const createdEvent = buildConversationCreatedEvent(conversation);
        await outboxIntentWriter.persist(tx, createdEvent);
        committedEvents.push(createdEvent);
      } else if (!conversation.contactId && inboundContact) {
        conversation = (await conversationRepository.attachContact(conversation.id, inboundContact.id, tx)) ?? conversation;
      }

      const { message, isDuplicate } = await messageRepository.createIdempotent(
        {
          conversationId: conversation.id,
          direction: 'inbound',
          content: input.content,
          sender: input.sender,
          senderType: input.senderType,
          externalMessageId: input.externalMessageId,
          sentAt: input.sentAt || new Date(),
          status: 'pending',
          mediaUrl: input.mediaUrl,
          mediaType: input.mediaType,
          mediaMimetype: input.mediaMimetype,
          mediaFilename: input.mediaFilename,
          metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
        },
        tx,
      );

      if (isDuplicate) {
        // Lança para ABORTAR: conversa/histórico/contato/outbox desta
        // transação não podem sobreviver (BE08).
        throw new DuplicateInboundRaceError(input.externalMessageId);
      }

      const persistedEvent = buildMessagePersistedEvent(message);
      await outboxIntentWriter.persist(tx, persistedEvent);
      committedEvents.push(persistedEvent);

      conversation = (await conversationRepository.markInboundUnread(conversation.id, tx)) ?? conversation;

      return { message, conversation, isNewConversation, isDuplicate: false, committedEvents };
    });
  } catch (error) {
    if (!(error instanceof DuplicateInboundRaceError)) throw error;
    return resolveCommittedDuplicate(error.externalMessageId);
  }

  if (result.committedEvents.length > 0) {
    // Pós-commit (D-C03-2): best-effort; polling do outbox cobre hint perdido.
    void publishRealtimeHintsAfterCommit(result.committedEvents).catch(() => {});
  }

  return result;
}

/**
 * PROD-08/AC4 — critério EXATO de conversa órfã legada (dry-run, somente
 * leitura; nenhuma mensagem é apagada ou movida).
 *
 * Candidata = conversa SEM NENHUMA mensagem (`NOT EXISTS` em
 * `messages.conversation_id`). É o formato residual da corrida BE08: a
 * transação perdedora commitava a conversa (com histórico `open` e intenção
 * `conversation.created`) depois de a mensagem já ter sido persistida na
 * conversa da vencedora. Qualquer conversa com >= 1 mensagem NUNCA é
 * candidata; o outbox é log imutável e não é mutado.
 */
export interface OrphanConversationCandidate {
  id: string;
  externalConversationId: string | null;
  externalChannelId: string | null;
  status: string;
  statusV2: string;
  isActive: boolean;
  hasContact: boolean;
  hasCreatedIntent: boolean;
  hasStatusHistory: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OrphanConversationReport {
  criterion: 'conversation_without_messages';
  generatedAt: string;
  activeOnly: boolean;
  externalIdPrefix: string | null;
  limit: number;
  totalCandidates: number;
  truncated: boolean;
  candidates: OrphanConversationCandidate[];
}

export interface FindOrphanConversationsOptions {
  /** `true` (padrão da reconciliação): só conversas ativas são mutáveis. */
  activeOnly?: boolean;
  limit?: number;
  /**
   * Escopo operacional opcional por prefixo de `external_conversation_id`
   * (ex.: janela de IDs legados conhecidos). Ausente ⇒ varredura completa,
   * incluindo órfãos com `external_conversation_id` NULL (o formato clássico
   * da corrida BE08 sem id externo).
   */
  externalIdPrefix?: string;
}

function toIso(value: Date | string | null): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export async function findOrphanConversations(
  options: FindOrphanConversationsOptions = {},
): Promise<OrphanConversationReport> {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 500), 1), 5000);
  const activeOnly = options.activeOnly === true;
  const activeFilter = activeOnly ? sql`AND c.is_active = true` : sql``;
  const prefix = options.externalIdPrefix?.trim() ? options.externalIdPrefix.trim() : null;
  const escapedPrefix = prefix ? prefix.replace(/[\\%_]/g, '\\$&') : null;
  const prefixFilter = escapedPrefix
    ? sql`AND c.external_conversation_id LIKE ${`${escapedPrefix}%`} ESCAPE '\\'`
    : sql``;

  const result = await db.execute(sql`
    SELECT c.id,
           c.external_conversation_id,
           c.external_channel_id,
           c.status::text AS status,
           c.status_v2::text AS status_v2,
           c.is_active,
           (c.contact_id IS NOT NULL) AS has_contact,
           EXISTS (
             SELECT 1 FROM outbox_events o
              WHERE o.event_type = 'conversation.created'
                AND o.aggregate_id = c.id::text
           ) AS has_created_intent,
           EXISTS (
             SELECT 1 FROM conversation_status_history h
              WHERE h.conversation_id = c.id
           ) AS has_status_history,
           c.created_at,
           c.updated_at
      FROM conversations c
     WHERE NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id)
       ${activeFilter}
       ${prefixFilter}
     ORDER BY c.created_at ASC, c.id ASC
     LIMIT ${limit + 1}
  `);
  const rows = ((result as unknown as { rows: Array<Record<string, unknown>> }).rows ?? []);
  const truncated = rows.length > limit;
  const page = truncated ? rows.slice(0, limit) : rows;

  const countResult = await db.execute(sql`
    SELECT count(*)::int AS n
      FROM conversations c
     WHERE NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id)
       ${activeFilter}
       ${prefixFilter}
  `);
  const countRows = (countResult as unknown as { rows: Array<{ n: number }> }).rows ?? [];

  return {
    criterion: 'conversation_without_messages',
    generatedAt: new Date().toISOString(),
    activeOnly,
    externalIdPrefix: prefix,
    limit,
    totalCandidates: Number(countRows[0]?.n ?? 0),
    truncated,
    candidates: page.map((row) => ({
      id: String(row.id),
      externalConversationId: (row.external_conversation_id as string | null) ?? null,
      externalChannelId: (row.external_channel_id as string | null) ?? null,
      status: String(row.status),
      statusV2: String(row.status_v2),
      isActive: Boolean(row.is_active),
      hasContact: Boolean(row.has_contact),
      hasCreatedIntent: Boolean(row.has_created_intent),
      hasStatusHistory: Boolean(row.has_status_history),
      createdAt: toIso(row.created_at as Date | string | null),
      updatedAt: toIso(row.updated_at as Date | string | null),
    })),
  };
}

export interface ReconcileOrphanConversationsOptions extends FindOrphanConversationsOptions {
  /**
   * Mutação só ocorre com aprovação EXPLÍCITA (`true`). Ausente/false ⇒
   * dry-run: relatório sem nenhum UPDATE. Não existe caminho destrutivo:
   * a reconciliação ARQUIVA (is_active=false/status arquivado) e nunca apaga
   * mensagens.
   */
  approve?: boolean;
  actor?: string;
}

export interface ReconcileOrphanConversationsResult {
  applied: boolean;
  reason: 'approval_required' | 'no_candidates' | 'archived';
  report: OrphanConversationReport;
  archivedIds: string[];
}

export async function reconcileOrphanConversations(
  options: ReconcileOrphanConversationsOptions = {},
): Promise<ReconcileOrphanConversationsResult> {
  const report = await findOrphanConversations({ ...options, activeOnly: true });
  if (options.approve !== true) {
    return { applied: false, reason: 'approval_required', report, archivedIds: [] };
  }

  const ids = report.candidates.map((candidate) => candidate.id);
  if (ids.length === 0) {
    return { applied: true, reason: 'no_candidates', report, archivedIds: [] };
  }

  const archivedIds = await db.transaction(async (tx) => {
    // Revalida no MESMO UPDATE: só arquiva o que ainda está ativo e segue sem
    // mensagem. A condição `is_active = true` torna a rodada idempotente.
    const updated = await tx.execute(sql`
      UPDATE conversations c
         SET is_active = false,
             status = 'archived',
             status_v2 = 'arquivado',
             closed_at = NOW(),
             updated_at = NOW()
       WHERE c.id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
         AND c.is_active = true
         AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id)
      RETURNING c.id
    `);
    const rows = ((updated as unknown as { rows: Array<{ id: string }> }).rows ?? []);
    const changed = rows.map((row) => row.id);
    for (const id of changed) {
      await conversationRepository.addStatusHistory(
        id,
        'archived',
        options.actor,
        'PROD-08 orphan reconciliation (approved)',
        tx,
      );
    }
    return changed;
  });

  return { applied: true, reason: archivedIds.length > 0 ? 'archived' : 'no_candidates', report, archivedIds };
}
