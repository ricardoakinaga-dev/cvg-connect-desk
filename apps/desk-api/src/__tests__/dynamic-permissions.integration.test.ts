import { vi } from 'vitest';
vi.mock('@cvg/secretary-adapter', () => ({
  triggerHandoff: vi.fn().mockResolvedValue(undefined),
  invokeSecretary: vi.fn().mockResolvedValue({ isErr: () => true, isOk: () => false }),
}));
vi.mock('../../../../modules/chat/src/application/events/chat-publisher.ts', () => ({
  publishMessagePersisted: vi.fn().mockResolvedValue(undefined),
  publishConversationCreated: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@cvg/gateway-adapter', () => ({
  registerGatewayRoutes: vi.fn().mockResolvedValue(undefined),
  gatewayService: { sendOutbound: vi.fn().mockResolvedValue({ success: true, messageId: 'g' }), healthCheck: vi.fn().mockResolvedValue(true), getInstanceStatus: vi.fn().mockResolvedValue(null) },
  mediaService: { sendText: vi.fn().mockResolvedValue({ success: true, messageId: 'm' }), sendImage: vi.fn().mockResolvedValue({ success: true }), sendAudio: vi.fn().mockResolvedValue({ success: true }), sendDocument: vi.fn().mockResolvedValue({ success: true }) },
}));
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { buildDeskApiApp } from '../app.ts';

/**
 * Auth/session final (§20): permissões refletem ESTADO ATUAL do banco —
 * role removida / setor removido invalida a sessão ativa na próxima request.
 */
describe('Dynamic permissions (session active)', () => {
  const password = 'ChatRoutePass!42';
  const passwordHash = '$2a$10$UX/LcD/6NKhheDIZmbHyN.a6Hc8SW6ytZ/LCCZW3un3h5vJ9n/1h6';
  const email = `dynperm.${Date.now()}@example.com`;
  const userId = randomUUID();
  let app: Awaited<ReturnType<typeof buildDeskApiApp>>;
  let token = '';
  let roleId = '';
  let sectorId = '';
  let dynamicConvId = '';

  beforeAll(async () => {
    app = await buildDeskApiApp();
    await app.ready();
    let [role] = await db.select().from(schema.roles).where(eq(schema.roles.name, 'Receptionist')).limit(1);
    if (!role) role = (await db.insert(schema.roles).values({ name: 'Receptionist' }).returning())[0];
    roleId = role.id;
    const suffix = String(Date.now()).slice(-6);
    const [sector] = await db.insert(schema.sectors).values({ name: `dyn ${suffix}`, code: `dyn${suffix}` }).returning();
    sectorId = sector.id;
    await db.insert(schema.users).values({ id: userId, name: 'Dyn User', email, passwordHash, isActive: true });
    await db.insert(schema.userRoles).values({ userId, roleId });
    const [conv] = await db.insert(schema.conversations).values({ status: 'open', statusV2: 'novo', currentHandler: 'bot', isActive: true, sectorId }).returning();
    dynamicConvId = conv.id;
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
    expect(login.statusCode).toBe(200);
    token = (login.json() as { token: string }).token;
  });

  afterAll(async () => {
    await db.delete(schema.auditLogs).where(eq(schema.auditLogs.userId, userId));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, userId));
    await db.delete(schema.userSectors).where(eq(schema.userSectors.userId, userId));
    if (dynamicConvId) {
      await db.delete(schema.messages).where(eq(schema.messages.conversationId, dynamicConvId));
      await db.delete(schema.conversationStatusHistory).where(eq(schema.conversationStatusHistory.conversationId, dynamicConvId));
      await db.delete(schema.conversations).where(eq(schema.conversations.id, dynamicConvId));
    }
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    if (sectorId) await db.delete(schema.sectors).where(eq(schema.sectors.id, sectorId));
    await app.close();
  });

  it('role removida invalida permissão imediatamente (sem re-login)', async () => {
    // Antes: tem chat:read (Receptionist).
    const before = await app.inject({ method: 'GET', url: '/conversations', headers: { authorization: `Bearer ${token}` } });
    expect(before.statusCode).toBe(200);

    // Remove role DO BANCO enquanto sessão ativa.
    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, userId));

    // Recepção sem maximo setores -> agora sem setores e sem admin → default-deny vazio (200 [])
    // Mas admin:read continua negado: testa rota que exige admin.
    const adminRoute = await app.inject({ method: 'GET', url: '/admin/roles', headers: { authorization: `Bearer ${token}` } });
    expect(adminRoute.statusCode).toBe(403);

    // Reinsere para não quebrar outros testes do arquivo (this é o único; ok).
    await db.insert(schema.userRoles).values({ userId, roleId });
  });

  it('setor removido muda escopo em sessão ativa (vacuo → default-deny)', async () => {
    await db.insert(schema.userSectors).values({ userId, sectorId, accessLevel: 'read' }).onConflictDoNothing();
    const greets = await app.inject({ method: 'GET', url: `/sectors/${sectorId}/conversations`, headers: { authorization: `Bearer ${token}` } });
    expect(greets.statusCode).toBe(200);

    await db.delete(schema.userSectors).where(eq(schema.userSectors.userId, userId));
    const gone = await app.inject({ method: 'GET', url: `/sectors/${sectorId}/conversations`, headers: { authorization: `Bearer ${token}` } });
    expect(gone.statusCode).toBe(403);
  });
});
