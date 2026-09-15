import { db } from '@cvg/database';
import { TransferRepository } from '../../infrastructure/repositories/transfer.repository';
import { insertOperationalAudit } from '../../infrastructure/audit';
import { ok, err, NotFoundError, BadRequestError, ConflictError, type Result } from '@cvg/shared';
import { persistOutboxEventIntent, publishRealtimeHintsAfterCommit, createEvent, type EventEnvelope } from '@cvg/events';

const repo = new TransferRepository();

type TransferRow = Awaited<ReturnType<TransferRepository['create']>>;

export interface CreateTransferInput {
  contactId: string;
  conversationId?: string;
  toSectorId: string;
  fromSectorId?: string;
  fromUserId?: string;
  toUserId?: string;
  reason?: string;
  autoAccept?: boolean;
  correlationId?: string;
}

export interface TransferActionInput {
  transferId: string;
  actorId?: string;
  correlationId?: string;
}

export interface TransferResult extends TransferRow {
  deduplicated?: boolean;
}

function transferEvent(
  eventType: 'transfer.created' | 'transfer.accepted' | 'transfer.rejected',
  transfer: TransferRow,
  correlationId?: string,
): EventEnvelope {
  return createEvent(
    eventType,
    'ContactTransfer',
    transfer.id,
    {
      transferId: transfer.id,
      contactId: transfer.contactId,
      conversationId: transfer.conversationId,
      fromSectorId: transfer.fromSectorId,
      toSectorId: transfer.toSectorId,
      fromUserId: transfer.fromUserId,
      toUserId: transfer.toUserId,
      status: transfer.status,
    },
    { correlationId },
  );
}

async function auditTransition(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  action: string,
  transfer: TransferRow,
  actorId: string | undefined,
  correlationId: string | undefined,
  oldValue?: Record<string, unknown>,
): Promise<void> {
  await insertOperationalAudit(tx, {
    userId: actorId,
    action,
    entityType: 'contact_transfer',
    entityId: transfer.id,
    oldValue,
    newValue: {
      status: transfer.status,
      contactId: transfer.contactId,
      conversationId: transfer.conversationId,
      fromSectorId: transfer.fromSectorId,
      toSectorId: transfer.toSectorId,
    },
    metadata: { actorId },
    correlationId,
  });
}

/**
 * PROD-18/AC1/AC3: a transferência é atômica (linha + vínculo de contato +
 * setor da conversa + auditoria + outbox no MESMO `tx`), serializada por
 * contato (advisory lock) e idempotente para pedidos repetidos idênticos.
 */
export async function createTransfer(input: CreateTransferInput): Promise<Result<TransferResult, Error>> {
  try {
    const contact = await repo.findContact(input.contactId);
    if (!contact) {
      return err(new NotFoundError('Contato não encontrado'));
    }

    const targetSector = await repo.findSector(input.toSectorId);
    if (!targetSector || !targetSector.isActive) {
      return err(new BadRequestError('Setor de destino inválido ou inativo', 'INVALID_TARGET_SECTOR'));
    }

    const conversation = input.conversationId
      ? await repo.findConversation(input.conversationId)
      : null;
    if (input.conversationId && !conversation) {
      return err(new NotFoundError('Conversa não encontrada'));
    }
    if (conversation?.contactId && conversation.contactId !== input.contactId) {
      return err(new BadRequestError('Conversa não pertence a este contato', 'CONVERSATION_CONTACT_MISMATCH'));
    }

    if (input.toUserId) {
      const recipient = await repo.findActiveUser(input.toUserId);
      if (!recipient || !recipient.isActive) {
        return err(new BadRequestError('Responsável de destino inválido ou inativo', 'INVALID_TRANSFER_RECIPIENT'));
      }
    }

    const autoAccept = input.autoAccept === true;

    const outcome = await db.transaction(async (tx) => {
      await repo.lockContact(input.contactId, tx);

      // Releitura DENTRO do lock: duas transferências simultâneas do mesmo
      // contato convergem — a segunda enxerga o setor já movido pela primeira
      // e responde 409 de origem defasada em vez de deixar setores contraditórios.
      const freshConversation = input.conversationId
        ? await repo.findConversation(input.conversationId, tx)
        : null;
      const currentSectorId = freshConversation?.sectorId ?? null;
      if (input.fromSectorId && currentSectorId && input.fromSectorId !== currentSectorId) {
        throw new ConflictError(
          'Setor de origem diverge do setor atual da conversa',
          'TRANSFER_SECTOR_MISMATCH',
        );
      }
      const fromSectorId = input.fromSectorId ?? currentSectorId ?? undefined;

      if (!autoAccept) {
        const pending = await repo.findPendingDuplicate(
          input.contactId,
          input.conversationId ?? null,
          input.toSectorId,
          tx,
        );
        if (pending) {
          return { transfer: pending, deduplicated: true, event: null as EventEnvelope | null };
        }
      } else if (freshConversation && freshConversation.sectorId === input.toSectorId) {
        const existing = await repo.findLatestAccepted(input.contactId, input.toSectorId, tx);
        if (existing) {
          return { transfer: existing, deduplicated: true, event: null as EventEnvelope | null };
        }
      }

      const transfer = await repo.create({
        contactId: input.contactId,
        conversationId: input.conversationId,
        fromSectorId,
        toSectorId: input.toSectorId,
        fromUserId: input.fromUserId,
        toUserId: input.toUserId,
        reason: input.reason,
        status: autoAccept ? 'accepted' : 'pending',
        resolvedAt: autoAccept ? new Date() : undefined,
      }, tx);

      if (autoAccept && freshConversation && fromSectorId) {
        await repo.updateConversationSector(freshConversation.id, input.toSectorId, tx);
        await repo.updateContactSector(input.contactId, fromSectorId, input.toSectorId, tx);
      }

      await auditTransition(
        tx,
        autoAccept ? 'contact_transfer.accepted' : 'contact_transfer.created',
        transfer,
        input.fromUserId,
        input.correlationId,
        { status: 'pending' },
      );

      const event = transferEvent(autoAccept ? 'transfer.accepted' : 'transfer.created', transfer, input.correlationId);
      await persistOutboxEventIntent(tx, event);
      return { transfer, deduplicated: false, event };
    });

    if (outcome.event) {
      await publishRealtimeHintsAfterCommit([outcome.event]);
    }

    return ok({ ...outcome.transfer, deduplicated: outcome.deduplicated });
  } catch (error) {
    return err(error as Error);
  }
}

export async function listTransfers(limit?: number, offset?: number) {
  const transfers = await repo.findAll({ limit, offset });
  return ok(transfers);
}

export async function getTransfer(id: string) {
  const transfer = await repo.findById(id);
  if (!transfer) return err(new NotFoundError('Transferência'));
  return ok(transfer);
}

export async function getContactTransfers(contactId: string) {
  const transfers = await repo.findByContact(contactId);
  return ok(transfers);
}

/**
 * PROD-18/AC3: aceite é CAS (`pending` → `accepted`); repetir o aceite é
 * idempotente e um estado oposto responde 409. O movimento de setor acontece
 * na MESMA transação do aceite.
 */
export async function acceptTransfer(input: TransferActionInput): Promise<Result<TransferResult, Error>> {
  try {
    const existing = await repo.findById(input.transferId);
    if (!existing) return err(new NotFoundError('Transferência'));

    if (existing.status === 'accepted') {
      return ok({ ...existing, deduplicated: true });
    }
    if (existing.status === 'rejected') {
      return err(new ConflictError('Transferência já rejeitada', 'TRANSFER_STATE_CONFLICT'));
    }

    const events: EventEnvelope[] = [];
    const accepted = await db.transaction(async (tx) => {
      await repo.lockContact(existing.contactId, tx);

      const transitioned = await repo.transition(input.transferId, 'accepted', tx);
      if (!transitioned) {
        throw new ConflictError(
          'Transferência alterada por outro operador; releia o estado antes de repetir',
          'TRANSFER_STATE_CONFLICT',
        );
      }

      const conversation = transitioned.conversationId
        ? await repo.findConversation(transitioned.conversationId, tx)
        : null;
      const fromSectorId = transitioned.fromSectorId ?? conversation?.sectorId ?? null;
      if (transitioned.conversationId && fromSectorId && conversation?.sectorId !== transitioned.toSectorId) {
        await repo.updateConversationSector(transitioned.conversationId, transitioned.toSectorId, tx);
        await repo.updateContactSector(transitioned.contactId, fromSectorId, transitioned.toSectorId, tx);
      }

      await auditTransition(tx, 'contact_transfer.accepted', transitioned, input.actorId, input.correlationId, { status: 'pending' });

      const event = transferEvent('transfer.accepted', transitioned, input.correlationId);
      await persistOutboxEventIntent(tx, event);
      events.push(event);

      return transitioned;
    });

    await publishRealtimeHintsAfterCommit(events);

    return ok({ ...accepted, deduplicated: false });
  } catch (error) {
    if (error instanceof ConflictError) {
      return err(error);
    }
    return err(error as Error);
  }
}

/** PROD-18/AC3: rejeição é CAS (`pending` → `rejected`), idempotente e sem mover setores. */
export async function rejectTransfer(input: TransferActionInput): Promise<Result<TransferResult, Error>> {
  try {
    const existing = await repo.findById(input.transferId);
    if (!existing) return err(new NotFoundError('Transferência'));

    if (existing.status === 'rejected') {
      return ok({ ...existing, deduplicated: true });
    }
    if (existing.status === 'accepted') {
      return err(new ConflictError('Transferência já aceita', 'TRANSFER_STATE_CONFLICT'));
    }

    const events: EventEnvelope[] = [];
    const rejected = await db.transaction(async (tx) => {
      await repo.lockContact(existing.contactId, tx);

      const transitioned = await repo.transition(input.transferId, 'rejected', tx);
      if (!transitioned) {
        throw new ConflictError(
          'Transferência alterada por outro operador; releia o estado antes de repetir',
          'TRANSFER_STATE_CONFLICT',
        );
      }

      await auditTransition(tx, 'contact_transfer.rejected', transitioned, input.actorId, input.correlationId, { status: 'pending' });

      const event = transferEvent('transfer.rejected', transitioned, input.correlationId);
      await persistOutboxEventIntent(tx, event);
      events.push(event);

      return transitioned;
    });

    await publishRealtimeHintsAfterCommit(events);

    return ok({ ...rejected, deduplicated: false });
  } catch (error) {
    if (error instanceof ConflictError) {
      return err(error);
    }
    return err(error as Error);
  }
}
