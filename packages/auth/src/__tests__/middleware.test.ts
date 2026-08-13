import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
}));

const getUserRoles = vi.fn();
const findSessionByToken = vi.fn();
const select = vi.fn();

vi.mock('@cvg/database', () => ({
  db: {
    select,
  },
  schema: {
    sessions: {
      tokenHash: 'session-token-hash-column',
    },
    users: {
      id: 'user-id-column',
    },
  },
}));

vi.mock('../infrastructure/repositories/auth.repository', () => ({
  authRepository: {
    getUserRoles,
    findSessionByToken,
  },
}));

const { authenticate } = await import('../middleware');
const { clearAuthCache } = await import('../auth-cache');

function createReply() {
  const reply = {
    status: vi.fn<(code: number) => typeof reply>(),
    send: vi.fn<(payload: unknown) => void>(),
  };
  reply.status.mockReturnValue(reply);
  return reply;
}

function createRequest(authorization?: string) {
  return {
    headers: authorization ? { authorization } : {},
    log: {
      error: vi.fn(),
    },
    user: undefined,
  };
}

function createCookieRequest(cookie: string) {
  return {
    headers: { cookie },
    log: {
      error: vi.fn(),
    },
    user: undefined,
  };
}

function mockSelectSequence(results: unknown[][]) {
  select.mockImplementation(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve(results.shift() ?? [])),
    })),
  }));
}

describe('authenticate middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAuthCache();
  });

  it('rejects requests without bearer token', async () => {
    const request = createRequest();
    const reply = createReply();

    await authenticate(request as never, reply as never);

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith({
      error: 'UNAUTHORIZED',
      message: 'Missing token',
    });
  });

  it('rejects invalid sessions', async () => {
    findSessionByToken.mockResolvedValue(null);
    const request = createRequest('Bearer invalid');
    const reply = createReply();

    await authenticate(request as never, reply as never);

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith({
      error: 'UNAUTHORIZED',
      message: 'Invalid token',
    });
  });

  it('rejects expired sessions', async () => {
    findSessionByToken.mockResolvedValue({ userId: 'user-1', expiresAt: new Date(Date.now() - 1000) });
    const request = createRequest('Bearer expired');
    const reply = createReply();

    await authenticate(request as never, reply as never);

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith({
      error: 'UNAUTHORIZED',
      message: 'Token expired',
    });
  });

  it('attaches active users with roles to the request', async () => {
    findSessionByToken.mockResolvedValue({ userId: 'user-1', expiresAt: new Date(Date.now() + 1000) });
    mockSelectSequence([[{ id: 'user-1', email: 'user@example.com', name: 'User', isActive: true }]]);
    getUserRoles.mockResolvedValue(['Admin']);
    const request = createRequest('Bearer valid');
    const reply = createReply();

    await authenticate(request as never, reply as never);

    expect(reply.status).not.toHaveBeenCalled();
    expect(request.user).toEqual({
      id: 'user-1',
      email: 'user@example.com',
      name: 'User',
      roles: ['Admin'],
    });
  });

  it('authenticates requests with a session cookie', async () => {
    findSessionByToken.mockResolvedValue({ userId: 'user-1', expiresAt: new Date(Date.now() + 1000) });
    mockSelectSequence([[{ id: 'user-1', email: 'user@example.com', name: 'User', isActive: true }]]);
    getUserRoles.mockResolvedValue(['Admin']);
    const request = createCookieRequest('cvg_session=valid');
    const reply = createReply();

    await authenticate(request as never, reply as never);

    expect(reply.status).not.toHaveBeenCalled();
    expect(request.user).toEqual({
      id: 'user-1',
      email: 'user@example.com',
      name: 'User',
      roles: ['Admin'],
    });
  });

  it('returns internal error when dependency lookup fails', async () => {
    findSessionByToken.mockRejectedValue(new Error('database down'));
    const request = createRequest('Bearer valid');
    const reply = createReply();

    await authenticate(request as never, reply as never);

    expect(reply.status).toHaveBeenCalledWith(500);
    expect(reply.send).toHaveBeenCalledWith({
      error: 'INTERNAL_ERROR',
      message: 'Authentication failed',
    });
    expect(request.log.error).toHaveBeenCalled();
  });
});
