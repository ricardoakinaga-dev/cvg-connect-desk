/**
 * PROD-05 — Sessão, rotação e revalidação HTTP/WS (AC1–AC4).
 *
 * Roda com PostgreSQL + Redis REAIS do harness AAA isolado
 * (`cvg_aaa_prod05_20260913_w15`, 127.0.0.1:57932/56830 — nunca o banco do
 * host). O provisionamento é do próprio teste:
 *   provisionIsolatedEnv -> db:migrate real -> app real (`buildDeskApiApp`)
 *   -> realtime-service real (child `tsx src/index.ts`) com socket real.
 * Teardown ao final: `{ stopServices: true, dropDatabase: true }`.
 *
 * O processo roda em TZ=America/Sao_Paulo (UTC-3) para provar que os
 * deadlines são instantes absolutos (TIMESTAMPTZ da migration 0023) e não
 * dependem do fuso do cliente.
 *
 * AC1  Token opaco só hash; 7d normal/30d absoluto/24h idle; limite exato
 *      nega; rotação não estende o absoluto; legado ancora no created_at.
 * AC2  login/logout/me/rotate/logout-all; usuário desativado nega;
 *      concorrência de rotação com um único vencedor; fuso do processo.
 * AC3  Revalidação WS usa a mesma política do HTTP (`evaluateSession`) e o
 *      sucessor de rotação é aceito enquanto o token antigo é recusado;
 *      tokens viajam em Authorization/`auth` message, nunca em querystring;
 *      logs do app e do realtime não contêm o token.
 * AC4  Boot não exige JWT (sessões opacas) e o segredo interno efetivo é
 *      `INTERNAL_EVENTS_SECRET`; config legada JWT é registrada como
 *      inconsistência documentada (fora do escopo de escrita deste cartão).
 */
import '../integration-mocks';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import net from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Writable } from 'node:stream';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 600_000 });

// AC2 — o fuso do processo é diferente do UTC. Node invalida o cache de TZ
// quando `process.env.TZ` muda, então o valor vale para todo o arquivo.
process.env.TZ = 'America/Sao_Paulo';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..', '..');
const PROGRAM_DIR = process.env.CVG_PROGRAM_DIR || join(REPO_ROOT, 'docs', 'producao-2026-09-13');
const EVIDENCE_SEGMENT = process.env.CVG_EVIDENCE_SEGMENT?.trim();
const EVIDENCE_DIR = join(
  PROGRAM_DIR,
  'evidencias',
  'prod-05',
  ...(EVIDENCE_SEGMENT ? [EVIDENCE_SEGMENT] : []),
);
const LOG_DIR = join(EVIDENCE_DIR, 'logs');

process.env.CVG_PROGRAM_DIR = PROGRAM_DIR;
process.env.CVG_RUNTIME_DIR = process.env.CVG_RUNTIME_DIR || join(EVIDENCE_DIR, 'runtime');
process.env.AAA_RUN_ID = process.env.AAA_RUN_ID || 'prod05-20260913';
process.env.AAA_WORKER_INDEX = process.env.AAA_WORKER_INDEX || '15';

const RUN_ID = process.env.AAA_RUN_ID;
const WORKER_INDEX = Number(process.env.AAA_WORKER_INDEX);
const ATTEMPT = Number(process.env.AAA_ATTEMPT || process.env.R3_ATTEMPT || 1);
const INTERNAL_SECRET = `prod05-internal-${RUN_ID}`;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const IDLE_MS = 24 * 60 * 60 * 1000;

type DatabaseModule = typeof import('@cvg/database');

interface RunContext {
  runId: string;
  databaseName: string;
  databaseUrl: string;
  redisUrl: string;
  ports: { postgres: number; redis: number };
}

interface Harness {
  provisionIsolatedEnv: (
    context: RunContext,
  ) => Promise<{ databaseName: string; marker: { runId: string } }>;
  teardownIsolatedEnv: (
    context: RunContext,
    options?: { stopServices?: boolean; dropDatabase?: boolean },
  ) => Record<string, unknown>;
}

let ctx: RunContext;
let harness: Pick<Harness, 'teardownIsolatedEnv'>;
let databaseModule: DatabaseModule | undefined;
let app: FastifyInstance;
let appUrl = '';
let db: DatabaseModule['db'];
let schema: DatabaseModule['schema'];

const password = 'Str0ngPass!42';
const passwordHash = '$2a$10$QMxMJ8QfVxjH93DvTDs2m.OVuALoBBR6S9d58BwIPb8rcXHsUBJWC';
const suffix = String(Date.now()).slice(-6);
const email = `prod05.${suffix}@example.com`;
let userId = '';

const probes: Array<{
  id: string;
  method: string;
  url: string;
  expected: number[];
  status: number;
  note?: string;
}> = [];
const sessionTokens: string[] = [];
const logChunks: string[] = [];
const childLogs: string[] = [];
const openSockets: TestSocket[] = [];
let realtimeChild: ChildProcess | undefined;
let realtimePort = 0;

const ENV_KEYS = [
  'JWT_SECRET',
  'INTERNAL_EVENTS_SECRET',
  'REALTIME_INTERNAL_SECRET',
  'EVENTS_API_KEY',
  'RATE_LIMIT_MAX',
  'RATE_LIMIT_LOGIN_MAX',
  'DESK_API_URL',
  'USE_DATABASE_OUTBOX',
  'REALTIME_POLL_INTERVAL_MS',
  'REALTIME_AUTH_REVALIDATE_MS',
  'REALTIME_AUTHZ_CACHE_MS',
  'REALTIME_PORT',
  'DATABASE_URL',
  'REDIS_URL',
  'LOG_LEVEL',
  'NODE_ENV',
] as const;
const envSnapshot = new Map<string, string | undefined>();

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function probe(id: string, method: string, url: string, expected: number[], status: number, note?: string): void {
  probes.push({ id, method, url, expected, status, note });
}

function recordToken(token: string): string {
  sessionTokens.push(token);
  return token;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs = 8000, label = 'condition'): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for ${label}`);
    }
    await wait(25);
  }
}

async function getFreePort(): Promise<number> {
  const probeServer = createServer();
  return await new Promise<number>((resolvePromise, reject) => {
    probeServer.on('error', reject);
    probeServer.listen(0, '127.0.0.1', () => {
      const port = (probeServer.address() as AddressInfo).port;
      probeServer.close((error) => (error ? reject(error) : resolvePromise(port)));
    });
  });
}

async function waitForTcpPort(port: number, timeoutMs = 30_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const open = await new Promise<boolean>((resolvePromise) => {
      const socket = net.connect(port, '127.0.0.1');
      const finish = (value: boolean) => {
        socket.removeAllListeners();
        socket.destroy();
        resolvePromise(value);
      };
      socket.once('connect', () => finish(true));
      socket.once('error', () => finish(false));
      socket.setTimeout(500, () => finish(false));
    });
    if (open) return;
    await wait(100);
  }
  throw new Error(`realtime-service não abriu a porta ${port}`);
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

async function login(): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
  expect(response.statusCode, response.body).toBe(200);
  return recordToken((response.json() as { token: string }).token);
}

async function me(token: string) {
  return app.inject({ method: 'GET', url: '/auth/me', headers: auth(token) });
}

async function rotate(token: string) {
  return app.inject({ method: 'POST', url: '/auth/rotate', headers: auth(token) });
}

async function logout(token: string) {
  return app.inject({ method: 'POST', url: '/auth/logout', headers: auth(token) });
}

async function logoutAll(token: string) {
  return app.inject({ method: 'POST', url: '/auth/logout-all', headers: auth(token) });
}

interface SessionOverrides {
  expiresAt?: Date | null;
  absoluteExpiresAt?: Date | null;
  lastSeenAt?: Date | null;
  revokedAt?: Date | null;
  createdAt?: Date;
}

async function insertSession(overrides: SessionOverrides = {}): Promise<string> {
  const token = recordToken(`${randomUUID()}.${randomBytes(24).toString('hex')}`);
  const now = Date.now();
  await db.insert(schema.sessions).values({
    userId,
    token: sha256(token),
    tokenHash: sha256(token),
    expiresAt: overrides.expiresAt === undefined ? new Date(now + 60 * 60 * 1000) : overrides.expiresAt,
    absoluteExpiresAt:
      overrides.absoluteExpiresAt === undefined ? new Date(now + 24 * 60 * 60 * 1000) : overrides.absoluteExpiresAt,
    lastSeenAt: overrides.lastSeenAt === undefined ? new Date(now) : overrides.lastSeenAt,
    revokedAt: overrides.revokedAt ?? null,
    ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
  });
  return token;
}

interface SessionEpochs {
  expiresMs: number | null;
  absoluteMs: number | null;
  lastSeenMs: number | null;
  revokedMs: number | null;
  createdMs: number | null;
}

async function sessionEpochs(token: string): Promise<SessionEpochs> {
  const result = await db.execute(sql`
    SELECT
      (extract(epoch from expires_at) * 1000)::double precision AS expires_ms,
      (extract(epoch from absolute_expires_at) * 1000)::double precision AS absolute_ms,
      (extract(epoch from last_seen_at) * 1000)::double precision AS last_seen_ms,
      (extract(epoch from revoked_at) * 1000)::double precision AS revoked_ms,
      (extract(epoch from created_at) * 1000)::double precision AS created_ms
    FROM sessions WHERE token = ${sha256(token)}
  `);
  const row = (result.rows[0] ?? {}) as Record<string, number | null>;
  const toMs = (value: number | null | undefined) => (value === null || value === undefined ? null : Math.round(Number(value)));
  return {
    expiresMs: toMs(row.expires_ms),
    absoluteMs: toMs(row.absolute_ms),
    lastSeenMs: toMs(row.last_seen_ms),
    revokedMs: toMs(row.revoked_ms),
    createdMs: toMs(row.created_ms),
  };
}

async function sessionRows() {
  return db.select().from(schema.sessions).where(eq(schema.sessions.userId, userId));
}

/** ---- WebSocket real (global WebSocket do Node 24) ---- */

interface SocketMessage {
  event?: string;
  data?: { type?: string; payload?: Record<string, unknown>; [key: string]: unknown };
  [key: string]: unknown;
}

interface TestSocket {
  socket: WebSocket;
  messages: SocketMessage[];
  closeCode?: number;
}

async function connectSocket(token?: string): Promise<TestSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${realtimePort}`);
  const client: TestSocket = { socket, messages: [] };
  socket.addEventListener('message', (event: MessageEvent) => {
    try {
      client.messages.push(typeof event.data === 'string' ? JSON.parse(event.data) : { raw: String(event.data) });
    } catch {
      client.messages.push({ raw: String(event.data) });
    }
  });
  socket.addEventListener('close', (event: CloseEvent) => {
    client.closeCode = event.code;
  });
  await new Promise<void>((resolvePromise, reject) => {
    socket.addEventListener('open', () => resolvePromise(), { once: true });
    socket.addEventListener('error', () => reject(new Error('websocket error')), { once: true });
  });
  await waitFor(() => client.messages.some((message) => message.event === 'auth.required'), 8000, 'auth.required');
  if (token) {
    socket.send(JSON.stringify({ type: 'auth', token }));
  }
  openSockets.push(client);
  return client;
}

function hasEvent(client: TestSocket, event: string): boolean {
  return client.messages.some((message) => message.event === event);
}

function collectSourceFiles(root: string): string[] {
  const entries = readdirSync(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === '__tests__') continue;
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

beforeAll(async () => {
  mkdirSync(LOG_DIR, { recursive: true });
  expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/Sao_Paulo');
  expect(new Date().getTimezoneOffset()).toBe(180);

  const runContextModule = (await import(
    pathToFileURL(join(REPO_ROOT, 'e2e/support/aaa/run-context.ts')).href
  )) as { getRunContext: (workerIndex?: number) => RunContext };
  const isolatedEnvModule = (await import(
    pathToFileURL(join(REPO_ROOT, 'e2e/support/aaa/isolated-env.ts')).href
  )) as Harness;
  harness = { teardownIsolatedEnv: isolatedEnvModule.teardownIsolatedEnv };

  ctx = runContextModule.getRunContext(WORKER_INDEX);
  const isolated = await isolatedEnvModule.provisionIsolatedEnv(ctx);
  if (isolated.marker.runId !== RUN_ID) {
    throw new Error(`marcador do run divergente: ${isolated.marker.runId}`);
  }

  const migrated = spawnSync('pnpm', ['--filter', '@cvg/database', 'run', 'db:migrate'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 300_000,
    env: { ...process.env, DATABASE_URL: ctx.databaseUrl },
  });
  writeFileSync(
    join(LOG_DIR, 'db-migrate.log'),
    `$ pnpm --filter @cvg/database run db:migrate\nexit=${migrated.status ?? 'null'}\n${migrated.stdout}\n${migrated.stderr}\n`,
  );
  if (migrated.status !== 0) {
    throw new Error(`db:migrate falhou (exit ${migrated.status}): ${migrated.stderr || migrated.stdout}`);
  }

  for (const key of ENV_KEYS) envSnapshot.set(key, process.env[key]);

  process.env.DATABASE_URL = ctx.databaseUrl;
  process.env.REDIS_URL = ctx.redisUrl;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'info';
  process.env.RATE_LIMIT_MAX = '100000';
  process.env.RATE_LIMIT_LOGIN_MAX = '100000';
  // AC4 — a arquitetura efetiva não usa JWT; o segredo interno é
  // INTERNAL_EVENTS_SECRET (REALTIME_INTERNAL_SECRET/EVENTS_API_KEY ausentes).
  delete process.env.JWT_SECRET;
  delete process.env.REALTIME_INTERNAL_SECRET;
  delete process.env.EVENTS_API_KEY;
  process.env.INTERNAL_EVENTS_SECRET = INTERNAL_SECRET;

  const importedDatabaseModule = (await import(
    pathToFileURL(join(REPO_ROOT, 'packages/database/src/index.ts')).href
  )) as DatabaseModule;
  databaseModule = importedDatabaseModule;
  db = importedDatabaseModule.db;
  schema = importedDatabaseModule.schema;

  const logStream = new Writable({
    write(chunk, _encoding, callback) {
      logChunks.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
      callback();
    },
  });
  const appModule = (await import(pathToFileURL(join(REPO_ROOT, 'apps/desk-api/src/app.ts')).href)) as {
    buildDeskApiApp: (options?: { loggerStream?: NodeJS.WritableStream }) => Promise<FastifyInstance>;
  };
  app = await appModule.buildDeskApiApp({ loggerStream: logStream });
  await app.ready();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (!address || typeof address === 'string') {
    throw new Error('desk-api não expôs porta TCP real');
  }
  appUrl = `http://127.0.0.1:${address.port}`;
  process.env.DESK_API_URL = appUrl;

  userId = randomUUID();
  await db.insert(schema.users).values({
    id: userId,
    name: 'PROD-05 Session User',
    email,
    passwordHash,
    isActive: true,
  });
  const [existingRole] = await db.select().from(schema.roles).where(eq(schema.roles.name, 'Receptionist')).limit(1);
  let roleId = existingRole?.id;
  if (!roleId) {
    const [createdRole] = await db.insert(schema.roles).values({ name: 'Receptionist' }).returning();
    roleId = createdRole.id;
  }
  await db.insert(schema.userRoles).values({ userId, roleId });

  process.env.USE_DATABASE_OUTBOX = 'false';
  process.env.REALTIME_POLL_INTERVAL_MS = '600000';
  process.env.REALTIME_AUTH_REVALIDATE_MS = '300';
  process.env.REALTIME_AUTHZ_CACHE_MS = '300';

  realtimePort = await getFreePort();
  realtimeChild = spawn('pnpm', ['exec', 'tsx', 'src/index.ts'], {
    cwd: join(REPO_ROOT, 'apps', 'realtime-service'),
    env: {
      ...process.env,
      // O bootstrap do realtime-service só auto-inicia fora de NODE_ENV=test.
      NODE_ENV: 'development',
      REALTIME_PORT: String(realtimePort),
      DATABASE_URL: ctx.databaseUrl,
      REDIS_URL: ctx.redisUrl,
      DESK_API_URL: appUrl,
      USE_DATABASE_OUTBOX: 'false',
      REALTIME_POLL_INTERVAL_MS: '600000',
      REALTIME_AUTH_REVALIDATE_MS: '300',
      REALTIME_AUTHZ_CACHE_MS: '300',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const captureChildLog = (chunk: Buffer) => {
    const text = chunk.toString();
    childLogs.push(text);
  };
  realtimeChild.on('error', (error) => childLogs.push(`[spawn-error] ${String(error)}\n`));
  realtimeChild.on('exit', (code, signal) => childLogs.push(`[exit] code=${code} signal=${signal}\n`));
  realtimeChild.stdout?.on('data', captureChildLog);
  realtimeChild.stderr?.on('data', captureChildLog);
  await waitForTcpPort(realtimePort);
  await wait(300);
});

beforeEach(async () => {
  if (userId) {
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
    await db.update(schema.users).set({ isActive: true }).where(eq(schema.users.id, userId));
  }
});

afterAll(async () => {
  for (const client of openSockets.splice(0)) {
    try {
      client.socket.close();
    } catch {
      // socket já encerrado
    }
  }
  realtimeChild?.kill('SIGTERM');
  await wait(300);

  if (db && schema) {
    try {
      if (userId) {
        await db.delete(schema.auditLogs).where(eq(schema.auditLogs.userId, userId)).catch(() => undefined);
        await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
        await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, userId));
        await db.delete(schema.users).where(eq(schema.users.id, userId));
      }
    } catch (error) {
      writeFileSync(join(LOG_DIR, 'cleanup-error.log'), `${String(error)}\n`);
    }
  }

  writeFileSync(join(EVIDENCE_DIR, 'prod-05-probes.json'), `${JSON.stringify({
    task: 'PROD-05',
    runId: RUN_ID,
    attempt: ATTEMPT,
    evidenceSegment: EVIDENCE_SEGMENT || null,
    database: ctx?.databaseName,
    timezone: process.env.TZ,
    probes,
  }, null, 2)}\n`);
  writeFileSync(join(LOG_DIR, 'realtime-child.log'), childLogs.join(''));
  writeFileSync(join(LOG_DIR, 'desk-api.log'), logChunks.join(''));

  if (app) {
    await app.close().catch(() => undefined);
  }
  if (databaseModule?.getPool) {
    await databaseModule.getPool().end().catch(() => undefined);
  }

  for (const key of ENV_KEYS) {
    const value = envSnapshot.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  if (ctx && harness) {
    const teardown = harness.teardownIsolatedEnv(ctx, { stopServices: true, dropDatabase: true });
    writeFileSync(join(LOG_DIR, 'teardown.json'), `${JSON.stringify(teardown, null, 2)}\n`);
  }
});

describe('PROD-05 AC1 — token opaco, defaults e limites exatos (HTTP+PG real)', () => {
  it('login devolve token opaco e o banco persiste somente o hash SHA-256', async () => {
    const token = await login();
    probe('AC1.1', 'POST', '/auth/login', [200], 200, 'token opaco');

    expect(token).toMatch(/^[0-9a-f-]{36}\.[0-9a-f]{48}$/);
    expect(token.startsWith('eyJ')).toBe(false);
    expect(token.split('.')).toHaveLength(2);

    const [row] = await db.select().from(schema.sessions).where(eq(schema.sessions.tokenHash, sha256(token)));
    expect(row).toBeDefined();
    expect(row.token).toBe(sha256(token));
    expect(row.token).not.toBe(token);
    expect(row.tokenHash).toBe(sha256(token));
  });

  it('defaults reais: normal 7d, absoluto 30d e idle 24h ancorados no created_at', async () => {
    const token = await login();
    const epochs = await sessionEpochs(token);
    expect(epochs.createdMs).not.toBeNull();
    expect(Math.abs(epochs.expiresMs! - (epochs.createdMs! + SEVEN_DAYS_MS))).toBeLessThan(2000);
    expect(Math.abs(epochs.absoluteMs! - (epochs.createdMs! + THIRTY_DAYS_MS))).toBeLessThan(2000);
    expect(Math.abs(epochs.lastSeenMs! - epochs.createdMs!)).toBeLessThan(2000);
    expect(epochs.expiresMs!).toBeLessThanOrEqual(epochs.absoluteMs!);
  });

  it('limite exato nega em /auth/me e /auth/rotate (normal, absoluto e idle)', async () => {
    const expiredToken = await insertSession({ expiresAt: new Date() });
    const expiredMe = await me(expiredToken);
    probe('AC1.3', 'GET', '/auth/me (expira exatamente agora)', [401], expiredMe.statusCode, 'Token expired');
    expect(expiredMe.statusCode).toBe(401);
    expect(expiredMe.json()).toMatchObject({ error: 'UNAUTHORIZED', message: 'Token expired' });
    const expiredRotate = await rotate(expiredToken);
    expect(expiredRotate.statusCode).toBe(401);
    expect(expiredRotate.json()).toMatchObject({ message: 'Token expired' });

    const absoluteToken = await insertSession({ absoluteExpiresAt: new Date() });
    const absoluteMe = await me(absoluteToken);
    probe('AC1.3', 'GET', '/auth/me (absoluto exatamente agora)', [401], absoluteMe.statusCode, 'Session expired');
    expect(absoluteMe.statusCode).toBe(401);
    expect(absoluteMe.json()).toMatchObject({ error: 'UNAUTHORIZED', message: 'Session expired' });
    const absoluteRotate = await rotate(absoluteToken);
    expect(absoluteRotate.statusCode).toBe(401);
    expect(absoluteRotate.json()).toMatchObject({ message: 'Session expired' });

    const idleToken = await insertSession({ lastSeenAt: new Date(Date.now() - IDLE_MS) });
    const idleMe = await me(idleToken);
    probe('AC1.3', 'GET', '/auth/me (idle exatamente 24h)', [401], idleMe.statusCode, 'Session idle timeout');
    expect(idleMe.statusCode).toBe(401);
    expect(idleMe.json()).toMatchObject({ error: 'UNAUTHORIZED', message: 'Session idle timeout' });
    const idleRotate = await rotate(idleToken);
    expect(idleRotate.statusCode).toBe(401);
    expect(idleRotate.json()).toMatchObject({ message: 'Session idle timeout' });
  });

  it('sessão legada mantém o absoluto original ancorado no created_at; absoluto derivado vencido nega', async () => {
    const createdAt = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000);
    const legacyToken = await insertSession({
      createdAt,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      absoluteExpiresAt: null,
      lastSeenAt: new Date(),
    });

    const legacyMe = await me(legacyToken);
    probe('AC1.4', 'GET', '/auth/me (legado dentro do absoluto original)', [200], legacyMe.statusCode);
    expect(legacyMe.statusCode).toBe(200);

    const rotated = await rotate(legacyToken);
    expect(rotated.statusCode).toBe(200);
    const successor = recordToken((rotated.json() as { token: string }).token);
    const epoch = await sessionEpochs(successor);
    const expectedAbsolute = createdAt.getTime() + THIRTY_DAYS_MS;
    expect(Math.abs(epoch.absoluteMs! - expectedAbsolute)).toBeLessThan(2000);
    expect(epoch.expiresMs!).toBeLessThanOrEqual(epoch.absoluteMs!);

    const staleCreatedAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    const staleToken = await insertSession({
      createdAt: staleCreatedAt,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      absoluteExpiresAt: null,
      lastSeenAt: new Date(),
    });
    const staleMe = await me(staleToken);
    probe('AC1.4', 'GET', '/auth/me (legado além do absoluto original)', [401], staleMe.statusCode, 'Session expired');
    expect(staleMe.statusCode).toBe(401);
    expect(staleMe.json()).toMatchObject({ message: 'Session expired' });
    const staleRotate = await rotate(staleToken);
    expect(staleRotate.statusCode).toBe(401);
    expect(staleRotate.json()).toMatchObject({ message: 'Session expired' });
  });

  it('rotação não estende o deadline absoluto, mesmo perto do vencimento', async () => {
    const soonAbsolute = new Date(Date.now() + 60 * 60 * 1000);
    const token = await insertSession({
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      absoluteExpiresAt: soonAbsolute,
    });
    const before = await sessionEpochs(token);

    const response = await rotate(token);
    probe('AC1.5', 'POST', '/auth/rotate (absoluto em 1h)', [200], response.statusCode);
    expect(response.statusCode).toBe(200);
    const successor = recordToken((response.json() as { token: string }).token);

    const after = await sessionEpochs(successor);
    expect(after.absoluteMs).toBe(before.absoluteMs);
    expect(after.expiresMs!).toBeLessThanOrEqual(after.absoluteMs!);
    expect(after.expiresMs!).toBeLessThanOrEqual(Date.now() + SEVEN_DAYS_MS + 2000);
  });
});

describe('PROD-05 AC2 — fluxo HTTP completo, usuário desativado, concorrência e fuso', () => {
  it('logout, logout-all e rotação completam o ciclo com o banco real', async () => {
    const tokenA = await login();
    const tokenB = await login();

    const meA = await me(tokenA);
    probe('AC2.1', 'GET', '/auth/me', [200], meA.statusCode);
    expect(meA.statusCode).toBe(200);
    expect(meA.json()).toMatchObject({ user: { id: userId, email } });

    const rotated = await rotate(tokenA);
    probe('AC2.1', 'POST', '/auth/rotate', [200], rotated.statusCode);
    expect(rotated.statusCode).toBe(200);
    const successor = recordToken((rotated.json() as { token: string }).token);

    const oldMe = await me(tokenA);
    probe('AC2.1', 'GET', '/auth/me (token antigo pós-rotação)', [401], oldMe.statusCode);
    expect(oldMe.statusCode).toBe(401);
    const successorMe = await me(successor);
    expect(successorMe.statusCode).toBe(200);

    const loggedOut = await logout(successor);
    probe('AC2.1', 'POST', '/auth/logout', [200], loggedOut.statusCode);
    expect(loggedOut.statusCode).toBe(200);
    expect((await me(successor)).statusCode).toBe(401);
    const loggedOutAgain = await logout(successor);
    expect(loggedOutAgain.statusCode).toBe(200);

    // logout-all valida o token apresentado e derruba todas as sessões do usuário.
    const logoutAllResponse = await logoutAll(tokenB);
    probe('AC2.1', 'POST', '/auth/logout-all', [200], logoutAllResponse.statusCode);
    expect(logoutAllResponse.statusCode).toBe(200);
    expect((await me(tokenB)).statusCode).toBe(401);
    expect(await sessionRows()).toHaveLength(0);
  });

  it('logout-all com token expirado nega (401) sem derrubar sessões ativas', async () => {
    const active = await login();
    const expired = await insertSession({ expiresAt: new Date(Date.now() - 1000) });

    const response = await logoutAll(expired);
    probe('AC2.2', 'POST', '/auth/logout-all (token expirado)', [401], response.statusCode, 'Token expired');
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: 'UNAUTHORIZED', message: 'Token expired' });

    const activeMe = await me(active);
    expect(activeMe.statusCode).toBe(200);
  });

  it('usuário desativado nega em me/rotate sem apagar a sessão e volta ao normal ao reativar', async () => {
    const token = await login();
    await db.update(schema.users).set({ isActive: false }).where(eq(schema.users.id, userId));

    const meInactive = await me(token);
    probe('AC2.3', 'GET', '/auth/me (isActive=false)', [401], meInactive.statusCode, 'inactive_user');
    expect(meInactive.statusCode).toBe(401);
    expect(meInactive.json()).toMatchObject({ message: 'User not found or inactive' });

    const rotateInactive = await rotate(token);
    expect(rotateInactive.statusCode).toBe(401);
    expect(rotateInactive.json()).toMatchObject({ message: 'User not found or inactive' });

    await db.update(schema.users).set({ isActive: true }).where(eq(schema.users.id, userId));
    const meReactivated = await me(token);
    probe('AC2.3', 'GET', '/auth/me (reativado)', [200], meReactivated.statusCode);
    expect(meReactivated.statusCode).toBe(200);

    await db.update(schema.users).set({ isActive: false }).where(eq(schema.users.id, userId));
    const logoutInactive = await logout(token);
    expect(logoutInactive.statusCode).toBe(200);
    expect((await me(token)).statusCode).toBe(401);
    await db.update(schema.users).set({ isActive: true }).where(eq(schema.users.id, userId));
  });

  it('duas rotações concorrentes do mesmo token produzem uma única vencedora', async () => {
    const token = await login();

    const [first, second] = await Promise.all([rotate(token), rotate(token)]);
    const statuses = [first.statusCode, second.statusCode].sort((a, b) => a - b);
    probe('AC2.4', 'POST', '/auth/rotate x2 (concorrente)', [200, 401], statuses[0], `statuses=[${statuses.join(',')}]`);
    expect(statuses).toEqual([200, 401]);

    const rows = await sessionRows();
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.revokedAt === null)).toHaveLength(1);
    expect(rows.filter((row) => row.revokedReason === 'rotation')).toHaveLength(1);

    const winner = first.statusCode === 200 ? first : second;
    const loser = first.statusCode === 200 ? second : first;
    const winnerToken = recordToken((winner.json() as { token: string }).token);
    expect((await me(winnerToken)).statusCode).toBe(200);
    expect((await me(token)).statusCode).toBe(401);
    expect(loser.json()).toMatchObject({ error: 'UNAUTHORIZED' });
  });

  it('TZ America/Sao_Paulo: deadlines são instantes absolutos e a rotação preserva o absoluto', async () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/Sao_Paulo');
    expect(new Date().getTimezoneOffset()).toBe(180);

    const serverTz = await db.execute(sql`SELECT current_setting('TimeZone') AS tz`);
    const tzRow = (serverTz.rows[0] ?? {}) as { tz?: string };
    writeFileSync(join(LOG_DIR, 'timezone.json'), `${JSON.stringify({
      runId: RUN_ID,
      processTz: process.env.TZ,
      processOffsetMinutes: new Date().getTimezoneOffset(),
      postgresTimeZone: tzRow.tz ?? null,
    }, null, 2)}\n`);

    const token = await login();
    const before = await sessionEpochs(token);
    expect(Math.abs(before.expiresMs! - (before.createdMs! + SEVEN_DAYS_MS))).toBeLessThan(2000);
    expect(Math.abs(before.absoluteMs! - (before.createdMs! + THIRTY_DAYS_MS))).toBeLessThan(2000);

    const rotated = await rotate(token);
    probe('AC2.5', 'POST', '/auth/rotate (TZ America/Sao_Paulo)', [200], rotated.statusCode);
    expect(rotated.statusCode).toBe(200);
    const successor = recordToken((rotated.json() as { token: string }).token);
    const after = await sessionEpochs(successor);
    expect(after.absoluteMs).toBe(before.absoluteMs);
    expect(after.expiresMs!).toBeLessThanOrEqual(after.absoluteMs!);
    expect(after.expiresMs!).toBeLessThanOrEqual(Date.now() + SEVEN_DAYS_MS + 2000);
  });

  it('revogação não vaza para outra sessão do mesmo usuário', async () => {
    const revoked = await insertSession({ revokedAt: new Date() });
    const active = await login();

    const revokedMe = await me(revoked);
    probe('AC2.6', 'GET', '/auth/me (sessão revogada)', [401], revokedMe.statusCode, 'Invalid token');
    expect(revokedMe.statusCode).toBe(401);
    expect(revokedMe.json()).toMatchObject({ message: 'Invalid token' });

    const activeMe = await me(active);
    expect(activeMe.statusCode).toBe(200);
  });
});

describe('PROD-05 AC3 — revalidação WS usa a mesma política; sucessor de sessão', () => {
  it('sucessor de rotação autentica no socket e o token antigo é recusado (4003)', async () => {
    const token = await login();
    const rotated = await rotate(token);
    expect(rotated.statusCode).toBe(200);
    const successor = recordToken((rotated.json() as { token: string }).token);

    const oldClient = await connectSocket(token);
    await waitFor(() => hasEvent(oldClient, 'auth.error'), 8000, 'auth.error do token antigo');
    const oldError = oldClient.messages.find((message) => message.event === 'auth.error');
    expect(oldError?.data?.payload?.error).toContain('Invalid token: 401');
    await waitFor(() => oldClient.closeCode !== undefined, 8000, 'close do token antigo');
    expect(oldClient.closeCode).toBe(4003);

    const successorClient = await connectSocket(successor);
    await waitFor(() => hasEvent(successorClient, 'auth.success'), 8000, 'auth.success do sucessor');
    probe('AC3.1', 'WS', 'auth.message (sucessor)', [200], 200, 'auth.success');

    const successorEpochs = await sessionEpochs(successor);
    const oldEpochs = await sessionEpochs(token);
    expect(successorEpochs.absoluteMs).toBe(oldEpochs.absoluteMs);
  });

  it('sessão que fica idle além de 24h é cortada no socket em <=5s (mesma mensagem do HTTP)', async () => {
    const token = await login();
    const client = await connectSocket(token);
    await waitFor(() => hasEvent(client, 'auth.success'), 8000, 'auth.success');

    const httpBefore = await me(token);
    expect(httpBefore.statusCode).toBe(200);

    const revokedAt = Date.now();
    await db
      .update(schema.sessions)
      .set({ lastSeenAt: new Date(Date.now() - IDLE_MS) })
      .where(eq(schema.sessions.tokenHash, sha256(token)));

    await waitFor(() => client.closeCode !== undefined, 8000, 'close 4002 por idle');
    const elapsed = Date.now() - revokedAt;
    expect(client.closeCode).toBe(4002);
    expect(elapsed).toBeLessThanOrEqual(5000);
    expect(hasEvent(client, 'auth.revalidate.error')).toBe(true);

    const httpAfter = await me(token);
    probe('AC3.2', 'GET', '/auth/me (idle após revalidação WS)', [401], httpAfter.statusCode, 'Session idle timeout');
    expect(httpAfter.statusCode).toBe(401);
    expect(httpAfter.json()).toMatchObject({ message: 'Session idle timeout' });

    writeFileSync(join(LOG_DIR, 'ws-idle-cut.json'), `${JSON.stringify({ runId: RUN_ID, elapsedMs: elapsed, closeCode: client.closeCode }, null, 2)}\n`);
  });

  it('usuário desativado durante a conexão derruba o socket em <=5s', async () => {
    const token = await login();
    const client = await connectSocket(token);
    await waitFor(() => hasEvent(client, 'auth.success'), 8000, 'auth.success');

    const revokedAt = Date.now();
    await db.update(schema.users).set({ isActive: false }).where(eq(schema.users.id, userId));

    await waitFor(() => client.closeCode !== undefined, 8000, 'close 4002 por usuário desativado');
    const elapsed = Date.now() - revokedAt;
    expect(client.closeCode).toBe(4002);
    expect(elapsed).toBeLessThanOrEqual(5000);
    await db.update(schema.users).set({ isActive: true }).where(eq(schema.users.id, userId));
  });

  it('revogação de sessão derruba o socket em <=5s e não vaza para outra sessão', async () => {
    const token = await login();
    const other = await login();
    const client = await connectSocket(token);
    await waitFor(() => hasEvent(client, 'auth.success'), 8000, 'auth.success');

    const revokedAt = Date.now();
    await db
      .update(schema.sessions)
      .set({ revokedAt: new Date(), revokedReason: 'prod05-integration' })
      .where(eq(schema.sessions.tokenHash, sha256(token)));

    await waitFor(() => client.closeCode !== undefined, 8000, 'close 4002 por revogação');
    const elapsed = Date.now() - revokedAt;
    expect(client.closeCode).toBe(4002);
    expect(elapsed).toBeLessThanOrEqual(5000);

    const otherMe = await me(other);
    expect(otherMe.statusCode).toBe(200);
  });
});

describe('PROD-05 AC3 — tokens fora de URL/log e AC4 — boot sem JWT', () => {
  it('tráfego efetivo vai em Authorization sem aparecer no log; querystring não autentica', async () => {
    const token = await login();
    const rotated = await rotate(token);
    expect(rotated.statusCode).toBe(200);
    const successor = recordToken((rotated.json() as { token: string }).token);

    const withHeader = await me(successor);
    probe('AC3.3', 'GET', '/auth/me (Authorization)', [200], withHeader.statusCode);
    expect(withHeader.statusCode).toBe(200);

    // Higiene de log dos fluxos efetivos (header/message), antes de qualquer
    // controle negativo de querystring.
    const effectiveLog = logChunks.join('');
    for (const captured of sessionTokens) {
      expect(effectiveLog, 'token não pode aparecer no log do desk-api').not.toContain(captured);
    }
    expect(effectiveLog).not.toContain('Bearer ');
    expect(childLogs.join('')).not.toContain(successor);

    // Controle negativo: token em querystring NÃO autentica.
    const queryOnly = await app.inject({
      method: 'GET',
      url: `/auth/me?token=${encodeURIComponent(successor)}`,
    });
    probe('AC3.3', 'GET', '/auth/me?token=... (sem header)', [401], queryOnly.statusCode, 'querystring não autentica');
    expect(queryOnly.statusCode).toBe(401);

    const rotateQueryOnly = await app.inject({
      method: 'POST',
      url: `/auth/rotate?token=${encodeURIComponent(successor)}`,
    });
    expect(rotateQueryOnly.statusCode).toBe(401);

    // A tentativa negativa não invalida nem altera a sessão válida.
    const stillValid = await me(successor);
    expect(stillValid.statusCode).toBe(200);

    const controllerSource = readFileSync(
      join(REPO_ROOT, 'packages/auth/src/presentation/http/auth.controller.ts'),
      'utf8',
    );
    expect(controllerSource).toContain('request.headers.authorization');
    expect(controllerSource).not.toMatch(/request\.query\.token|query\s*\.\s*token|searchParams\.get\(['"]token['"]\)/);

    const middlewareSource = readFileSync(join(REPO_ROOT, 'packages/auth/src/middleware.ts'), 'utf8');
    expect(middlewareSource).toContain('request.headers.authorization');

    // Residual demonstrado (não bloqueia o aceite): o logger de request do
    // Fastify registra `req.url` integral; um cliente que (contra o contrato)
    // envie token em querystring o veria no log. Registrado para hardening.
    const afterNegative = logChunks.join('');
    const queryTokenEchoedInRequestLog = afterNegative.includes('/auth/me?token=')
      || afterNegative.includes('/auth/rotate?token=');
    writeFileSync(join(LOG_DIR, 'query-token-log-residual.json'), `${JSON.stringify({
      runId: RUN_ID,
      queryTokenAuthenticated: false,
      queryTokenEchoedInRequestLog,
      note: 'PINO_REDACT_PATHS cobre headers/body, não req.url; recomendação: serializers.req/disableRequestLogging ou reject de query token (fora do escopo de escrita do PROD-05)',
    }, null, 2)}\n`);
  });

  it('boot opera sem JWT_SECRET e o segredo interno efetivo é INTERNAL_EVENTS_SECRET', async () => {
    expect(process.env.JWT_SECRET).toBeUndefined();
    expect(process.env.REALTIME_INTERNAL_SECRET).toBeUndefined();
    expect(process.env.EVENTS_API_KEY).toBeUndefined();

    const scannedRoots = [
      join(REPO_ROOT, 'apps', 'desk-api', 'src'),
      join(REPO_ROOT, 'packages', 'auth', 'src'),
    ];
    const jwtHits: string[] = [];
    for (const root of scannedRoots) {
      for (const file of collectSourceFiles(root)) {
        const text = readFileSync(file, 'utf8');
        if (/JWT_SECRET|jsonwebtoken|\bjwt\s*\.\s*(sign|verify)\b/.test(text)) {
          jwtHits.push(file);
        }
      }
    }
    expect(jwtHits).toEqual([]);

    // O login segue opaco (não JWT) mesmo sem JWT_SECRET configurado.
    const token = await login();
    expect(token.startsWith('eyJ')).toBe(false);

    // Guard interno responde pelo INTERNAL_EVENTS_SECRET efetivo.
    const noKey = await app.inject({ method: 'GET', url: '/events' });
    probe('AC4', 'GET', '/events (sem chave)', [401], noKey.statusCode);
    expect(noKey.statusCode).toBe(401);

    const wrongKey = await app.inject({
      method: 'GET',
      url: '/events',
      headers: { 'x-internal-service-key': 'chave-errada' },
    });
    expect(wrongKey.statusCode).toBe(401);

    const withKey = await app.inject({
      method: 'GET',
      url: '/events',
      headers: { 'x-internal-service-key': INTERNAL_SECRET },
    });
    probe('AC4', 'GET', '/events (INTERNAL_EVENTS_SECRET)', [200], withKey.statusCode);
    expect(withKey.statusCode).toBe(200);
    expect(withKey.json()).toMatchObject({ events: [] });

    // Bearer de usuário não substitui a credencial de serviço nas rotas internas.
    const bearerOnly = await app.inject({ method: 'GET', url: '/events', headers: auth(token) });
    expect(bearerOnly.statusCode).toBe(401);
  });
});
