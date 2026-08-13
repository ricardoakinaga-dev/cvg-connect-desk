import { TransferRepository } from '../../infrastructure/repositories/transfer.repository';
import { ok, err, NotFoundError, BadRequestError } from '@cvg/shared';

const repo = new TransferRepository();

export interface CreateTransferInput {
  contactId: string;
  conversationId?: string;
  toSectorId: string;
  fromSectorId?: string;
  fromUserId?: string;
  toUserId?: string;
  reason?: string;
  autoAccept?: boolean;
}

export async function createTransfer(input: CreateTransferInput) {
  // Se autoAccept, transferir imediatamente
  if (input.autoAccept) {
    const transfer = await repo.create({ ...input, status: 'accepted' });

    if (input.conversationId && input.fromSectorId) {
      await repo.updateConversationSector(input.conversationId, input.toSectorId);
      await repo.updateContactSector(input.contactId, input.fromSectorId, input.toSectorId);
    }

    return ok(transfer);
  }

  const transfer = await repo.create(input);
  return ok(transfer);
}

export async function listTransfers(limit?: number) {
  const transfers = await repo.findAll(limit);
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

export async function acceptTransfer(id: string, _userId?: string) {
  const transfer = await repo.findById(id);
  if (!transfer) return err(new NotFoundError('Transferência'));
  if (transfer.status !== 'pending') return err(new BadRequestError('Transferência já processada'));

  const accepted = await repo.accept(id);

  // Executar a transferência de fato
  if (transfer.conversationId && transfer.fromSectorId) {
    await repo.updateConversationSector(transfer.conversationId, transfer.toSectorId);
    await repo.updateContactSector(transfer.contactId, transfer.fromSectorId, transfer.toSectorId);
  }

  return ok(accepted);
}

export async function rejectTransfer(id: string) {
  const transfer = await repo.findById(id);
  if (!transfer) return err(new NotFoundError('Transferência'));
  if (transfer.status !== 'pending') return err(new BadRequestError('Transferência já processada'));

  const rejected = await repo.reject(id);
  return ok(rejected);
}
