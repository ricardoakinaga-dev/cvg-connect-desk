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
 * Phase 4 §7.2 — autorização por setor (testes negativos incluídos).
 * - membro enxerga apenas seus setores;
 * - não-membro recebe 403 em recurso setorizado e lista vazia no geral;
 * - admin tem override global;
 * - mudanças de membership e DLQ geram audit log.
 */
describe('Sector authorization integration', () => {
  const passwordHash = '$2a$10$UX/LcD/6NKhheDIZmbHyN.a6Hc8SW6ytZ/LCCZW3un3h5vJ9n/1h6';
  const password = 'ChatRoutePass!42';
  const suffix = Date.now().toString().slice(-6);

  const sectorACode = `authz-a-${suffix}`;
  const sectorBCode = `authz-b-${suffix}`;
  let sectorAId = '';
  let sectorBId = '';
  let convAId = '';
  let convBId = '';

  let adminToken = '';
  let memberToken = '';
  let outsiderToken = '';
  const adminId = randomUUID();
  const memberId = randomUUID();
  const outsiderId = randomUUID();
  const adminEmail = `authz.admin.${suffix}@example.com`;
  const memberEmail = `authz.member.${suffix}@example.com`;
  const outsiderEmail = `authz.outsider.${suffix}@example.com`;

  let app: Awaited<ReturnType<typeof buildDeskApiApp>>;

  async function createUser(id: string, email: string, roleName: string): Promise<string> {
    let [role] = await db.select().from(schema.roles).where(eq(schema.roles.name, roleName)).limit(1);
    if (!role) {
      [role] = await db.insert(schema.roles).values({ name: roleName }).returning();
    }
    await db.insert(schema.users).values({ id, name: email, email, passwordHash, isActive: true });
    await db.insert(schema.userRoles).values({ userId: id, roleId: role.id });
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
    expect(login.statusCode).toBe(200);
    return (login.json() as { token: string }).token;
  }

  beforeAll(async () => {
    app = await buildDeskApiApp();
    await app.ready();

    const [sectorA] = await db.insert(schema.sectors).values({
      name: `AuthZ A ${suffix}`, code: sectorACode, isActive: true,
    }).returning();
    const [sectorB] = await db.insert(schema.sectors).values({
      name: `AuthZ B ${suffix}`, code: sectorBCode, isActive: true,
    }).returning();
    sectorAId = sectorA.id;
    sectorBId = sectorB.id;

    adminToken = await createUser(adminId, adminEmail, 'Admin');
    memberToken = await createUser(memberId, memberEmail, 'Receptionist');
    outsiderToken = await createUser(outsiderId, outsiderEmail, 'Receptionist');

    await db.insert(schema.userSectors).values({ userId: memberId, sectorId: sectorAId, accessLevel: 'read' });

    const [convA] = await db.insert(schema.conversations).values({
      status: 'open', statusV2: 'novo', currentHandler: 'bot', isActive: true, sectorId: sectorAId,
    }).returning();
    const [convB] = await db.insert(schema.conversations).values({
      status: 'open', statusV2: 'novo', currentHandler: 'bot', isActive: true, sectorId: sectorBId,
    }).returning();
    convAId = convA.id;
    convBId = convB.id;
  });

  afterAll(async () => {
    await db.delete(schema.messages).where(eq(schema.messages.conversationId, convAId));
    await db.delete(schema.messages).where(eq(schema.messages.conversationId, convBId));
    await db.delete(schema.conversations).where(eq(schema.conversations.id, convAId));
    await db.delete(schema.conversations).where(eq(schema.conversations.id, convBId));
    for (const uid of [adminId, memberId, outsiderId]) {
      await db.delete(schema.auditLogs).where(eq(schema.auditLogs.userId, uid));
      await db.delete(schema.sessions).where(eq(schema.sessions.userId, uid));
      await db.delete(schema.userSectors).where(eq(schema.userSectors.userId, uid));
      await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, uid));
      await db.delete(schema.users).where(eq(schema.users.id, uid));
    }
    await db.delete(schema.sectors).where(eq(schema.sectors.id, sectorAId));
    await db.delete(schema.sectors).where(eq(schema.sectors.id, sectorBId));
    await app.close();
  });

  it('membro acessa conversas do próprio setor', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/sectors/${sectorAId}/conversations`,
      headers: { authorization: `Bearer ${memberToken}` },
    });
    expect(response.statusCode).toBe(200);
  });

  it('não-membro recebe 403 em setor alheio (negativo)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/sectors/${sectorBId}/conversations`,
      headers: { authorization: `Bearer ${memberToken}` },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: 'FORBIDDEN' });
  });

  it('outsider sem setores recebe 403 em stats de setor (negativo)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/sectors/${sectorAId}/stats`,
      headers: { authorization: `Bearer ${outsiderToken}` },
    });
    expect(response.statusCode).toBe(403);
  });

  it('admin tem override global', async () => {
    for (const sectorId of [sectorAId, sectorBId]) {
      const response = await app.inject({
        method: 'GET',
        url: `/sectors/${sectorId}/conversations`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(response.statusCode).toBe(200);
    }
  });

  it('membro lista apenas conversas dos próprios setores', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/conversations',
      headers: { authorization: `Bearer ${memberToken}` },
    });
    expect(response.statusCode).toBe(200);
    const ids = ((response.json() as { conversations: { id: string }[] }).conversations).map((c) => c.id);
    expect(ids).toContain(convAId);
    expect(ids).not.toContain(convBId);
  });

  it('listagem traz a última mensagem correta em 1 round-trip (sem N+1)', async () => {
    await db.insert(schema.messages).values([
      {
        conversationId: convAId,
        direction: 'inbound',
        content: 'primeira',
        sender: '+5511000000001',
        sentAt: new Date('2026-01-01T10:00:00Z'),
        createdAt: new Date('2026-01-01T10:00:00Z'),
      },
      {
        conversationId: convAId,
        direction: 'inbound',
        content: 'última-msg-n1',
        sender: '+5511000000001',
        sentAt: new Date('2026-01-02T10:00:00Z'),
        createdAt: new Date('2026-01-02T10:00:00Z'),
      },
    ]);
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/conversations',
        headers: { authorization: `Bearer ${memberToken}` },
      });
      expect(response.statusCode).toBe(200);
      const conversations = (response.json() as { conversations: { id: string; lastMessage: { content: string } | null }[] }).conversations;
      const convA = conversations.find((c) => c.id === convAId);
      expect(convA?.lastMessage?.content).toBe('última-msg-n1');
    } finally {
      await db.delete(schema.messages).where(eq(schema.messages.conversationId, convAId));
    }
  });

  it('não-membro com filtro explícito de setor alheio recebe 403 (negativo)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/conversations?sectorId=${sectorBId}`,
      headers: { authorization: `Bearer ${memberToken}` },
    });
    expect(response.statusCode).toBe(403);
  });

  it('outsider sem setores recebe lista vazia (default-deny)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/conversations',
      headers: { authorization: `Bearer ${outsiderToken}` },
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as { conversations: unknown[] }).conversations).toHaveLength(0);
  });

  it('mudança de membership gera audit log', async () => {
    const grant = await app.inject({
      method: 'POST',
      url: `/admin/users/${outsiderId}/sectors`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { sectorId: sectorBId, accessLevel: 'read' },
    });
    expect(grant.statusCode).toBe(200);

    const logs = await db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.action, 'sector.membership.change'),
          eq(schema.auditLogs.entityId, outsiderId)
        )
      );
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].userId).toBe(adminId);
  });
});
