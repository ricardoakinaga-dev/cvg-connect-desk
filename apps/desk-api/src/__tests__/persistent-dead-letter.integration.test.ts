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
import { eq } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { persistentDeadLetterStore } from '@cvg/events';
import { buildDeskApiApp } from '../app.ts';

/**
 * Final-1: API operacional da DLQ persistente (auth + RBAC + audit).
 */
describe('Persistent dead-letter API integration', () => {
  const password = 'ChatRoutePass!42';
  const passwordHash = '$2a$10$UX/LcD/6NKhheDIZmbHyN.a6Hc8SW6ytZ/LCCZW3un3h5vJ9n/1h6';
  const email = `pdlq.integration.${Date.now()}@example.com`;
  const userId = randomUUID();
  const readerId = randomUUID();
  const readerEmail = `pdlq.reader.${Date.now()}@example.com`;
  const prefix = `pdlq.api.${Date.now()}`;
  let app: Awaited<ReturnType<typeof buildDeskApiApp>>;
  let adminToken = '';
  let readerToken = '';

  beforeAll(async () => {
    app = await buildDeskApiApp();
    await app.ready();

    let [adminRole] = await db.select().from(schema.roles).where(eq(schema.roles.name, 'Admin')).limit(1);
    if (!adminRole) {
      [adminRole] = await db.insert(schema.roles).values({ name: 'Admin' }).returning();
    }
    let [readerRole] = await db.select().from(schema.roles).where(eq(schema.roles.name, 'Receptionist')).limit(1);
    if (!readerRole) {
      [readerRole] = await db.insert(schema.roles).values({ name: 'Receptionist' }).returning();
    }

    await db.insert(schema.users).values({ id: userId, name: 'PDLQ Admin', email, passwordHash, isActive: true });
    await db.insert(schema.userRoles).values({ userId, roleId: adminRole.id });
    await db.insert(schema.users).values({ id: readerId, name: 'PDLQ Reader', email: readerEmail, passwordHash, isActive: true });
    await db.insert(schema.userRoles).values({ userId: readerId, roleId: readerRole.id });

    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
    expect(login.statusCode).toBe(200);
    adminToken = (login.json() as { token: string }).token;

    const readerLogin = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: readerEmail, password } });
    expect(readerLogin.statusCode).toBe(200);
    readerToken = (readerLogin.json() as { token: string }).token;
  });

  afterAll(async () => {
    await persistentDeadLetterStore.deleteByEventPrefix(prefix);
    for (const uid of [userId, readerId]) {
      await db.delete(schema.auditLogs).where(eq(schema.auditLogs.userId, uid));
      await db.delete(schema.sessions).where(eq(schema.sessions.userId, uid));
      await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, uid));
      await db.delete(schema.users).where(eq(schema.users.id, uid));
    }
    await app.close();
  });

  function envelope(eventId: string) {
    return {
      event_id: eventId,
      event_type: 'message.persisted',
      aggregate_type: 'Message',
      aggregate_id: randomUUID(),
      occurred_at: new Date().toISOString(),
      payload: { messageId: 'm-1' },
      version: 1 as const,
    };
  }

  it('401 sem token e 403 sem admin (negativos)', async () => {
    const anon = await app.inject({ method: 'GET', url: '/dead-letter' });
    expect(anon.statusCode).toBe(401);

    // Receptionist não tem admin:read → 403 na listagem.
    const forbidden = await app.inject({
      method: 'GET',
      url: '/dead-letter',
      headers: { authorization: `Bearer ${readerToken}` },
    });
    expect(forbidden.statusCode).toBe(403);

    // Receptionist não tem admin:write → 403 no replay.
    const forbiddenReplay = await app.inject({
      method: 'POST',
      url: `/dead-letter/${randomUUID()}/replay`,
      headers: { authorization: `Bearer ${readerToken}` },
    });
    expect(forbiddenReplay.statusCode).toBe(403);
  });

  it('lista, inspeciona, replay, resolve e discard com audit', async () => {
    const headers = { authorization: `Bearer ${adminToken}` };

    const { entry } = await persistentDeadLetterStore.persist({
      originalEventId: `${prefix}.flow`,
      consumerId: 'worker',
      eventType: 'message.persisted',
      payload: envelope(`${prefix}.flow`),
      errorMessage: 'handler exploded',
      attemptCount: 3,
    });

    const list = await app.inject({ method: 'GET', url: '/dead-letter?status=PENDING&limit=100', headers });
    expect(list.statusCode).toBe(200);
    const listBody = list.json() as { data: { id: string }[]; stats: unknown };
    expect(listBody.data.map((d) => d.id)).toContain(entry.id);
    expect(listBody.stats).toBeDefined();

    const get = await app.inject({ method: 'GET', url: `/dead-letter/${entry.id}`, headers });
    expect(get.statusCode).toBe(200);
    expect((get.json() as { originalEventId: string }).originalEventId).toBe(`${prefix}.flow`);

    const replay = await app.inject({ method: 'POST', url: `/dead-letter/${entry.id}/replay`, headers });
    expect(replay.statusCode).toBe(200);
    expect((replay.json() as { replayed: boolean }).replayed).toBe(true);

    // Replay duplicado: entrada já RESOLVED → 409.
    const replayAgain = await app.inject({ method: 'POST', url: `/dead-letter/${entry.id}/replay`, headers });
    expect(replayAgain.statusCode).toBe(409);

    // Evento republicado existe no outbox com causation para o original.
    const republished = await db
      .select()
      .from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.eventId, `${prefix}.flow-replay-1`));
    expect(republished).toHaveLength(1);

    // Audit de replay registrado.
    const audit = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, 'dlq.replay'));
    expect(audit.length).toBeGreaterThanOrEqual(1);

    // Resolve em outra entrada + discard.
    const { entry: e2 } = await persistentDeadLetterStore.persist({
      originalEventId: `${prefix}.flow2`,
      consumerId: 'worker',
      eventType: 'message.persisted',
      payload: envelope(`${prefix}.flow2`),
    });
    const resolve = await app.inject({
      method: 'POST',
      url: `/dead-letter/${e2.id}/resolve`,
      headers,
      payload: { reason: 'fixed by hand' },
    });
    expect(resolve.statusCode).toBe(200);

    const { entry: e3 } = await persistentDeadLetterStore.persist({
      originalEventId: `${prefix}.flow3`,
      consumerId: 'worker',
      eventType: 'message.persisted',
      payload: envelope(`${prefix}.flow3`),
    });
    const discard = await app.inject({
      method: 'POST',
      url: `/dead-letter/${e3.id}/discard`,
      headers,
      payload: { reason: 'poison' },
    });
    expect(discard.statusCode).toBe(200);
    expect((discard.json() as { entry: { status: string } }).entry.status).toBe('DISCARDED');

    // Limpa o evento republicado para não poluir o outbox.
    await db.delete(schema.outboxEvents).where(eq(schema.outboxEvents.eventId, `${prefix}.flow-replay-1`));
  });

  it('batch replay processa múltiplas entradas e audita', async () => {
    const headers = { authorization: `Bearer ${adminToken}` };
    for (const suffix of ['b1', 'b2']) {
      await persistentDeadLetterStore.persist({
        originalEventId: `${prefix}.${suffix}`,
        consumerId: 'worker-batch',
        eventType: 'message.persisted',
        payload: envelope(`${prefix}.${suffix}`),
      });
    }

    const batch = await app.inject({
      method: 'POST',
      url: '/dead-letter/replay-batch',
      headers,
      payload: { consumerId: 'worker-batch', limit: 10 },
    });
    expect(batch.statusCode).toBe(200);
    const body = batch.json() as { results: { id: string; ok: boolean }[] };
    expect(body.results).toHaveLength(2);
    expect(body.results.every((r) => r.ok)).toBe(true);

    for (const suffix of ['b1', 'b2']) {
      await db.delete(schema.outboxEvents).where(eq(schema.outboxEvents.eventId, `${prefix}.${suffix}-replay-1`));
    }
  });

  it('payload corrompido retorna 422 sem perder a entrada', async () => {
    const headers = { authorization: `Bearer ${adminToken}` };
    // Insere payload não-envelope diretamente.
    const [row] = await db
      .insert(schema.deadLetterEvents)
      .values({
        originalEventId: `${prefix}.corrupt`,
        consumerId: 'worker',
        eventType: 'message.persisted',
        payload: { _raw: 'garbage' },
      })
      .returning();

    const replay = await app.inject({ method: 'POST', url: `/dead-letter/${row.id}/replay`, headers });
    expect(replay.statusCode).toBe(422);

    const back = await persistentDeadLetterStore.getById(row.id);
    expect(back?.status).toBe('PENDING');
  });

  it('404 para id inexistente', async () => {
    const headers = { authorization: `Bearer ${adminToken}` };
    const response = await app.inject({ method: 'GET', url: `/dead-letter/${randomUUID()}`, headers });
    expect(response.statusCode).toBe(404);
  });
});
