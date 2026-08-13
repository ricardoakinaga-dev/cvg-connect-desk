import { getSessionCookie, withSessionCsrf } from './integration-mocks';
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

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password },
    });

    expect(login.statusCode).toBe(200);
    token = getSessionCookie(login);
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
      await db.delete(schema.users).where(eq(schema.users.id, userId));
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
      headers: withSessionCsrf(token),
      payload: {
        conversationId,
        recipient: '+5511999999000',
        content: 'Mensagem outbound via integracao',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as { messageId: string; conversationId: string; status: string };
    expect(body.conversationId).toBe(conversationId);
    expect(body.status).toBe('pending');

    const [message] = await db
      .select()
      .from(schema.messages)
      .where(and(eq(schema.messages.conversationId, conversationId), eq(schema.messages.direction, 'outbound')));

    expect(message).toBeDefined();
    expect(message.content).toBe('Mensagem outbound via integracao');
    expect(message.recipient).toBe('+5511999999000');
  });

  it('aceita mensagem com mediaType image', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/messages',
      headers: withSessionCsrf(token),
      payload: {
        conversationId,
        recipient: '+5511999999002',
        mediaUrl: 'https://example.com/image.jpg',
        mediaType: 'image',
        content: 'Imagem do caso',
      },
    });

    expect(response.statusCode).toBe(201);

    const body = response.json() as { messageId: string };
    const [message] = await db
      .select()
      .from(schema.messages)
      .where(and(eq(schema.messages.id, body.messageId)));

    expect(message.mediaType).toBe('image');
    expect(message.mediaUrl).toBe('https://example.com/image.jpg');
  });

  it('aceita mensagem com mediaType document', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/messages',
      headers: withSessionCsrf(token),
      payload: {
        conversationId,
        recipient: '+5511999999003',
        mediaUrl: 'https://example.com/recipe.pdf',
        mediaType: 'document',
        content: 'Laudo',
        mediaFilename: 'recipe.pdf',
      },
    });

    expect(response.statusCode).toBe(201);

    const body = response.json() as { messageId: string };
    const [message] = await db
      .select()
      .from(schema.messages)
      .where(and(eq(schema.messages.id, body.messageId)));

    expect(message.mediaType).toBe('document');
    expect(message.mediaUrl).toBe('https://example.com/recipe.pdf');
  });

  it('aceita mensagem com mediaType audio', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/messages',
      headers: withSessionCsrf(token),
      payload: {
        conversationId,
        recipient: '+5511999999005',
        mediaUrl: 'https://example.com/audio.mp3',
        mediaType: 'audio',
        content: 'Áudio para operação',
      },
    });

    expect(response.statusCode).toBe(201);

    const body = response.json() as { messageId: string };
    const [message] = await db
      .select()
      .from(schema.messages)
      .where(and(eq(schema.messages.id, body.messageId)));

    expect(message.mediaType).toBe('audio');
    expect(message.mediaUrl).toBe('https://example.com/audio.mp3');
  });

  it('aceita mensagem com mediaType location', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/messages',
      headers: withSessionCsrf(token),
      payload: {
        conversationId,
        recipient: '+5511999999004',
        mediaType: 'location',
        latitude: -23.55052,
        longitude: -46.633308,
        content: 'Praia da região',
      },
    });

    expect(response.statusCode).toBe(201);

    const body = response.json() as { messageId: string };
    const [message] = await db
      .select()
      .from(schema.messages)
      .where(and(eq(schema.messages.id, body.messageId)));

    expect(message.mediaType).toBe('location');
  });

  it('validation error e retornado corretamente para input invalido', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/messages',
      headers: withSessionCsrf(token),
      payload: {
        conversationId,
        content: 'Sem recipient',
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('GET /conversations/:id/messages retorna a persistencia real', async () => {
    await app.inject({
      method: 'POST',
      url: '/messages',
      headers: withSessionCsrf(token),
      payload: {
        conversationId,
        recipient: '+5511999999001',
        content: 'Mensagem para leitura',
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/conversations/${conversationId}/messages?limit=10`,
      headers: withSessionCsrf(token),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { messages: Array<{ content: string; direction: string }> };
    expect(body.messages.length).toBeGreaterThan(0);
    expect(body.messages[0].content).toBe('Mensagem para leitura');
    expect(body.messages[0].direction).toBe('outbound');
  });
});
