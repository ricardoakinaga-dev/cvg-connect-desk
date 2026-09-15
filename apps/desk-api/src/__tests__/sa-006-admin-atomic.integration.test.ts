import './integration-mocks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { buildDeskApiApp } from '../app.ts';

/**
 * SA-006 / A07 — operações administrativas atômicas e auditáveis.
 *
 * Prova:
 *  - criar usuário + papéis é um único commit; FK inválida não cria usuário parcial;
 *  - editar usuário + substituir papéis é um único commit; falha preserva vínculos;
 *  - auditoria participa do commit: falha forçada na trilha reverte o usuário;
 *  - revogação de papel muda a decisão da sessão ativa;
 *  - concorrência não duplica vínculos e não devolve 500 após efeito.
 */

const password = 'KanbanRoutePass!42';
const passwordHash = '$2a$10$kOS6WENS2HZ/vSU96GD62O6aJbj.nc/B5O6Ctp/ecRh1mV5a8BCCO';
const suffix = Date.now().toString().slice(-6);

const adminId = randomUUID();
const adminEmail = `sa006.admin.${suffix}@example.com`;
const adminRoleId = randomUUID();
const extraRoleId = randomUUID();
const userRoleId = randomUUID();
let app: Awaited<ReturnType<typeof buildDeskApiApp>>;
let adminToken = '';
let createdUserId = '';

async function login(email: string, secret: string = password): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: secret } });
  expect(response.statusCode).toBe(200);
  return (response.json() as { token: string }).token;
}

async function grantRolePermission(roleId: string, name: string): Promise<void> {
  let [permission] = await db.select().from(schema.permissions).where(eq(schema.permissions.name, name)).limit(1);
  if (!permission) {
    [permission] = await db.insert(schema.permissions).values({ name }).returning();
  }
  await db.insert(schema.rolePermissions).values({ roleId, permissionId: permission.id }).onConflictDoNothing();
}

describe('SA-006 — admin atômico e auditável (A07)', () => {
  beforeAll(async () => {
    app = await buildDeskApiApp();
    await app.ready();

    await db.insert(schema.roles).values({ id: adminRoleId, name: `SA006 Admin ${suffix}` });
    await db.insert(schema.roles).values({ id: extraRoleId, name: `SA006 Extra ${suffix}` });
    await db.insert(schema.roles).values({ id: userRoleId, name: `SA006 User ${suffix}` });
    await db.insert(schema.users).values({ id: adminId, name: 'SA006 Admin', email: adminEmail, passwordHash, isActive: true });
    await db.insert(schema.userRoles).values({ userId: adminId, roleId: adminRoleId });
    for (const name of ['admin:read', 'admin:write']) {
      await grantRolePermission(adminRoleId, name);
    }
    adminToken = await login(adminEmail);
  });

  afterAll(async () => {
    if (createdUserId) {
      await db.delete(schema.auditLogs).where(eq(schema.auditLogs.entityId, createdUserId));
      await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, createdUserId));
      await db.delete(schema.sessions).where(eq(schema.sessions.userId, createdUserId));
      await db.delete(schema.users).where(eq(schema.users.id, createdUserId));
    }
    await db.delete(schema.auditLogs).where(eq(schema.auditLogs.entityId, adminId));
    await db.delete(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, adminRoleId));
    for (const id of [adminId]) {
      await db.delete(schema.sessions).where(eq(schema.sessions.userId, id));
      await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, id));
      await db.delete(schema.users).where(eq(schema.users.id, id));
    }
    await db.delete(schema.roles).where(eq(schema.roles.id, adminRoleId));
    await db.delete(schema.roles).where(eq(schema.roles.id, extraRoleId));
    await db.delete(schema.roles).where(eq(schema.roles.id, userRoleId));
    await app.close();
  });

  it('AC1: papel inexistente não cria usuário parcial e devolve 400', async () => {
    const email = `sa006.partial.${suffix}@example.com`;
    const response = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'Parcial', email, password: 'SenhaForte!42', roleIds: [randomUUID()] },
    });
    expect(response.statusCode).toBe(400);
    expect((response.json() as { error: string }).error).toBe('INVALID_ROLE');

    const rows = await db.select().from(schema.users).where(eq(schema.users.email, email));
    expect(rows).toHaveLength(0);
  });

  it('AC1: edição com papel inválido preserva vínculos anteriores (rollback total)', async () => {
    const email = `sa006.keep.${suffix}@example.com`;
    const created = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'Keep', email, password: 'SenhaForte!42', roleIds: [userRoleId] },
    });
    expect([200, 201]).toContain(created.statusCode);
    const userId = String((created.json() as { id: string }).id);

    const before = await db.select().from(schema.userRoles).where(eq(schema.userRoles.userId, userId));
    expect(before.map((row) => row.roleId)).toEqual([userRoleId]);

    const failed = await app.inject({
      method: 'PUT',
      url: `/admin/users/${userId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { roleIds: [extraRoleId, randomUUID()] },
    });
    expect(failed.statusCode).toBe(400);

    const after = await db.select().from(schema.userRoles).where(eq(schema.userRoles.userId, userId));
    expect(after.map((row) => row.roleId)).toEqual([userRoleId]);

    await db.delete(schema.auditLogs).where(eq(schema.auditLogs.entityId, userId));
    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, userId));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
  });

  it('AC2: auditoria participa do commit — falha forçada na trilha reverte o usuário', async () => {
    const email = `sa006.audit.${suffix}@example.com`;
    await db.execute(sql`
      CREATE OR REPLACE FUNCTION sa006_fail_audit() RETURNS trigger AS $$
      BEGIN
        IF NEW.action = 'admin.user.created' THEN
          RAISE EXCEPTION 'sa006 forced audit failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await db.execute(sql`DROP TRIGGER IF EXISTS sa006_audit_guard ON audit_logs`);
    await db.execute(sql`CREATE TRIGGER sa006_audit_guard BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION sa006_fail_audit()`);

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/admin/users',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { name: 'AuditFail', email, password: 'SenhaForte!42' },
      });
      expect(response.statusCode).toBe(500);

      const rows = await db.select().from(schema.users).where(eq(schema.users.email, email));
      expect(rows).toHaveLength(0);
      const audits = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, 'admin.user.created'));
      expect(audits.some((row) => row.newValue?.includes(email))).toBe(false);
    } finally {
      await db.execute(sql`DROP TRIGGER IF EXISTS sa006_audit_guard ON audit_logs`);
      await db.execute(sql`DROP FUNCTION IF EXISTS sa006_fail_audit()`);
    }
  });

  it('AC2: sucesso grava usuário e auditoria no mesmo commit', async () => {
    const email = `sa006.together.${suffix}@example.com`;
    const response = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'Together', email, password: 'SenhaForte!42', roleIds: [userRoleId] },
    });
    expect([200, 201]).toContain(response.statusCode);
    createdUserId = String((response.json() as { id: string }).id);

    const audits = await db.select().from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.action, 'admin.user.created'), eq(schema.auditLogs.entityId, createdUserId)));
    expect(audits.length).toBe(1);
    expect(audits[0].newValue).toContain(email);
    // Sem PII sensível: nenhum hash/segredo na trilha.
    expect(audits[0].newValue).not.toContain('$2a$');
    expect(audits[0].newValue).not.toContain('passwordHash');
  });

  it('AC3: revogação de papel muda a decisão da sessão ativa (sem relogar)', async () => {
    const memberId = randomUUID();
    const memberEmail = `sa006.revoke.${suffix}@example.com`;
    const create = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'Revoke', email: memberEmail, password: 'SenhaForte!42', roleIds: [adminRoleId] },
    });
    expect([200, 201]).toContain(create.statusCode);
    const userId = String((create.json() as { id: string }).id);
    const token = await login(memberEmail, 'SenhaForte!42');

    const allowed = await app.inject({ method: 'GET', url: '/admin/users', headers: { authorization: `Bearer ${token}` } });
    expect(allowed.statusCode).toBe(200);

    const replaced = await app.inject({
      method: 'PUT',
      url: `/admin/users/${userId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { roleIds: [userRoleId] },
    });
    expect(replaced.statusCode).toBe(200);

    const denied = await app.inject({ method: 'GET', url: '/admin/users', headers: { authorization: `Bearer ${token}` } });
    expect(denied.statusCode).toBe(403);

    await db.delete(schema.auditLogs).where(eq(schema.auditLogs.entityId, userId));
    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, userId));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    void memberId;
  });

  it('AC3: substituições concorrentes não duplicam vínculos nem devolvem 500', async () => {
    const responses = await Promise.all([
      app.inject({
        method: 'PUT',
        url: `/admin/users/${createdUserId}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { roleIds: [userRoleId, extraRoleId] },
      }),
      app.inject({
        method: 'PUT',
        url: `/admin/users/${createdUserId}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { roleIds: [userRoleId, extraRoleId] },
      }),
    ]);
    for (const response of responses) {
      expect([200, 409]).toContain(response.statusCode);
      expect(response.statusCode).not.toBe(500);
    }
    const links = await db.select().from(schema.userRoles).where(eq(schema.userRoles.userId, createdUserId));
    const unique = new Set(links.map((row) => row.roleId));
    expect(unique.size).toBe(links.length);
    for (const roleId of [userRoleId, extraRoleId]) {
      expect(unique.has(roleId)).toBe(true);
    }
  });
});
