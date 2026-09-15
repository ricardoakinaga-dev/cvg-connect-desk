import { ContactRepository } from '../../infrastructure/repositories/contact.repository';
import { conversationRepository } from '@cvg/chat';
import { db } from '@cvg/database';
import { ok, err, NotFoundError, ConflictError } from '@cvg/shared';
import { insertAuditLog } from '@cvg/audit';
import {
  persistOutboxEventIntent,
  publishRealtimeHintsAfterCommit,
  createConversationCreatedEvent,
  type EventEnvelope,
} from '@cvg/events';
import type { CreateContactInput, UpdateContactInput } from '../../types';

const repo = new ContactRepository();

export async function listContacts(search?: string) {
  const contacts = await repo.findAll(search);
  return ok(contacts);
}

export async function getContact(id: string) {
  const contact = await repo.getWithDetails(id);
  if (!contact) return err(new NotFoundError('Contato'));
  return ok(contact);
}

export async function createContact(input: CreateContactInput) {
  // Verificar se já existe
  const existing = await repo.findByPhone(input.phone);
  if (existing) return err(new ConflictError('Telefone já cadastrado'));

  const contact = await repo.create(input);
  return ok(contact);
}

export async function updateContact(id: string, input: UpdateContactInput) {
  const contact = await repo.findById(id);
  if (!contact) return err(new NotFoundError('Contato'));

  const updated = await repo.update(id, input);
  return ok(updated);
}

export async function deleteContact(id: string) {
  const contact = await repo.findById(id);
  if (!contact) return err(new NotFoundError('Contato'));
  await repo.delete(id);
  return ok({ deleted: true });
}

export interface StartConversationContext {
  actorId?: string;
  correlationId?: string;
}

/**
 * SA-007/A07 (C01): conversa + histórico + auditoria + outbox em UM commit.
 *
 * O `SELECT ... FOR UPDATE` no contato serializa requisições concorrentes: a
 * segunda enxerga a conversa ativa criada pela primeira e devolve o MESMO id
 * canônico (`isNew:false`, `deduplicated:true`), sem órfãos. Falha tardia
 * (audit/outbox/histórico) reverte tudo, inclusive a conversa.
 */
export async function startConversation(
  contactId: string,
  sectorId?: string,
  userId?: string,
  context: StartConversationContext = {},
) {
  try {
    const outcome = await db.transaction(async (tx) => {
      const contact = await repo.lockById(contactId, tx);
      if (!contact) throw new NotFoundError('Contato');

      const existingConv = await conversationRepository.findActiveByContactId(contactId, tx);
      if (existingConv) {
        return { conversationId: existingConv.id, isNew: false, deduplicated: true, event: null as EventEnvelope | null };
      }

      const conversation = await conversationRepository.create({
        contactId,
        status: 'open',
        statusV2: 'novo',
        isActive: true,
        sectorId,
        assignedUserId: userId,
        externalChannelId: 'whatsapp',
        externalConversationId: `desk_${contact.phone}_${Date.now()}`,
      }, tx);

      await conversationRepository.addStatusHistory(
        conversation.id,
        'open',
        userId,
        'Conversa iniciada pelo Desk',
        tx,
      );

      await insertAuditLog(tx, {
        userId: context.actorId ?? userId ?? null,
        action: 'contact.conversation_started',
        entityType: 'conversation',
        entityId: conversation.id,
        newValue: { contactId, sectorId: sectorId ?? null, assignedUserId: userId ?? null },
        correlationId: context.correlationId ?? null,
      });

      const event = createConversationCreatedEvent(
        {
          conversationId: conversation.id,
          contactId,
          externalConversationId: conversation.externalConversationId ?? undefined,
          externalChannelId: conversation.externalChannelId ?? undefined,
          createdAt: conversation.createdAt.toISOString(),
        },
        context.correlationId,
      );
      await persistOutboxEventIntent(tx, event);

      return { conversationId: conversation.id, isNew: true, deduplicated: false, event };
    });

    if (outcome.event) {
      await publishRealtimeHintsAfterCommit([outcome.event]);
    }

    return ok({ conversationId: outcome.conversationId, isNew: outcome.isNew, deduplicated: outcome.deduplicated });
  } catch (error) {
    if (error instanceof NotFoundError) return err(error);
    return err(error as Error);
  }
}

export async function getContactStats() {
  return ok(await repo.getStats());
}
