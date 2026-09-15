import { ContactGroupRepository } from '../../infrastructure/repositories/contact-group.repository';
import { ok, err, NotFoundError, type Result } from '@cvg/shared';
import type { CreateGroupInput } from '../../types';

const repo = new ContactGroupRepository();

type ContactGroupRow = Awaited<ReturnType<ContactGroupRepository['create']>>;

export async function listGroups() {
  const groups = await repo.findAll();
  return ok(groups);
}

export async function getGroup(id: string) {
  const group = await repo.findById(id);
  if (!group) return err(new NotFoundError('Grupo'));
  return ok(group);
}

export async function createGroup(input: CreateGroupInput, userId?: string): Promise<Result<ContactGroupRow, Error>> {
  const group = await repo.create(input, userId);
  return ok(group);
}

export async function updateGroup(id: string, input: Partial<CreateGroupInput>) {
  const group = await repo.findById(id);
  if (!group) return err(new NotFoundError('Grupo'));
  const updated = await repo.update(id, input);
  return ok(updated);
}

export async function deleteGroup(id: string) {
  const group = await repo.findById(id);
  if (!group) return err(new NotFoundError('Grupo'));
  if (group.isSystem) return err(new Error('Grupos do sistema não podem ser deletados'));
  await repo.delete(id);
  return ok({ deleted: true });
}

export async function getGroupMembers(groupId: string) {
  const group = await repo.findById(groupId);
  if (!group) return err(new NotFoundError('Grupo'));
  const members = await repo.getMembers(groupId);
  return ok(members);
}

export async function addGroupMember(groupId: string, contactId: string, userId?: string) {
  const group = await repo.findById(groupId);
  if (!group) return err(new NotFoundError('Grupo'));
  await repo.addMember(groupId, contactId, userId);
  return ok({ added: true });
}

export async function removeGroupMember(groupId: string, contactId: string) {
  await repo.removeMember(groupId, contactId);
  return ok({ removed: true });
}

export async function getContactGroups(contactId: string) {
  const groups = await repo.getContactGroups(contactId);
  return ok(groups.map(g => g.group));
}
