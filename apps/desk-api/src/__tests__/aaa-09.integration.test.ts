import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import net from 'node:net';
import { Writable } from 'node:stream';
import { sql } from 'drizzle-orm';
import { db } from '@cvg/database';
import { buildDeskApiApp } from '../app.ts';

/**
 * AAA-09 — readiness e dependências operacionais (achado A08; C08; QA04/QA13/QA15).
 *
 * Prova em HTTP real (`app.inject`) contra PostgreSQL real do run
 * `aaa-20260912-a9` em 127.0.0.1:56432 (marcador obrigatório no beforeAll; sem
 * fallback 5432):
 *   - `/readiness` 503 quando o banco está indisponível OU o ledger de
 *     migrations está atrás do schema esperado; 200 só com DB + schema ok;
 *   - `/health` (liveness) permanece 200 e independente de DB/Redis;
 *   - Redis valida AUTH (`AUTH`/`NOAUTH`/`WRONGPASS`) e TLS (`rediss://`);
 *     falha vira `degraded` ou `error` (503) conforme REDIS_REQUIRED;
 *   - dependências opcionais degradam explicitamente;
 *   - respostas e logs não carregam senha/string de conexão/mensagem de erro.
 *
 * Servidores Redis/blackhole são dublês TCP locais: nada toca 6379/5432.
 */

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const DB_MARKER = 'aaa-20260912-a9';
const REDIS_PASSWORD = 'aaa09-redis-secret';
const REDIS_WRONG_PASSWORD = 'aaa09-wrong-password';
const DB_LEAK_PASSWORD = 'aaa09-db-secret';
const MISSING_USER = 'aaa09_no_such_user';
const MISSING_DATABASE = 'aaa09_no_such_database';
const WRONG_PORT = 56431;

const ENV_KEYS = [
  'DATABASE_URL',
  'REDIS_URL',
  'REDIS_REQUIRED',
  'REDIS_CRITICAL',
  'REDIS_TLS_REJECT_UNAUTHORIZED',
  'READINESS_DB_TIMEOUT_MS',
  'READINESS_REDIS_TIMEOUT_MS',
  'READINESS_SECRETARY_TIMEOUT_MS',
  'SECRETARY_URL',
  'SECRETARY_API_KEY',
] as const;

interface CheckEntry {
  status: 'ok' | 'error' | 'degraded';
  latencyMs?: number;
  code?: string;
  applied?: number;
  expected?: number;
  missing?: string[];
  mismatched?: string[];
}

interface ReadinessBody {
  ready: boolean;
  degraded: boolean;
  checks: Record<string, CheckEntry>;
  version: string;
  timestamp: string;
}

interface FakeRedisStats {
  authAttempts: number;
  authSucceeded: number;
  pings: number;
  noauthPings: number;
  tlsClientHello: boolean;
}

interface OpenServer {
  port: number;
  close(): Promise<void>;
}

function handleFakeRedisConnection(socket: net.Socket, password: string, stats: FakeRedisStats): void {
  let buffer = '';
  let tlsDetected = false;
  let authenticated = false;

  const sendLine = (line: string): void => {
    socket.write(`${line}\r\n`);
  };

  const processCommand = (args: string[]): void => {
    const command = (args[0] ?? '').toUpperCase();
    if (command === 'AUTH') {
      stats.authAttempts += 1;
      const provided = args.length >= 3 ? args[2] : args[1];
      if (provided === password) {
        authenticated = true;
        stats.authSucceeded += 1;
        sendLine('+OK');
      } else {
        sendLine('-WRONGPASS invalid username-password pair');
      }
      return;
    }
    if (command === 'PING') {
      stats.pings += 1;
      if (authenticated) {
        sendLine('+PONG');
      } else {
        stats.noauthPings += 1;
        sendLine('-NOAUTH Authentication required.');
      }
      return;
    }
    sendLine('-ERR unknown command');
  };

  socket.on('error', () => undefined);
  socket.on('data', (chunk: Buffer) => {
    if (tlsDetected) return;
    if (chunk.length > 0 && chunk[0] === 0x16) {
      tlsDetected = true;
      stats.tlsClientHello = true;
      socket.write('-ERR plaintext server\r\n');
      return;
    }
    buffer += chunk.toString('utf8');
    for (;;) {
      if (buffer.startsWith('*')) {
        const headerEnd = buffer.indexOf('\r\n');
        if (headerEnd === -1) return;
        const count = Number(buffer.slice(1, headerEnd));
        let cursor = headerEnd + 2;
        const args: string[] = [];
        let complete = true;
        for (let index = 0; index < count; index += 1) {
          const lengthEnd = buffer.indexOf('\r\n', cursor);
          if (lengthEnd === -1) {
            complete = false;
            break;
          }
          const length = Number(buffer.slice(cursor + 1, lengthEnd));
          const start = lengthEnd + 2;
          if (!Number.isFinite(length) || buffer.length < start + length + 2) {
            complete = false;
            break;
          }
          args.push(buffer.slice(start, start + length));
          cursor = start + length + 2;
        }
        if (!complete) return;
        buffer = buffer.slice(cursor);
        processCommand(args);
        continue;
      }
      const lineEnd = buffer.indexOf('\r\n');
      if (lineEnd === -1) return;
      const line = buffer.slice(0, lineEnd).trim();
      buffer = buffer.slice(lineEnd + 2);
      if (line.length > 0) processCommand(line.split(/\s+/));
    }
  });
}

function startFakeRedis(password: string): Promise<OpenServer & { stats: FakeRedisStats }> {
  const stats: FakeRedisStats = {
    authAttempts: 0,
    authSucceeded: 0,
    pings: 0,
    noauthPings: 0,
    tlsClientHello: false,
  };
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    handleFakeRedisConnection(socket, password, stats);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as net.AddressInfo;
      resolve({
        port: address.port,
        stats,
        close: () =>
          new Promise<void>((done) => {
            for (const socket of sockets) socket.destroy();
            server.close(() => done());
          }),
      });
    });
  });
}

function startBlackhole(): Promise<OpenServer> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as net.AddressInfo;
      resolve({
        port: address.port,
        close: () =>
          new Promise<void>((done) => {
            for (const socket of sockets) socket.destroy();
            server.close(() => done());
          }),
      });
    });
  });
}

describe('AAA-09 — readiness, liveness e dependências operacionais', () => {
  let app: Awaited<ReturnType<typeof buildDeskApiApp>>;
  let fakeRedis: Awaited<ReturnType<typeof startFakeRedis>>;
  let blackhole: OpenServer;
  const logChunks: string[] = [];
  let suiteReady = false;
  const servers: OpenServer[] = [];
  const envSnapshot = new Map<string, string | undefined>();
  let previousRateLimitMax: string | undefined;

  function readiness(): Promise<ReadinessBody & { statusCode: number; raw: string }> {
    return app.inject({ method: 'GET', url: '/readiness' }).then((response) => ({
      ...(response.json() as ReadinessBody),
      statusCode: response.statusCode,
      raw: response.body,
    }));
  }

  function logsSince(mark: number): string {
    return logChunks.slice(mark).join('');
  }

  beforeAll(async () => {
    if (!DATABASE_URL.includes('127.0.0.1:56432') || !/\/cvg_aaa_[a-z0-9_]*a9(\?|$)/.test(DATABASE_URL)) {
      throw new Error(`AAA-09 exige DATABASE_URL do run a9 em 127.0.0.1:56432; recebido: ${DATABASE_URL}`);
    }
    const markerResult = await db.execute(sql`SELECT run_id FROM aaa_environment_marker WHERE run_id = ${DB_MARKER}`);
    const markerRows = (markerResult as unknown as { rows: Array<{ run_id: string }> }).rows ?? [];
    if (markerRows.length === 0) {
      throw new Error(`Marcador ${DB_MARKER} ausente no banco informado.`);
    }

    fakeRedis = await startFakeRedis(REDIS_PASSWORD);
    blackhole = await startBlackhole();
    servers.push(fakeRedis, blackhole);

    previousRateLimitMax = process.env.RATE_LIMIT_MAX;
    process.env.RATE_LIMIT_MAX = '100000';
    const logStream = new Writable({
      write(chunk, _encoding, callback) {
        logChunks.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
        callback();
      },
    });
    app = await buildDeskApiApp({ loggerStream: logStream });
    await app.ready();
    suiteReady = true;
  });

  beforeEach(() => {
    for (const key of ENV_KEYS) envSnapshot.set(key, process.env[key]);
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = envSnapshot.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  afterAll(async () => {
    for (const server of servers) {
      await server.close();
    }
    if (previousRateLimitMax === undefined) delete process.env.RATE_LIMIT_MAX;
    else process.env.RATE_LIMIT_MAX = previousRateLimitMax;
    if (suiteReady) await app.close();
  });

  it('readiness 200 saudável: banco acessível e ledger no schema esperado', async () => {
    const body = await readiness();
    expect(body.statusCode).toBe(200);
    expect(body.ready).toBe(true);
    expect(body.degraded).toBe(false);
    expect(body.checks.database?.status).toBe('ok');
    expect(body.checks.migrations?.status).toBe('ok');
    expect(body.checks.migrations?.expected).toBeGreaterThan(0);
    expect(body.checks.migrations?.applied).toBe(body.checks.migrations?.expected);

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect((health.json() as { status: string }).status).toBe('ok');
  });

  it('readiness 503 quando o ledger de migrations está atrás do schema esperado', async () => {
    const ledger = await db.execute(sql`SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 1`);
    const last = (ledger as unknown as { rows: Array<{ id: number; hash: string; created_at: string | number }> }).rows[0];
    expect(last).toBeDefined();

    try {
      await db.execute(sql`DELETE FROM drizzle.__drizzle_migrations WHERE id = ${last.id}`);
      const body = await readiness();
      expect(body.statusCode).toBe(503);
      expect(body.ready).toBe(false);
      expect(body.checks.database?.status).toBe('ok');
      expect(body.checks.migrations?.status).toBe('error');
      expect(body.checks.migrations?.code).toBe('SCHEMA_BEHIND');
      expect(body.checks.migrations?.applied).toBe((body.checks.migrations?.expected ?? 0) - 1);
      expect(body.checks.migrations?.missing?.length).toBeGreaterThan(0);
    } finally {
      await db.execute(sql`INSERT INTO drizzle.__drizzle_migrations (id, hash, created_at) VALUES (${last.id}, ${last.hash}, ${last.created_at})`);
    }

    const restored = await readiness();
    expect(restored.statusCode).toBe(200);
    expect(restored.checks.migrations?.status).toBe('ok');
  });

  it('readiness 503 quando o hash do ledger diverge do SQL esperado', async () => {
    const ledger = await db.execute(sql`SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 1`);
    const last = (ledger as unknown as { rows: Array<{ id: number; hash: string; created_at: string | number }> }).rows[0];
    expect(last).toBeDefined();

    try {
      await db.execute(sql`UPDATE drizzle.__drizzle_migrations SET hash = 'ledger-hash-divergente-aaa09' WHERE id = ${last.id}`);
      const body = await readiness();
      expect(body.statusCode).toBe(503);
      expect(body.ready).toBe(false);
      expect(body.checks.database?.status).toBe('ok');
      expect(body.checks.migrations?.status).toBe('error');
      expect(body.checks.migrations?.code).toBe('SCHEMA_MISMATCH');
      expect(body.checks.migrations?.mismatched?.length).toBeGreaterThan(0);
    } finally {
      await db.execute(sql`UPDATE drizzle.__drizzle_migrations SET hash = ${last.hash} WHERE id = ${last.id}`);
    }

    const restored = await readiness();
    expect(restored.statusCode).toBe(200);
  });

  it('readiness 503 com DATABASE_URL ausente, sem cair para nenhum default', async () => {
    delete process.env.DATABASE_URL;

    const body = await readiness();
    expect(body.statusCode).toBe(503);
    expect(body.ready).toBe(false);
    expect(body.checks.database?.status).toBe('error');
    expect(body.checks.database?.code).toBe('DB_URL_MISSING');
    expect(body.checks.migrations?.status).toBe('error');
    expect(body.checks.migrations?.code).toBe('SCHEMA_UNVERIFIABLE');
    expect(body.raw).not.toContain('5432');
  });

  it('readiness 503 com banco inalcançável; liveness 200; sem vazar conexão/credencial', async () => {
    process.env.DATABASE_URL = `postgresql://cvg_aaa:${DB_LEAK_PASSWORD}@127.0.0.1:${WRONG_PORT}/cvg_aaa_aaa_20260912_a9`;
    process.env.READINESS_DB_TIMEOUT_MS = '1000';
    const logMark = logChunks.length;

    const started = Date.now();
    const body = await readiness();
    const elapsedMs = Date.now() - started;

    expect(body.statusCode).toBe(503);
    expect(body.ready).toBe(false);
    expect(body.checks.database?.status).toBe('error');
    expect(['DB_UNAVAILABLE', 'DB_TIMEOUT']).toContain(body.checks.database?.code);
    expect(body.checks.migrations?.status).toBe('error');
    expect(body.checks.migrations?.code).toBe('SCHEMA_UNVERIFIABLE');
    expect(elapsedMs).toBeLessThan(4000);

    expect(body.raw).not.toContain(DB_LEAK_PASSWORD);
    expect(body.raw).not.toContain('postgresql://');
    expect(body.raw).not.toContain(`127.0.0.1:${WRONG_PORT}`);
    expect(body.raw).not.toContain('ECONNREFUSED');

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect((health.json() as { status: string }).status).toBe('ok');

    const captured = logsSince(logMark);
    expect(captured).toContain('readiness: dependência crítica indisponível');
    expect(captured).not.toContain(DB_LEAK_PASSWORD);
    expect(captured).not.toContain('postgresql://');
    expect(captured).not.toContain('select "id"');
    expect(captured).not.toContain('ECONNREFUSED');
  });

  it('readiness 503 com usuário/banco inválidos sem vazar detalhes', async () => {
    process.env.DATABASE_URL = `postgresql://${MISSING_USER}:${DB_LEAK_PASSWORD}@127.0.0.1:56432/${MISSING_DATABASE}`;
    process.env.READINESS_DB_TIMEOUT_MS = '1000';

    const body = await readiness();
    expect(body.statusCode).toBe(503);
    expect(body.checks.database?.status).toBe('error');
    expect(body.checks.database?.code).toBe('DB_UNAVAILABLE');
    expect(body.raw).not.toContain(MISSING_USER);
    expect(body.raw).not.toContain(MISSING_DATABASE);
    expect(body.raw).not.toContain(DB_LEAK_PASSWORD);
    expect(body.raw).not.toContain('role');
    expect(body.raw).not.toContain('does not exist');
  });

  it('readiness é limitado por timeout quando o banco aceita TCP e não responde', async () => {
    process.env.DATABASE_URL = `postgresql://cvg_aaa:${DB_LEAK_PASSWORD}@127.0.0.1:${blackhole.port}/cvg_aaa_aaa_20260912_a9`;
    process.env.READINESS_DB_TIMEOUT_MS = '800';

    const started = Date.now();
    const body = await readiness();
    const elapsedMs = Date.now() - started;

    expect(body.statusCode).toBe(503);
    expect(body.checks.database?.code).toBe('DB_TIMEOUT');
    expect(elapsedMs).toBeGreaterThanOrEqual(700);
    expect(elapsedMs).toBeLessThan(3000);
    expect(body.raw).not.toContain(DB_LEAK_PASSWORD);
  });

  it('sem REDIS_URL nenhum check de redis é exigido', async () => {
    delete process.env.REDIS_URL;
    const body = await readiness();
    expect(body.statusCode).toBe(200);
    expect(body.checks.redis).toBeUndefined();
    expect(body.degraded).toBe(false);
  });

  it('Redis com AUTH correto: readiness 200 e AUTH realmente enviado', async () => {
    process.env.REDIS_URL = `redis://:${REDIS_PASSWORD}@127.0.0.1:${fakeRedis.port}`;
    process.env.REDIS_REQUIRED = 'true';
    const authBefore = fakeRedis.stats.authAttempts;

    const body = await readiness();
    expect(body.statusCode).toBe(200);
    expect(body.ready).toBe(true);
    expect(body.checks.redis?.status).toBe('ok');
    expect(fakeRedis.stats.authAttempts).toBeGreaterThan(authBefore);
    expect(fakeRedis.stats.authSucceeded).toBeGreaterThan(0);
    expect(body.raw).not.toContain(REDIS_PASSWORD);
  });

  it('Redis com senha errada e REDIS_REQUIRED=true → 503 sem vazar a senha', async () => {
    process.env.REDIS_URL = `redis://:${REDIS_WRONG_PASSWORD}@127.0.0.1:${fakeRedis.port}`;
    process.env.REDIS_REQUIRED = 'true';
    const logMark = logChunks.length;

    const body = await readiness();
    expect(body.statusCode).toBe(503);
    expect(body.ready).toBe(false);
    expect(body.checks.redis?.status).toBe('error');
    expect(body.checks.redis?.code).toBe('REDIS_AUTH_FAILED');
    expect(body.raw).not.toContain(REDIS_PASSWORD);
    expect(body.raw).not.toContain(REDIS_WRONG_PASSWORD);
    expect(logsSince(logMark)).not.toContain(REDIS_WRONG_PASSWORD);
  });

  it('Redis com senha errada e sem REDIS_REQUIRED → 200 degraded explícito', async () => {
    process.env.REDIS_URL = `redis://:${REDIS_WRONG_PASSWORD}@127.0.0.1:${fakeRedis.port}`;
    delete process.env.REDIS_REQUIRED;

    const body = await readiness();
    expect(body.statusCode).toBe(200);
    expect(body.ready).toBe(true);
    expect(body.degraded).toBe(true);
    expect(body.checks.redis?.status).toBe('degraded');
    expect(body.checks.redis?.code).toBe('REDIS_AUTH_FAILED');
    expect(body.raw).not.toContain(REDIS_WRONG_PASSWORD);
  });

  it('Redis sem credencial contra servidor autenticado → REDIS_AUTH_REQUIRED sem tentar AUTH', async () => {
    process.env.REDIS_URL = `redis://127.0.0.1:${fakeRedis.port}`;
    delete process.env.REDIS_REQUIRED;
    const authBefore = fakeRedis.stats.authAttempts;

    const body = await readiness();
    expect(body.statusCode).toBe(200);
    expect(body.ready).toBe(true);
    expect(body.degraded).toBe(true);
    expect(body.checks.redis?.status).toBe('degraded');
    expect(body.checks.redis?.code).toBe('REDIS_AUTH_REQUIRED');
    expect(fakeRedis.stats.authAttempts).toBe(authBefore);
  });

  it('rediss:// exige TLS: handshake observado contra servidor plaintext → falha explícita', async () => {
    process.env.REDIS_URL = `rediss://127.0.0.1:${fakeRedis.port}`;
    process.env.REDIS_REQUIRED = 'true';
    const tlsBefore = fakeRedis.stats.tlsClientHello;

    const body = await readiness();
    expect(body.statusCode).toBe(503);
    expect(body.checks.redis?.status).toBe('error');
    expect(body.checks.redis?.code).toBe('REDIS_TLS_FAILED');
    expect(fakeRedis.stats.tlsClientHello).toBe(true);
    expect(tlsBefore).toBe(false);
  });

  it('esquema de REDIS_URL inválido falha explícito quando Redis é crítico', async () => {
    process.env.REDIS_URL = 'http://127.0.0.1:6379';
    process.env.REDIS_REQUIRED = 'true';

    const body = await readiness();
    expect(body.statusCode).toBe(503);
    expect(body.checks.redis?.code).toBe('REDIS_URL_INVALID');
  });

  it('dependência opcional (Secretary) degrada explicitamente sem derrubar readiness', async () => {
    process.env.SECRETARY_URL = 'http://127.0.0.1:9';
    process.env.READINESS_SECRETARY_TIMEOUT_MS = '800';

    const body = await readiness();
    expect(body.statusCode).toBe(200);
    expect(body.ready).toBe(true);
    expect(body.degraded).toBe(true);
    expect(body.checks.secretary?.status).toBe('degraded');
    expect(body.checks.secretary?.code).toBe('SECRETARY_UNREACHABLE');
    expect(body.raw).not.toContain('127.0.0.1:9');
  });
});
