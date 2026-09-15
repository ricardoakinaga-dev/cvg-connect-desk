import './integration-mocks';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { buildDeskApiApp } from '../app.ts';

/**
 * PROD-04/AC3 — papel CUSTOMIZADO só age com permissão no banco:
 * a mesma operação passa com `role_permissions` gravado e volta a negar
 * quando a permissão é removida (a edição altera a decisão na hora).
 */
describe('Kanban routes integration', () => {
  const password = 'KanbanRoutePass!42';
  const passwordHash = '$2a$10$kOS6WENS2HZ/vSU96GD62O6aJbj.nc/B5O6Ctp/ecRh1mV5a8BCCO';
  const email = `kanban.integration.${Date.now()}@example.com`;
  const roleName = `Kanban Integration ${Date.now()}`;
  const userId = randomUUID();
  const roleId = randomUUID();
  const conversationId = randomUUID();
  let app: Awaited<ReturnType<typeof buildDeskApiApp>>;
  let token = '';

  async function permissionIdByName(name: string): Promise<string> {
    const [existing] = await db
      .select()
      .from(schema.permissions)
      .where(eq(schema.permissions.name, name))
      .limit(1);
    if (existing) return existing.id;
    const [created] = await db.insert(schema.permissions).values({ name }).returning();
    return created.id;
  }

  async function grantRolePermission(name: string): Promise<void> {
    const permissionId = await permissionIdByName(name);
    await db
      .insert(schema.rolePermissions)
      .values({ roleId, permissionId })
      .onConflictDoNothing();
  }

  async function revokeRolePermission(name: string): Promise<void> {
    const permissionId = await permissionIdByName(name);
    await db
      .delete(schema.rolePermissions)
      .where(and(eq(schema.rolePermissions.roleId, roleId), eq(schema.rolePermissions.permissionId, permissionId)));
  }

  beforeAll(async () => {
    app = await buildDeskApiApp();
    await app.ready();

    await db.insert(schema.roles).values({
      id: roleId,
      name: roleName,
      description: 'Role for kanban route integration tests',
    });

    await db.insert(schema.users).values({
      id: userId,
      name: 'Kanban Route User',
      email,
      passwordHash,
      isActive: true,
    });

    await db.insert(schema.userRoles).values({
      userId,
      roleId,
    });

    // AC3: o papel customizado recebe as permissões no BANCO — sem elas o
    // gate por ação negaria (ver teste de revogação abaixo).
    await grantRolePermission('chat:read');
    await grantRolePermission('chat:write');

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password },
    });

    expect(login.statusCode).toBe(200);
    token = (login.json() as { token: string }).token;
  });

  beforeEach(async () => {
    // O movimento transacional (SA-005) grava histórico/atribuições/outbox no
    // mesmo commit; a limpeza precisa remover os dependentes antes da conversa.
    await db.delete(schema.conversationStatusHistory).where(eq(schema.conversationStatusHistory.conversationId, conversationId));
    await db.delete(schema.conversationAssignments).where(eq(schema.conversationAssignments.conversationId, conversationId));
    await db.delete(schema.outboxEvents).where(eq(schema.outboxEvents.aggregateId, conversationId));
    await db.delete(schema.conversations).where(eq(schema.conversations.id, conversationId));
    await db.insert(schema.conversations).values({
      id: conversationId,
      status: 'open',
      statusV2: 'novo',
      currentHandler: 'bot',
      isActive: true,
    });
  });

  afterAll(async () => {
    await db.delete(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, roleId));
    await db.delete(schema.conversationStatusHistory).where(eq(schema.conversationStatusHistory.conversationId, conversationId));
    await db.delete(schema.conversationAssignments).where(eq(schema.conversationAssignments.conversationId, conversationId));
    await db.delete(schema.outboxEvents).where(eq(schema.outboxEvents.aggregateId, conversationId));
    await db.delete(schema.conversations).where(eq(schema.conversations.id, conversationId));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, userId));
    await db.delete(schema.auditLogs).where(eq(schema.auditLogs.userId, userId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    await db.delete(schema.roles).where(eq(schema.roles.id, roleId));
    await app.close();
  });

  it('PATCH /kanban/card/:id/move atualiza o status final do card', async () => {
    // D-AUTHZ-02: conversa sem setor exige Admin global ou vínculo explícito;
    // o caso positivo vincula o ator como responsável (assignedUserId).
    await db
      .update(schema.conversations)
      .set({ assignedUserId: userId })
      .where(eq(schema.conversations.id, conversationId));

    const response = await app.inject({
      method: 'PATCH',
      url: `/kanban/card/${conversationId}/move`,
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        status: 'finalizado',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      id: conversationId,
      status: 'finalizado',
    });

    const [conversation] = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversationId));

    expect(conversation.statusV2).toBe('finalizado');
    expect(conversation.isActive).toBe(false);
  });

  it('PATCH /kanban/card/:id/move falha com 404 para card inexistente', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/kanban/card/${randomUUID()}/move`,
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        status: 'finalizado',
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: 'NOT_FOUND',
      message: 'Conversa não encontrada',
    });
  });

  it('AC3: revogar/conceder role_permissions altera a decisão da mesma operação', async () => {
    await db
      .update(schema.conversations)
      .set({ assignedUserId: userId })
      .where(eq(schema.conversations.id, conversationId));

    // Sem chat:write no banco, mover é negado antes de qualquer efeito.
    await revokeRolePermission('chat:write');
    const deniedMove = await app.inject({
      method: 'PATCH',
      url: `/kanban/card/${conversationId}/move`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'em_atendimento' },
    });
    expect(deniedMove.statusCode).toBe(403);

    const [stillNovo] = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversationId));
    expect(stillNovo.statusV2).toBe('novo');

    // Concedida no banco, a MESMA operação passa na requisição seguinte.
    await grantRolePermission('chat:write');
    const allowedMove = await app.inject({
      method: 'PATCH',
      url: `/kanban/card/${conversationId}/move`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'em_atendimento' },
    });
    expect(allowedMove.statusCode).toBe(200);

    // Leitura segue o mesmo contrato: sem chat:read o board é negado.
    await revokeRolePermission('chat:read');
    const deniedBoard = await app.inject({
      method: 'GET',
      url: '/kanban/board',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(deniedBoard.statusCode).toBe(403);

    await grantRolePermission('chat:read');
    const allowedBoard = await app.inject({
      method: 'GET',
      url: '/kanban/board',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(allowedBoard.statusCode).toBe(200);
  });
});
