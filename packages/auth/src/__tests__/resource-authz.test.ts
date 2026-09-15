import { describe, expect, it } from 'vitest';
import {
  authorizeAlertResource,
  authorizeContactResource,
  authorizeConversationResource,
  authorizeSectorScope,
  authorizeTaskResource,
} from '../resource-authz';

/**
 * PROD-04/AC3 — o helper só autoriza com ação+recurso efetivos:
 * - sem permissão da ação → 403 (antes de tocar membership/DB);
 * - Admin global (role) tem override explícito;
 * - ação fora do catálogo, sem alias, é negada (default-deny);
 * - aliases de recurso (kanban/contacts) mapeiam para o catálogo vigente.
 * Nenhum caso aqui usa banco: a permissão é decidida antes do escopo.
 */
describe('resource-authz — ação+recurso (D01/PROD-04)', () => {
  it('nega ator sem role com 403 de permissão', async () => {
    const decision = await authorizeConversationResource({
      actor: { id: 'u1', roles: [] },
      action: 'chat:read',
      conversation: { id: 'c1', sectorId: 's1' },
      requiredLevel: 'read',
    });
    expect(decision).toMatchObject({ allowed: false, statusCode: 403, error: 'FORBIDDEN' });
  });

  it('nega papel desconhecido (hasPermission false)', async () => {
    const decision = await authorizeConversationResource({
      actor: { id: 'u1', roles: ['Ghost'] },
      action: 'chat:read',
      conversation: { id: 'c1', sectorId: 's1' },
      requiredLevel: 'read',
    });
    expect(decision).toMatchObject({ allowed: false, statusCode: 403, error: 'FORBIDDEN' });
  });

  it('nega ação fora do catálogo sem alias (default-deny)', async () => {
    const decision = await authorizeConversationResource({
      actor: { id: 'u1', roles: ['Receptionist'] },
      action: 'unknown:read',
      conversation: { id: 'c1', sectorId: 's1' },
      requiredLevel: 'read',
    });
    expect(decision).toMatchObject({ allowed: false, statusCode: 403, error: 'FORBIDDEN' });
  });

  it('Admin global tem override explícito sem consultar banco', async () => {
    const decision = await authorizeConversationResource({
      actor: { id: 'u1', roles: ['Admin'] },
      action: 'chat:write',
      conversation: { id: 'c1', sectorId: 's1' },
      requiredLevel: 'write',
    });
    expect(decision).toEqual({ allowed: true });
  });

  it('401 prevalece para ator sem id em todos os helpers', async () => {
    const inputs = [
      authorizeConversationResource({ actor: null, action: 'chat:read', conversation: { id: 'c1' } }),
      authorizeContactResource({ actor: null, action: 'chat:read', contact: { id: 'c1' } }),
      authorizeTaskResource({ actor: null, action: 'tasks:read', task: { createdBy: 'u1' } }),
      authorizeAlertResource({ actor: null, action: 'alerts:read', alert: { triggeredBy: 'u1' } }),
      authorizeSectorScope({ actor: undefined, sectorId: 's1', action: 'chat:write' }),
    ];
    for (const decision of inputs) {
      expect(await decision).toMatchObject({ allowed: false, statusCode: 401, error: 'UNAUTHORIZED' });
    }
  });

  it('aliases de recurso mapeiam para o catálogo vigente', async () => {
    const contactWithoutSectors = { id: 'c1', sectorIds: [] };
    const notGlobalAdmin = async () => false;

    const readAllowed = await authorizeContactResource({
      actor: { id: 'u1', roles: ['Receptionist'] },
      action: 'contacts:read',
      contact: contactWithoutSectors,
      requiredLevel: 'read',
      isGlobalAdmin: notGlobalAdmin,
    });
    expect(readAllowed).toEqual({ allowed: true });

    const writeAllowed = await authorizeContactResource({
      actor: { id: 'u1', roles: ['Receptionist'] },
      action: 'contacts:write',
      contact: contactWithoutSectors,
      requiredLevel: 'write',
      isGlobalAdmin: notGlobalAdmin,
    });
    expect(writeAllowed).toEqual({ allowed: true });

    const writeDenied = await authorizeContactResource({
      actor: { id: 'u1', roles: [] },
      action: 'contacts:write',
      contact: contactWithoutSectors,
      requiredLevel: 'write',
      isGlobalAdmin: notGlobalAdmin,
    });
    expect(writeDenied).toMatchObject({ allowed: false, statusCode: 403 });
  });

  it('authorizeSectorScope com ação exige a permissão antes da membership', async () => {
    const denied = await authorizeSectorScope({
      actor: { id: 'u1', roles: [] },
      sectorId: 's1',
      requiredLevel: 'write',
      action: 'chat:write',
    });
    expect(denied).toMatchObject({ allowed: false, statusCode: 403, error: 'FORBIDDEN' });
  });

  it('task/alerta sem conversa também negam ator sem permissão', async () => {
    const task = await authorizeTaskResource({
      actor: { id: 'u1', roles: [] },
      action: 'tasks:read',
      task: { createdBy: 'u1' },
    });
    expect(task).toMatchObject({ allowed: false, statusCode: 403 });

    const alert = await authorizeAlertResource({
      actor: { id: 'u1', roles: [] },
      action: 'alerts:read',
      alert: { triggeredBy: 'u1' },
    });
    expect(alert).toMatchObject({ allowed: false, statusCode: 403 });
  });

  it('permissões efetivas do banco prevalecem sobre o catálogo (Admin incluído)', async () => {
    const denied = await authorizeConversationResource({
      actor: { id: 'u1', roles: ['Admin'], permissions: ['chat:read'] },
      action: 'chat:write',
      conversation: { id: 'c1', sectorId: 's1' },
      requiredLevel: 'write',
    });
    expect(denied).toMatchObject({ allowed: false, statusCode: 403, error: 'FORBIDDEN' });

    const customAllowed = await authorizeConversationResource({
      actor: { id: 'u1', roles: ['Custom'], permissions: ['chat:read'] },
      action: 'chat:read',
      conversation: { id: 'c1', assignedUserId: 'u1' },
      requiredLevel: 'read',
      isGlobalAdmin: async () => false,
    });
    expect(customAllowed).toEqual({ allowed: true });
  });

  it('instalação provisionada com conjunto vazio nega até Admin', async () => {
    const denied = await authorizeConversationResource({
      actor: { id: 'u1', roles: ['Admin'], permissions: [], permissionsAuthoritative: true },
      action: 'chat:write',
      conversation: { id: 'c1', sectorId: 's1' },
      requiredLevel: 'write',
    });
    expect(denied).toMatchObject({ allowed: false, statusCode: 403, error: 'FORBIDDEN' });

    const builtIn = await authorizeConversationResource({
      actor: { id: 'u1', roles: ['Receptionist'], permissions: [], permissionsAuthoritative: true },
      action: 'chat:read',
      conversation: { id: 'c1', assignedUserId: 'u1' },
      requiredLevel: 'read',
    });
    expect(builtIn).toMatchObject({ allowed: false, statusCode: 403, error: 'FORBIDDEN' });
  });

  it('permissions vazio mantém o fallback estático apenas para built-in', async () => {
    const notGlobalAdmin = async () => false;

    const builtIn = await authorizeConversationResource({
      actor: { id: 'u1', roles: ['Receptionist'], permissions: [] },
      action: 'chat:read',
      conversation: { id: 'c1', assignedUserId: 'u1' },
      requiredLevel: 'read',
      isGlobalAdmin: notGlobalAdmin,
    });
    expect(builtIn).toEqual({ allowed: true });

    const custom = await authorizeConversationResource({
      actor: { id: 'u1', roles: ['Custom'], permissions: [] },
      action: 'chat:read',
      conversation: { id: 'c1', assignedUserId: 'u1' },
      requiredLevel: 'read',
      isGlobalAdmin: notGlobalAdmin,
    });
    expect(custom).toMatchObject({ allowed: false, statusCode: 403 });
  });
});
