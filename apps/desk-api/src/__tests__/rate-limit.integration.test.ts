import { getSessionCookie, withSessionCsrf } from './integration-mocks';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { buildDeskApiApp } from '../app.ts';

describe('Rate limit integration', () => {
  const password = 'RateLimitPass!42';
  const passwordHash = '$2a$10$/LI3HViXcAktI672D7ZjdOR4qh7q76i1zF6kjfeGbSJkK4Wd7O7LS';
  const roleName = `Rate Limit ${Date.now()}`;
  let app: Awaited<ReturnType<typeof buildDeskApiApp>>;
  let roleId = '';
  let userId = '';
  let token = '';
  let email = '';
  const webhookSecret = 'rate-limit-webhook-secret';

  const originalRateLimitMax = process.env.RATE_LIMIT_MAX;
  const originalRateLimitWindow = process.env.RATE_LIMIT_WINDOW;

  async function seedUser() {
    roleId = randomUUID();
    userId = randomUUID();
    email = `rate-limit.integration.${Date.now()}.${userId}@example.com`;

    await db.insert(schema.roles).values({
      id: roleId,
      name: roleName,
      description: 'Role for rate limit integration tests',
    });

    await db.insert(schema.users).values({
      id: userId,
      name: 'Rate Limit User',
      email,
      passwordHash,
      isActive: true,
    });

    await db.insert(schema.userRoles).values({
      userId,
      roleId,
    });
  }

  beforeEach(async () => {
    process.env.RATE_LIMIT_MAX = '2';
    process.env.RATE_LIMIT_WINDOW = '1 minute';
    process.env.DESK_ENV = 'production';
    process.env.WEBHOOK_SECRET = webhookSecret;
    process.env.CORS_ORIGIN = 'http://localhost:5173';
    app = await buildDeskApiApp();
    await app.ready();

    await seedUser();

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password },
    });
    expect(login.statusCode).toBe(200);
    token = getSessionCookie(login);
  });

  afterEach(async () => {
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, userId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    await db.delete(schema.roles).where(eq(schema.roles.id, roleId));

    process.env.RATE_LIMIT_MAX = originalRateLimitMax;
    process.env.RATE_LIMIT_WINDOW = originalRateLimitWindow;
    process.env.DESK_ENV = '';
    process.env.WEBHOOK_SECRET = '';
    process.env.CORS_ORIGIN = '';

    if (app) {
      await app.close();
    }
  });

  it('aplica limite mais restrito para rotas /auth/*', async () => {
    const wrongPayload = { email, password: 'wrong-password' };

    const response1 = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: wrongPayload,
    });
    const response2 = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: wrongPayload,
    });
    const response3 = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: wrongPayload,
    });

    expect(response1.statusCode).toBe(401);
    expect(response2.statusCode).toBe(429);
    expect(response3.statusCode).toBe(429);
    expect(response3.headers['x-ratelimit-remaining']).toBe('0');
  });

  it('aplica limite separado para /webhook/*', async () => {
    const response1 = await app.inject({
      method: 'POST',
      url: '/webhook/inbound',
      payload: {
        messageId: `rl-webhook-${Date.now()}-1`,
        conversationId: `rl-conv-${Date.now()}-1`,
        from: '+5511999999111',
        content: 'Mensagem sem assinatura 1',
      },
    });
    const response2 = await app.inject({
      method: 'POST',
      url: '/webhook/inbound',
      payload: {
        messageId: `rl-webhook-${Date.now()}-2`,
        conversationId: `rl-conv-${Date.now()}-2`,
        from: '+5511999999222',
        content: 'Mensagem sem assinatura 2',
      },
    });
    const response3 = await app.inject({
      method: 'POST',
      url: '/webhook/inbound',
      payload: {
        messageId: `rl-webhook-${Date.now()}-3`,
        conversationId: `rl-conv-${Date.now()}-3`,
        from: '+5511999999333',
        content: 'Mensagem sem assinatura 3',
      },
    });

    expect(response1.statusCode).toBe(401);
    expect(response2.statusCode).toBe(401);
    expect(response3.statusCode).toBe(429);
  });

  it('protege endpoint de API com limite de taxa', async () => {
    const response1 = await app.inject({
      method: 'GET',
      url: '/contacts',
      headers: withSessionCsrf(token),
    });
    const response2 = await app.inject({
      method: 'GET',
      url: '/contacts',
      headers: withSessionCsrf(token),
    });
    const response3 = await app.inject({
      method: 'GET',
      url: '/contacts',
      headers: withSessionCsrf(token),
    });

    expect(response1.statusCode).toBe(200);
    expect(response2.statusCode).toBe(200);
    expect(response3.statusCode).toBe(429);
    expect(response3.headers['x-ratelimit-remaining']).toBe('0');
  });
});
