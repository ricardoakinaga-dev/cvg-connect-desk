import './integration-mocks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { scanSlaAlerts, SLA_RULES, SLA_WINDOW_MS } from '@cvg/alerts';
import { buildDeskApiApp } from '../app.ts';

/**
 * SA-017 / C01 — alertas automáticos idempotentes e corrida ack/resolve.
 *
 * Prova:
 *  - regras congeladas (sem responsável, sem resposta, tarefa vencida) geram
 *    alertas com vínculo; repetir a varredura na MESMA janela não duplica;
 *  - resolver e avançar uma janela gera novo alerta (comportamento explícito);
 *  - ack/resolve concorrentes: um vence, o outro 409, e o histórico/auditoria
 *    registram o estado ANTERIOR correto (linha travada), sem trilha enganosa;
 *  - ack de alerta resolvido → 409; alerta inexistente → 404.
 */

const password = 'KanbanRoutePass!42';
const passwordHash = '$2a$10$kOS6WENS2HZ/vSU96GD62O6aJbj.nc/B5O6Ctp/ecRh1mV5a8BCCO';
const suffix = Date.now().toString().slice(-6);

const userId = randomUUID();
const roleId = randomUUID();
const sectorId = randomUUID();
const unassignedConvId = randomUUID();
const unansweredConvId = randomUUID();
const healthyConvId = randomUUID();
const overdueTaskId = randomUUID();
const futureTaskId = randomUUID();
const userEmail = `sa017.user.${suffix}@example.com`;
let app: Awaited<ReturnType<typeof buildDeskApiApp>>;
let token = '';

async function grantRolePermission(name: string): Promise<void> {
  let [permission] = await db.select().from(schema.permissions).where(eq(schema.permissions.name, name)).limit(1);
  if (!permission) {
    [permission] = await db.insert(schema.permissions).values({ name }).returning();
  }
  await db.insert(schema.rolePermissions).values({ roleId, permissionId: permission.id }).onConflictDoNothing();
}

describe('SA-017 — alertas automáticos e corrida ack/resolve', () => {
  beforeAll(async () => {
    app = await buildDeskApiApp();
    await app.ready();

    await db.insert(schema.roles).values({ id: roleId, name: `SA017 Role ${suffix}` });
    await db.insert(schema.users).values({ id: userId, name: 'SA017 User', email: userEmail, passwordHash, isActive: true });
    await db.insert(schema.userRoles).values({ userId, roleId });
    await db.insert(schema.sectors).values({ id: sectorId, name: `SA017 Setor ${suffix}`, code: `sa017-${suffix}` });
    await db.insert(schema.userSectors).values({ userId, sectorId, accessLevel: 'write' });
    for (const permission of ['alerts:read', 'alerts:write']) {
      await grantRolePermission(permission);
    }
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: userEmail, password } });
    expect(login.statusCode).toBe(200);
    token = (login.json() as { token: string }).token;

    const now = Date.now();
    await db.insert(schema.conversations).values([
      { id: unassignedConvId, status: 'open', statusV2: 'novo', currentHandler: 'bot', isActive: true, sectorId, createdAt: new Date(now - SLA_RULES.UNASSIGNED_CONVERSATION_MS - 60_000) },
      { id: unansweredConvId, status: 'open', statusV2: 'novo', currentHandler: 'bot', isActive: true, sectorId, assignedUserId: userId },
      { id: healthyConvId, status: 'open', statusV2: 'novo', currentHandler: 'bot', isActive: true, sectorId, assignedUserId: userId },
    ]);
    await db.insert(schema.messages).values([
      { conversationId: unansweredConvId, direction: 'inbound', content: 'sem resposta', createdAt: new Date(now - SLA_RULES.UNANSWERED_CONVERSATION_MS - 60_000) },
      { conversationId: healthyConvId, direction: 'inbound', content: 'respondida', createdAt: new Date(now - SLA_RULES.UNANSWERED_CONVERSATION_MS - 60_000) },
      { conversationId: healthyConvId, direction: 'outbound', content: 'resposta ok', createdAt: new Date(now - 60_000) },
    ]);
    await db.insert(schema.tasks).values([
      { id: overdueTaskId, title: 'SA017 vencida', status: 'pending', dueAt: new Date(now - 120_000), createdBy: userId },
      { id: futureTaskId, title: 'SA017 futura', status: 'pending', dueAt: new Date(now + 3_600_000), createdBy: userId },
    ]);
  });

  afterAll(async () => {
    const alerts = await db.select({ id: schema.alerts.id }).from(schema.alerts)
      .where(inArray(schema.alerts.conversationId, [unassignedConvId, unansweredConvId, healthyConvId]));
    const taskAlerts = await db.select({ id: schema.alerts.id }).from(schema.alerts).where(eq(schema.alerts.taskId, overdueTaskId));
    const alertIds = [...alerts, ...taskAlerts].map((row) => row.id);
    if (alertIds.length > 0) {
      await db.delete(schema.alertEvents).where(inArray(schema.alertEvents.alertId, alertIds));
      await db.delete(schema.auditLogs).where(inArray(schema.auditLogs.entityId, alertIds));
      await db.delete(schema.outboxEvents).where(inArray(schema.outboxEvents.aggregateId, alertIds));
      await db.delete(schema.workerEffectReceipts).where(eq(schema.workerEffectReceipts.consumerId, 'sla-scanner'));
      await db.delete(schema.alerts).where(inArray(schema.alerts.id, alertIds));
    }
    await db.delete(schema.messages).where(inArray(schema.messages.conversationId, [unassignedConvId, unansweredConvId, healthyConvId]));
    await db.delete(schema.conversations).where(inArray(schema.conversations.id, [unassignedConvId, unansweredConvId, healthyConvId]));
    await db.delete(schema.tasks).where(inArray(schema.tasks.id, [overdueTaskId, futureTaskId]));
    await db.delete(schema.userSectors).where(eq(schema.userSectors.userId, userId));
    await db.delete(schema.sectors).where(eq(schema.sectors.id, sectorId));
    await db.delete(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, roleId));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, userId));
    await db.delete(schema.auditLogs).where(eq(schema.auditLogs.userId, userId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    await db.delete(schema.roles).where(eq(schema.roles.id, roleId));
    await app.close();
  });

  it('regras congeladas geram alertas com vínculo e sem falso positivo', async () => {
    const scanned = await scanSlaAlerts({ now: new Date() });
    expect(scanned.isOk()).toBe(true);
    if (scanned.isErr()) return;
    const created = scanned.value.created.filter((entry) => !entry.deduplicated);
    const rules = created.map((entry) => entry.rule).sort();
    expect(rules).toContain('conversation.unassigned');
    expect(rules).toContain('conversation.unanswered');
    expect(rules).toContain('task.overdue');
    // Conversa com resposta recente e tarefa futura NÃO geram alerta.
    const all = await db.select().from(schema.alerts)
      .where(inArray(schema.alerts.conversationId, [unassignedConvId, unansweredConvId, healthyConvId]));
    expect(all.every((alert) => alert.conversationId !== healthyConvId)).toBe(true);
    const taskAlerts = await db.select().from(schema.alerts).where(eq(schema.alerts.taskId, futureTaskId));
    expect(taskAlerts).toHaveLength(0);

    const unansweredAlert = all.find((alert) => alert.conversationId === unansweredConvId);
    expect(unansweredAlert).toBeTruthy();
    expect(unansweredAlert?.type).toBe('message');
    expect(JSON.parse(unansweredAlert?.metadata ?? '{}')).toMatchObject({ slaRule: 'conversation.unanswered' });
  });

  it('repetir a varredura na MESMA janela não duplica alerta', async () => {
    const before = await db.select().from(schema.alerts)
      .where(inArray(schema.alerts.conversationId, [unassignedConvId, unansweredConvId]));
    const rescan = await scanSlaAlerts({ now: new Date() });
    expect(rescan.isOk()).toBe(true);
    if (rescan.isErr()) return;
    expect(rescan.value.created.every((entry) => entry.deduplicated)).toBe(true);
    const after = await db.select().from(schema.alerts)
      .where(inArray(schema.alerts.conversationId, [unassignedConvId, unansweredConvId]));
    expect(after.length).toBe(before.length);
  });

  it('resolve e próxima janela gera novo alerta (comportamento explícito)', async () => {
    const [active] = await db.select().from(schema.alerts)
      .where(and(eq(schema.alerts.conversationId, unansweredConvId), eq(schema.alerts.status, 'active')));
    expect(active).toBeTruthy();
    const resolved = await app.inject({
      method: 'POST',
      url: `/alerts/${active.id}/resolve`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect([200, 204]).toContain(resolved.statusCode);

    const nextWindow = new Date(Date.now() + SLA_WINDOW_MS + 1000);
    const rescanned = await scanSlaAlerts({ now: nextWindow });
    expect(rescanned.isOk()).toBe(true);
    if (rescanned.isErr()) return;
    const fresh = await db.select().from(schema.alerts)
      .where(and(eq(schema.alerts.conversationId, unansweredConvId), eq(schema.alerts.status, 'active')));
    expect(fresh.length).toBe(1);
    expect(fresh[0].id).not.toBe(active.id);
  });

  it('ack/resolve concorrentes: um vence, o outro 409, estado anterior correto', async () => {
    const [alert] = await db.select().from(schema.alerts)
      .where(and(eq(schema.alerts.conversationId, unassignedConvId), eq(schema.alerts.status, 'active')));
    expect(alert).toBeTruthy();

    const [ack, resolve] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/alerts/${alert.id}/acknowledge`,
        headers: { authorization: `Bearer ${token}` },
        payload: {},
      }),
      app.inject({
        method: 'POST',
        url: `/alerts/${alert.id}/resolve`,
        headers: { authorization: `Bearer ${token}` },
        payload: { expectedStatus: 'active' },
      }),
    ]);

    const statuses = [ack.statusCode, resolve.statusCode].sort();
    expect(statuses.filter((status) => status === 200).length).toBe(1);
    expect(statuses.filter((status) => status === 409).length).toBe(1);

    const [finalAlert] = await db.select().from(schema.alerts).where(eq(schema.alerts.id, alert.id));
    const events = await db.select().from(schema.alertEvents).where(eq(schema.alertEvents.alertId, alert.id));
    const audits = await db.select().from(schema.auditLogs).where(and(
      eq(schema.auditLogs.entityType, 'alert'),
      eq(schema.auditLogs.entityId, alert.id),
    ));

    // Nenhuma trilha enganosa: o evento/auditoria vencedores descrevem a
    // transição a partir de 'active' (estado travado), e existe apenas UMA
    // transição registrada.
    const transitions = events.filter((event) => event.eventType === 'acknowledged' || event.eventType === 'resolved');
    expect(transitions.length).toBe(1);
    expect(transitions[0].oldValue).toBe('active');
    const transitionAudits = audits.filter((audit) => audit.action === 'alert.acknowledged' || audit.action === 'alert.resolved');
    expect(transitionAudits.length).toBe(1);
    expect(JSON.parse(transitionAudits[0].oldValue ?? '{}')).toMatchObject({ status: 'active' });
    if (finalAlert.status === 'acknowledged') {
      expect(transitionAudits[0].action).toBe('alert.acknowledged');
    } else {
      expect(finalAlert.status).toBe('resolved');
      expect(transitionAudits[0].action).toBe('alert.resolved');
    }
  });

  it('ack de alerta resolvido → 409 e alerta inexistente → 404', async () => {
    const [resolvedAlert] = await db.select().from(schema.alerts).where(eq(schema.alerts.status, 'resolved'));
    expect(resolvedAlert).toBeTruthy();
    const conflict = await app.inject({
      method: 'POST',
      url: `/alerts/${resolvedAlert.id}/acknowledge`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(conflict.statusCode).toBe(409);

    const missing = await app.inject({
      method: 'POST',
      url: `/alerts/${randomUUID()}/acknowledge`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect([404, 400]).toContain(missing.statusCode);
  });
});
