import './integration-mocks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { buildDeskApiApp } from '../app.ts';

/**
 * SA-008 / A06 / C04 — consulta contextual autorizada e paginada.
 *
 * Fixture: conversa A (acessível), conversa B (de outro setor), registros sem
 * vínculo. Prova no caminho HTTP real:
 *  - /tasks?conversationId=A, /alerts?conversationId=A e /notes?conversationId=A
 *    retornam SOMENTE os recursos de A;
 *  - conversa inacessível responde 404 sem vazar título/conteúdo;
 *  - UUID inválido responde 400 (validação de schema);
 *  - remover o filtro (sem query) volta à lista normal autorizada.
 */

const password = 'KanbanRoutePass!42';
const passwordHash = '$2a$10$kOS6WENS2HZ/vSU96GD62O6aJbj.nc/B5O6Ctp/ecRh1mV5a8BCCO';
const suffix = Date.now().toString().slice(-6);

const userId = randomUUID();
const roleId = randomUUID();
const sectorAId = randomUUID();
const sectorBId = randomUUID();
const conversationAId = randomUUID();
const conversationBId = randomUUID();
const unlinkedConversationId = randomUUID();
const userEmail = `sa008.user.${suffix}@example.com`;

const taskAId = randomUUID();
const taskBId = randomUUID();
const taskUnlinkedId = randomUUID();
const alertAId = randomUUID();
const alertBId = randomUUID();

let app: Awaited<ReturnType<typeof buildDeskApiApp>>;
let token = '';

async function grantRolePermission(name: string): Promise<void> {
  let [permission] = await db.select().from(schema.permissions).where(eq(schema.permissions.name, name)).limit(1);
  if (!permission) {
    [permission] = await db.insert(schema.permissions).values({ name }).returning();
  }
  await db.insert(schema.rolePermissions).values({ roleId, permissionId: permission.id }).onConflictDoNothing();
}

describe('SA-008 — contexto de conversa no servidor (C04)', () => {
  beforeAll(async () => {
    app = await buildDeskApiApp();
    await app.ready();

    await db.insert(schema.roles).values({ id: roleId, name: `SA008 Role ${suffix}` });
    await db.insert(schema.users).values({ id: userId, name: 'SA008 User', email: userEmail, passwordHash, isActive: true });
    await db.insert(schema.userRoles).values({ userId, roleId });
    for (const permission of ['chat:read', 'tasks:read', 'tasks:write', 'alerts:read', 'notes:read', 'notes:write']) {
      await grantRolePermission(permission);
    }
    await db.insert(schema.sectors).values({ id: sectorAId, name: `SA008 A ${suffix}`, code: `sa008a-${suffix}` });
    await db.insert(schema.sectors).values({ id: sectorBId, name: `SA008 B ${suffix}`, code: `sa008b-${suffix}` });
    await db.insert(schema.userSectors).values({ userId, sectorId: sectorAId, accessLevel: 'write' });

    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: userEmail, password } });
    expect(login.statusCode).toBe(200);
    token = (login.json() as { token: string }).token;

    await db.insert(schema.conversations).values([
      { id: conversationAId, status: 'open', statusV2: 'novo', currentHandler: 'bot', isActive: true, sectorId: sectorAId, assignedUserId: userId },
      { id: conversationBId, status: 'open', statusV2: 'novo', currentHandler: 'bot', isActive: true, sectorId: sectorBId },
      { id: unlinkedConversationId, status: 'open', statusV2: 'novo', currentHandler: 'bot', isActive: true, sectorId: sectorAId },
    ]);
    await db.insert(schema.tasks).values([
      { id: taskAId, title: 'SA008 Tarefa A', status: 'pending', priority: 'high', conversationId: conversationAId, createdBy: userId },
      { id: taskBId, title: 'SA008 Tarefa B', status: 'pending', priority: 'high', conversationId: conversationBId, createdBy: userId },
      { id: taskUnlinkedId, title: 'SA008 Tarefa sem vínculo', status: 'pending', priority: 'low', createdBy: userId },
    ]);
    await db.insert(schema.alerts).values([
      { id: alertAId, title: 'SA008 Alerta A', severity: 'warning', type: 'message', status: 'active', conversationId: conversationAId },
      { id: alertBId, title: 'SA008 Alerta B', severity: 'warning', type: 'message', status: 'active', conversationId: conversationBId },
    ]);
    await db.insert(schema.internalNotes).values([
      { referenceType: 'conversation', referenceId: conversationAId, conversationId: conversationAId, authorId: userId, content: 'SA008 nota A' },
      { referenceType: 'conversation', referenceId: conversationBId, conversationId: conversationBId, authorId: userId, content: 'SA008 nota B' },
    ]);
  });

  afterAll(async () => {
    await db.delete(schema.internalNotes).where(eq(schema.internalNotes.authorId, userId));
    await db.delete(schema.alerts).where(eq(schema.alerts.conversationId, conversationAId));
    await db.delete(schema.alerts).where(eq(schema.alerts.conversationId, conversationBId));
    await db.delete(schema.tasks).where(eq(schema.tasks.createdBy, userId));
    for (const id of [conversationAId, conversationBId, unlinkedConversationId]) {
      await db.delete(schema.outboxEvents).where(eq(schema.outboxEvents.aggregateId, id));
      await db.delete(schema.conversations).where(eq(schema.conversations.id, id));
    }
    await db.delete(schema.userSectors).where(eq(schema.userSectors.userId, userId));
    await db.delete(schema.sectors).where(eq(schema.sectors.id, sectorAId));
    await db.delete(schema.sectors).where(eq(schema.sectors.id, sectorBId));
    await db.delete(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, roleId));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, userId));
    await db.delete(schema.auditLogs).where(eq(schema.auditLogs.userId, userId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    await db.delete(schema.roles).where(eq(schema.roles.id, roleId));
    await app.close();
  });

  it('GET /tasks?conversationId=A retorna somente tarefas de A', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/tasks?conversationId=${conversationAId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    const tasks = response.json() as Array<{ id: string; title: string }>;
    expect(tasks.map((task) => task.id)).toEqual([taskAId]);
    expect(JSON.stringify(tasks)).not.toContain('Tarefa B');
    expect(JSON.stringify(tasks)).not.toContain('sem vínculo');
  });

  it('GET /tasks sem filtro não inclui a conversa de outro setor', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/tasks',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    const tasks = response.json() as Array<{ id: string }>;
    const ids = tasks.map((task) => task.id);
    expect(ids).toContain(taskAId);
    expect(ids).not.toContain(taskBId);
  });

  it('GET /tasks?conversationId=B responde 404 sem vazar a tarefa', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/tasks?conversationId=${conversationBId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(404);
    expect(JSON.stringify(response.json())).not.toContain('Tarefa B');
  });

  it('GET /alerts?conversationId=A retorna somente alertas de A; B responde 404', async () => {
    const allowed = await app.inject({
      method: 'GET',
      url: `/alerts?conversationId=${conversationAId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(allowed.statusCode).toBe(200);
    const alerts = allowed.json() as Array<{ id: string }>;
    expect(alerts.map((alert) => alert.id)).toEqual([alertAId]);

    const denied = await app.inject({
      method: 'GET',
      url: `/alerts?conversationId=${conversationBId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(denied.statusCode).toBe(404);
    expect(JSON.stringify(denied.json())).not.toContain('Alerta B');
  });

  it('GET /notes?conversationId=A retorna somente notas de A', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/notes?conversationId=${conversationAId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    const notes = response.json() as Array<{ conversationId: string; content: string }>;
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.every((note) => note.conversationId === conversationAId)).toBe(true);
    expect(JSON.stringify(notes)).not.toContain('SA008 nota B');
  });

  it('contexto com UUID inválido responde 400 em tasks e alerts', async () => {
    const tasks = await app.inject({
      method: 'GET',
      url: '/tasks?conversationId=nao-e-uuid',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(tasks.statusCode).toBe(400);

    const alerts = await app.inject({
      method: 'GET',
      url: '/alerts?conversationId=nao-e-uuid',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(alerts.statusCode).toBe(400);
  });

  it('paginação contextual é aplicada (limit/offset)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/tasks?conversationId=${conversationAId}&limit=1&offset=0`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    const tasks = response.json() as Array<{ id: string }>;
    expect(tasks.length).toBe(1);
    expect(tasks[0].id).toBe(taskAId);
  });
});
