import './integration-mocks';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { buildDeskApiApp } from '../app.ts';

describe('Labels routes integration', () => {
  const password = 'ChatRoutePass!42';
  const passwordHash = '$2a$10$UX/LcD/6NKhheDIZmbHyN.a6Hc8SW6ytZ/LCCZW3un3h5vJ9n/1h6';
  const email = `label.integration.${Date.now()}@example.com`;
  const userId = randomUUID();
  let adminRoleId: string = randomUUID();
  let createdAdminRole = false;
  const testLabelId = randomUUID();
  const testConversationId = randomUUID();
  let app: Awaited<ReturnType<typeof buildDeskApiApp>>;
  let token = '';

  beforeAll(async () => {
    app = await buildDeskApiApp();
    await app.ready();

    const [existingAdminRole] = await db
      .select()
      .from(schema.roles)
      .where(eq(schema.roles.name, 'Admin'));

    if (existingAdminRole) {
      adminRoleId = existingAdminRole.id;
    } else {
      await db.insert(schema.roles).values({
        id: adminRoleId,
        name: 'Admin',
        description: 'Admin role for label integration tests',
      });
      createdAdminRole = true;
    }

    await db.insert(schema.users).values({
      id: userId,
      name: 'Label Integration User',
      email,
      passwordHash,
      isActive: true,
    });

    await db.insert(schema.userRoles).values({
      userId,
      roleId: adminRoleId,
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
    // Cleanup test label
    await db.delete(schema.conversationLabels).where(eq(schema.conversationLabels.labelId, testLabelId));
    await db.delete(schema.labels).where(eq(schema.labels.id, testLabelId));

    // Insert test label
    await db.insert(schema.labels).values({
      id: testLabelId,
      name: `Test Label ${Date.now()}`,
      color: '#FF0000',
      description: 'Test label for integration tests',
    });

    // Insert test conversation
    await db.delete(schema.conversations).where(eq(schema.conversations.id, testConversationId));
    await db.insert(schema.conversations).values({
      id: testConversationId,
      status: 'open',
      statusV2: 'novo',
      currentHandler: 'bot',
      isActive: true,
    });
  });

  afterAll(async () => {
    await db.delete(schema.conversationLabels).where(eq(schema.conversationLabels.conversationId, testConversationId));
    await db.delete(schema.labels).where(eq(schema.labels.id, testLabelId));
    await db.delete(schema.conversations).where(eq(schema.conversations.id, testConversationId));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, userId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    if (createdAdminRole) {
      await db.delete(schema.roles).where(eq(schema.roles.id, adminRoleId));
    }
    await app.close();
  });

  // === GET /labels ===
  it('listar labels retorna 200 com array', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/labels',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toBeInstanceOf(Array);
  });

  // === POST /labels ===
  it('criar label com dados validos retorna 201', async () => {
    const labelName = `Nova Label ${Date.now()}`;
    const response = await app.inject({
      method: 'POST',
      url: '/labels',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: labelName,
        color: '#00FF00',
        description: 'Label de teste',
        category: 'test',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as { id: string; name: string; color: string };
    expect(body.name).toBe(labelName);
    expect(body.color).toBe('#00FF00');

    // Cleanup
    await db.delete(schema.labels).where(eq(schema.labels.id, body.id));
  });

  it('criar label com nome duplicado retorna 409', async () => {
    const labelName = `Duplicate Label ${Date.now()}`;

    // First create
    await app.inject({
      method: 'POST',
      url: '/labels',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: labelName, color: '#0000FF' },
    });

    // Second create (duplicate)
    const response = await app.inject({
      method: 'POST',
      url: '/labels',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: labelName, color: '#FF00FF' },
    });

    expect(response.statusCode).toBe(409);
    const body = response.json() as { error: string };
    expect(body.error).toBe('CONFLICT');
  });

  // === PUT /labels/:id ===
  it('atualizar label existente retorna 200', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/labels/${testLabelId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Label Atualizada', color: '#FFFF00' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { name: string; color: string };
    expect(body.name).toBe('Label Atualizada');
  });

  it('atualizar label inexistente retorna 404', async () => {
    const fakeId = randomUUID();
    const response = await app.inject({
      method: 'PUT',
      url: `/labels/${fakeId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Label Inexistente' },
    });

    expect(response.statusCode).toBe(404);
  });

  // === DELETE /labels/:id ===
  it('deletar label existente retorna 200', async () => {
    const labelToDelete = randomUUID();
    await db.insert(schema.labels).values({
      id: labelToDelete,
      name: `Label Para Deletar ${Date.now()}`,
      color: '#AAAAAA',
    });

    const response = await app.inject({
      method: 'DELETE',
      url: `/labels/${labelToDelete}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
  });

  it('deletar label inexistente retorna 404', async () => {
    const fakeId = randomUUID();
    const response = await app.inject({
      method: 'DELETE',
      url: `/labels/${fakeId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(404);
  });

  // === GET /conversations/:id/labels ===
  it('listar labels de conversa retorna 200', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/conversations/${testConversationId}/labels`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(Array.isArray(response.json())).toBe(true);
  });

  // === POST /conversations/:id/labels ===
  it('adicionar label a conversa retorna 201', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/conversations/${testConversationId}/labels`,
      headers: { authorization: `Bearer ${token}` },
      payload: { labelId: testLabelId },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as { added: boolean };
    expect(body.added).toBe(true);
  });

  it('adicionar label inexistente a conversa retorna 404', async () => {
    const fakeLabelId = randomUUID();
    const response = await app.inject({
      method: 'POST',
      url: `/conversations/${testConversationId}/labels`,
      headers: { authorization: `Bearer ${token}` },
      payload: { labelId: fakeLabelId },
    });

    expect(response.statusCode).toBe(404);
  });

  // === DELETE /conversations/:id/labels/:labelId ===
  it('remover label de conversa retorna 200', async () => {
    // First add
    await db.insert(schema.conversationLabels).values({
      conversationId: testConversationId,
      labelId: testLabelId,
      createdBy: userId,
    });

    const response = await app.inject({
      method: 'DELETE',
      url: `/conversations/${testConversationId}/labels/${testLabelId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
  });
});
