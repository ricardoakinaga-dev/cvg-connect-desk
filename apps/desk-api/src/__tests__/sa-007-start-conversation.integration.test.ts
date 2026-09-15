import './integration-mocks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db, getPool, schema } from '@cvg/database';
import { buildDeskApiApp } from '../app.ts';

/**
 * SA-007 / A07 — início de atendimento transacional, idempotente e concorrente.
 *
 * Prova:
 *  - conversa + histórico + auditoria + outbox no MESMO commit;
 *  - falha forçada na trilha reverte a conversa (nada parcial);
 *  - N requisições concorrentes convergem para UMA conversa ativa canônica;
 *  - retry devolve o mesmo id sem efeito adicional;
 *  - listagem de contatos preserva o contato após a criação.
 */

const password = 'KanbanRoutePass!42';
const passwordHash = '$2a$10$kOS6WENS2HZ/vSU96GD62O6aJbj.nc/B5O6Ctp/ecRh1mV5a8BCCO';
const suffix = Date.now().toString().slice(-6);

const userId = randomUUID();
const roleId = randomUUID();
const contactId = randomUUID();
const sectorId = randomUUID();
const userEmail = `sa007.user.${suffix}@example.com`;
let app: Awaited<ReturnType<typeof buildDeskApiApp>>;
let token = '';

async function grantRolePermission(name: string): Promise<void> {
  let [permission] = await db.select().from(schema.permissions).where(eq(schema.permissions.name, name)).limit(1);
  if (!permission) {
    [permission] = await db.insert(schema.permissions).values({ name }).returning();
  }
  await db.insert(schema.rolePermissions).values({ roleId, permissionId: permission.id }).onConflictDoNothing();
}

describe('SA-007 — startConversation atômico (A07)', () => {
  beforeAll(async () => {
    app = await buildDeskApiApp();
    await app.ready();

    await db.insert(schema.roles).values({ id: roleId, name: `SA007 Role ${suffix}` });
    await db.insert(schema.users).values({ id: userId, name: 'SA007 User', email: userEmail, passwordHash, isActive: true });
    await db.insert(schema.userRoles).values({ userId, roleId });
    await db.insert(schema.sectors).values({ id: sectorId, name: `SA007 Setor ${suffix}`, code: `sa007-${suffix}` });
    await db.insert(schema.userSectors).values({ userId, sectorId, accessLevel: 'write' });
    await grantRolePermission('chat:read');
    await grantRolePermission('chat:write');

    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: userEmail, password } });
    expect(login.statusCode).toBe(200);
    token = (login.json() as { token: string }).token;

    await db.insert(schema.contacts).values({
      id: contactId,
      name: `SA007 Contato ${suffix}`,
      phone: `55${suffix}0001`,
      updatedAt: new Date(),
    });
  });

  afterAll(async () => {
    const conversations = await db.select({ id: schema.conversations.id }).from(schema.conversations)
      .where(eq(schema.conversations.contactId, contactId));
    for (const conversation of conversations) {
      await db.delete(schema.outboxEvents).where(eq(schema.outboxEvents.aggregateId, conversation.id));
      await db.delete(schema.conversationStatusHistory).where(eq(schema.conversationStatusHistory.conversationId, conversation.id));
      await db.delete(schema.auditLogs).where(eq(schema.auditLogs.entityId, conversation.id));
      await db.delete(schema.messages).where(eq(schema.messages.conversationId, conversation.id));
    }
    await db.delete(schema.conversations).where(eq(schema.conversations.contactId, contactId));
    await db.delete(schema.contacts).where(eq(schema.contacts.id, contactId));
    await db.delete(schema.userSectors).where(eq(schema.userSectors.userId, userId));
    await db.delete(schema.sectors).where(eq(schema.sectors.id, sectorId));
    await db.delete(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, roleId));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, userId));
    await db.delete(schema.auditLogs).where(eq(schema.auditLogs.userId, userId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    await db.delete(schema.roles).where(eq(schema.roles.id, roleId));
    // O pool pg é do arquivo de teste: encerra as conexões DEPOIS da app para
    // devolver o recurso ao run isolado sem afetar outras suítes (cada arquivo
    // roda em ambiente próprio). `db` em si não expõe `close`.
    await app.close();
    try {
      await getPool().end();
    } catch (error) {
      // Teardown não deve mascarar o resultado funcional, mas a falha fica visível.
      console.warn('[sa-007] falha ao encerrar o pool pg:', error);
    }
  });

  async function start() {
    return app.inject({
      method: 'POST',
      url: `/contacts/${contactId}/start-conversation`,
      headers: { authorization: `Bearer ${token}` },
      payload: { sectorId },
    });
  }

  async function activeConversations() {
    return db.select().from(schema.conversations)
      .where(and(eq(schema.conversations.contactId, contactId), eq(schema.conversations.isActive, true)));
  }

  it('cria conversa com histórico, auditoria e outbox no mesmo commit', async () => {
    const response = await start();
    expect(response.statusCode).toBe(201);
    const body = response.json() as { conversationId: string; isNew: boolean };
    expect(body.isNew).toBe(true);

    const [conversation] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, body.conversationId));
    expect(conversation).toBeTruthy();
    expect(conversation.statusV2).toBe('novo');
    expect(conversation.isActive).toBe(true);

    const history = await db.select().from(schema.conversationStatusHistory)
      .where(eq(schema.conversationStatusHistory.conversationId, body.conversationId));
    expect(history.length).toBe(1);

    const audit = await db.select().from(schema.auditLogs)
      .where(and(
        eq(schema.auditLogs.action, 'contact.conversation_started'),
        eq(schema.auditLogs.entityId, body.conversationId),
      ));
    expect(audit.length).toBe(1);

    const outbox = await db.select().from(schema.outboxEvents)
      .where(and(
        eq(schema.outboxEvents.aggregateId, body.conversationId),
        eq(schema.outboxEvents.eventType, 'conversation.created'),
      ));
    expect(outbox.length).toBe(1);
  });

  it('retry devolve o mesmo id canônico sem efeito adicional', async () => {
    const first = await start();
    const second = await start();
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    const firstBody = first.json() as { conversationId: string };
    const secondBody = second.json() as { conversationId: string; isNew: boolean };
    expect(secondBody.conversationId).toBe(firstBody.conversationId);
    expect(secondBody.isNew).toBe(false);

    const history = await db.select().from(schema.conversationStatusHistory)
      .where(eq(schema.conversationStatusHistory.conversationId, firstBody.conversationId));
    expect(history.length).toBe(1);
    expect((await activeConversations()).length).toBe(1);
  });

  it('N requisições concorrentes convergem para uma única conversa ativa', async () => {
    // Encerra a conversa atual para liberar a criação concorrente.
    await db.update(schema.conversations).set({ isActive: false, status: 'closed', statusV2: 'finalizado', closedAt: new Date() })
      .where(eq(schema.conversations.contactId, contactId));

    const responses = await Promise.all(Array.from({ length: 5 }, () => start()));
    for (const response of responses) {
      expect([200, 201]).toContain(response.statusCode);
    }
    const ids = new Set(responses.map((response) => (response.json() as { conversationId: string }).conversationId));
    expect(ids.size).toBe(1);

    const active = await activeConversations();
    expect(active.length).toBe(1);
    const all = await db.select().from(schema.conversations).where(eq(schema.conversations.contactId, contactId));
    // Nenhuma órfã: todas as conversas do contato têm histórico.
    for (const conversation of all) {
      const history = await db.select().from(schema.conversationStatusHistory)
        .where(eq(schema.conversationStatusHistory.conversationId, conversation.id));
      expect(history.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('falha forçada na auditoria reverte a conversa inteira', async () => {
    await db.update(schema.conversations).set({ isActive: false, status: 'closed', statusV2: 'finalizado', closedAt: new Date() })
      .where(eq(schema.conversations.contactId, contactId));
    const before = (await db.select().from(schema.conversations).where(eq(schema.conversations.contactId, contactId))).length;

    await db.execute(sql`
      CREATE OR REPLACE FUNCTION sa007_fail_audit() RETURNS trigger AS $$
      BEGIN
        IF NEW.action = 'contact.conversation_started' THEN
          RAISE EXCEPTION 'sa007 forced audit failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await db.execute(sql`DROP TRIGGER IF EXISTS sa007_audit_guard ON audit_logs`);
    await db.execute(sql`CREATE TRIGGER sa007_audit_guard BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION sa007_fail_audit()`);
    try {
      const response = await start();
      expect(response.statusCode).toBe(500);
      const after = (await db.select().from(schema.conversations).where(eq(schema.conversations.contactId, contactId))).length;
      expect(after).toBe(before);
      expect((await activeConversations()).length).toBe(0);
    } finally {
      await db.execute(sql`DROP TRIGGER IF EXISTS sa007_audit_guard ON audit_logs`);
      await db.execute(sql`DROP FUNCTION IF EXISTS sa007_fail_audit()`);
    }
  });

  it('listagem paginada preserva o contato criado', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/contacts?search=${encodeURIComponent(`SA007 Contato ${suffix}`)}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { data?: Array<{ id: string }>; items?: Array<{ id: string }> } | Array<{ id: string }>;
    const rows = Array.isArray(body) ? body : (body.data ?? body.items ?? []);
    expect(rows.some((row) => row.id === contactId)).toBe(true);
  });
});
