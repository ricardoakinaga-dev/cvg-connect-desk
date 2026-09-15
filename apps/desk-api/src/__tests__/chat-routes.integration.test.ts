import './integration-mocks';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { buildDeskApiApp } from '../app.ts';

describe('Chat routes integration', () => {
  const password = 'ChatRoutePass!42';
  const passwordHash = '$2a$10$UX/LcD/6NKhheDIZmbHyN.a6Hc8SW6ytZ/LCCZW3un3h5vJ9n/1h6';
  const email = `chat.integration.${Date.now()}@example.com`;
  const roleName = 'Receptionist';
  const conversationId = randomUUID();
  const userId = randomUUID();
  let sectorId = '';
  let roleId = '';
  let createdRole = false;
  let app: Awaited<ReturnType<typeof buildDeskApiApp>>;
  let token = '';

  beforeAll(async () => {
    app = await buildDeskApiApp();
    await app.ready();

    const [existingRole] = await db
      .select()
      .from(schema.roles)
      .where(eq(schema.roles.name, roleName));

    if (existingRole) {
      roleId = existingRole.id;
    } else {
      roleId = randomUUID();
      createdRole = true;
      await db.insert(schema.roles).values({
        id: roleId,
        name: roleName,
        description: 'Role for chat route integration tests',
      });
    }

    await db.insert(schema.users).values({
      id: userId,
      name: 'Chat Route User',
      email,
      passwordHash,
      isActive: true,
    });

    await db.insert(schema.userRoles).values({
      userId,
      roleId,
    });

    // AAA-04 (MUD-CAT-002): conversa com setor exige membership para o ator de teste.
    const suffix = String(Date.now()).slice(-6);
    const [sector] = await db.insert(schema.sectors).values({ name: `chat-routes ${suffix}`, code: `chatr${suffix}` }).returning();
    sectorId = sector.id;
    await db.insert(schema.userSectors).values({ userId, sectorId, accessLevel: 'write' });

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password },
    });

    expect(login.statusCode).toBe(200);
    token = (login.json() as { token: string }).token;
  });

  beforeEach(async () => {
    await db.delete(schema.messages).where(eq(schema.messages.conversationId, conversationId));
    await db.delete(schema.conversationStatusHistory).where(eq(schema.conversationStatusHistory.conversationId, conversationId));
    await db.delete(schema.conversations).where(eq(schema.conversations.id, conversationId));

    await db.insert(schema.conversations).values({
      id: conversationId,
      status: 'open',
      statusV2: 'novo',
      currentHandler: 'bot',
      isActive: true,
      sectorId,
    });
  });

  afterAll(async () => {
    await db.delete(schema.messages).where(eq(schema.messages.conversationId, conversationId));
    await db.delete(schema.conversationStatusHistory).where(eq(schema.conversationStatusHistory.conversationId, conversationId));
    await db.delete(schema.conversations).where(eq(schema.conversations.id, conversationId));
    if (userId) {
      await db.delete(schema.auditLogs).where(eq(schema.auditLogs.userId, userId));
      await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
      await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, userId));
      await db.delete(schema.userSectors).where(eq(schema.userSectors.userId, userId));
      await db.delete(schema.users).where(eq(schema.users.id, userId));
    }
    if (sectorId) {
      await db.delete(schema.sectors).where(eq(schema.sectors.id, sectorId));
    }
    if (createdRole) {
      await db.delete(schema.roles).where(eq(schema.roles.id, roleId));
    }
    await app.close();
  });

  it('endpoint de mensagem aceita payload valido e persiste a mensagem', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/messages',
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        conversationId,
        recipient: '+5511999999000',
        content: 'Mensagem outbound via integracao',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as { messageId: string; conversationId: string; status: string };
    expect(body.conversationId).toBe(conversationId);
    expect(body.status).toBe('sent');

    const [message] = await db
      .select()
      .from(schema.messages)
      .where(and(eq(schema.messages.conversationId, conversationId), eq(schema.messages.direction, 'outbound')));

    expect(message).toBeDefined();
    expect(message.content).toBe('Mensagem outbound via integracao');
    expect(message.recipient).toBe('+5511999999000');
    expect(message.senderType).toBe('human');
  });

  it('validation error e retornado corretamente para input invalido', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/messages',
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        conversationId,
        content: 'Sem recipient',
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('resolve o recipient pela ultima mensagem inbound quando o cliente nao envia telefone', async () => {
    await db.insert(schema.messages).values({
      conversationId,
      direction: 'inbound',
      senderType: 'contact',
      sender: '5511987788770',
      content: 'Mensagem recebida',
      status: 'pending',
      externalMessageId: `inbound-recipient-${Date.now()}`,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/messages',
      headers: { authorization: `Bearer ${token}` },
      payload: { conversationId, recipient: '', content: 'Resposta manual' },
    });

    expect(response.statusCode).toBe(201);
    const outbound = (await db
      .select()
      .from(schema.messages)
      .where(and(eq(schema.messages.conversationId, conversationId), eq(schema.messages.direction, 'outbound'))))[0];
    expect(outbound?.recipient).toBe('5511987788770');
  });

  it('GET /conversations/:id/messages retorna a persistencia real', async () => {
    await app.inject({
      method: 'POST',
      url: '/messages',
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        conversationId,
        recipient: '+5511999999001',
        content: 'Mensagem para leitura',
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/conversations/${conversationId}/messages?limit=10`,
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { messages: Array<{ content: string; direction: string }> };
    expect(body.messages.length).toBeGreaterThan(0);
    expect(body.messages[0].content).toBe('Mensagem para leitura');
    expect(body.messages[0].direction).toBe('outbound');
  });

  it('marca uma conversa como lida para o atendimento humano', async () => {
    await db
      .update(schema.conversations)
      .set({ unreadCount: 3 })
      .where(eq(schema.conversations.id, conversationId));

    const response = await app.inject({
      method: 'POST',
      url: `/conversations/${conversationId}/read`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ conversationId, unreadCount: 0 });

    const conversation = await db.query.conversations.findFirst({
      where: eq(schema.conversations.id, conversationId),
    });
    expect(conversation?.unreadCount).toBe(0);
  });
});
