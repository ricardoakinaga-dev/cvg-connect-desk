import './integration-mocks';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { buildDeskApiApp } from '../app.ts';

describe('Auth routes integration', () => {
  const password = 'Str0ngPass!42';
  const passwordHash = '$2a$10$QMxMJ8QfVxjH93DvTDs2m.OVuALoBBR6S9d58BwIPb8rcXHsUBJWC';
  const email = `auth.integration.${Date.now()}@example.com`;
  const roleName = `Auth Integration ${Date.now()}`;
  let app: Awaited<ReturnType<typeof buildDeskApiApp>>;
  let userId = '';
  let roleId = '';

  beforeAll(async () => {
    app = await buildDeskApiApp();
    await app.ready();

    roleId = randomUUID();
    userId = randomUUID();

    await db.insert(schema.roles).values({
      id: roleId,
      name: roleName,
      description: 'Role for auth route integration tests',
    });

    await db.insert(schema.users).values({
      id: userId,
      name: 'Auth Integration User',
      email,
      passwordHash,
      isActive: true,
    });

    await db.insert(schema.userRoles).values({
      userId,
      roleId,
    });
  });

  beforeEach(async () => {
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
  });

  afterAll(async () => {
    if (userId) {
      await db.delete(schema.auditLogs).where(eq(schema.auditLogs.userId, userId));
      await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
      await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, userId));
      await db.delete(schema.users).where(eq(schema.users.id, userId));
    }

    if (roleId) {
      await db.delete(schema.roles).where(eq(schema.roles.id, roleId));
    }

    await app.close();
  });

  it('login valido retorna sessao/token e dados do usuario', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json() as { user: { email: string; roles: string[] }; token: string };
    expect(body.user.email).toBe(email);
    expect(body.user.roles).toContain(roleName);
    expect(body.token).toBeTypeOf('string');
    expect(body.token).not.toHaveLength(0);
  });

  it('login invalido falha com 401', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: 'wrong-password' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: 'UNAUTHORIZED',
      message: 'Invalid credentials',
    });
  });

  it('/auth/me responde para token valido e falha sem token', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password },
    });

    expect(login.statusCode).toBe(200);
    const token = (login.json() as { token: string }).token;

    const me = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      user: {
        email,
      },
    });

    const missing = await app.inject({
      method: 'GET',
      url: '/auth/me',
    });

    expect(missing.statusCode).toBe(401);
    expect(missing.json()).toMatchObject({
      error: 'UNAUTHORIZED',
      message: 'Missing token',
    });
  });

  it('/auth/me rejeita token invalido', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: 'Bearer invalid-token' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: 'UNAUTHORIZED',
      message: 'Invalid token',
    });
  });

  it('/auth/rotate emite novo token e invalida o antigo', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password },
    });
    expect(login.statusCode).toBe(200);
    const oldToken = (login.json() as { token: string }).token;

    const rotate = await app.inject({
      method: 'POST',
      url: '/auth/rotate',
      headers: { authorization: `Bearer ${oldToken}` },
    });
    expect(rotate.statusCode).toBe(200);
    const newToken = (rotate.json() as { token: string }).token;
    expect(newToken).toBeTypeOf('string');
    expect(newToken).not.toBe(oldToken);

    const oldMe = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${oldToken}` },
    });
    expect(oldMe.statusCode).toBe(401);

    const newMe = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${newToken}` },
    });
    expect(newMe.statusCode).toBe(200);
  });

  it('/auth/logout-all revoga todas as sessoes do usuario', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password },
    });
    const tokenA = (first.json() as { token: string }).token;
    const tokenB = (second.json() as { token: string }).token;

    const logoutAll = await app.inject({
      method: 'POST',
      url: '/auth/logout-all',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(logoutAll.statusCode).toBe(200);

    for (const token of [tokenA, tokenB]) {
      const me = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(me.statusCode).toBe(401);
    }
  });
});
