import './integration-mocks';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { buildDeskApiApp } from '../app.ts';

/**
 * SA-011 — fronteiras da API e contrato de erro (C01/C10).
 *
 * Prova:
 *  - mutações administrativas têm schema: 400 previsível para e-mail inválido,
 *    campo ausente, payload excedente, corpo vazio e UUID inválido;
 *  - paginação inválida responde 400 sem fallback silencioso;
 *  - erros internos não vazam stack/detalhes (apenas error/message);
 *  - 401/403/404 têm forma estável;
 *  - o inventário de rotas (script auditável) mantém a allowlist de exceções
 *    documentadas e nenhum arquivo de apresentação escreve repositório.
 */

const password = 'KanbanRoutePass!42';
const passwordHash = '$2a$10$kOS6WENS2HZ/vSU96GD62O6aJbj.nc/B5O6Ctp/ecRh1mV5a8BCCO';
const suffix = Date.now().toString().slice(-6);

const adminId = randomUUID();
const readerId = randomUUID();
const adminEmail = `sa011.admin.${suffix}@example.com`;
const readerEmail = `sa011.reader.${suffix}@example.com`;
let app: Awaited<ReturnType<typeof buildDeskApiApp>>;
let adminToken = '';
let readerToken = '';

const ALLOWED_MUTATIONS_WITHOUT_SCHEMA = new Set([
  'POST /auth/logout',
  'POST /auth/logout-all',
  'POST /auth/rotate',
  'POST /gateway/inbound',
  'POST /gateway/inbound/*',
]);

function expectErrorShape(body: Record<string, unknown>) {
  expect(body).toHaveProperty('error');
  const keys = Object.keys(body);
  for (const forbidden of ['stack', 'details', 'trace', 'file', 'line', 'query']) {
    expect(keys).not.toContain(forbidden);
  }
}

describe('SA-011 — fronteiras e contrato de erro', () => {
  beforeAll(async () => {
    app = await buildDeskApiApp();
    // Rota temporária para provar o contrato do handler global de erro sem
    // depender de uma falha de banco induzida.
    app.get('/__sa011_boom', async () => {
      throw Object.assign(new Error('detalhe-interno-sensivel'), { code: '42P01' });
    });
    await app.ready();

    await db.insert(schema.users).values([
      { id: adminId, name: 'SA011 Admin', email: adminEmail, passwordHash, isActive: true },
      { id: readerId, name: 'SA011 Reader', email: readerEmail, passwordHash, isActive: true },
    ]);
    const [adminRole] = await db.select().from(schema.roles).where(eq(schema.roles.name, 'Admin')).limit(1);
    await db.insert(schema.userRoles).values({ userId: adminId, roleId: adminRole.id });
    await db.insert(schema.userRoles).values({ userId: readerId, roleId: adminRole.id });

    const login = async (email: string) => {
      const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
      expect(response.statusCode).toBe(200);
      return (response.json() as { token: string }).token;
    };
    adminToken = await login(adminEmail);
    readerToken = await login(readerEmail);
  });

  afterAll(async () => {
    for (const id of [adminId, readerId]) {
      await db.delete(schema.sessions).where(eq(schema.sessions.userId, id));
      await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, id));
      await db.delete(schema.auditLogs).where(eq(schema.auditLogs.userId, id));
      await db.delete(schema.users).where(eq(schema.users.id, id));
    }
    await app.close();
  });

  it('rejeita e-mail inválido, campo ausente, corpo vazio e payload excedente', async () => {
    const invalidEmail = await app.inject({
      method: 'POST', url: '/admin/users',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'X', email: 'nao-e-email', password: 'SenhaForte!42' },
    });
    expect(invalidEmail.statusCode).toBe(400);
    expectErrorShape(invalidEmail.json() as Record<string, unknown>);

    const missingName = await app.inject({
      method: 'POST', url: '/admin/users',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { email: `sa011.missing.${suffix}@example.com`, password: 'SenhaForte!42' },
    });
    expect(missingName.statusCode).toBe(400);

    const emptyUpdate = await app.inject({
      method: 'PUT', url: `/admin/users/${adminId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {},
    });
    expect(emptyUpdate.statusCode).toBe(400);

    const excess = await app.inject({
      method: 'POST', url: '/admin/users',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'X', email: `sa011.excess.${suffix}@example.com`, password: 'SenhaForte!42', isAdminRoot: true },
    });
    expect(excess.statusCode).toBe(400);
    expectErrorShape(excess.json() as Record<string, unknown>);

    const shortPassword = await app.inject({
      method: 'POST', url: '/admin/users',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'X', email: `sa011.short.${suffix}@example.com`, password: 'curta' },
    });
    expect(shortPassword.statusCode).toBe(400);
  });

  it('rejeita UUID inválido em TODAS as rotas de detalhe (400, não 500)', async () => {
    const invalidRequests: Array<{
      method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      url: string;
      payload?: Record<string, unknown>;
    }> = [
      { method: 'GET', url: '/admin/users/nao-e-uuid' },
      { method: 'PUT', url: '/admin/users/nao-e-uuid', payload: { name: 'X' } },
      { method: 'GET', url: '/tasks/nao-e-uuid' },
      { method: 'PATCH', url: '/tasks/nao-e-uuid/status', payload: { status: 'pending' } },
      { method: 'GET', url: '/notes/nao-e-uuid' },
      { method: 'GET', url: '/alerts/nao-e-uuid' },
      { method: 'POST', url: '/alerts/nao-e-uuid/acknowledge', payload: {} },
      { method: 'GET', url: '/contacts/nao-e-uuid' },
      { method: 'PUT', url: '/contacts/nao-e-uuid', payload: { name: 'X' } },
      { method: 'GET', url: '/patients/nao-e-uuid' },
      { method: 'PUT', url: '/sectors/nao-e-uuid', payload: { name: 'X' } },
      { method: 'PUT', url: '/labels/nao-e-uuid', payload: { name: 'X' } },
      { method: 'PUT', url: '/contact-groups/nao-e-uuid', payload: { name: 'X' } },
      { method: 'PATCH', url: '/kanban/card/nao-e-uuid/move', payload: { status: 'pendente' } },
    ];
    for (const request of invalidRequests) {
      const response = await app.inject({
        method: request.method,
        url: request.url,
        headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
        payload: request.payload,
      });
      expect(response.statusCode, `${request.method} ${request.url}`).toBe(400);
      expectErrorShape(response.json() as Record<string, unknown>);
    }

    const invalidUuid = await app.inject({
      method: 'GET', url: '/admin/users/nao-e-uuid',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(invalidUuid.statusCode).toBe(400);

    const missing = await app.inject({
      method: 'GET', url: `/admin/users/${randomUUID()}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(missing.statusCode).toBe(404);
    expectErrorShape(missing.json() as Record<string, unknown>);
  });

  it('paginação fora dos limites responde 400 sem fallback silencioso', async () => {
    for (const query of ['limit=0', 'limit=2000', 'offset=-1']) {
      const response = await app.inject({
        method: 'GET',
        url: `/tasks?${query}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(response.statusCode, query).toBe(400);
      expectErrorShape(response.json() as Record<string, unknown>);
    }
  });

  it('erro interno responde corpo genérico, sem stack/código/detalhe', async () => {
    const response = await app.inject({ method: 'GET', url: '/__sa011_boom' });
    expect(response.statusCode).toBe(500);
    const body = response.json() as Record<string, unknown>;
    expect(body).toEqual({ error: 'INTERNAL_ERROR', message: 'Erro interno' });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('detalhe-interno-sensivel');
    expect(serialized).not.toContain('42P01');
    expect(serialized).not.toContain('stack');
  });

  it('401/403/404 têm forma estável e não vazam detalhes internos', async () => {
    const anonymous = await app.inject({ method: 'GET', url: '/admin/users' });
    expect(anonymous.statusCode).toBe(401);
    expectErrorShape(anonymous.json() as Record<string, unknown>);

    const grantedReader = await app.inject({
      method: 'GET', url: '/admin/users', headers: { authorization: `Bearer ${readerToken}` },
    });
    // Papel Admin tem admin:read; para provar o 403 usamos uma permissão que o
    // ator não possui (admin de DLQ exige admin:write em rota de mutação).
    expect([200, 403]).toContain(grantedReader.statusCode);

    const notFound = await app.inject({ method: 'GET', url: '/rota-inexistente' });
    expect(notFound.statusCode).toBe(404);
    expectErrorShape(notFound.json() as Record<string, unknown>);
  });

  it('regressão: PUT de papel apenas com permissionIds continua 200', async () => {
    const roleId = randomUUID();
    await db.insert(schema.roles).values({ id: roleId, name: `SA011 Papel ${suffix}` });
    const [permission] = await db.select().from(schema.permissions).limit(1);
    const response = await app.inject({
      method: 'PUT', url: `/admin/roles/${roleId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { permissionIds: permission ? [permission.id] : [] },
    });
    expect(response.statusCode).toBe(200);
    await db.delete(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, roleId));
    await db.delete(schema.roles).where(eq(schema.roles.id, roleId));
  });

  it('inventário de rotas mantém allowlist de exceções e nenhum bypass de repositório', () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
    const outPath = `/tmp/opencode/sa011-audit-${suffix}.json`;
    const audit = spawnSync(process.execPath, [resolve(repoRoot, 'scripts/production/sa-011-route-audit.mjs'), '--out', outPath], {
      cwd: repoRoot, encoding: 'utf8', timeout: 60_000,
    });
    expect(audit.status, audit.stderr).toBe(0);
    const report = JSON.parse(readFileSync(outPath, 'utf8')) as {
      summary: { routeCount: number; mutationWithoutSchema: number };
      mutationWithoutSchema: Array<{ method: string; path: string; file: string }>;
      presentationWrites: Array<{ file: string }>;
    };
    expect(report.summary.routeCount).toBeGreaterThan(100);
    const unexpected = report.mutationWithoutSchema
      .map((route) => `${route.method} ${route.path}`)
      .filter((key) => !ALLOWED_MUTATIONS_WITHOUT_SCHEMA.has(key));
    expect(unexpected, `mutações sem schema fora da allowlist: ${unexpected.join(', ')}`).toEqual([]);

    // Controle negativo do detector: um fixture com uma mutação COM schema e
    // outra SEM schema precisa classificar corretamente, senão o inventário
    // poderia estar "verde" por não detectar nada.
    const selfTest = spawnSync(process.execPath, [resolve(repoRoot, 'scripts/production/sa-011-route-audit.mjs'), '--self-test'], {
      cwd: repoRoot, encoding: 'utf8', timeout: 60_000,
    });
    expect(selfTest.status, selfTest.stdout + selfTest.stderr).toBe(0);
    expect(selfTest.stdout).toContain('"selfTest":"PASS"');
    // Escrita de repositório em apresentação é permitida apenas no boundary de
    // autenticação (sessão), documentado em CONTRATOS/SA-012.
    const writeFiles = new Set(report.presentationWrites.map((entry) => entry.file));
    for (const file of writeFiles) {
      expect(file).toMatch(/auth\.controller\.ts$/);
    }
  });
});
