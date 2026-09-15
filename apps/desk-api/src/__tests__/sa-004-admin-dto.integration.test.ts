import { vi } from 'vitest';
vi.mock('@cvg/secretary-adapter', () => ({
  triggerHandoff: vi.fn().mockResolvedValue(undefined),
  invokeSecretary: vi.fn().mockResolvedValue({ isErr: () => true, isOk: () => false }),
}));
vi.mock('../../../../modules/chat/src/application/events/chat-publisher.ts', () => ({
  publishMessagePersisted: vi.fn().mockResolvedValue(undefined),
  publishConversationCreated: vi.fn().mockResolvedValue(undefined),
  publishConversationStatusChanged: vi.fn().mockResolvedValue(undefined),
}));

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { buildDeskApiApp } from '../app.ts';

/**
 * SA-004 / A01 / C02 — DTO público de usuário nunca serializa `passwordHash`.
 *
 * Prova no caminho HTTP real (app.inject + PostgreSQL do runner isolado):
 *  - GET  /admin/users            → itens sem campos privados
 *  - GET  /admin/users/:id        → detalhe sem `passwordHash`
 *  - POST /admin/users            → 201 sem `passwordHash`
 *  - PUT  /admin/users/:id        → 200 mesmo quando a senha é alterada
 *  - negativos: 401 sem sessão; 403 sem permissão de escrita
 *  - persistência: o hash existe no banco (prova de que não foi omitido por acaso)
 */

const passwordHash = '$2a$10$UX/LcD/6NKhheDIZmbHyN.a6Hc8SW6ytZ/LCCZW3un3h5vJ9n/1h6';
const password = 'ChatRoutePass!42';
const suffix = Date.now().toString().slice(-6);
const runTag = `sa004-${suffix}`;

const adminId = randomUUID();
const readerId = randomUUID();
const adminEmail = `sa004.admin.${suffix}@example.com`;
const readerEmail = `sa004.reader.${suffix}@example.com`;

let app: Awaited<ReturnType<typeof buildDeskApiApp>>;
let adminToken = '';
let readerToken = '';
let createdUserId = '';

function expectNoPrivateUserFields(body: Record<string, unknown>) {
  expect(body).not.toHaveProperty('passwordHash');
  expect(body).not.toHaveProperty('password');
  const serialized = JSON.stringify(body);
  expect(serialized).not.toContain('$2a$');
  expect(serialized).not.toContain('$2b$');
  expect(serialized).not.toContain('$argon2');
  // Campos públicos esperados permanecem.
  expect(body).toHaveProperty('id');
  expect(body).toHaveProperty('email');
  expect(body).toHaveProperty('isActive');
}

async function ensureRole(name: string, permissions: string[]): Promise<string> {
  let [role] = await db.select().from(schema.roles).where(eq(schema.roles.name, name)).limit(1);
  if (!role) {
    [role] = await db.insert(schema.roles).values({ name }).returning();
  }
  for (const permissionName of permissions) {
    let [permission] = await db.select().from(schema.permissions).where(eq(schema.permissions.name, permissionName)).limit(1);
    if (!permission) {
      [permission] = await db.insert(schema.permissions).values({ name: permissionName }).returning();
    }
    const existing = await db.select().from(schema.rolePermissions)
      .where(eq(schema.rolePermissions.roleId, role.id));
    if (!existing.some((row) => row.permissionId === permission.id)) {
      await db.insert(schema.rolePermissions).values({ roleId: role.id, permissionId: permission.id });
    }
  }
  return role.id;
}

async function createUser(id: string, email: string, roleName: string): Promise<string> {
  const roleId = await ensureRole(roleName, roleName === 'Admin'
    ? ['admin:read', 'admin:write', 'chat:read', 'chat:write']
    : ['chat:read']);
  await db.insert(schema.users).values({ id, name: `SA004 ${email}`, email, passwordHash, isActive: true });
  await db.insert(schema.userRoles).values({ userId: id, roleId });
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
  expect(login.statusCode).toBe(200);
  return (login.json() as { token: string }).token;
}

describe('SA-004 — DTO público de usuário (A01/C02)', () => {
  beforeAll(async () => {
    app = await buildDeskApiApp();
    await app.ready();
    adminToken = await createUser(adminId, adminEmail, 'Admin');
    readerToken = await createUser(readerId, readerEmail, 'Receptionist');
  });

  afterAll(async () => {
    if (createdUserId) {
      await db.delete(schema.auditLogs).where(eq(schema.auditLogs.userId, createdUserId));
      await db.delete(schema.sessions).where(eq(schema.sessions.userId, createdUserId));
      await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, createdUserId));
      await db.delete(schema.users).where(eq(schema.users.id, createdUserId));
    }
    for (const uid of [adminId, readerId]) {
      await db.delete(schema.auditLogs).where(eq(schema.auditLogs.userId, uid));
      await db.delete(schema.sessions).where(eq(schema.sessions.userId, uid));
      await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, uid));
      await db.delete(schema.users).where(eq(schema.users.id, uid));
    }
    await app.close();
  });

  it('POST /admin/users responde 201 sem hash e persiste hash no banco', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'SA004 Novo', email: `${runTag}.novo@example.com`, password: 'SenhaForte!42', roleIds: [] },
    });
    expect([200, 201]).toContain(response.statusCode);
    const body = response.json() as Record<string, unknown>;
    expectNoPrivateUserFields(body);
    createdUserId = String(body.id);

    const [row] = await db.select().from(schema.users).where(eq(schema.users.id, createdUserId));
    expect(row).toBeTruthy();
    expect(row.passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it('GET /admin/users/:id responde sem hash', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/admin/users/${createdUserId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(response.statusCode).toBe(200);
    expectNoPrivateUserFields(response.json() as Record<string, unknown>);
  });

  it('PUT /admin/users/:id altera senha e continua sem hash', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/admin/users/${createdUserId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'SA004 Atualizado', password: 'OutraSenha!43' },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as Record<string, unknown>;
    expectNoPrivateUserFields(body);
    expect(body.name).toBe('SA004 Atualizado');

    // Prova de efeito real: a nova senha autentica e a antiga não.
    const newLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: `${runTag}.novo@example.com`, password: 'OutraSenha!43' },
    });
    expect(newLogin.statusCode).toBe(200);
    const oldLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: `${runTag}.novo@example.com`, password: 'SenhaForte!42' },
    });
    expect(oldLogin.statusCode).not.toBe(200);
  });

  it('GET /admin/users lista somente campos públicos', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/admin/users',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(response.statusCode).toBe(200);
    const list = response.json() as Array<Record<string, unknown>>;
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThan(0);
    for (const item of list) {
      expect(item).not.toHaveProperty('passwordHash');
      expect(item).not.toHaveProperty('password');
    }
  });

  it('negativos: 401 sem sessão e 403 sem permissão de administração', async () => {
    const anonymous = await app.inject({ method: 'GET', url: `/admin/users/${createdUserId}` });
    expect(anonymous.statusCode).toBe(401);

    const forbiddenRead = await app.inject({
      method: 'GET',
      url: `/admin/users/${createdUserId}`,
      headers: { authorization: `Bearer ${readerToken}` },
    });
    expect(forbiddenRead.statusCode).toBe(403);

    const forbiddenWrite = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: { authorization: `Bearer ${readerToken}` },
      payload: { name: 'X', email: `sa004.x.${suffix}@example.com`, password: 'SenhaForte!42' },
    });
    expect(forbiddenWrite.statusCode).toBe(403);
  });
});
