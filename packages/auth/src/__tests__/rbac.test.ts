import { describe, expect, it } from 'vitest';
import { RolePermissions, hasPermission, type Role } from '../rbac';

describe('RBAC permissions', () => {
  it('grants admin all declared permissions', () => {
    const permissions = RolePermissions.Admin;

    expect(permissions).toContain('chat:read');
    expect(permissions).toContain('chat:delete');
    expect(permissions).toContain('admin:write');
    expect(permissions).toContain('dashboard:read');
  });

  it.each([
    ['Receptionist', 'chat:write', true],
    ['Receptionist', 'admin:write', false],
    ['Veterinarian', 'alerts:write', true],
    ['Manager', 'notes:write', false],
  ] as const)('checks %s permission %s', (role, permission, expected) => {
    expect(hasPermission(role, permission)).toBe(expected);
  });

  it('denies unknown roles defensively', () => {
    expect(hasPermission('Unknown' as Role, 'admin:write')).toBe(false);
  });
});
