import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashSessionToken } from '../session-token';

const select = vi.fn();
const insert = vi.fn();
const deleteFrom = vi.fn();

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
  inArray: vi.fn((left: unknown, values: unknown[]) => ({ left, values })),
}));

vi.mock('bcryptjs', () => ({
  default: { compare: vi.fn() },
  compare: vi.fn(),
}));

vi.mock('@cvg/database', () => ({
  db: { select, insert, delete: deleteFrom },
  schema: {
    users: { email: 'users.email' },
    sessions: { tokenHash: 'sessions.token_hash', userId: 'sessions.user_id' },
    userRoles: { userId: 'user_roles.user_id', roleId: 'user_roles.role_id' },
    roles: { id: 'roles.id' },
  },
}));

const { authRepository } = await import('../infrastructure/repositories/auth.repository');

describe('session token security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hashes session tokens deterministically without retaining the raw value', () => {
    const token = 'raw-session-token';
    const first = hashSessionToken(token);
    const second = hashSessionToken(token);

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain(token);
  });

  it('persists only the hash while returning the raw token to the cookie layer', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue(execute);
    insert.mockReturnValue({ values });

    const token = await authRepository.createSession('user-1');

    expect(token).toMatch(/^[0-9a-f-]{36}$/);
    expect(values).toHaveBeenCalledWith({
      userId: 'user-1',
      tokenHash: hashSessionToken(token),
      expiresAt: expect.any(Date),
    });
    expect(JSON.stringify(values.mock.calls[0][0])).not.toContain(token);
  });

  it('looks up and invalidates sessions by a hash of the presented token', async () => {
    const where = vi.fn(() => Promise.resolve([{ userId: 'user-1', expiresAt: new Date() }]));
    select.mockReturnValue({
      from: vi.fn(() => ({ where })),
    });
    const deleteWhere = vi.fn(() => Promise.resolve());
    deleteFrom.mockReturnValue({ where: deleteWhere });

    const token = 'presented-token';
    await expect(authRepository.findSessionByToken(token)).resolves.toMatchObject({ userId: 'user-1' });
    await authRepository.invalidateSession(token);

    expect(where).toHaveBeenCalledWith({
      left: 'sessions.token_hash',
      right: hashSessionToken(token),
    });
    expect(deleteWhere).toHaveBeenCalledWith({
      left: 'sessions.token_hash',
      right: hashSessionToken(token),
    });
  });
});
