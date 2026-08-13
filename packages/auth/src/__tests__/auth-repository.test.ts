import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
  inArray: vi.fn((left: unknown, values: unknown[]) => ({ left, values })),
}));

const compare = vi.fn();
const select = vi.fn();
const insert = vi.fn();
const deleteFrom = vi.fn();

vi.mock('bcryptjs', () => ({
  default: {
    compare,
  },
  compare,
}));

vi.mock('@cvg/database', () => ({
  db: {
    select,
    insert,
    delete: deleteFrom,
  },
  schema: {
    users: {
      email: 'users.email',
    },
    sessions: {
      tokenHash: 'sessions.tokenHash',
      userId: 'sessions.userId',
    },
    userRoles: {
      userId: 'userRoles.userId',
      roleId: 'userRoles.roleId',
    },
    roles: {
      id: 'roles.id',
    },
  },
}));

const { authRepository } = await import('../infrastructure/repositories/auth.repository');

function mockSelectResults(results: unknown[][]) {
  select.mockImplementation(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve(results.shift() ?? [])),
    })),
  }));
}

describe('authRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('finds users by email and returns null when absent', async () => {
    mockSelectResults([[{ id: 'user-1', email: 'user@example.com' }], []]);

    await expect(authRepository.findUserByEmail('user@example.com')).resolves.toEqual({
      id: 'user-1',
      email: 'user@example.com',
    });
    await expect(authRepository.findUserByEmail('missing@example.com')).resolves.toBeNull();
  });

  it('delegates password verification to bcrypt', async () => {
    compare.mockResolvedValue(true);

    await expect(authRepository.verifyPassword('secret', 'hash')).resolves.toBe(true);

    expect(compare).toHaveBeenCalledWith('secret', 'hash');
  });

  it('creates sessions with a token hash and returns only the raw cookie token', async () => {
    const values = vi.fn(() => Promise.resolve());
    insert.mockReturnValue({ values });

    const token = await authRepository.createSession('user-1');

    expect(values).toHaveBeenCalledWith({
      userId: 'user-1',
      tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      expiresAt: expect.any(Date),
    });
    expect(token).toMatch(/^[0-9a-f-]{36}$/);
    expect(values.mock.calls[0][0].tokenHash).not.toBe(token);
  });

  it('maps role ids to role names', async () => {
    mockSelectResults([
      [{ roleId: 'role-1' }, { roleId: 'role-2' }],
      [{ id: 'role-1', name: 'Admin' }, { id: 'role-3', name: 'Other' }],
    ]);

    await expect(authRepository.getUserRoles('user-1')).resolves.toEqual(['Admin']);
  });

  it('returns empty roles without querying role names when no role ids exist', async () => {
    mockSelectResults([[]]);

    await expect(authRepository.getUserRoles('user-1')).resolves.toEqual([]);
  });

  it('invalidates one or all user sessions', async () => {
    const where = vi.fn(() => Promise.resolve());
    deleteFrom.mockReturnValue({ where });

    await authRepository.invalidateSession('token-1');
    await authRepository.invalidateAllUserSessions('user-1');

    expect(deleteFrom).toHaveBeenCalledTimes(2);
    expect(where).toHaveBeenCalledTimes(2);
  });
});
