import './integration-mocks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { buildDeskApiApp } from '../app.ts';

/**
 * B04/SA-006 — regressão do PUT de papel encontrada durante a prova SA-008:
 * atualizar SOMENTE `permissionIds` respondia 500 (`.set({})` vazio no drizzle)
 * e a substituição de vínculos não era atômica.
 *
 * Prova:
 *  - PUT /admin/roles/:id com apenas permissionIds → 200 e vínculos trocados;
 *  - lista de permissões vazia → remove todos os vínculos sem erro;
 *  - permissão inexistente → 4xx (FK tratada), sem perder vínculos anteriores;
 *  - edição de nome/descrição sem permissionIds continua funcionando.
 */

const password = 'KanbanRoutePass!42';
const passwordHash = '$2a$10$kOS6WENS2HZ/vSU96GD62O6aJbj.nc/B5O6Ctp/ecRh1mV5a8BCCO';
const suffix = Date.now().toString().slice(-6);

const adminId = randomUUID();
const adminEmail = `sa006-role.admin.${suffix}@example.com`;
const roleId = randomUUID();
const roleName = `SA006 Papel ${suffix}`;
let app: Awaited<ReturnType<typeof buildDeskApiApp>>;
let token = '';

describe('SA-006 — PUT de papel só com permissionIds (regressão)', () => {
  beforeAll(async () => {
    app = await buildDeskApiApp();
    await app.ready();

    await db.insert(schema.roles).values({ id: roleId, name: roleName, description: 'papel de teste' });
    await db.insert(schema.users).values({ id: adminId, name: 'SA006 Role Admin', email: adminEmail, passwordHash, isActive: true });
    const [adminRole] = await db.select().from(schema.roles).where(eq(schema.roles.name, 'Admin')).limit(1);
    expect(adminRole, 'migration 0025 provisiona o papel Admin').toBeTruthy();
    await db.insert(schema.userRoles).values({ userId: adminId, roleId: adminRole.id });

    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: adminEmail, password } });
    expect(login.statusCode).toBe(200);
    token = (login.json() as { token: string }).token;
  });

  afterAll(async () => {
    await db.delete(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, roleId));
    await db.delete(schema.roles).where(eq(schema.roles.id, roleId));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, adminId));
    await db.delete(schema.auditLogs).where(eq(schema.auditLogs.userId, adminId));
    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, adminId));
    await db.delete(schema.users).where(eq(schema.users.id, adminId));
    await app.close();
  });

  async function permissionIds(names: string[]): Promise<string[]> {
    const rows = await db.select().from(schema.permissions);
    return names.map((name) => {
      const row = rows.find((permission) => permission.name === name);
      if (!row) throw new Error(`permissão ausente: ${name}`);
      return row.id;
    });
  }

  it('atualiza somente permissionIds e troca os vínculos sem 500', async () => {
    const first = await permissionIds(['chat:read', 'tasks:read']);
    const response = await app.inject({
      method: 'PUT',
      url: `/admin/roles/${roleId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { permissionIds: first },
    });
    expect(response.statusCode).toBe(200);
    let links = await db.select().from(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, roleId));
    expect(new Set(links.map((link) => link.permissionId))).toEqual(new Set(first));

    const second = await permissionIds(['notes:read']);
    const replace = await app.inject({
      method: 'PUT',
      url: `/admin/roles/${roleId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { permissionIds: second },
    });
    expect(replace.statusCode).toBe(200);
    links = await db.select().from(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, roleId));
    expect(links.map((link) => link.permissionId)).toEqual(second);
  });

  it('lista vazia remove vínculos e nome/descrição seguem editáveis', async () => {
    const cleared = await app.inject({
      method: 'PUT',
      url: `/admin/roles/${roleId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { permissionIds: [] },
    });
    expect(cleared.statusCode).toBe(200);
    const links = await db.select().from(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, roleId));
    expect(links).toHaveLength(0);

    const renamed = await app.inject({
      method: 'PUT',
      url: `/admin/roles/${roleId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { description: 'descrição atualizada' },
    });
    expect(renamed.statusCode).toBe(200);
    const [role] = await db.select().from(schema.roles).where(eq(schema.roles.id, roleId));
    expect(role.description).toBe('descrição atualizada');
  });

  it('permissão inexistente responde 4xx e mantém os vínculos anteriores', async () => {
    const valid = await permissionIds(['alerts:read']);
    await app.inject({
      method: 'PUT',
      url: `/admin/roles/${roleId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { permissionIds: valid },
    });

    const response = await app.inject({
      method: 'PUT',
      url: `/admin/roles/${roleId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { permissionIds: [valid[0], randomUUID()] },
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.statusCode).toBeLessThan(500);

    const links = await db.select().from(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, roleId));
    expect(links.map((link) => link.permissionId)).toEqual(valid);
  });
});
