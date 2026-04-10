import './integration-mocks';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { buildDeskApiApp } from '../app.ts';

describe('Kanban routes integration', () => {
  const password = 'KanbanRoutePass!42';
  const passwordHash = '$2a$10$kOS6WENS2HZ/vSU96GD62O6aJbj.nc/B5O6Ctp/ecRh1mV5a8BCCO';
  const email = `kanban.integration.${Date.now()}@example.com`;
  const roleName = `Kanban Integration ${Date.now()}`;
  const userId = randomUUID();
  const roleId = randomUUID();
  const conversationId = randomUUID();
  let app: Awaited<ReturnType<typeof buildDeskApiApp>>;
  let token = '';

  beforeAll(async () => {
    app = await buildDeskApiApp();
    await app.ready();

    await db.insert(schema.roles).values({
      id: roleId,
      name: roleName,
      description: 'Role for kanban route integration tests',
    });

    await db.insert(schema.users).values({
      id: userId,
      name: 'Kanban Route User',
      email,
      passwordHash,
      isActive: true,
    });

    await db.insert(schema.userRoles).values({
      userId,
      roleId,
    });

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password },
    });

    expect(login.statusCode).toBe(200);
    token = (login.json() as { token: string }).token;
  });

  beforeEach(async () => {
    await db.delete(schema.conversations).where(eq(schema.conversations.id, conversationId));
    await db.insert(schema.conversations).values({
      id: conversationId,
      status: 'open',
      statusV2: 'novo',
      currentHandler: 'bot',
      isActive: true,
    });
  });

  afterAll(async () => {
    await db.delete(schema.conversations).where(eq(schema.conversations.id, conversationId));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, userId));
    await db.delete(schema.auditLogs).where(eq(schema.auditLogs.userId, userId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    await db.delete(schema.roles).where(eq(schema.roles.id, roleId));
    await app.close();
  });

  it('PATCH /kanban/card/:id/move atualiza o status final do card', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/kanban/card/${conversationId}/move`,
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        status: 'finalizado',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      id: conversationId,
      status: 'finalizado',
    });

    const [conversation] = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversationId));

    expect(conversation.statusV2).toBe('finalizado');
    expect(conversation.isActive).toBe(false);
  });

  it('PATCH /kanban/card/:id/move falha com 404 para card inexistente', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/kanban/card/${randomUUID()}/move`,
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        status: 'finalizado',
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: 'NOT_FOUND',
      message: 'Conversa não encontrada',
    });
  });
});
