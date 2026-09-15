// PROD-08 — snapshot FUNCIONAL do arquivo imediatamente antes do delta
// (estado AAA-08 herdado do candidato 754f9bad; o arquivo é não rastreado, sem
// baseline no git). Restaurar este conteúdo desfaz o delta PROD-08 e reintroduz
// o defeito BE08 — usar apenas como rollback de emergência.
import { db, schema, type DatabaseExecutor } from '@cvg/database';
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
 * AAA-08 / C03 D-C03-1 — persistência atômica do inbound.
 *
 * Em UMA transação de banco:
 *   1. resolve (ou cria) a conversa + histórico de status;
 *   2. grava a intenção `conversation.created` no outbox (mesmo `tx`);
 *   3. insere a mensagem de forma idempotente;
 *   4. grava a intenção `message.persisted` no outbox (mesmo `tx`);
 *   5. atualiza o estado da conversa (unread/updatedAt).
 *
 * Qualquer falha entre as escritas provoca ROLLBACK total: não existe estado
 * intermediário "mensagem sem evento". Só depois de `db.transaction` resolver
 * (commit) os hints realtime são disparados, best-effort (D-C03-2).
 */
export async function persistInboundAtomically(input: PersistInboundInput): Promise<PersistInboundResult> {
  const result = await db.transaction(async (tx) => {
    const committedEvents: EventEnvelope[] = [];

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
      return { message, conversation, isNewConversation: false, isDuplicate: true, committedEvents: [] };
    }

    const persistedEvent = buildMessagePersistedEvent(message);
    await outboxIntentWriter.persist(tx, persistedEvent);
    committedEvents.push(persistedEvent);

    conversation = (await conversationRepository.markInboundUnread(conversation.id, tx)) ?? conversation;

    return { message, conversation, isNewConversation, isDuplicate: false, committedEvents };
  });

  if (result.committedEvents.length > 0) {
    // Pós-commit (D-C03-2): best-effort; polling do outbox cobre hint perdido.
    void publishRealtimeHintsAfterCommit(result.committedEvents).catch(() => {});
  }

  return result;
}
