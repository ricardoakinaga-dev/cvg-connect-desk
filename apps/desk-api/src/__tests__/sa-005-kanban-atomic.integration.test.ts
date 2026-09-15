import './integration-mocks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { buildDeskApiApp } from '../app.ts';

/**
 * SA-005 / A02 / A03 — movimento Kanban transacional e reabertura coerente.
 *
 * Reproduz a lacuna da auditoria (finalizado→em_atendimento mantinha
 * isActive=false/closedAt) e prova:
 *  - reabertura restaura status/atividade/fechamento e grava histórico+audit+outbox;
 *  - falha no último passo reverte TODAS as escritas (nada parcial);
 *  - CAS por versão responde 409 sem sobrescrever;
 *  - repetição idempotente não gera histórico/evento duplicado;
 *  - responsável só muda quando enviado explicitamente;
 *  - negativos de autorização permanecem.
 */

const password = 'KanbanRoutePass!42';
const passwordHash = '$2a$10$kOS6WENS2HZ/vSU96GD62O6aJbj.nc/B5O6Ctp/ecRh1mV5a8BCCO';
const suffix = Date.now().toString().slice(-6);

const userId = randomUUID();
const outsiderId = randomUUID();
const roleId = randomUUID();
const roleName = `SA005 Kanban ${suffix}`;
const userEmail = `sa005.kanban.${suffix}@example.com`;
const outsiderEmail = `sa005.outsider.${suffix}@example.com`;
const conversationId = randomUUID();
let app: Awaited<ReturnType<typeof buildDeskApiApp>>;
let token = '';
let outsiderToken = '';

async function grantRolePermission(name: string): Promise<void> {
  let [permission] = await db.select().from(schema.permissions).where(eq(schema.permissions.name, name)).limit(1);
  if (!permission) {
    [permission] = await db.insert(schema.permissions).values({ name }).returning();
  }
  await db.insert(schema.rolePermissions).values({ roleId, permissionId: permission.id }).onConflictDoNothing();
}

async function login(email: string): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
  expect(response.statusCode).toBe(200);
  return (response.json() as { token: string }).token;
}

async function currentConversation() {
  const [row] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, conversationId));
  return row;
}

async function seedFinalized(assignedUserId: string | null = null) {
  const closedAt = new Date(Date.now() - 60_000);
  await db.update(schema.conversations).set({
    status: 'closed',
    statusV2: 'finalizado',
    isActive: false,
    closedAt,
    assignedUserId,
    updatedAt: new Date(Date.now() - 30_000),
  }).where(eq(schema.conversations.id, conversationId));
}

function countHistory() {
  return db.select().from(schema.conversationStatusHistory)
    .where(eq(schema.conversationStatusHistory.conversationId, conversationId));
}

function countAudit() {
  return db.select().from(schema.auditLogs)
    .where(and(
      eq(schema.auditLogs.entityType, 'conversation'),
      eq(schema.auditLogs.entityId, conversationId),
      eq(schema.auditLogs.action, 'conversation.kanban.moved'),
    ));
}

describe('SA-005 — Kanban atômico e reabertura (A02/A03)', () => {
  beforeAll(async () => {
    app = await buildDeskApiApp();
    await app.ready();

    await db.insert(schema.roles).values({ id: roleId, name: roleName, description: 'SA-005 kanban' });
    await db.insert(schema.users).values({ id: userId, name: 'SA005 Operador', email: userEmail, passwordHash, isActive: true });
    await db.insert(schema.users).values({ id: outsiderId, name: 'SA005 Outsider', email: outsiderEmail, passwordHash, isActive: true });
    await db.insert(schema.userRoles).values({ userId, roleId });
    await grantRolePermission('chat:read');
    await grantRolePermission('chat:write');
    token = await login(userEmail);
    outsiderToken = await login(outsiderEmail);

    await db.insert(schema.conversations).values({
      id: conversationId,
      status: 'open',
      statusV2: 'novo',
      currentHandler: 'bot',
      isActive: true,
      assignedUserId: userId,
    });
  });

  afterAll(async () => {
    await db.delete(schema.outboxEvents).where(eq(schema.outboxEvents.aggregateId, conversationId));
    await db.delete(schema.conversationStatusHistory).where(eq(schema.conversationStatusHistory.conversationId, conversationId));
    await db.delete(schema.conversationAssignments).where(eq(schema.conversationAssignments.conversationId, conversationId));
    await db.delete(schema.conversations).where(eq(schema.conversations.id, conversationId));
    await db.delete(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, roleId));
    for (const id of [userId, outsiderId]) {
      await db.delete(schema.sessions).where(eq(schema.sessions.userId, id));
      await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, id));
      await db.delete(schema.auditLogs).where(eq(schema.auditLogs.userId, id));
      await db.delete(schema.users).where(eq(schema.users.id, id));
    }
    await db.delete(schema.roles).where(eq(schema.roles.id, roleId));
    await app.close();
  });

  it('reabre conversa finalizada com status/atividade/fechamento coerentes e trilha completa', async () => {
    await seedFinalized(userId);
    const historyBefore = await countHistory();

    const response = await app.inject({
      method: 'PATCH',
      url: `/kanban/card/${conversationId}/move`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'em_atendimento' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      statusV2: 'em_atendimento',
      isActive: true,
      closedAt: null,
    });

    const conversation = await currentConversation();
    expect(conversation.statusV2).toBe('em_atendimento');
    expect(conversation.status).toBe('open');
    expect(conversation.isActive).toBe(true);
    expect(conversation.closedAt).toBeNull();
    // Responsável preservado: não foi enviado, não muda.
    expect(conversation.assignedUserId).toBe(userId);

    const history = await countHistory();
    expect(history.length).toBe(historyBefore.length + 1);
    expect(history.at(-1)?.status).toBe('open');

    const audit = await countAudit();
    expect(audit.length).toBeGreaterThanOrEqual(1);

    const outbox = await db.select().from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.aggregateId, conversationId));
    expect(outbox.some((event) => event.eventType === 'conversation.status.changed')).toBe(true);
  });

  it('falha tardia reverte tudo: destino inválido não deixa status/setor/responsável parciais', async () => {
    await seedFinalized(userId);
    const before = await currentConversation();
    const historyBefore = await countHistory();

    const response = await app.inject({
      method: 'PATCH',
      url: `/kanban/card/${conversationId}/move`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'em_atendimento', assignedUserId: randomUUID() },
    });

    expect([400, 404]).toContain(response.statusCode);
    const after = await currentConversation();
    expect(after.statusV2).toBe(before.statusV2);
    expect(after.status).toBe(before.status);
    expect(after.isActive).toBe(before.isActive);
    expect(after.closedAt?.getTime()).toBe(before.closedAt?.getTime());
    expect(after.assignedUserId).toBe(before.assignedUserId);
    expect((await countHistory()).length).toBe(historyBefore.length);
  });

  it('falha na ÚLTIMA escrita (auditoria) reverte conversa, histórico, atribuição e outbox', async () => {
    // Diferente do caso de validação (que falha antes de escrever), aqui todas
    // as escritas de entidade/histórico/outbox são executadas e a auditoria —
    // última escrita do commit — é forçada a falhar. Nada pode persistir.
    await seedFinalized(userId);
    const before = await currentConversation();
    const historyBefore = (await countHistory()).length;
    const outboxBefore = (await db.select().from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.aggregateId, conversationId))).length;
    const assignmentsBefore = (await db.select().from(schema.conversationAssignments)
      .where(eq(schema.conversationAssignments.conversationId, conversationId))).length;

    await db.execute(sql`
      CREATE OR REPLACE FUNCTION sa005_fail_audit() RETURNS trigger AS $$
      BEGIN
        IF NEW.action = 'conversation.kanban.moved' THEN
          RAISE EXCEPTION 'sa005 forced last-write failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await db.execute(sql`DROP TRIGGER IF EXISTS sa005_audit_guard ON audit_logs`);
    await db.execute(sql`CREATE TRIGGER sa005_audit_guard BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION sa005_fail_audit()`);

    try {
      // Envia também novo responsável: a escrita de atribuição participa do
      // commit e precisa ser revertida junto com o restante.
      const response = await app.inject({
        method: 'PATCH',
        url: `/kanban/card/${conversationId}/move`,
        headers: { authorization: `Bearer ${token}` },
        payload: { status: 'em_atendimento', assignedUserId: outsiderId },
      });
      expect(response.statusCode).toBe(500);

      const after = await currentConversation();
      expect(after.statusV2).toBe(before.statusV2);
      expect(after.status).toBe(before.status);
      expect(after.isActive).toBe(before.isActive);
      expect(after.closedAt?.getTime()).toBe(before.closedAt?.getTime());
      expect(after.assignedUserId).toBe(before.assignedUserId);
      expect((await countHistory()).length).toBe(historyBefore);
      expect((await db.select().from(schema.outboxEvents)
        .where(eq(schema.outboxEvents.aggregateId, conversationId))).length).toBe(outboxBefore);
      expect((await db.select().from(schema.conversationAssignments)
        .where(eq(schema.conversationAssignments.conversationId, conversationId))).length).toBe(assignmentsBefore);
    } finally {
      await db.execute(sql`DROP TRIGGER IF EXISTS sa005_audit_guard ON audit_logs`);
      await db.execute(sql`DROP FUNCTION IF EXISTS sa005_fail_audit()`);
    }
  });

  it('CAS por versão: updatedAt divergente responde 409 e não altera nada', async () => {
    await seedFinalized(userId);
    const before = await currentConversation();
    const staleVersion = new Date(Date.now() - 3_600_000).toISOString();

    const response = await app.inject({
      method: 'PATCH',
      url: `/kanban/card/${conversationId}/move`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'em_atendimento', expectedUpdatedAt: staleVersion },
    });

    expect(response.statusCode).toBe(409);
    const after = await currentConversation();
    expect(after.statusV2).toBe(before.statusV2);
    expect(after.isActive).toBe(false);
  });

  it('repetição idempotente não duplica histórico nem evento', async () => {
    await seedFinalized(userId);
    const first = await app.inject({
      method: 'PATCH',
      url: `/kanban/card/${conversationId}/move`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'em_atendimento' },
    });
    expect(first.statusCode).toBe(200);
    const historyAfterFirst = (await countHistory()).length;
    const outboxAfterFirst = (await db.select().from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.aggregateId, conversationId))).length;

    const second = await app.inject({
      method: 'PATCH',
      url: `/kanban/card/${conversationId}/move`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'em_atendimento' },
    });
    expect(second.statusCode).toBe(200);
    expect((second.json() as { deduplicated: boolean }).deduplicated).toBe(true);
    expect((await countHistory()).length).toBe(historyAfterFirst);
    expect((await db.select().from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.aggregateId, conversationId))).length).toBe(outboxAfterFirst);
  });

  it('responsável só muda por ação explícita e respeita o CAS do responsável', async () => {
    await db.update(schema.conversations).set({
      status: 'open', statusV2: 'em_atendimento', isActive: true, closedAt: null,
      assignedUserId: userId, updatedAt: new Date(),
    }).where(eq(schema.conversations.id, conversationId));

    // Sem `assignedUserId` explícito, o responsável atual é preservado.
    const moved = await app.inject({
      method: 'PATCH',
      url: `/kanban/card/${conversationId}/move`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'pendente' },
    });
    expect(moved.statusCode).toBe(200);
    const [afterMove] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, conversationId));
    expect(afterMove.statusV2).toBe('pendente');
    expect(afterMove.assignedUserId).toBe(userId);

    // CAS do responsável: expectativa divergente ⇒ 409 sem sobrescrever.
    await db.update(schema.conversations)
      .set({ updatedAt: new Date() })
      .where(eq(schema.conversations.id, conversationId));
    const conflict = await app.inject({
      method: 'PATCH',
      url: `/kanban/card/${conversationId}/move`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'em_atendimento', assignedUserId: outsiderId, expectedAssignedUserId: randomUUID() },
    });
    expect(conflict.statusCode).toBe(409);
    expect((conflict.json() as { error: string }).error).toBe('CONVERSATION_ASSIGNMENT_CONFLICT');

    const [after] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, conversationId));
    expect(after.assignedUserId).toBe(userId);
    expect(after.statusV2).toBe('pendente');
  });

  it('negativo: ator sem vínculo recebe 404/403 e a conversa permanece', async () => {
    await seedFinalized(null);
    const response = await app.inject({
      method: 'PATCH',
      url: `/kanban/card/${conversationId}/move`,
      headers: { authorization: `Bearer ${outsiderToken}` },
      payload: { status: 'em_atendimento' },
    });
    expect([403, 404]).toContain(response.statusCode);
    const after = await currentConversation();
    expect(after.statusV2).toBe('finalizado');
    expect(after.isActive).toBe(false);
  });
});
