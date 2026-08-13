import { describe, expect, it, vi } from 'vitest';
import { requirePermission, requireRole } from '../rbac-middleware';

function createReply() {
  const reply = {
    status: vi.fn<(code: number) => typeof reply>(),
    send: vi.fn<(payload: unknown) => void>(),
  };
  reply.status.mockReturnValue(reply);
  return reply;
}

function createRequest(roles?: string[]) {
  return {
    user: roles
      ? {
          id: 'user-1',
          email: 'user@example.com',
          name: 'User',
          roles,
        }
      : undefined,
    log: {
      warn: vi.fn(),
    },
  };
}

describe('RBAC middleware', () => {
  it('requires authentication before permission checks', async () => {
    const request = createRequest();
    const reply = createReply();

    await requirePermission('chat:read')(request as never, reply as never);

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith({
      error: 'UNAUTHORIZED',
      message: 'Authentication required',
    });
  });

  it('allows users with any required permission', async () => {
    const request = createRequest(['Receptionist']);
    const reply = createReply();

    await requirePermission('chat:write', 'admin:write')(request as never, reply as never);

    expect(reply.status).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
  });

  it('rejects users without the required permission', async () => {
    const request = createRequest(['Receptionist']);
    const reply = createReply();

    await requirePermission('admin:write')(request as never, reply as never);

    expect(reply.status).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith({
      error: 'FORBIDDEN',
      message: 'Insufficient permissions',
    });
    expect(request.log.warn).toHaveBeenCalled();
  });

  it('allows users with the required role', async () => {
    const request = createRequest(['Manager']);
    const reply = createReply();

    await requireRole('Admin', 'Manager')(request as never, reply as never);

    expect(reply.status).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
  });

  it('rejects users without the required role', async () => {
    const request = createRequest(['Veterinarian']);
    const reply = createReply();

    await requireRole('Admin')(request as never, reply as never);

    expect(reply.status).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith({
      error: 'FORBIDDEN',
      message: 'Required role not present',
    });
    expect(request.log.warn).toHaveBeenCalled();
  });
});
