import './integration-mocks';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { buildDeskApiApp } from '../app.ts';

describe('Contact Groups routes integration', () => {
  const password = 'ChatRoutePass!42';
  const passwordHash = '$2a$10$UX/LcD/6NKhheDIZmbHyN.a6Hc8SW6ytZ/LCCZW3un3h5vJ9n/1h6';
  const email = `group.integration.${Date.now()}@example.com`;
  const userId = randomUUID();
  let adminRoleId = randomUUID();
  let createdAdminRole = false;
  const testGroupId = randomUUID();
  const testContactId = randomUUID();
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
        description: 'Admin role for contact group integration tests',
      });
      createdAdminRole = true;
    }

    await db.insert(schema.users).values({
      id: userId,
      name: 'Contact Group Integration User',
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
    // Cleanup
    await db.delete(schema.contactGroupMembers).where(eq(schema.contactGroupMembers.groupId, testGroupId));
    await db.delete(schema.contactGroups).where(eq(schema.contactGroups.id, testGroupId));
    await db.delete(schema.contacts).where(eq(schema.contacts.id, testContactId));

    // Insert test contact
    await db.insert(schema.contacts).values({
      id: testContactId,
      name: `Test Contact ${Date.now()}`,
      phone: `+55199${Date.now()}`.slice(0, 15),
      type: 'patient',
    });

    // Insert test group
    await db.insert(schema.contactGroups).values({
      id: testGroupId,
      name: `Test Group ${Date.now()}`,
      description: 'Test group for integration tests',
      groupType: 'custom',
    });
  });

  afterAll(async () => {
    await db.delete(schema.contactGroupMembers).where(eq(schema.contactGroupMembers.groupId, testGroupId));
    await db.delete(schema.contactGroups).where(eq(schema.contactGroups.id, testGroupId));
    await db.delete(schema.contacts).where(eq(schema.contacts.id, testContactId));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, userId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    if (createdAdminRole) {
      await db.delete(schema.roles).where(eq(schema.roles.id, adminRoleId));
    }
    await app.close();
  });

  // === GET /contact-groups ===
  it('listar grupos retorna 200 com array', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/contact-groups',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toBeInstanceOf(Array);
  });

  // === POST /contact-groups ===
  it('criar grupo com dados validos retorna 201', async () => {
    const groupName = `Novo Grupo ${Date.now()}`;
    const response = await app.inject({
      method: 'POST',
      url: '/contact-groups',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: groupName,
        description: 'Grupo de teste',
        groupType: 'custom',
        color: '#FF8800',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as { id: string; name: string; groupType: string };
    expect(body.name).toBe(groupName);
    expect(body.groupType).toBe('custom');

    // Cleanup
    await db.delete(schema.contactGroups).where(eq(schema.contactGroups.id, body.id));
  });

  // === PUT /contact-groups/:id ===
  it('atualizar grupo existente retorna 200', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/contact-groups/${testGroupId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Grupo Atualizado', description: 'Nova descricao' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { name: string };
    expect(body.name).toBe('Grupo Atualizado');
  });

  it('atualizar grupo inexistente retorna 404', async () => {
    const fakeId = randomUUID();
    const response = await app.inject({
      method: 'PUT',
      url: `/contact-groups/${fakeId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Grupo Inexistente' },
    });

    expect(response.statusCode).toBe(404);
  });

  // === DELETE /contact-groups/:id ===
  it('deletar grupo existente retorna 200', async () => {
    const groupToDelete = randomUUID();
    await db.insert(schema.contactGroups).values({
      id: groupToDelete,
      name: `Grupo Para Deletar ${Date.now()}`,
      groupType: 'custom',
    });

    const response = await app.inject({
      method: 'DELETE',
      url: `/contact-groups/${groupToDelete}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
  });

  it('deletar grupo inexistente retorna 404', async () => {
    const fakeId = randomUUID();
    const response = await app.inject({
      method: 'DELETE',
      url: `/contact-groups/${fakeId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(404);
  });

  // === GET /contact-groups/:id/members ===
  it('listar membros do grupo retorna 200', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/contact-groups/${testGroupId}/members`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(Array.isArray(response.json())).toBe(true);
  });

  it('listar membros de grupo inexistente retorna 404', async () => {
    const fakeId = randomUUID();
    const response = await app.inject({
      method: 'GET',
      url: `/contact-groups/${fakeId}/members`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(404);
  });

  // === POST /contact-groups/:id/members ===
  it('adicionar membro ao grupo retorna 201', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/contact-groups/${testGroupId}/members`,
      headers: { authorization: `Bearer ${token}` },
      payload: { contactId: testContactId },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as { added: boolean };
    expect(body.added).toBe(true);
  });

  it('adicionar membro a grupo inexistente retorna 404', async () => {
    const fakeGroupId = randomUUID();
    const response = await app.inject({
      method: 'POST',
      url: `/contact-groups/${fakeGroupId}/members`,
      headers: { authorization: `Bearer ${token}` },
      payload: { contactId: testContactId },
    });

    expect(response.statusCode).toBe(404);
  });

  // === DELETE /contact-groups/:id/members/:contactId ===
  it('remover membro do grupo retorna 200', async () => {
    // First add the member
    await db.insert(schema.contactGroupMembers).values({
      groupId: testGroupId,
      contactId: testContactId,
      addedBy: userId,
    });

    const response = await app.inject({
      method: 'DELETE',
      url: `/contact-groups/${testGroupId}/members/${testContactId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
  });

  // === GET /contacts/:id/groups ===
  it('listar grupos de um contato retorna 200', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/contacts/${testContactId}/groups`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(Array.isArray(response.json())).toBe(true);
  });
});
