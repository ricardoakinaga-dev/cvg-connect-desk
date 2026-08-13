import { getSessionCookie, withSessionCsrf } from './integration-mocks';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { buildDeskApiApp } from '../app.ts';
import { deadLetterStore } from '@cvg/events';

describe('Dead-letter routes integration', () => {
  const password = 'Str0ngPass!42';
  const passwordHash = '$2a$10$QMxMJ8QfVxjH93DvTDs2m.OVuALoBBR6S9d58BwIPb8rcXHsUBJWC';
  const email = `dead-letter.integration.${Date.now()}@example.com`;
  const roleName = 'Admin';
  let app: Awaited<ReturnType<typeof buildDeskApiApp>>;
  let userId = '';
  let roleId = '';
  let createdRole = false;
  let token = '';
  const replayableEventId = `dlq.replayable.${Date.now()}`;
  const manualOnlyEventId = `dlq.manual.${Date.now()}`;
  const replayableEntryId = `dlq_replayable_${Date.now()}`;
  const manualEntryId = `dlq_manual_${Date.now()}`;

  beforeAll(async () => {
    app = await buildDeskApiApp();
    await app.ready();

    const existingRole = await db
      .select()
      .from(schema.roles)
      .where(eq(schema.roles.name, roleName))
      .limit(1);

    if (existingRole.length > 0) {
      roleId = existingRole[0].id;
    } else {
      roleId = randomUUID();
      createdRole = true;
      await db.insert(schema.roles).values({
        id: roleId,
        name: roleName,
        description: 'Role with admin permissions for dead-letter tests',
      });
    }

    userId = randomUUID();
    await db.insert(schema.users).values({
      id: userId,
      name: 'Dead Letter Admin',
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

  beforeEach(async () => {
    deadLetterStore.clear();

    await db.delete(schema.outboxEvents).where(eq(schema.outboxEvents.eventId, replayableEventId));
    await db.delete(schema.outboxEvents).where(eq(schema.outboxEvents.eventId, manualOnlyEventId));

    deadLetterStore.add({
      id: replayableEntryId,
      eventType: 'message.persisted',
      eventId: replayableEventId,
      payload: { messageId: 'msg_replayable' },
      error: 'Timeout',
      retryCount: 3,
      handlerName: 'worker.processMessage',
      sourceEvent: {
        event_id: replayableEventId,
        event_type: 'message.persisted',
        aggregate_type: 'Message',
        aggregate_id: 'msg_replayable',
        occurred_at: '2026-04-10T12:00:00.000Z',
        payload: { messageId: 'msg_replayable' },
        version: 1,
      },
    });

    deadLetterStore.add({
      id: manualEntryId,
      eventType: 'task.created',
      eventId: manualOnlyEventId,
      payload: { taskId: 'task_manual' },
      error: 'Persistent failure',
      retryCount: 5,
      handlerName: 'worker.processTask',
    });
  });

  afterAll(async () => {
    deadLetterStore.clear();
    await db.delete(schema.outboxEvents).where(eq(schema.outboxEvents.eventId, replayableEventId));
    await db.delete(schema.outboxEvents).where(eq(schema.outboxEvents.eventId, manualOnlyEventId));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, userId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));

    if (createdRole && roleId) {
      await db.delete(schema.roles).where(eq(schema.roles.id, roleId));
    }

    await app.close();
  });

  it('lists dead-letter entries for admin users', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/admin/dead-letters?limit=10',
      headers: withSessionCsrf(token),
    });

    expect(response.statusCode).toBe(200);

    const body = response.json() as {
      data: Array<{ id: string; eventId: string; eventType: string; resolved: boolean }>;
      stats: { total: number; unresolved: number; resolved: number };
    };

    expect(body.data.map((entry) => entry.eventId)).toEqual(
      expect.arrayContaining([replayableEventId, manualOnlyEventId]),
    );
    expect(body.stats.total).toBe(2);
    expect(body.stats.unresolved).toBe(2);
    expect(body.stats.resolved).toBe(0);
  });

  it('exposes operational dead-letter stats for triage', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/admin/dead-letters/stats',
      headers: withSessionCsrf(token),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      total: 2,
      unresolved: 2,
      resolved: 0,
      replayable: 1,
      manualOnly: 1,
      byHandler: expect.arrayContaining([
        expect.objectContaining({
          handlerName: 'worker.processMessage',
          total: 1,
          replayable: 1,
        }),
        expect.objectContaining({
          handlerName: 'worker.processTask',
          total: 1,
          manualOnly: 1,
        }),
      ]),
      byReason: expect.arrayContaining([
        expect.objectContaining({
          reason: 'Timeout',
          total: 1,
        }),
        expect.objectContaining({
          reason: 'Persistent failure',
          total: 1,
        }),
      ]),
    });
  });

  it('retries replayable dead-letter entries by republishing to the outbox', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/admin/dead-letters/${replayableEntryId}/retry`,
      headers: withSessionCsrf(token),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      replayed: true,
    });

    expect(deadLetterStore.getById(replayableEntryId)?.resolved).toBe(true);

    const outboxRows = await db
      .select()
      .from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.eventId, replayableEventId))
      .limit(1);

    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]).toMatchObject({
      eventId: replayableEventId,
      eventType: 'message.persisted',
    });
  });

  it('marks manual-only dead-letter entries as resolved', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/admin/dead-letters/${manualEntryId}/resolve`,
      headers: withSessionCsrf(token),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      replayed: false,
    });

    expect(deadLetterStore.getById(manualEntryId)?.resolved).toBe(true);
  });
});
