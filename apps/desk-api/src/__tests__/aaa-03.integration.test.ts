import './integration-mocks';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { authenticate } from '@cvg/auth';
import { buildDeskApiApp } from '../app.ts';

const password = 'Str0ngPass!42';
const passwordHash = '$2a$10$QMxMJ8QfVxjH93DvTDs2m.OVuALoBBR6S9d58BwIPb8rcXHsUBJWC';

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

describe('AAA-03 — validação e renovação de sessões (PostgreSQL real)', () => {
  const email = `aaa03.integration.${Date.now()}@example.com`;
  let app: Awaited<ReturnType<typeof buildDeskApiApp>>;
  let userId = '';

  type SessionOverrides = {
    expiresAt?: Date | null;
    absoluteExpiresAt?: Date | null;
    lastSeenAt?: Date | null;
    revokedAt?: Date | null;
    createdAt?: Date;
  };

  async function insertSession(overrides: SessionOverrides = {}): Promise<string> {
    const token = `${randomUUID()}.${randomUUID().replace(/-/g, '')}`;
    const now = Date.now();
    await db.insert(schema.sessions).values({
      userId,
      token: hashToken(token),
      tokenHash: hashToken(token),
      expiresAt: overrides.expiresAt === undefined ? new Date(now + 60 * 60 * 1000) : overrides.expiresAt,
      absoluteExpiresAt:
        overrides.absoluteExpiresAt === undefined ? new Date(now + 24 * 60 * 60 * 1000) : overrides.absoluteExpiresAt,
      lastSeenAt: overrides.lastSeenAt === undefined ? new Date(now) : overrides.lastSeenAt,
      revokedAt: overrides.revokedAt ?? null,
      ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
    });
    return token;
  }

  async function login(): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password },
    });
    expect(response.statusCode).toBe(200);
    return (response.json() as { token: string }).token;
  }

  function auth(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function rotate(token: string) {
    return app.inject({ method: 'POST', url: '/auth/rotate', headers: auth(token) });
  }

  async function sessionRow(token: string) {
    const [row] = await db.select().from(schema.sessions).where(eq(schema.sessions.token, hashToken(token)));
    return row;
  }

  async function sessionTimestamps(token: string) {
    const result = await db.execute(sql`
      SELECT
        (extract(epoch from absolute_expires_at) * 1000)::double precision AS absolute_ms,
        (extract(epoch from last_seen_at) * 1000)::double precision AS last_seen_ms,
        (extract(epoch from revoked_at) * 1000)::double precision AS revoked_ms
      FROM sessions WHERE token = ${hashToken(token)}
    `);
    const row = result.rows[0] as {
      absolute_ms: number | null;
      last_seen_ms: number | null;
      revoked_ms: number | null;
    };
    const toMs = (value: number | null) => (value === null ? null : Math.round(Number(value)));
    return {
      absoluteExpiresAtMs: toMs(row.absolute_ms),
      lastSeenAtMs: toMs(row.last_seen_ms),
      revokedAtMs: toMs(row.revoked_ms),
    };
  }

  async function countActiveSessions(): Promise<number> {
    const rows = await db.select().from(schema.sessions).where(eq(schema.sessions.userId, userId));
    return rows.filter((row) => row.revokedAt === null).length;
  }

  async function expectDeniedEverywhere(token: string, message: string) {
    for (const url of ['/auth/me', '/aaa-03/probe']) {
      const response = await app.inject({ method: 'GET', url, headers: auth(token) });
      expect(response.statusCode, `${url} deve negar`).toBe(401);
      expect(response.json()).toMatchObject({ error: 'UNAUTHORIZED', message });
    }

    const rotation = await rotate(token);
    expect(rotation.statusCode, '/auth/rotate deve negar').toBe(401);
    expect(rotation.json()).toMatchObject({ error: 'UNAUTHORIZED', message });
  }

  beforeAll(async () => {
    app = await buildDeskApiApp();
    app.get('/aaa-03/probe', { preHandler: [authenticate] }, async (request) => ({
      user: (request as { user?: unknown }).user ?? null,
    }));
    await app.ready();

    userId = randomUUID();
    await db.insert(schema.users).values({
      id: userId,
      name: 'AAA-03 Session User',
      email,
      passwordHash,
      isActive: true,
    });
  });

  beforeEach(async () => {
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
    await db.update(schema.users).set({ isActive: true }).where(eq(schema.users.id, userId));
  });

  afterAll(async () => {
    if (userId) {
      await db.delete(schema.auditLogs).where(eq(schema.auditLogs.userId, userId));
      await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
      await db.delete(schema.users).where(eq(schema.users.id, userId));
    }
    await app.close();
  });

  it('sessão válida acessa /auth/me e rota protegida com as mesmas regras', async () => {
    const token = await login();

    const me = await app.inject({ method: 'GET', url: '/auth/me', headers: auth(token) });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ user: { id: userId, email } });

    const probe = await app.inject({ method: 'GET', url: '/aaa-03/probe', headers: auth(token) });
    expect(probe.statusCode).toBe(200);
    expect(probe.json()).toMatchObject({ user: { id: userId } });
  });

  it('login inválido continua 401 e logout é idempotente', async () => {
    const invalid = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: 'senha-errada' },
    });
    expect(invalid.statusCode).toBe(401);

    const token = await login();
    const first = await app.inject({ method: 'POST', url: '/auth/logout', headers: auth(token) });
    expect(first.statusCode).toBe(200);

    const after = await app.inject({ method: 'GET', url: '/auth/me', headers: auth(token) });
    expect(after.statusCode).toBe(401);

    const second = await app.inject({ method: 'POST', url: '/auth/logout', headers: auth(token) });
    expect(second.statusCode).toBe(200);
  });

  it('token é persistido apenas como hash SHA-256', async () => {
    const token = await login();
    const [row] = await db.select().from(schema.sessions).where(eq(schema.sessions.tokenHash, hashToken(token)));

    expect(row).toBeDefined();
    expect(row.token).toBe(hashToken(token));
    expect(row.token).not.toBe(token);
    expect(row.tokenHash).toBe(hashToken(token));
  });

  it('nega expiração normal em me, rota protegida e rotate sem tocar lastSeenAt', async () => {
    const token = await insertSession({ expiresAt: new Date(Date.now() - 1000) });
    const before = (await sessionRow(token)).lastSeenAt?.getTime();

    await expectDeniedEverywhere(token, 'Token expired');

    const after = (await sessionRow(token)).lastSeenAt?.getTime();
    expect(after).toBe(before);
  });

  it('nega expiração absoluta mesmo com validade normal futura', async () => {
    const token = await insertSession({ absoluteExpiresAt: new Date(Date.now() - 1000) });
    await expectDeniedEverywhere(token, 'Session expired');
  });

  it('aplica default-deny no deadline imediatamente anterior à requisição', async () => {
    const token = await insertSession({ expiresAt: new Date(Date.now()) });
    await expectDeniedEverywhere(token, 'Token expired');
  });

  it('nega inatividade além de 24h em todos os caminhos', async () => {
    const token = await insertSession({ lastSeenAt: new Date(Date.now() - (24 * 60 * 60 * 1000 + 60_000)) });
    await expectDeniedEverywhere(token, 'Session idle timeout');
  });

  it('nega sessão revogada em todos os caminhos', async () => {
    const token = await insertSession({ revokedAt: new Date() });
    await expectDeniedEverywhere(token, 'Invalid token');
  });

  it('nega usuário desativado em todos os caminhos', async () => {
    const token = await insertSession();
    await db.update(schema.users).set({ isActive: false }).where(eq(schema.users.id, userId));

    await expectDeniedEverywhere(token, 'User not found or inactive');
  });

  it('rotação emite sucessora, invalida a antiga e preserva o prazo absoluto', async () => {
    const oldToken = await login();
    const originalAbsolute = (await sessionTimestamps(oldToken)).absoluteExpiresAtMs!;

    const response = await rotate(oldToken);
    expect(response.statusCode).toBe(200);
    const newToken = (response.json() as { token: string }).token;
    expect(newToken).not.toBe(oldToken);

    const oldMe = await app.inject({ method: 'GET', url: '/auth/me', headers: auth(oldToken) });
    expect(oldMe.statusCode).toBe(401);

    const newMe = await app.inject({ method: 'GET', url: '/auth/me', headers: auth(newToken) });
    expect(newMe.statusCode).toBe(200);

    const successorTimestamps = await sessionTimestamps(newToken);
    expect(successorTimestamps.absoluteExpiresAtMs).toBe(originalAbsolute);

    const successor = await sessionRow(newToken);
    expect(successor.userId).toBe(userId);
    expect(successor.expiresAt!.getTime()).toBeLessThanOrEqual(originalAbsolute);
    expect((await sessionRow(oldToken)).revokedAt).not.toBeNull();
  });

  it('múltiplas rotações mantêm o prazo absoluto original', async () => {
    const token = await login();
    const originalAbsolute = (await sessionTimestamps(token)).absoluteExpiresAtMs!;

    const first = await rotate(token);
    expect(first.statusCode).toBe(200);
    const firstToken = (first.json() as { token: string }).token;

    const second = await rotate(firstToken);
    expect(second.statusCode).toBe(200);
    const secondToken = (second.json() as { token: string }).token;

    const successorTimestamps = await sessionTimestamps(secondToken);
    expect(successorTimestamps.absoluteExpiresAtMs).toBe(originalAbsolute);

    const successor = await sessionRow(secondToken);
    expect(successor.expiresAt!.getTime()).toBeLessThanOrEqual(originalAbsolute);
  });

  it('materializa o absoluto de sessão legada ancorado no created_at original', async () => {
    const createdAt = new Date(Date.now() - 60 * 60 * 1000);
    const token = await insertSession({
      createdAt,
      expiresAt: null,
      absoluteExpiresAt: null,
      lastSeenAt: null,
    });

    const response = await rotate(token);
    expect(response.statusCode).toBe(200);
    const newToken = (response.json() as { token: string }).token;

    const successor = await sessionRow(newToken);
    const successorTimestamps = await sessionTimestamps(newToken);
    const expectedAbsolute = createdAt.getTime() + 30 * 24 * 60 * 60 * 1000;
    expect(successorTimestamps.absoluteExpiresAtMs).not.toBeNull();
    expect(Math.abs(successorTimestamps.absoluteExpiresAtMs! - expectedAbsolute)).toBeLessThan(2000);
    expect(successor.expiresAt!.getTime()).toBeLessThanOrEqual(successorTimestamps.absoluteExpiresAtMs!);
  });

  it('duas rotações concorrentes do mesmo token produzem uma única sucessora', async () => {
    const token = await login();

    const [first, second] = await Promise.all([rotate(token), rotate(token)]);
    const statuses = [first.statusCode, second.statusCode].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 401]);

    const rows = await db.select().from(schema.sessions).where(eq(schema.sessions.userId, userId));
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.revokedAt === null)).toHaveLength(1);
    expect(rows.filter((row) => row.revokedReason === 'rotation')).toHaveLength(1);

    const winner = first.statusCode === 200 ? first : second;
    const loser = first.statusCode === 200 ? second : first;
    const winnerToken = (winner.json() as { token: string }).token;

    expect((await app.inject({ method: 'GET', url: '/auth/me', headers: auth(winnerToken) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/auth/me', headers: auth(token) })).statusCode).toBe(401);
    expect(loser.json()).toMatchObject({ error: 'UNAUTHORIZED' });
  });

  it('falha transacional na rotação não revoga a sessão antiga nem cria sucessora', async () => {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS aaa03_rotate_poison (marker text primary key)`);
    await db.execute(sql`CREATE OR REPLACE FUNCTION aaa03_poison_rotate() RETURNS trigger AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM aaa03_rotate_poison) THEN
          RAISE EXCEPTION 'aaa03 forced rotation failure';
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await db.execute(sql`DROP TRIGGER IF EXISTS aaa03_poison_rotate ON sessions`);
    await db.execute(sql`CREATE TRIGGER aaa03_poison_rotate BEFORE INSERT ON sessions FOR EACH ROW EXECUTE FUNCTION aaa03_poison_rotate()`);

    try {
      const token = await login();
      await db.execute(sql`INSERT INTO aaa03_rotate_poison (marker) VALUES ('on')`);

      const response = await rotate(token);
      expect(response.statusCode).toBe(500);

      const oldSession = await sessionRow(token);
      expect(oldSession.revokedAt).toBeNull();
      expect(await countActiveSessions()).toBe(1);

      const oldMe = await app.inject({ method: 'GET', url: '/auth/me', headers: auth(token) });
      expect(oldMe.statusCode).toBe(200);
    } finally {
      await db.execute(sql`DELETE FROM aaa03_rotate_poison`);
      await db.execute(sql`DROP TRIGGER IF EXISTS aaa03_poison_rotate ON sessions`);
      await db.execute(sql`DROP FUNCTION IF EXISTS aaa03_poison_rotate()`);
      await db.execute(sql`DROP TABLE IF EXISTS aaa03_rotate_poison`);
    }
  });

  it('logout-all valida o token apresentado e revoga todas as sessões', async () => {
    const tokenA = await login();
    const tokenB = await login();

    const response = await app.inject({ method: 'POST', url: '/auth/logout-all', headers: auth(tokenA) });
    expect(response.statusCode).toBe(200);

    for (const token of [tokenA, tokenB]) {
      const me = await app.inject({ method: 'GET', url: '/auth/me', headers: auth(token) });
      expect(me.statusCode).toBe(401);
    }
  });

  it('logout-all nega token expirado em vez de revogar sessões', async () => {
    const token = await insertSession({ expiresAt: new Date(Date.now() - 1000) });
    const response = await app.inject({ method: 'POST', url: '/auth/logout-all', headers: auth(token) });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: 'UNAUTHORIZED', message: 'Token expired' });
  });
});
