import { LabelRepository } from '../../infrastructure/repositories/label.repository';
import { ok, err, NotFoundError, ConflictError } from '@cvg/shared';
import type { CreateLabelInput, UpdateLabelInput } from '../../types';

const repo = new LabelRepository();

export async function listLabels() {
  const labels = await repo.findAll();
  return ok(labels);
}

export async function getLabel(id: string) {
  const label = await repo.findById(id);
  if (!label) return err(new NotFoundError('Label'));
  return ok(label);
}

export async function createLabel(input: CreateLabelInput) {
  const existing = await repo.findByName(input.name);
  if (existing) return err(new ConflictError(`Label '${input.name}' já existe`));
  const label = await repo.create(input);
  return ok(label);
}

export async function updateLabel(id: string, input: UpdateLabelInput) {
  const label = await repo.findById(id);
  if (!label) return err(new NotFoundError('Label'));
  if (label.isSystem) return err(new ConflictError('Labels do sistema não podem ser editadas'));
  const updated = await repo.update(id, input);
  return ok(updated);
}

export async function deleteLabel(id: string) {
  const label = await repo.findById(id);
  if (!label) return err(new NotFoundError('Label'));
  if (label.isSystem) return err(new ConflictError('Labels do sistema não podem ser deletadas'));
  await repo.delete(id);
  return ok({ deleted: true });
}

export async function getConversationLabels(conversationId: string) {
  const result = await repo.getConversationLabels(conversationId);
  return ok(result.map(r => r.label));
}

export async function addConversationLabel(conversationId: string, labelId: string, userId?: string) {
  const label = await repo.findById(labelId);
  if (!label) return err(new NotFoundError('Label'));
  await repo.addConversationLabel(conversationId, labelId, userId);
  return ok({ added: true });
}

export async function removeConversationLabel(conversationId: string, labelId: string) {
  await repo.removeConversationLabel(conversationId, labelId);
  return ok({ removed: true });
}

export async function getContactLabels(contactId: string) {
  const result = await repo.getContactLabels(contactId);
  return ok(result.map(r => r.label));
}

export async function addContactLabel(contactId: string, labelId: string, userId?: string) {
  const label = await repo.findById(labelId);
  if (!label) return err(new NotFoundError('Label'));
  await repo.addContactLabel(contactId, labelId, userId);
  return ok({ added: true });
}

export async function removeContactLabel(contactId: string, labelId: string) {
  await repo.removeContactLabel(contactId, labelId);
  return ok({ removed: true });
}
