import { describe, expect, it, vi } from 'vitest';
import { requirePermission } from '../rbac-middleware';

interface FakeReply {
  status: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
}

function makeReply(): FakeReply {
  const reply: FakeReply = {
    status: vi.fn(() => reply),
    send: vi.fn(() => reply),
  };
  return reply;
}

function makeRequest(user: unknown): never {
  return { user, log: { warn: vi.fn() } } as never;
}

describe('requirePermission — fonte efetiva (D01/PROD-04-AC3)', () => {
  it('401 sem usuário autenticado', async () => {
    const reply = makeReply();
    await requirePermission('chat:read')(makeRequest(undefined), reply as never);
    expect(reply.status).toHaveBeenCalledWith(401);
  });

  it('decide pelo conjunto do banco quando presente (Admin sem a permissão é negado)', async () => {
    const denied = makeReply();
    await requirePermission('chat:write')(
      makeRequest({ id: 'u1', email: 'e', name: 'n', roles: ['Admin'], permissions: ['chat:read'] }),
      denied as never,
    );
    expect(denied.status).toHaveBeenCalledWith(403);

    const allowed = makeReply();
    await requirePermission('chat:read')(
      makeRequest({ id: 'u1', email: 'e', name: 'n', roles: ['Admin'], permissions: ['chat:read'] }),
      allowed as never,
    );
    expect(allowed.status).not.toHaveBeenCalled();
  });

  it('fallback estático cobre apenas built-in sem permissões resolvidas', async () => {
    const builtIn = makeReply();
    await requirePermission('chat:read')(
      makeRequest({ id: 'u1', email: 'e', name: 'n', roles: ['Receptionist'], permissions: [] }),
      builtIn as never,
    );
    expect(builtIn.status).not.toHaveBeenCalled();

    const custom = makeReply();
    await requirePermission('chat:read')(
      makeRequest({ id: 'u1', email: 'e', name: 'n', roles: ['Custom'], permissions: [] }),
      custom as never,
    );
    expect(custom.status).toHaveBeenCalledWith(403);
  });

  it('instalação provisionada com conjunto vazio nega built-in mesmo com papel conhecido', async () => {
    const manager = makeReply();
    await requirePermission('chat:read')(
      makeRequest({
        id: 'u1', email: 'e', name: 'n', roles: ['Manager'], permissions: [], permissionsAuthoritative: true,
      }),
      manager as never,
    );
    expect(manager.status).toHaveBeenCalledWith(403);

    const admin = makeReply();
    await requirePermission('admin:write')(
      makeRequest({
        id: 'u1', email: 'e', name: 'n', roles: ['Admin'], permissions: [], permissionsAuthoritative: true,
      }),
      admin as never,
    );
    expect(admin.status).toHaveBeenCalledWith(403);
  });

  it('papel customizado com permissão do banco passa', async () => {
    const reply = makeReply();
    await requirePermission('notes:write')(
      makeRequest({ id: 'u1', email: 'e', name: 'n', roles: ['Custom'], permissions: ['notes:write'] }),
      reply as never,
    );
    expect(reply.status).not.toHaveBeenCalled();
  });

  it('ator legado sem o campo permissions mantém o catálogo estático', async () => {
    const legacyBuiltIn = makeReply();
    await requirePermission('chat:read')(
      makeRequest({ id: 'u1', email: 'e', name: 'n', roles: ['Veterinarian'] }),
      legacyBuiltIn as never,
    );
    expect(legacyBuiltIn.status).not.toHaveBeenCalled();

    const legacyCustom = makeReply();
    await requirePermission('chat:read')(
      makeRequest({ id: 'u1', email: 'e', name: 'n', roles: ['Custom'] }),
      legacyCustom as never,
    );
    expect(legacyCustom.status).toHaveBeenCalledWith(403);
  });
});
