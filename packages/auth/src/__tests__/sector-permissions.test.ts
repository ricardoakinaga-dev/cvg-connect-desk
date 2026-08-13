import { beforeEach, describe, expect, it, vi } from 'vitest';

const select = vi.fn();
const deleteFrom = vi.fn();
const insert = vi.fn();
const eq = vi.fn((left: unknown, right: unknown) => ({ op: 'eq', left, right }));
const and = vi.fn((...conditions: unknown[]) => ({ op: 'and', conditions }));

vi.mock('drizzle-orm', () => ({
  eq,
  and,
}));

vi.mock('@cvg/database', () => ({
  db: {
    select,
    delete: deleteFrom,
    insert,
  },
  userSectors: {
    userId: 'user_sectors.user_id',
    sectorId: 'user_sectors.sector_id',
    accessLevel: 'user_sectors.access_level',
  },
  sectors: {
    id: 'sectors.id',
    name: 'sectors.name',
    code: 'sectors.code',
    icon: 'sectors.icon',
    color: 'sectors.color',
  },
  userRoles: {
    userId: 'user_roles.user_id',
    roleId: 'user_roles.role_id',
  },
  roles: {
    id: 'roles.id',
    name: 'roles.name',
  },
}));

const { sectorPermissionService } = await import('../sector-permissions');

function mockSelectRows(rows: unknown[]) {
  const where = vi.fn().mockResolvedValue(rows);
  const innerJoin = vi.fn(() => ({ where }));
  const from = vi.fn(() => ({ where, innerJoin }));
  select.mockReturnValue({ from });
  return { from, innerJoin, where };
}

function mockDeleteChain() {
  const where = vi.fn().mockResolvedValue(undefined);
  deleteFrom.mockReturnValue({ where });
  return { where };
}

function mockInsertChain() {
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn(() => ({ onConflictDoUpdate }));
  insert.mockReturnValue({ values });
  return { values, onConflictDoUpdate };
}

describe('sectorPermissionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists sector ids for a user', async () => {
    mockSelectRows([{ sectorId: 'sector-1' }, { sectorId: 'sector-2' }]);

    await expect(sectorPermissionService.getUserSectorIds('user-1')).resolves.toEqual(['sector-1', 'sector-2']);
  });

  it('lists sectors with access levels', async () => {
    const rows = [{ sectorId: 'sector-1', sectorName: 'Clinical', accessLevel: 'admin' }];
    mockSelectRows(rows);

    await expect(sectorPermissionService.getUserSectors('user-1')).resolves.toEqual(rows);
  });

  it('checks access by required level', async () => {
    mockSelectRows([{ accessLevel: 'write' }]);
    await expect(sectorPermissionService.hasAccess('user-1', 'sector-1')).resolves.toBe(true);

    mockSelectRows([{ accessLevel: 'write' }]);
    await expect(sectorPermissionService.hasAccess('user-1', 'sector-1', 'read')).resolves.toBe(true);

    mockSelectRows([{ accessLevel: 'read' }]);
    await expect(sectorPermissionService.hasAccess('user-1', 'sector-1', 'admin')).resolves.toBe(false);

    mockSelectRows([]);
    await expect(sectorPermissionService.hasAccess('user-1', 'sector-1')).resolves.toBe(false);
  });

  it('detects global admins by role name', async () => {
    mockSelectRows([{ roleName: 'Agent' }, { roleName: 'Admin' }]);
    await expect(sectorPermissionService.isGlobalAdmin('user-1')).resolves.toBe(true);

    mockSelectRows([{ roleName: 'Agent' }]);
    await expect(sectorPermissionService.isGlobalAdmin('user-2')).resolves.toBe(false);
  });

  it('replaces user sector permissions', async () => {
    const deleteChain = mockDeleteChain();
    const insertChain = mockInsertChain();

    await sectorPermissionService.setUserSectors('user-1', [
      { sectorId: 'sector-1', accessLevel: 'read' },
      { sectorId: 'sector-2', accessLevel: 'admin' },
    ]);

    expect(deleteChain.where).toHaveBeenCalledOnce();
    expect(insertChain.values).toHaveBeenCalledWith([
      { userId: 'user-1', sectorId: 'sector-1', accessLevel: 'read' },
      { userId: 'user-1', sectorId: 'sector-2', accessLevel: 'admin' },
    ]);
  });

  it('skips insert when replacing with an empty permission set', async () => {
    mockDeleteChain();
    mockInsertChain();

    await sectorPermissionService.setUserSectors('user-1', []);

    expect(insert).not.toHaveBeenCalled();
  });

  it('upserts and removes individual sector permissions', async () => {
    const insertChain = mockInsertChain();

    await sectorPermissionService.addSectorPermission('user-1', 'sector-1', 'write');

    expect(insertChain.values).toHaveBeenCalledWith({
      userId: 'user-1',
      sectorId: 'sector-1',
      accessLevel: 'write',
    });
    expect(insertChain.onConflictDoUpdate).toHaveBeenCalledWith({
      target: ['user_sectors.user_id', 'user_sectors.sector_id'],
      set: { accessLevel: 'write', updatedAt: expect.any(Date) },
    });

    const deleteChain = mockDeleteChain();
    await sectorPermissionService.removeSectorPermission('user-1', 'sector-1');

    expect(deleteChain.where).toHaveBeenCalledOnce();
  });
});
