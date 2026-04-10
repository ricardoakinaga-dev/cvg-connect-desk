import './integration-mocks';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { buildDeskApiApp } from '../app.ts';

describe('Transfers routes integration', () => {
  const password = 'ChatRoutePass!42';
  const passwordHash = '$2a$10$UX/LcD/6NKhheDIZmbHyN.a6Hc8SW6ytZ/LCCZW3un3h5vJ9n/1h6';
  const email = `transfer.integration.${Date.now()}@example.com`;
  const userId = randomUUID();
  let adminRoleId = randomUUID();
  const testContactId = randomUUID();
  const sectorAId = randomUUID();
  const sectorBId = randomUUID();
  const testConversationId = randomUUID();
  let createdAdminRole = false;
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
        description: 'Admin role for transfer integration tests',
      });
      createdAdminRole = true;
    }

    await db.insert(schema.users).values({
      id: userId,
      name: 'Transfer Integration User',
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
    await db.delete(schema.contactTransfers).where(eq(schema.contactTransfers.contactId, testContactId));
    await db.delete(schema.contactSectors).where(eq(schema.contactSectors.contactId, testContactId));
    await db.delete(schema.conversations).where(eq(schema.conversations.id, testConversationId));
    await db.delete(schema.contacts).where(eq(schema.contacts.id, testContactId));
    await db.delete(schema.sectors).where(eq(schema.sectors.id, sectorAId));
    await db.delete(schema.sectors).where(eq(schema.sectors.id, sectorBId));

    // Insert test sectors
    await db.insert(schema.sectors).values({
      id: sectorAId,
      name: `Sector A ${Date.now()}`,
      code: `SEC-A-${Date.now()}`,
      isActive: true,
    });

    await db.insert(schema.sectors).values({
      id: sectorBId,
      name: `Sector B ${Date.now()}`,
      code: `SEC-B-${Date.now()}`,
      isActive: true,
    });

    // Insert test contact
    await db.insert(schema.contacts).values({
      id: testContactId,
      name: `Transfer Contact ${Date.now()}`,
      phone: `+55199${Date.now()}`.slice(0, 15),
      type: 'patient',
    });

    // Insert test conversation
    await db.insert(schema.conversations).values({
      id: testConversationId,
      contactId: testContactId,
      status: 'open',
      statusV2: 'novo',
      currentHandler: 'bot',
      isActive: true,
    });
  });

  afterAll(async () => {
    await db.delete(schema.contactTransfers).where(eq(schema.contactTransfers.contactId, testContactId));
    await db.delete(schema.contactSectors).where(eq(schema.contactSectors.contactId, testContactId));
    await db.delete(schema.conversations).where(eq(schema.conversations.id, testConversationId));
    await db.delete(schema.contacts).where(eq(schema.contacts.id, testContactId));
    await db.delete(schema.sectors).where(eq(schema.sectors.id, sectorAId));
    await db.delete(schema.sectors).where(eq(schema.sectors.id, sectorBId));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, userId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    if (createdAdminRole) {
      await db.delete(schema.roles).where(eq(schema.roles.id, adminRoleId));
    }
    await app.close();
  });

  // === POST /transfers (with autoAccept: true) ===
  it('criar transferencia com autoAccept retorna 201', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/transfers',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        contactId: testContactId,
        toSectorId: sectorBId,
        fromSectorId: sectorAId,
        conversationId: testConversationId,
        reason: 'Test transfer',
        autoAccept: true,
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as { id: string; contactId: string; status: string };
    expect(body.contactId).toBe(testContactId);
    expect(body.status).toBe('accepted');
  });

  // === POST /transfers (pending) ===
  it('criar transferencia pendente sem autoAccept retorna 201', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/transfers',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        contactId: testContactId,
        toSectorId: sectorBId,
        fromSectorId: sectorAId,
        conversationId: testConversationId,
        autoAccept: false,
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as { id: string; contactId: string; status: string };
    expect(body.contactId).toBe(testContactId);
    expect(body.status).toBe('pending');
  });

  // === GET /transfers ===
  it('listar transferencias retorna 200', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/transfers',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(Array.isArray(response.json())).toBe(true);
  });

  // === GET /contacts/:id/transfers ===
  it('buscar transferencias do contato retorna 200', async () => {
    // First create a transfer
    await app.inject({
      method: 'POST',
      url: '/transfers',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        contactId: testContactId,
        toSectorId: sectorBId,
        fromSectorId: sectorAId,
        autoAccept: true,
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/contacts/${testContactId}/transfers`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as any[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  // === POST /transfers/:id/accept ===
  it('aceitar transferencia pendente retorna 200 e muda status', async () => {
    // Create pending transfer
    const createResp = await app.inject({
      method: 'POST',
      url: '/transfers',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        contactId: testContactId,
        toSectorId: sectorBId,
        fromSectorId: sectorAId,
        autoAccept: false,
      },
    });

    const transfer = createResp.json() as { id: string };

    // Accept it
    const acceptResp = await app.inject({
      method: 'POST',
      url: `/transfers/${transfer.id}/accept`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(acceptResp.statusCode).toBe(200);
  });

  it('aceitar transferencia inexistente retorna 404', async () => {
    const fakeId = randomUUID();
    const response = await app.inject({
      method: 'POST',
      url: `/transfers/${fakeId}/accept`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(404);
  });

  // === POST /transfers/:id/reject ===
  it('rejeitar transferencia pendente retorna 200', async () => {
    // Create pending transfer
    const createResp = await app.inject({
      method: 'POST',
      url: '/transfers',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        contactId: testContactId,
        toSectorId: sectorBId,
        fromSectorId: sectorAId,
        autoAccept: false,
      },
    });

    const transfer = createResp.json() as { id: string };

    // Reject it
    const rejectResp = await app.inject({
      method: 'POST',
      url: `/transfers/${transfer.id}/reject`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(rejectResp.statusCode).toBe(200);
  });

  it('rejeitar transferencia inexistente retorna 404', async () => {
    const fakeId = randomUUID();
    const response = await app.inject({
      method: 'POST',
      url: `/transfers/${fakeId}/reject`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(404);
  });

  it('aceitar transferencia ja aceita retorna 400', async () => {
    // Create auto-accept transfer (already accepted)
    const createResp = await app.inject({
      method: 'POST',
      url: '/transfers',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        contactId: testContactId,
        toSectorId: sectorBId,
        fromSectorId: sectorAId,
        autoAccept: true,
      },
    });

    const transfer = createResp.json() as { id: string };

    // Try to accept again
    const acceptResp = await app.inject({
      method: 'POST',
      url: `/transfers/${transfer.id}/accept`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(acceptResp.statusCode).toBe(400);
  });

  it('rejeitar transferencia ja rejeitada retorna 400', async () => {
    // Create pending transfer
    const createResp = await app.inject({
      method: 'POST',
      url: '/transfers',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        contactId: testContactId,
        toSectorId: sectorBId,
        fromSectorId: sectorAId,
        autoAccept: false,
      },
    });

    const transfer = createResp.json() as { id: string };

    // Reject it
    await app.inject({
      method: 'POST',
      url: `/transfers/${transfer.id}/reject`,
      headers: { authorization: `Bearer ${token}` },
    });

    // Try to reject again
    const rejectResp = await app.inject({
      method: 'POST',
      url: `/transfers/${transfer.id}/reject`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(rejectResp.statusCode).toBe(400);
  });
});
