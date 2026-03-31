import { ContactRepository } from '../../infrastructure/repositories/contact.repository';
import { conversationRepository } from '@cvg/chat';
import { ok, err, NotFoundError, ConflictError } from '@cvg/shared';
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

export async function startConversation(contactId: string, sectorId?: string, userId?: string) {
  const contact = await repo.findById(contactId);
  if (!contact) return err(new NotFoundError('Contato'));

  // Verificar se já existe conversa ativa
  const existingConv = await repo.getActiveConversation(contactId);
  if (existingConv) return ok({ conversationId: existingConv.id, isNew: false });

  // Criar nova conversa
  const conversation = await conversationRepository.create({
    contactId,
    status: 'open',
    statusV2: 'novo',
    isActive: true,
    sectorId,
    assignedUserId: userId,
    externalChannelId: 'whatsapp',
    externalConversationId: `desk_${contact.phone}_${Date.now()}`,
  });

  await conversationRepository.addStatusHistory(conversation.id, 'open', userId, 'Conversa iniciada pelo Desk');

  return ok({ conversationId: conversation.id, isNew: true });
}

export async function getContactStats() {
  return ok(await repo.getStats());
}
