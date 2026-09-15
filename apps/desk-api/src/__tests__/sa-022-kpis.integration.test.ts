import './integration-mocks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { buildDeskApiApp } from '../app.ts';

/**
 * SA-022 / A08 — entradas de KPI validadas (400 previsível), agrupamento sem
 * fallback silencioso, contagens conferidas contra SQL independente na virada
 * de dia (UTC) e estados distintos (vazio ≠ erro).
 */

const password = 'KanbanRoutePass!42';
const passwordHash = '$2a$10$kOS6WENS2HZ/vSU96GD62O6aJbj.nc/B5O6Ctp/ecRh1mV5a8BCCO';
const suffix = Date.now().toString().slice(-6);

const userId = randomUUID();
const roleId = randomUUID();
const noReadUserId = randomUUID();
const userEmail = `sa022.user.${suffix}@example.com`;
const noReadEmail = `sa022.noread.${suffix}@example.com`;
const boundaryIds = [randomUUID(), randomUUID(), randomUUID()];
let app: Awaited<ReturnType<typeof buildDeskApiApp>>;
let token = '';
let noReadToken = '';

async function grantRolePermission(role: string, name: string): Promise<void> {
  let [permission] = await db.select().from(schema.permissions).where(eq(schema.permissions.name, name)).limit(1);
  if (!permission) {
    [permission] = await db.insert(schema.permissions).values({ name }).returning();
  }
  await db.insert(schema.rolePermissions).values({ roleId: role, permissionId: permission.id }).onConflictDoNothing();
}

describe('SA-022 — KPIs validados e contagens conferíveis (A08)', () => {
  beforeAll(async () => {
    app = await buildDeskApiApp();
    await app.ready();

    const noReadRoleId = randomUUID();
    await db.insert(schema.roles).values({ id: roleId, name: `SA022 Role ${suffix}` });
    await db.insert(schema.roles).values({ id: noReadRoleId, name: `SA022 NoRead ${suffix}` });
    await db.insert(schema.users).values({ id: userId, name: 'SA022 User', email: userEmail, passwordHash, isActive: true });
    await db.insert(schema.users).values({ id: noReadUserId, name: 'SA022 NoRead', email: noReadEmail, passwordHash, isActive: true });
    await db.insert(schema.userRoles).values({ userId, roleId });
    await db.insert(schema.userRoles).values({ userId: noReadUserId, roleId: noReadRoleId });
    await grantRolePermission(roleId, 'dashboard:read');

    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: userEmail, password } });
    expect(login.statusCode).toBe(200);
    token = (login.json() as { token: string }).token;
    const noReadLogin = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: noReadEmail, password } });
    expect(noReadLogin.statusCode).toBe(200);
    noReadToken = (noReadLogin.json() as { token: string }).token;

    // Virada de dia UTC: 23:59:59 de 01/01, 00:00:01 e 23:00 de 02/01.
    await db.insert(schema.conversations).values([
      { id: boundaryIds[0], status: 'open', statusV2: 'novo', currentHandler: 'bot', isActive: true, createdAt: new Date('2026-01-01T23:59:59.000Z') },
      { id: boundaryIds[1], status: 'open', statusV2: 'novo', currentHandler: 'bot', isActive: true, createdAt: new Date('2026-01-02T00:00:01.000Z') },
      { id: boundaryIds[2], status: 'open', statusV2: 'novo', currentHandler: 'bot', isActive: true, createdAt: new Date('2026-01-02T23:00:00.000Z') },
    ]);
  });

  afterAll(async () => {
    await db.delete(schema.conversations).where(sql`id IN (${boundaryIds[0]}, ${boundaryIds[1]}, ${boundaryIds[2]})`);
    await db.delete(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, roleId));
    for (const id of [userId, noReadUserId]) {
      await db.delete(schema.sessions).where(eq(schema.sessions.userId, id));
      await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, id));
      await db.delete(schema.users).where(eq(schema.users.id, id));
    }
    await db.delete(schema.roles).where(sql`name LIKE ${`SA022 %${suffix}`}`);
    await app.close();
  });

  it('AC1: datas inválidas, intervalo invertido, grupo desconhecido e ausência → 400', async () => {
    const cases = [
      '/metrics/conversations/volume?startDate=13/09/2026&endDate=14/09/2026',
      '/metrics/conversations/volume?startDate=2026-09-14T00:00:00Z',
      '/metrics/conversations/volume?startDate=2026-09-14T00:00:00Z&endDate=2026-09-13T00:00:00Z',
      '/metrics/conversations/volume?startDate=2026-09-14T00:00:00Z&endDate=2026-09-15T00:00:00Z&groupBy=hour',
      '/metrics/conversations/volume?startDate=2020-01-01T00:00:00Z&endDate=2026-09-15T00:00:00Z',
    ];
    for (const url of cases) {
      const response = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
      expect(response.statusCode, url).toBe(400);
      expect(response.json()).toHaveProperty('error');
    }
    const inverted = await app.inject({
      method: 'GET',
      url: '/metrics/conversations/volume?startDate=2026-09-14T00:00:00Z&endDate=2026-09-13T00:00:00Z',
      headers: { authorization: `Bearer ${token}` },
    });
    expect((inverted.json() as { error: string }).error).toBe('INVALID_RANGE');
  });

  it('AC1: agrupamento inválido não cai em fallback mensal', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/metrics/conversations/volume?startDate=2026-01-01T00:00:00Z&endDate=2026-01-03T00:00:00Z&groupBy=MONTH',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(400);
  });

  it('AC1: aging valida o limite e nega sem dashboard:read', async () => {
    const invalid = await app.inject({ method: 'GET', url: '/metrics/aging?limit=0', headers: { authorization: `Bearer ${token}` } });
    expect(invalid.statusCode).toBe(400);
    const tooBig = await app.inject({ method: 'GET', url: '/metrics/aging?limit=1000', headers: { authorization: `Bearer ${token}` } });
    expect(tooBig.statusCode).toBe(400);
    const allowed = await app.inject({ method: 'GET', url: '/metrics/aging?limit=5', headers: { authorization: `Bearer ${token}` } });
    expect(allowed.statusCode).toBe(200);

    const denied = await app.inject({ method: 'GET', url: '/metrics/aging', headers: { authorization: `Bearer ${noReadToken}` } });
    expect(denied.statusCode).toBe(403);
  });

  it('AC2: volume na virada de dia (UTC) confere com SQL independente', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/metrics/conversations/volume?startDate=2026-01-01T00:00:00Z&endDate=2026-01-03T00:00:00Z&groupBy=day',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    const apiBuckets = response.json() as Array<{ date: string; count: number }>;

    const independent = await db.execute<{ bucket: string; total: number }>(sql`
      SELECT to_char(created_at, 'YYYY-MM-DD') AS bucket, count(*)::int AS total
      FROM conversations
      WHERE created_at >= '2026-01-01 00:00:00' AND created_at < '2026-01-03 00:00:00'
      GROUP BY 1 ORDER BY 1
    `);
    const rows = ((independent as unknown as { rows?: Array<{ bucket: string; total: number }> }).rows
      ?? independent) as Array<{ bucket: string; total: number }>;

    const apiMap = Object.fromEntries(apiBuckets.map((bucket) => [bucket.date, Number(bucket.count)]));
    const sqlMap = Object.fromEntries(rows.map((row) => [row.bucket, Number(row.total)]));
    expect(apiMap).toEqual(sqlMap);
    // O evento de 23:59:59 pertence ao dia 01; o de 00:00:01 ao dia 02.
    expect(apiMap['2026-01-01']).toBe(1);
    expect(apiMap['2026-01-02']).toBe(2);
  });

  it('AC2: estado vazio é distinto de erro (200 com zeros, não 500)', async () => {
    const empty = await app.inject({
      method: 'GET',
      url: '/metrics/conversations/volume?startDate=2019-01-01T00:00:00Z&endDate=2019-01-02T00:00:00Z&groupBy=day',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(empty.statusCode).toBe(200);
    const body = empty.json() as Array<{ count: number }>;
    expect(body.every((bucket) => Number(bucket.count) === 0) || body.length === 0).toBe(true);
  });
});
