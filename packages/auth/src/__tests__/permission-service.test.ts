import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * PROD-04/AC3 — a fonte efetiva é o banco. Aqui o `@cvg/database` é mockado
 * para provar que:
 * - a resolução usa UMA query de acesso com os joins esperados e devolve
 *   papéis/permissões únicos, sem inventar permissão quando não há linhas;
 * - o flag de provisionamento (`role_permissions` com linhas) é consultado
 *   uma vez e cacheado por ≤5s (a segunda resolução não repete a checagem);
 * - instalação provisionada com conjunto vazio continua autoritativa
 *   (F1: revogar tudo não reativa o catálogo estático).
 */
const dbState = vi.hoisted(() => ({
  rows: [] as Array<{ roleName: string | null; permissionName: string | null }>,
  provisionRows: [] as Array<{ roleId: string }>,
  selectCalls: 0,
}));

vi.mock('@cvg/database', () => {
  const schema = {
    userRoles: { userId: 'user_roles.user_id', roleId: 'user_roles.role_id' },
    roles: { id: 'roles.id', name: 'roles.name' },
    rolePermissions: { roleId: 'role_permissions.role_id', permissionId: 'role_permissions.permission_id' },
    permissions: { id: 'permissions.id', name: 'permissions.name' },
  };
  const accessQuery = {
    innerJoin: () => accessQuery,
    leftJoin: () => accessQuery,
    where: () => Promise.resolve(dbState.rows),
  };
  const provisionQuery = {
    limit: () => Promise.resolve(dbState.provisionRows),
  };
  return {
    db: {
      select: () => {
        dbState.selectCalls += 1;
        return {
          from: (table: unknown) => (table === schema.rolePermissions ? provisionQuery : accessQuery),
        };
      },
    },
    schema,
  };
});

import {
  collapseAccessRows,
  isRolePermissionsProvisioned,
  resetPermissionProvisionCacheForTests,
  resolveEffectivePermissions,
  resolveUserAccess,
} from '../permission-service';

describe('permission-service — resolução no banco (D01/PROD-04-AC3)', () => {
  beforeEach(() => {
    dbState.rows = [];
    dbState.provisionRows = [{ roleId: 'perm-1' }];
    dbState.selectCalls = 0;
    resetPermissionProvisionCacheForTests();
  });

  it('colapsa linhas do join em conjuntos únicos e ignora nulos', () => {
    expect(collapseAccessRows([
      { roleName: 'Receptionist', permissionName: 'chat:read' },
      { roleName: 'Receptionist', permissionName: 'chat:read' },
      { roleName: 'Manager', permissionName: null },
      { roleName: null, permissionName: null },
    ])).toEqual({ roles: ['Receptionist', 'Manager'], permissions: ['chat:read'] });
  });

  it('resolve papéis + permissões em uma query de acesso e marca a instalação provisionada', async () => {
    dbState.rows = [
      { roleName: 'Receptionist', permissionName: 'chat:read' },
      { roleName: 'Receptionist', permissionName: 'chat:write' },
    ];
    const access = await resolveUserAccess('u1');
    expect(access).toEqual({
      roles: ['Receptionist'],
      permissions: ['chat:read', 'chat:write'],
      permissionsAuthoritative: true,
    });
    // 1 query de acesso + 1 checagem de provisionamento (role_permissions).
    expect(dbState.selectCalls).toBe(2);
  });

  it('cacheia o flag de provisionamento por ≤5s e não repete a checagem', async () => {
    dbState.rows = [{ roleName: 'Custom', permissionName: null }];
    const first = await resolveUserAccess('u1');
    expect(first.permissionsAuthoritative).toBe(true);
    expect(dbState.selectCalls).toBe(2);

    const second = await resolveUserAccess('u2');
    expect(second.permissionsAuthoritative).toBe(true);
    expect(dbState.selectCalls).toBe(3); // apenas a query de acesso do u2

    expect(await isRolePermissionsProvisioned()).toBe(true);
    expect(dbState.selectCalls).toBe(3);
  });

  it('instalação sem role_permissions resolve como não autoritativa (fallback legado)', async () => {
    dbState.provisionRows = [];
    const access = await resolveUserAccess('u1');
    expect(access.permissionsAuthoritative).toBe(false);
    expect(await isRolePermissionsProvisioned()).toBe(false);
  });

  it('resolveEffectivePermissions devolve Set com as permissões do banco', async () => {
    dbState.rows = [
      { roleName: 'Custom', permissionName: 'chat:read' },
      { roleName: 'Custom', permissionName: 'chat:write' },
    ];
    const permissions = await resolveEffectivePermissions('u1');
    expect(permissions).toBeInstanceOf(Set);
    expect([...permissions]).toEqual(['chat:read', 'chat:write']);
  });

  it('papel sem nenhuma permissão no banco devolve conjunto vazio', async () => {
    dbState.rows = [{ roleName: 'Custom', permissionName: null }];
    expect(await resolveEffectivePermissions('u1')).toEqual(new Set());
  });
});
