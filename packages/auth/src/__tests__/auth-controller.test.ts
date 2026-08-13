import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
}));

const findUserByEmail = vi.fn();
const verifyPassword = vi.fn();
const getUserRoles = vi.fn();
const createSession = vi.fn();
const findSessionByToken = vi.fn();
const invalidateSession = vi.fn();
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
    findUserByEmail,
    verifyPassword,
    getUserRoles,
    createSession,
    findSessionByToken,
    invalidateSession,
  },
}));

const { registerAuthRoutes } = await import('../presentation/http/auth.controller');

function mockSelectSequence(results: unknown[][]) {
  select.mockImplementation(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve(results.shift() ?? [])),
    })),
  }));
}

async function buildApp() {
  const app = Fastify({ logger: false });
  await registerAuthRoutes(app);
  await app.ready();
  return app;
}

describe('auth controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs in active users with valid credentials', async () => {
    const app = await buildApp();
    findUserByEmail.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      name: 'User',
      passwordHash: 'hash',
      isActive: true,
    });
    verifyPassword.mockResolvedValue(true);
    getUserRoles.mockResolvedValue(['Admin']);
    createSession.mockResolvedValue('session-token');

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'user@example.com', password: 'secret' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      user: {
        id: 'user-1',
        email: 'user@example.com',
        name: 'User',
        roles: ['Admin'],
      },
    });
    const setCookie = response.headers['set-cookie'];
    expect(setCookie).toEqual(expect.arrayContaining([
      expect.stringContaining('cvg_session=session-token'),
      expect.stringContaining('cvg_csrf='),
    ]));
    expect(setCookie?.join('; ')).toContain('HttpOnly');
    await app.close();
  });

  it('rejects missing users, inactive users, and invalid passwords', async () => {
    const app = await buildApp();

    findUserByEmail.mockResolvedValueOnce(null);
    let response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'missing@example.com', password: 'secret' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ message: 'Invalid credentials' });

    findUserByEmail.mockResolvedValueOnce({
      id: 'user-1',
      email: 'inactive@example.com',
      name: 'Inactive',
      passwordHash: 'hash',
      isActive: false,
    });
    response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'inactive@example.com', password: 'secret' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ message: 'User account is inactive' });

    findUserByEmail.mockResolvedValueOnce({
      id: 'user-1',
      email: 'user@example.com',
      name: 'User',
      passwordHash: 'hash',
      isActive: true,
    });
    verifyPassword.mockResolvedValueOnce(false);
    response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'user@example.com', password: 'wrong' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ message: 'Invalid credentials' });
    await app.close();
  });

  it('invalidates session cookie on logout', async () => {
    const app = await buildApp();

    const missing = await app.inject({
      method: 'POST',
      url: '/auth/logout',
    });
    expect(missing.statusCode).toBe(401);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { cookie: 'cvg_session=session-token; cvg_csrf=csrf-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(invalidateSession).toHaveBeenCalledWith('session-token');
    expect(response.headers['set-cookie']).toEqual(expect.arrayContaining([
      expect.stringContaining('cvg_session=;'),
    ]));
    expect(response.json()).toEqual({ message: 'Logged out successfully' });
    await app.close();
  });

  it('returns current user for valid sessions', async () => {
    const app = await buildApp();
    findSessionByToken.mockResolvedValue({ userId: 'user-1', expiresAt: new Date(Date.now() + 1000) });
    mockSelectSequence([[{ id: 'user-1', email: 'user@example.com', name: 'User', isActive: true }]]);
    getUserRoles.mockResolvedValue(['Manager']);

    const response = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: 'cvg_session=session-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      user: {
        id: 'user-1',
        email: 'user@example.com',
        name: 'User',
        roles: ['Manager'],
      },
    });
    await app.close();
  });

  it('rejects invalid sessions and sanitizes authentication infrastructure failures', async () => {
    const app = await buildApp();

    findSessionByToken.mockResolvedValueOnce(null);
    let response = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: 'cvg_session=missing-session' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ message: 'Invalid token' });

    findSessionByToken.mockResolvedValueOnce({ userId: 'user-1', expiresAt: new Date(Date.now() - 1000) });
    response = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: 'cvg_session=expired-session' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ message: 'Token expired' });

    findSessionByToken.mockResolvedValueOnce({ userId: 'user-1', expiresAt: new Date(Date.now() + 1000) });
    mockSelectSequence([[]]);
    response = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: 'cvg_session=unknown-user' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ message: 'User not found or inactive' });

    findSessionByToken.mockRejectedValueOnce(new Error('database password leaked'));
    response = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: 'cvg_session=database-error' },
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'INTERNAL_ERROR', message: 'Failed to get current user' });

    invalidateSession.mockRejectedValueOnce(new Error('database unavailable'));
    response = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { cookie: 'cvg_session=logout-error' },
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'INTERNAL_ERROR', message: 'Logout failed' });

    findUserByEmail.mockRejectedValueOnce(new Error('database unavailable'));
    response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'user@example.com', password: 'secret' },
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'INTERNAL_ERROR', message: 'Login failed' });
    await app.close();
  });
});
