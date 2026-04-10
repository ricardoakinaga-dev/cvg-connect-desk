import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findAll: vi.fn(),
  findById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getMembers: vi.fn(),
  addMember: vi.fn(),
  removeMember: vi.fn(),
  getContactGroups: vi.fn(),
}));

vi.mock('../infrastructure/repositories/contact-group.repository', () => ({
  ContactGroupRepository: vi.fn().mockImplementation(() => mocks),
}));

import * as useCases from '../application/use-cases';

describe('contact groups use cases', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('passes the creator id when creating a group', async () => {
    mocks.create.mockResolvedValue({ id: 'group_1', name: 'Pacientes VIP' });

    const result = await useCases.createGroup({ name: 'Pacientes VIP', groupType: 'custom' }, 'user_1');

    expect(result.isOk()).toBe(true);
    expect(mocks.create).toHaveBeenCalledWith({ name: 'Pacientes VIP', groupType: 'custom' }, 'user_1');
  });

  it('blocks deleting system groups', async () => {
    mocks.findById.mockResolvedValue({ id: 'group_1', isSystem: true });

    const result = await useCases.deleteGroup('group_1');

    expect(result.isErr()).toBe(true);
  });

  it('returns not found when listing members of a missing group', async () => {
    mocks.findById.mockResolvedValue(null);

    const result = await useCases.getGroupMembers('group_404');

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
    }
  });

  it('maps contact groups back to group entities', async () => {
    mocks.getContactGroups.mockResolvedValue([{ group: { id: 'group_1', name: 'VIP' } }]);

    const result = await useCases.getContactGroups('contact_1');

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual([{ id: 'group_1', name: 'VIP' }]);
    }
  });
});
