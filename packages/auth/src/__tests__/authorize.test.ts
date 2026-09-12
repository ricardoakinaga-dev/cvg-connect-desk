import { describe, it, expect } from 'vitest';
import { authorize, SENSITIVE_ACTIONS, type AuthzDeps } from '../authorize';

const allowSector: AuthzDeps = {
  isGlobalAdmin: async () => false,
  hasSectorAccess: async () => true,
};

const denySector: AuthzDeps = {
  isGlobalAdmin: async () => false,
  hasSectorAccess: async () => false,
};

const globalAdminDb: AuthzDeps = {
  isGlobalAdmin: async () => true,
  hasSectorAccess: async () => false,
};

describe('authorize() central', () => {
  it('denies unauthenticated actors', async () => {
    expect(await authorize(undefined, 'chat:read')).toMatchObject({ allowed: false, reason: 'unauthenticated' });
    expect(await authorize(null, 'chat:read')).toMatchObject({ allowed: false, reason: 'unauthenticated' });
  });

  it('grants global admin override regardless of sector', async () => {
    const decision = await authorize({ id: 'u1', roles: ['Admin'] }, 'chat:delete', { type: 'conversation', sectorId: 's1' }, null, denySector);
    expect(decision).toMatchObject({ allowed: true, reason: 'global-admin' });
  });

  it('denies when no role grants the action', async () => {
    const decision = await authorize({ id: 'u1', roles: ['Receptionist'] }, 'admin:write', null, null, allowSector);
    expect(decision).toMatchObject({ allowed: false, reason: 'missing-permission' });
  });

  it('denies unknown roles', async () => {
    const decision = await authorize({ id: 'u1', roles: ['Ghost'] }, 'chat:read', null, null, allowSector);
    expect(decision).toMatchObject({ allowed: false, reason: 'missing-permission' });
  });

  it('allows permitted non-sector action', async () => {
    const decision = await authorize({ id: 'u1', roles: ['Receptionist'] }, 'chat:read', null, null, denySector);
    expect(decision).toMatchObject({ allowed: true, reason: 'permitted' });
  });

  it('enforces sector scope for sector resources (negative + positive)', async () => {
    const denied = await authorize(
      { id: 'u1', roles: ['Receptionist'] }, 'chat:read', { type: 'conversation', sectorId: 's1' }, null, denySector,
    );
    expect(denied).toMatchObject({ allowed: false, reason: 'sector-denied' });

    const allowed = await authorize(
      { id: 'u1', roles: ['Receptionist'] }, 'chat:read', { type: 'conversation', sectorId: 's1' }, null, allowSector,
    );
    expect(allowed).toMatchObject({ allowed: true, reason: 'sector-allowed' });
  });

  it('requires write level for write actions on sectors', async () => {
    let gotLevel: string | undefined;
    const spy: AuthzDeps = {
      isGlobalAdmin: async () => false,
      hasSectorAccess: async (_u, _s, level) => {
        gotLevel = level;
        return true;
      },
    };
    await authorize({ id: 'u1', roles: ['Receptionist'] }, 'chat:write', { type: 'conversation', sectorId: 's1' }, null, spy);
    expect(gotLevel).toBe('write');

    await authorize({ id: 'u1', roles: ['Receptionist'] }, 'chat:read', { type: 'conversation', sectorId: 's1' }, null, spy);
    expect(gotLevel).toBe('read');
  });

  it('honors DB-backed global admin even without Admin role name', async () => {
    const decision = await authorize(
      { id: 'u1', roles: ['Manager'] }, 'chat:read', { type: 'conversation', sectorId: 's1' }, null, globalAdminDb,
    );
    expect(decision).toMatchObject({ allowed: true, reason: 'global-admin' });
  });

  it('sensitive actions map to explicit permissions', () => {
    expect(SENSITIVE_ACTIONS['dlq.replay']).toBe('admin:write');
    expect(SENSITIVE_ACTIONS['contact.delete']).toBe('admin:write');
    expect(SENSITIVE_ACTIONS['message.resend']).toBe('chat:write');
    expect(SENSITIVE_ACTIONS['sector.membership.change']).toBe('admin:write');
  });
});
