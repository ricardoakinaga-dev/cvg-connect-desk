import { getSessionCookie, withSessionCsrf } from './integration-mocks';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { buildDeskApiApp } from '../app.ts';

describe('Dashboard KPIs integration', () => {
  const password = 'KpiTestPass!42';
  const passwordHash = '$2a$10$JIBxVK0EqaA3GuDt3BIxne10NeEOKentLiGBRgfzYislUIQ9deFOq';
  const email = `dashboard.integration.${Date.now()}@example.com`;
  const roleName = 'Admin';
  let app: Awaited<ReturnType<typeof buildDeskApiApp>>;
  let token = '';
  let userId = '';
  let roleId = '';
  let createdRole = false;
  const fixtureConversationIds: string[] = [];

  beforeAll(async () => {
    app = await buildDeskApiApp();
    await app.ready();

    userId = randomUUID();

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
        description: 'Role for dashboard KPI integration tests',
      });
    }

    await db.insert(schema.users).values({
      id: userId,
      name: 'Dashboard KPI User',
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

  afterEach(async () => {
    if (fixtureConversationIds.length > 0) {
      await db.delete(schema.messages).where(inArray(schema.messages.conversationId, fixtureConversationIds));
      await db.delete(schema.conversationStatusHistory).where(inArray(schema.conversationStatusHistory.conversationId, fixtureConversationIds));
      await db.delete(schema.conversations).where(inArray(schema.conversations.id, fixtureConversationIds));
      fixtureConversationIds.length = 0;
    }
  });

  afterAll(async () => {
    if (fixtureConversationIds.length > 0) {
      await db.delete(schema.messages).where(inArray(schema.messages.conversationId, fixtureConversationIds));
      await db.delete(schema.conversationStatusHistory).where(inArray(schema.conversationStatusHistory.conversationId, fixtureConversationIds));
      await db.delete(schema.conversations).where(inArray(schema.conversations.id, fixtureConversationIds));
    }

    if (userId) {
      await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
      await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, userId));
      await db.delete(schema.users).where(eq(schema.users.id, userId));
    }

    if (createdRole && roleId) {
      await db.delete(schema.roles).where(eq(schema.roles.id, roleId));
    }

    await app.close();
  });

  async function seedConversationFixture() {
    const conversationId = randomUUID();
    const now = new Date();
    const firstInboundAt = new Date(now.getTime() - 5 * 60 * 1000);
    const botResponseAt = new Date(now.getTime() - 4.5 * 60 * 1000);
    const firstHumanOutAt = new Date(now.getTime() - 4 * 60 * 1000);
    const onlyInboundAt = new Date(now.getTime() - 3 * 60 * 1000);

    await db.insert(schema.conversations).values({
      id: conversationId,
      status: 'open',
      statusV2: 'em_atendimento',
      currentHandler: 'bot',
      isActive: true,
      createdAt: new Date(now.getTime() - 6 * 60 * 1000),
      updatedAt: now,
    });

    await db.insert(schema.messages).values([
      {
        id: randomUUID(),
        conversationId,
        direction: 'outbound',
        content: 'Resposta automática do bot',
        senderType: 'bot',
        sender: 'secretary',
        recipient: '+551100000001',
        status: 'sent',
        createdAt: botResponseAt,
        occurredAt: botResponseAt,
      },
      {
        id: randomUUID(),
        conversationId,
        direction: 'inbound',
        content: 'Paciente pediu atendimento',
        sender: '+551100000001',
        senderType: 'contact',
        recipient: '+5511999999999',
        status: 'delivered',
        createdAt: firstInboundAt,
        occurredAt: firstInboundAt,
      },
      {
        id: randomUUID(),
        conversationId,
        direction: 'outbound',
        content: 'Estamos entrando em contato',
        senderType: 'human',
        sender: 'agent-1',
        recipient: '+551100000001',
        status: 'sent',
        createdAt: firstHumanOutAt,
        occurredAt: firstHumanOutAt,
      },
    ]);

    const conversationWithoutHandoff = randomUUID();
    await db.insert(schema.conversations).values({
      id: conversationWithoutHandoff,
      status: 'open',
      statusV2: 'em_atendimento',
      currentHandler: 'bot',
      isActive: true,
      createdAt: new Date(now.getTime() - 6 * 60 * 1000),
      updatedAt: now,
    });

    await db.insert(schema.messages).values({
      id: randomUUID(),
      conversationId: conversationWithoutHandoff,
      direction: 'inbound',
      content: 'Consulta sem resposta ainda',
      sender: '+551100000002',
      senderType: 'contact',
      recipient: '+5511999999999',
      status: 'delivered',
      createdAt: onlyInboundAt,
      occurredAt: onlyInboundAt,
    });

    fixtureConversationIds.push(conversationId, conversationWithoutHandoff);

    return {
      startDate: new Date(now.getTime() - 10 * 60 * 1000),
      endDate: new Date(now.getTime() + 10 * 60 * 1000),
    };
  }

  it('calcula tempo médio de primeira resposta (D1) com payload real', async () => {
    const { startDate, endDate } = await seedConversationFixture();

    const response = await app.inject({
      method: 'GET',
      url: `/metrics/first-response-time?startDate=${encodeURIComponent(startDate.toISOString())}&endDate=${encodeURIComponent(endDate.toISOString())}`,
      headers: withSessionCsrf(token),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      avgResponseTimeMs: number;
      count: number;
      period: string;
      calculatedAt: string;
    };

    expect(body.count).toBeGreaterThanOrEqual(0);
    expect(body.avgResponseTimeMs).toBeGreaterThanOrEqual(0);
    expect(body.avgResponseTimeMs).toBeLessThan(120000);
    expect(body.calculatedAt).toBeTypeOf('string');
  });

  it('calcula taxa de handoff com mensagens human-to-conversation (D2)', async () => {
    const { startDate, endDate } = await seedConversationFixture();

    const response = await app.inject({
      method: 'GET',
      url: `/metrics/handoff-rate?startDate=${encodeURIComponent(startDate.toISOString())}&endDate=${encodeURIComponent(endDate.toISOString())}`,
      headers: withSessionCsrf(token),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      handoffRate: number;
      totalConversations: number;
      conversationsWithHandoff: number;
      period: string;
      calculatedAt: string;
    };

    expect(body.totalConversations).toBeGreaterThanOrEqual(2);
    expect(body.conversationsWithHandoff).toBeGreaterThanOrEqual(0);
    expect(body.handoffRate).toBeGreaterThanOrEqual(0);
  });

  it('rejeita datas inválidas e intervalos sem limites', async () => {
    const invalid = await app.inject({
      method: 'GET',
      url: '/metrics/handoff-rate?startDate=not-a-date&endDate=also-invalid',
      headers: withSessionCsrf(token),
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ error: 'METRIC_DATE_INVALID' });

    const inverted = await app.inject({
      method: 'GET',
      url: '/metrics/first-response-time?startDate=2026-04-02T00:00:00.000Z&endDate=2026-04-01T00:00:00.000Z',
      headers: withSessionCsrf(token),
    });
    expect(inverted.statusCode).toBe(400);
    expect(inverted.json()).toMatchObject({ error: 'METRIC_DATE_RANGE_INVALID' });

    const tooLarge = await app.inject({
      method: 'GET',
      url: '/metrics/conversations/volume?startDate=2024-01-01T00:00:00.000Z&endDate=2026-01-01T00:00:00.000Z',
      headers: withSessionCsrf(token),
    });
    expect(tooLarge.statusCode).toBe(400);
    expect(tooLarge.json()).toMatchObject({ error: 'METRIC_DATE_RANGE_TOO_LARGE' });
  });
});
