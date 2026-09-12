import { vi } from 'vitest';
// Mocks seletivos: @cvg/audit permanece REAL para assertar trilhas de auditoria.
vi.mock('@cvg/secretary-adapter', () => ({
  triggerHandoff: vi.fn().mockResolvedValue(undefined),
  invokeSecretary: vi.fn().mockResolvedValue({
    isErr: () => true,
    isOk: () => false,
  }),
}));
vi.mock('../../../../modules/chat/src/application/events/chat-publisher.ts', () => ({
  publishMessagePersisted: vi.fn().mockResolvedValue(undefined),
  publishConversationCreated: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@cvg/gateway-adapter', () => ({
  registerGatewayRoutes: vi.fn().mockResolvedValue(undefined),
  gatewayService: {
    sendOutbound: vi.fn().mockResolvedValue({ success: true, messageId: 'gateway-mock' }),
    healthCheck: vi.fn().mockResolvedValue(true),
    getInstanceStatus: vi.fn().mockResolvedValue(null),
  },
  mediaService: {
    sendText: vi.fn().mockResolvedValue({ success: true, messageId: 'mock-text' }),
    sendImage: vi.fn().mockResolvedValue({ success: true, messageId: 'mock-image' }),
    sendAudio: vi.fn().mockResolvedValue({ success: true, messageId: 'mock-audio' }),
    sendDocument: vi.fn().mockResolvedValue({ success: true, messageId: 'mock-document' }),
  },
}));
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { buildDeskApiApp } from '../app.ts';

/**
 * Final-9: DSAR via API (autorização forte + audit).
 */
describe('Privacy DSAR API integration', () => {
  const password = 'ChatRoutePass!42';
  const passwordHash = '$2a$10$UX/LcD/6NKhheDIZmbHyN.a6Hc8SW6ytZ/LCCZW3un3h5vJ9n/1h6';
  const suffix = Date.now().toString().slice(-6);
  const adminEmail = `privacy.admin.${suffix}@example.com`;
  const readerEmail = `privacy.reader.${suffix}@example.com`;
  const adminId = randomUUID();
  const readerId = randomUUID();
  const contactId = randomUUID();
  const phone = `+55119${suffix}01`;
  let app: Awaited<ReturnType<typeof buildDeskApiApp>>;
  let adminToken = '';
  let readerToken = '';

  async function loginAs(email: string): Promise<string> {
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
    expect(login.statusCode).toBe(200);
    return (login.json() as { token: string }).token;
  }

  beforeAll(async () => {
    app = await buildDeskApiApp();
    await app.ready();

    let [adminRole] = await db.select().from(schema.roles).where(eq(schema.roles.name, 'Admin')).limit(1);
    if (!adminRole) [adminRole] = await db.insert(schema.roles).values({ name: 'Admin' }).returning();
    let [readerRole] = await db.select().from(schema.roles).where(eq(schema.roles.name, 'Receptionist')).limit(1);
    if (!readerRole) [readerRole] = await db.insert(schema.roles).values({ name: 'Receptionist' }).returning();

    await db.insert(schema.users).values({ id: adminId, name: 'Privacy Admin', email: adminEmail, passwordHash, isActive: true });
    await db.insert(schema.userRoles).values({ userId: adminId, roleId: adminRole.id });
    await db.insert(schema.users).values({ id: readerId, name: 'Privacy Reader', email: readerEmail, passwordHash, isActive: true });
    await db.insert(schema.userRoles).values({ userId: readerId, roleId: readerRole.id });

    adminToken = await loginAs(adminEmail);
    readerToken = await loginAs(readerEmail);

    await db.insert(schema.contacts).values({ id: contactId, phone, name: 'DSAR API Subject' });
  });

  afterAll(async () => {
    await db.delete(schema.auditLogs).where(eq(schema.auditLogs.entityId, contactId));
    await db.delete(schema.contacts).where(eq(schema.contacts.id, contactId));
    for (const uid of [adminId, readerId]) {
      await db.delete(schema.auditLogs).where(eq(schema.auditLogs.userId, uid));
      await db.delete(schema.sessions).where(eq(schema.sessions.userId, uid));
      await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, uid));
      await db.delete(schema.users).where(eq(schema.users.id, uid));
    }
    await app.close();
  });

  it('401 sem token, 403 sem permissão, 404 contato inexistente', async () => {
    expect((await app.inject({ method: 'GET', url: `/privacy/contacts/${contactId}/export?reason=x` })).statusCode).toBe(401);

    const forbidden = await app.inject({
      method: 'GET',
      url: `/privacy/contacts/${contactId}/export?reason=x`,
      headers: { authorization: `Bearer ${readerToken}` },
    });
    expect(forbidden.statusCode).toBe(403);

    const forbiddenAnon = await app.inject({
      method: 'POST',
      url: `/privacy/contacts/${contactId}/anonymize`,
      headers: { authorization: `Bearer ${readerToken}` },
      payload: { reason: 'dsar' },
    });
    expect(forbiddenAnon.statusCode).toBe(403);

    const missing = await app.inject({
      method: 'GET',
      url: `/privacy/contacts/${randomUUID()}/export?reason=x`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('export retorna pacote completo e audita', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/privacy/contacts/${contactId}/export?reason=dsar-api-test`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { contact: { phone: string }; conversations: unknown[] };
    expect(body.contact.phone).toBe(phone);

    const logs = await db
      .select()
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.action, 'lgpd.export'), eq(schema.auditLogs.entityId, contactId)));
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].userId).toBe(adminId);
  });

  it('anonymize anonimiza e audita com requestId', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/privacy/contacts/${contactId}/anonymize`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { reason: 'dsar-api-test', requestId: `req-${suffix}` },
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as { fieldsScrubbed: string[] }).fieldsScrubbed).toContain('phone');

    const [contact] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, contactId));
    expect(contact.phone).toContain('ANONYMIZED');
  });
});
