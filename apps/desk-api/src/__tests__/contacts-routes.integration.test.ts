import './integration-mocks';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { buildDeskApiApp } from '../app.ts';

describe('Contacts routes integration', () => {
  const password = 'ChatRoutePass!42';
  const passwordHash = '$2a$10$UX/LcD/6NKhheDIZmbHyN.a6Hc8SW6ytZ/LCCZW3un3h5vJ9n/1h6';
  const email = `contact.integration.${Date.now()}@example.com`;
  const userId = randomUUID();
  let adminRoleId = randomUUID();
  const testContactId = randomUUID();
  let createdAdminRole = false;
  let app: Awaited<ReturnType<typeof buildDeskApiApp>>;
  let token = '';

  const makePhone = () => `55199${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 9000 + 1000)}`.slice(0, 15);

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
        description: 'Admin role for contact integration tests',
      });
      createdAdminRole = true;
    }

    await db.insert(schema.users).values({
      id: userId,
      name: 'Contact Integration User',
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
    // Cleanup test contact — delete status history first, then conversations, then contact
    const convs = await db
      .select({ id: schema.conversations.id })
      .from(schema.conversations)
      .where(eq(schema.conversations.contactId, testContactId));

    for (const conv of convs) {
      await db.delete(schema.conversationStatusHistory).where(eq(schema.conversationStatusHistory.conversationId, conv.id));
    }

    await db.delete(schema.contactSectors).where(eq(schema.contactSectors.contactId, testContactId));
    await db.delete(schema.conversations).where(eq(schema.conversations.contactId, testContactId));
    await db.delete(schema.contacts).where(eq(schema.contacts.id, testContactId));

    // Insert test contact
    await db.insert(schema.contacts).values({
      id: testContactId,
      name: `Test Contact ${Date.now()}`,
      phone: makePhone(),
      type: 'patient',
    });
  });

  afterAll(async () => {
    // Cleanup: status history → conversations → contact → user/role
    const convs = await db
      .select({ id: schema.conversations.id })
      .from(schema.conversations)
      .where(eq(schema.conversations.contactId, testContactId));

    for (const conv of convs) {
      await db.delete(schema.conversationStatusHistory).where(eq(schema.conversationStatusHistory.conversationId, conv.id));
    }

    await db.delete(schema.contactSectors).where(eq(schema.contactSectors.contactId, testContactId));
    await db.delete(schema.conversations).where(eq(schema.conversations.contactId, testContactId));
    await db.delete(schema.contacts).where(eq(schema.contacts.id, testContactId));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, userId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    if (createdAdminRole) {
      await db.delete(schema.roles).where(eq(schema.roles.id, adminRoleId));
    }
    await app.close();
  });

  // === GET /contacts ===
  it('listar contatos retorna 200 com array', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/contacts',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(Array.isArray(response.json())).toBe(true);
  });

  it('listar contatos com search retorna 200', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/contacts?search=Test',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(Array.isArray(response.json())).toBe(true);
  });

  // === GET /contacts/:id ===
  it('buscar contato existente retorna 200', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/contacts/${testContactId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { id: string; name: string };
    expect(body.id).toBe(testContactId);
  });

  it('buscar contato inexistente retorna 404', async () => {
    const fakeId = randomUUID();
    const response = await app.inject({
      method: 'GET',
      url: `/contacts/${fakeId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(404);
  });

  // === POST /contacts ===
  it('criar contato com dados validos retorna 201', async () => {
    const phone = makePhone();
    const response = await app.inject({
      method: 'POST',
      url: '/contacts',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Novo Contato',
        phone,
        email: 'novo@contact.com',
        notes: 'Notas de teste',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as { id: string; name: string; phone: string };
    expect(body.name).toBe('Novo Contato');
    expect(body.phone).toBe(phone);

    // Cleanup
    await db.delete(schema.contacts).where(eq(schema.contacts.id, body.id));
  });

  it('criar contato com telefone duplicado retorna 409', async () => {
    const phone = `+55199${Date.now()}`.slice(0, 15);

    // First create
    await app.inject({
      method: 'POST',
      url: '/contacts',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Primeiro', phone },
    });

    // Duplicate
    const response = await app.inject({
      method: 'POST',
      url: '/contacts',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Segundo', phone },
    });

    expect(response.statusCode).toBe(409);
  });

  // === PUT /contacts/:id ===
  it('atualizar contato existente retorna 200', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/contacts/${testContactId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Contato Atualizado', notes: 'Novas notas' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { name: string };
    expect(body.name).toBe('Contato Atualizado');
  });

  it('atualizar contato inexistente retorna 404', async () => {
    const fakeId = randomUUID();
    const response = await app.inject({
      method: 'PUT',
      url: `/contacts/${fakeId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Contato Inexistente' },
    });

    expect(response.statusCode).toBe(404);
  });

  // === DELETE /contacts/:id ===
  it('deletar contato existente retorna 200', async () => {
    const contactToDelete = randomUUID();
    await db.insert(schema.contacts).values({
      id: contactToDelete,
      name: `Contato Para Deletar ${Date.now()}`,
      phone: `+55199${Date.now()}`.slice(0, 15),
      type: 'patient',
    });

    const response = await app.inject({
      method: 'DELETE',
      url: `/contacts/${contactToDelete}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
  });

  it('deletar contato inexistente retorna 404', async () => {
    const fakeId = randomUUID();
    const response = await app.inject({
      method: 'DELETE',
      url: `/contacts/${fakeId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(404);
  });

  // === POST /contacts/:id/start-conversation ===
  it('iniciar conversa com contato retorna 201 e cria conversa', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/contacts/${testContactId}/start-conversation`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as { conversationId: string; isNew: boolean };
    expect(body.isNew).toBe(true);
    expect(body.conversationId).toBeTypeOf('string');

    // Verify conversation was created in DB
    const [conv] = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, body.conversationId));
    expect(conv).toBeDefined();
    expect(conv.contactId).toBe(testContactId);

    // Cleanup — must delete status history first due to FK constraint
    await db.delete(schema.conversationStatusHistory).where(eq(schema.conversationStatusHistory.conversationId, body.conversationId));
    await db.delete(schema.conversations).where(eq(schema.conversations.id, body.conversationId));
  });

  it('iniciar conversa com contato inexistente retorna 404', async () => {
    const fakeId = randomUUID();
    const response = await app.inject({
      method: 'POST',
      url: `/contacts/${fakeId}/start-conversation`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(response.statusCode).toBe(404);
  });

  // === GET /contacts/stats/overview ===
  it('buscar stats de contatos retorna 200', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/contacts/stats/overview',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    // Stats can return any shape, just verify it's an object
    expect(typeof response.json()).toBe('object');
  });
});
