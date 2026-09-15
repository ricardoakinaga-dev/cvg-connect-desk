import './integration-mocks';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { buildDeskApiApp } from '../app.ts';

describe('Sectors routes integration', () => {
  const password = 'ChatRoutePass!42';
  const passwordHash = '$2a$10$UX/LcD/6NKhheDIZmbHyN.a6Hc8SW6ytZ/LCCZW3un3h5vJ9n/1h6';
  const email = `sector.integration.${Date.now()}@example.com`;
  const userId = randomUUID();
  let adminRoleId: string = randomUUID();
  let createdAdminRole = false;
  const testSectorId = randomUUID();
  const testSectorCode = `TEST-${Date.now()}`;
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
        description: 'Admin role for sector integration tests',
      });
      createdAdminRole = true;
    }

    await db.insert(schema.users).values({
      id: userId,
      name: 'Sector Integration User',
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
    await db.delete(schema.sectors).where(eq(schema.sectors.id, testSectorId));
    await db.insert(schema.sectors).values({
      id: testSectorId,
      name: `Test Sector ${Date.now()}`,
      code: testSectorCode,
      description: 'Test sector for integration tests',
      isActive: true,
    });
  });

  afterAll(async () => {
    await db.delete(schema.sectors).where(eq(schema.sectors.id, testSectorId));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, userId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    if (createdAdminRole) {
      await db.delete(schema.roles).where(eq(schema.roles.id, adminRoleId));
    }
    await app.close();
  });

  // === GET /sectors ===
  it('listar setores retorna 200 com array', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/sectors',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toBeInstanceOf(Array);
  });

  it('listar setores com query all=true retorna todos', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/sectors?all=true',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(Array.isArray(response.json())).toBe(true);
  });

  // === POST /sectors ===
  it('criar setor com dados validos retorna 201', async () => {
    const sectorCode = `NEW-${Date.now()}`;
    const response = await app.inject({
      method: 'POST',
      url: '/sectors',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Novo Setor',
        code: sectorCode,
        description: 'Setor de teste',
        color: '#123456',
        autoAssign: false,
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as { id: string; name: string; code: string };
    expect(body.name).toBe('Novo Setor');
    expect(body.code).toBe(sectorCode);

    // Cleanup
    await db.delete(schema.sectors).where(eq(schema.sectors.id, body.id));
  });

  it('criar setor com codigo duplicado retorna 409', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/sectors',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Setor Duplicado',
        code: testSectorCode, // Already used by testSectorId
        description: 'Setor duplicado',
      },
    });

    expect(response.statusCode).toBe(409);
  });

  // === PUT /sectors/:id ===
  it('atualizar setor existente retorna 200', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/sectors/${testSectorId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Setor Atualizado', description: 'Nova descricao' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { name: string };
    expect(body.name).toBe('Setor Atualizado');
  });

  it('atualizar setor inexistente retorna 404', async () => {
    const fakeId = randomUUID();
    const response = await app.inject({
      method: 'PUT',
      url: `/sectors/${fakeId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Setor Inexistente' },
    });

    expect(response.statusCode).toBe(404);
  });

  // === DELETE /sectors/:id ===
  it('deletar setor existente retorna 200', async () => {
    const sectorToDelete = randomUUID();
    await db.insert(schema.sectors).values({
      id: sectorToDelete,
      name: `Setor Para Deletar ${Date.now()}`,
      code: `DEL-${Date.now()}`,
      isActive: true,
    });

    const response = await app.inject({
      method: 'DELETE',
      url: `/sectors/${sectorToDelete}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
  });

  it('deletar setor inexistente retorna 404', async () => {
    const fakeId = randomUUID();
    const response = await app.inject({
      method: 'DELETE',
      url: `/sectors/${fakeId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(404);
  });

  // === GET /sectors/:id/conversations ===
  it('buscar conversas do setor retorna 200', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/sectors/${testSectorId}/conversations`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(Array.isArray(response.json())).toBe(true);
  });

  // === GET /sectors/:id/stats ===
  it('buscar stats do setor retorna 200', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/sectors/${testSectorId}/stats`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { sector: { id: string } };
    expect(body.sector.id).toBe(testSectorId);
  });

  it('buscar stats de setor inexistente retorna 404', async () => {
    const fakeId = randomUUID();
    const response = await app.inject({
      method: 'GET',
      url: `/sectors/${fakeId}/stats`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(404);
  });

  // === GET /sectors/stats/overview ===
  it('buscar overview de stats retorna 200', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/sectors/stats/overview',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(Array.isArray(response.json())).toBe(true);
  });
});
