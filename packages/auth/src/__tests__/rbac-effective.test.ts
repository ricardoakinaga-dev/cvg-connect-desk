import { describe, expect, it } from 'vitest';
import { actorGrantsPermission, builtInRolesGrant, hasAuthoritativePermissions, isBuiltInRole } from '../rbac';

/**
 * PROD-04/AC3 — decisão de ação com fonte efetiva:
 * - `permissions` não vazio (banco provisionado) é autoritativo, inclusive
 *   para Admin (não há bypass implícito);
 * - sem permissões resolvidas, o catálogo estático cobre apenas built-ins;
 * - papel customizado sem permissão no banco é negado.
 */
describe('rbac — permissão efetiva (D01/PROD-04-AC3)', () => {
  it('permissões do banco são autoritativas quando não vazias', () => {
    expect(actorGrantsPermission({ roles: ['Admin'], permissions: ['chat:read'] }, 'chat:read')).toBe(true);
    expect(actorGrantsPermission({ roles: ['Admin'], permissions: ['chat:read'] }, 'chat:write')).toBe(false);
  });

  it('papel customizado com permissão no banco é concedido', () => {
    expect(actorGrantsPermission({ roles: ['Custom'], permissions: ['notes:write'] }, 'notes:write')).toBe(true);
    expect(actorGrantsPermission({ roles: ['Custom'], permissions: ['notes:write'] }, 'notes:read')).toBe(false);
  });

  it('sem permissões resolvidas, fallback estático apenas para built-in', () => {
    expect(actorGrantsPermission({ roles: ['Receptionist'], permissions: [] }, 'chat:read')).toBe(true);
    expect(actorGrantsPermission({ roles: ['Receptionist'], permissions: [] }, 'admin:write')).toBe(false);
    expect(actorGrantsPermission({ roles: ['Custom'], permissions: [] }, 'chat:read')).toBe(false);
  });

  it('ator legado (permissions ausente) mantém o comportamento estático', () => {
    expect(actorGrantsPermission({ roles: ['Admin'] }, 'chat:delete')).toBe(true);
    expect(actorGrantsPermission({ roles: ['Manager'] }, 'admin:write')).toBe(false);
    expect(actorGrantsPermission({ roles: ['Ghost'] }, 'chat:read')).toBe(false);
    expect(actorGrantsPermission(undefined, 'chat:read')).toBe(false);
  });

  it('instalação provisionada com conjunto vazio é autoritativa: nega built-in e Admin', () => {
    // F1/AC3: revogar TODAS as permissões no banco não pode reativar o catálogo.
    expect(actorGrantsPermission(
      { roles: ['Receptionist'], permissions: [], permissionsAuthoritative: true },
      'chat:read',
    )).toBe(false);
    expect(actorGrantsPermission(
      { roles: ['Admin'], permissions: [], permissionsAuthoritative: true },
      'chat:delete',
    )).toBe(false);
    expect(actorGrantsPermission(
      { roles: ['Admin'], permissions: ['admin:write'], permissionsAuthoritative: true },
      'admin:write',
    )).toBe(true);
  });

  it('hasAuthoritativePermissions distingue provisionado de legado', () => {
    expect(hasAuthoritativePermissions({ permissions: [], permissionsAuthoritative: true })).toBe(true);
    expect(hasAuthoritativePermissions({ permissions: ['chat:read'] })).toBe(true);
    expect(hasAuthoritativePermissions({ permissions: [] })).toBe(false);
    expect(hasAuthoritativePermissions({ permissions: [], permissionsAuthoritative: false })).toBe(false);
    expect(hasAuthoritativePermissions(undefined)).toBe(false);
  });

  it('isBuiltInRole reconhece somente o catálogo e builtInRolesGrant nega desconhecidos', () => {
    expect(isBuiltInRole('Admin')).toBe(true);
    expect(isBuiltInRole('Manager')).toBe(true);
    expect(isBuiltInRole('Custom')).toBe(false);
    expect(builtInRolesGrant(['Custom', 'Ghost'], 'chat:read')).toBe(false);
    expect(builtInRolesGrant(['Veterinarian'], 'alerts:write')).toBe(true);
  });
});
