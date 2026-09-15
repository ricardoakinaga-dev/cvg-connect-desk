/**
 * PROD-11 — reconciliação outbound e retenção da intenção (C05/G03, BE10).
 *
 * Prova real em PostgreSQL + Redis isolados do harness AAA (run `prod11*`,
 * worker 38, `cvg_aaa_prod11_*`), usando o CÓDIGO DE PRODUÇÃO:
 *  - API: `buildDeskApiApp()` + `POST /messages` (sessão real) e
 *    `/gateway/receipt`/`/gateway/outbound/:id/sent` (HMAC + credencial de
 *    serviço reais);
 *  - Gateway: sandbox HTTP local do contrato outbound do GATEWAY REAL
 *    (`gatewayService`), controlável por teste (queued, 2xx inesperado, 429,
 *    reset de socket, hang);
 *  - Chat: `sendOutboundMessage` + `persistOutboundIntentAtomically` e o
 *    repositório de deliveries reais;
 *  - crash real: processo filho executando o envio e MORTO entre o request ao
 *    provider e o callback; a intenção sobrevive e é reconciliada.
 *
 * AC1 — intenção retida/idempotente (chave escopada ator+conversa+payload),
 *       409 em conflito, TTL explícito com `expired:true` e sem reenvio cego.
 * AC2 — estado ambíguo explícito (`unknown_reconciling`/`pending`), callback
 *       com sucesso/falha/duplicado resolve UMA vez, reconciliação sem efeito
 *       duplicado e corrida callback×retry converge para um estado final.
 * AC3 — crash entre envio e callback: retomada sem duplicar mensagem/entrega,
 *       sem reenvio no retry e intenção órfã listável/reconciliável.
 * AC4 — retenção: TTL não apaga antes do vencimento, expirados terminalizam
 *       com causa, `unknown` nunca é purgado e terminal antigo purga com
 *       tombstone (proibição de reenvio preservada).
 *
 * Nunca o banco do host: o runner exige `cvg_aaa_*` + marcador do run.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunContext } from '../../../../../e2e/support/aaa/run-context.ts';

interface PgQueryResult<R> {
  rows: R[];
  rowCount: number | null;
}

interface PgClientLike {
  query<R = Record<string, unknown>>(text: string, values?: unknown[]): Promise<PgQueryResult<R>>;
  end(): Promise<void>;
}

type PgPoolLike = PgClientLike;

interface PgRuntime {
  Pool: new (config: { connectionString: string; max?: number }) => PgPoolLike;
}

interface DatabasePoolLike {
  end(): Promise<void>;
}

type DatabaseModule = typeof import('../../../../../packages/database/src/index.ts');
type ChatModule = typeof import('../../../../../modules/chat/src/index.ts');

interface Harness {
  teardownIsolatedEnv: (
    context: RunContext,
    options?: { stopServices?: boolean; dropDatabase?: boolean },
  ) => Record<string, unknown>;
}

interface SendBody {
  messageId: string;
  conversationId: string;
  status: string;
  outcome: string;
  deduplicated: boolean;
  expired?: boolean;
  error?: string;
  message?: string;
}

interface DeliveryRow {
  id: string;
  internal_message_id: string;
  client_key: string | null;
  status: string;
  provider_message_id: string | null;
  attempt_count: number;
  last_error: string | null;
  expires_at: Date | null;
  scope_actor_id: string | null;
  scope_conversation_id: string | null;
}

interface MessageRow {
  id: string;
  status: string;
  external_message_id: string | null;
  delivered_at: Date | null;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../../..');
const PROGRAM_DIR = process.env.CVG_PROGRAM_DIR || join(REPO_ROOT, 'docs', 'producao-2026-09-13');
const EVIDENCE_SEGMENT = process.env.CVG_EVIDENCE_SEGMENT?.trim();
const EVIDENCE_DIR = join(
  PROGRAM_DIR,
  'evidencias',
  'prod-11',
  ...(EVIDENCE_SEGMENT ? [EVIDENCE_SEGMENT] : []),
);
const LOG_DIR = join(EVIDENCE_DIR, 'logs');
const RUNTIME_DIR = process.env.CVG_RUNTIME_DIR || join(EVIDENCE_DIR, 'runtime');
const MIGRATIONS_DIR = join(REPO_ROOT, 'packages', 'database', 'supabase', 'migrations');
const CRASH_SCRIPT_SOURCE = join(REPO_ROOT, 'scripts', 'production', 'prod-11-crash-send.ts');
const CRASH_SCRIPT = join(EVIDENCE_DIR, 'crash-send.ts');
const RUN_ID = process.env.AAA_RUN_ID || 'prod11';
const WORKER_INDEX = Number(process.env.AAA_WORKER_INDEX || '38');
const WEBHOOK_SECRET = 'prod11-webhook-secret';
const GATEWAY_API_KEY = 'prod11-gateway-sandbox';
const PASSWORD = 'ChatRoutePass!42';
const PASSWORD_HASH = '$2a$10$UX/LcD/6NKhheDIZmbHyN.a6Hc8SW6ytZ/LCCZW3un3h5vJ9n/1h6';
const ROLE_NAME = 'Receptionist';
const RECIPIENT = '+5511900000830';

process.env.CVG_PROGRAM_DIR = PROGRAM_DIR;
process.env.CVG_RUNTIME_DIR = RUNTIME_DIR;
process.env.AAA_RUN_ID = RUN_ID;
process.env.AAA_WORKER_INDEX = String(WORKER_INDEX);
process.env.NODE_ENV = 'test';
process.env.DESK_ENV = 'production';
process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;
process.env.RATE_LIMIT_MAX = process.env.RATE_LIMIT_MAX || '100000';
process.env.RATE_LIMIT_WINDOW = process.env.RATE_LIMIT_WINDOW || '1 minute';
// O DATABASE_URL só é definido após provisionar o PG isolado (nenhuma conexão
// com o banco do host no carregamento dos módulos).
delete process.env.DATABASE_URL;

vi.setConfig({ testTimeout: 180_000, hookTimeout: 600_000 });

type GatewayMode = 'ok' | 'weird200' | 'rate429' | 'reset' | 'hang';

interface HangEntry {
  response: import('node:http').ServerResponse;
  release: () => void;
}

const gatewayState = {
  mode: 'ok' as GatewayMode,
  requests: 0,
  bodies: [] as Array<Record<string, unknown>>,
  hangs: [] as HangEntry[],
};

const evidence: Array<Record<string, unknown>> = [];
const spawnedChildren: ChildProcess[] = [];
const testConversations: string[] = [];

let gatewayServer: Server | null = null;
let gatewayUrl = '';

let ctx: RunContext;
let pg: PgRuntime;
let harness: Harness;
let isolatedDatabaseName = '';
let pool: PgClientLike;
let databasePool: DatabasePoolLike | undefined;
let app: FastifyInstance | null = null;
let baseUrl = '';
let database: DatabaseModule;
let chat: ChatModule;

let tokenA = '';
let tokenB = '';
let userId = '';
let userBId = '';
let sectorId = '';
let roleId = '';

function databaseUrl(): string {
  return `postgresql://cvg_aaa@127.0.0.1:${ctx.ports.postgres}/${isolatedDatabaseName}`;
}

function writeEvidenceJson(name: string, value: unknown): void {
  writeFileSync(join(EVIDENCE_DIR, name), `${JSON.stringify(value, null, 2)}\n`);
}

function startGatewaySandbox(): void {
  gatewayServer = createServer((request, response) => {
    if (request.url !== '/webhooks/desk' || request.method !== 'POST') {
      response.writeHead(404).end();
      return;
    }
    let raw = '';
    request.on('data', (chunk: Buffer) => {
      raw += chunk.toString();
    });
    request.on('end', () => {
      gatewayState.requests += 1;
      try {
        gatewayState.bodies.push(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        gatewayState.bodies.push({ raw });
      }

      switch (gatewayState.mode) {
        case 'weird200':
          // 2xx cujo corpo não confirma enfileiramento: resultado ambíguo.
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ status: 'not-confirmed' }));
          return;
        case 'rate429':
          response.writeHead(429, { 'content-type': 'application/json', 'retry-after': '0' });
          response.end(JSON.stringify({ error: 'rate limited' }));
          return;
        case 'reset':
          // Fronteira de aceite desconhecida: socket cai sem resposta.
          request.socket.destroy();
          return;
        case 'hang': {
          const entry: HangEntry = {
            response,
            release: () => {
              if (response.writableEnded || response.destroyed) return;
              response.writeHead(200, { 'content-type': 'application/json' });
              response.end(JSON.stringify({ status: 'queued', operation_id: `gw-op-${gatewayState.requests}` }));
            },
          };
          response.on('error', () => {
            // Socket pode ter caído com o kill do processo filho; o release é
            // best-effort e nunca pode derrubar o servidor do teste.
          });
          gatewayState.hangs.push(entry);
          return;
        }
        default:
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ status: 'queued', operation_id: `gw-op-${gatewayState.requests}` }));
      }
    });
  });
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function signRawBody(rawBody: string, timestamp: number): string {
  return createHmac('sha256', WEBHOOK_SECRET).update(`${timestamp}.${rawBody}`).digest('hex');
}

function signedHeaders(rawBody: string, eventId: string): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000);
  return {
    'content-type': 'application/json',
    'x-webhook-signature': `sha256=${signRawBody(rawBody, timestamp)}`,
    'x-webhook-timestamp': String(timestamp),
    'x-webhook-event-id': eventId,
  };
}

async function sendHttp(
  conversationId: string,
  payload: Record<string, unknown>,
  idempotencyKey?: string,
  token: string = tokenA,
): Promise<Response> {
  return fetch(`${baseUrl}/messages`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    },
    body: JSON.stringify({ conversationId, recipient: RECIPIENT, ...payload }),
  });
}

async function postReceipt(input: {
  reference: string;
  status: 'sent' | 'delivered' | 'read' | 'played' | 'failed';
  eventId?: string;
}): Promise<Response> {
  const eventId = input.eventId ?? randomUUID();
  const rawBody = JSON.stringify({
    contract_version: '1.0.0',
    event_type: 'WA_RECEIPT',
    event_id: eventId,
    occurred_at: new Date().toISOString(),
    provider: 'evolutionapi',
    channel: 'whatsapp',
    payload: {
      instance: 'cvg-local',
      remoteJid: '5511900000830@s.whatsapp.net',
      messageId: input.reference,
      status: input.status,
      status_at: new Date().toISOString(),
    },
  });
  return fetch(`${baseUrl}/gateway/receipt`, {
    method: 'POST',
    headers: signedHeaders(rawBody, eventId),
    body: rawBody,
  });
}

async function postGatewayConfirm(internalMessageId: string, externalMessageId?: string): Promise<Response> {
  return fetch(`${baseUrl}/gateway/outbound/${internalMessageId}/sent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': GATEWAY_API_KEY },
    body: JSON.stringify({ messageId: externalMessageId }),
  });
}

function jsonOf<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  return check();
}

async function createConversation(): Promise<string> {
  const id = randomUUID();
  await pool.query(
    'INSERT INTO conversations (id, status, status_v2, current_handler, is_active, sector_id) VALUES ($1, $2, $3, $4, true, $5)',
    [id, 'open', 'novo', 'bot', sectorId],
  );
  testConversations.push(id);
  return id;
}

async function deliveryByKey(key: string): Promise<DeliveryRow | null> {
  const result = await pool.query<DeliveryRow>(
    'SELECT id, internal_message_id, client_key, status, provider_message_id, attempt_count, last_error, expires_at, scope_actor_id, scope_conversation_id FROM outbound_deliveries WHERE client_key = $1',
    [key],
  );
  return result.rows[0] ?? null;
}

async function deliveryById(id: string): Promise<DeliveryRow | null> {
  const result = await pool.query<DeliveryRow>(
    'SELECT id, internal_message_id, client_key, status, provider_message_id, attempt_count, last_error, expires_at, scope_actor_id, scope_conversation_id FROM outbound_deliveries WHERE id = $1',
    [id],
  );
  return result.rows[0] ?? null;
}

async function messageById(id: string): Promise<MessageRow | null> {
  const result = await pool.query<MessageRow>(
    'SELECT id, status, external_message_id, delivered_at FROM messages WHERE id = $1',
    [id],
  );
  return result.rows[0] ?? null;
}

async function countsFor(conversationId: string): Promise<{ messages: number; deliveries: number; events: number }> {
  const result = await pool.query<{ messages: number; deliveries: number; events: number }>(
    `SELECT
       (SELECT COUNT(*)::int FROM messages
         WHERE conversation_id = $1 AND direction = 'outbound') AS messages,
       (SELECT COUNT(*)::int FROM outbound_deliveries d
         WHERE d.internal_message_id IN (
           SELECT id FROM messages WHERE conversation_id = $1 AND direction = 'outbound'
         )) AS deliveries,
       (SELECT COUNT(*)::int FROM outbox_events e
         WHERE e.aggregate_type = 'Message' AND e.aggregate_id IN (
           SELECT id::text FROM messages WHERE conversation_id = $1 AND direction = 'outbound'
         )) AS events`,
    [conversationId],
  );
  return result.rows[0];
}

async function cleanupConversations(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const messageIds = (
    await pool.query<{ id: string }>('SELECT id FROM messages WHERE conversation_id = ANY($1::uuid[])', [ids])
  ).rows.map((row) => row.id);
  if (messageIds.length > 0) {
    await pool.query(
      `DELETE FROM outbox_consumer_acks WHERE event_id IN (
         SELECT event_id FROM outbox_events WHERE aggregate_id = ANY($1::text[])
       )`,
      [messageIds],
    );
    await pool.query('DELETE FROM outbox_events WHERE aggregate_id = ANY($1::text[])', [messageIds]);
    await pool.query('DELETE FROM outbound_deliveries WHERE internal_message_id = ANY($1::uuid[])', [messageIds]);
  }
  await pool.query('DELETE FROM messages WHERE conversation_id = ANY($1::uuid[])', [ids]);
  await pool.query('DELETE FROM outbound_idempotency_tombstones WHERE scope_conversation_id = ANY($1::uuid[])', [ids]);
  await pool.query('DELETE FROM conversation_status_history WHERE conversation_id = ANY($1::uuid[])', [ids]);
  await pool.query('DELETE FROM conversations WHERE id = ANY($1::uuid[])', [ids]);
}

function startCrashChild(conversationId: string, idempotencyKey: string, content: string): {
  child: ChildProcess;
  output: () => string;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
} {
  const child = spawn(join(REPO_ROOT, 'node_modules', '.bin', 'tsx'), [CRASH_SCRIPT], {
    cwd: REPO_ROOT,
    detached: true,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl(),
      REDIS_URL: ctx.redisUrl,
      GATEWAY_URL: gatewayUrl,
      GATEWAY_API_KEY,
      NODE_ENV: 'test',
      CRASH_CONVERSATION_ID: conversationId,
      CRASH_IDEMPOTENCY_KEY: idempotencyKey,
      CRASH_RECIPIENT: RECIPIENT,
      CRASH_ACTOR_ID: userId,
      CRASH_CONTENT: content,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  spawnedChildren.push(child);
  let output = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit) => {
    child.on('exit', (code, signal) => resolveExit({ code, signal }));
  });
  return { child, output: () => output, exited };
}

async function killChildren(): Promise<void> {
  for (const child of spawnedChildren.splice(0)) {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }
  }
}

function releaseHangs(): void {
  for (const hang of gatewayState.hangs.splice(0)) {
    try {
      hang.release();
    } catch {
      // Socket já destruído pelo kill do processo filho.
    }
  }
}

beforeAll(async () => {
  mkdirSync(LOG_DIR, { recursive: true });
  copyFileSync(CRASH_SCRIPT_SOURCE, CRASH_SCRIPT);
  startGatewaySandbox();
  gatewayUrl = await listen(gatewayServer!);

  const runContextSpecifier = '../../../../../e2e/support/aaa/run-context.ts';
  const isolatedEnvSpecifier = '../../../../../e2e/support/aaa/isolated-env.ts';
  const pgSpecifier = 'pg';
  const runContextModule = (await import(/* @vite-ignore */ runContextSpecifier)) as {
    getRunContext: (workerIndex?: number) => RunContext;
  };
  const isolatedEnvModule = (await import(/* @vite-ignore */ isolatedEnvSpecifier)) as {
    provisionIsolatedEnv: (context: RunContext) => Promise<{ databaseName: string; marker: { runId: string } }>;
    teardownIsolatedEnv: Harness['teardownIsolatedEnv'];
  };
  const pgModule = (await import(/* @vite-ignore */ pgSpecifier)) as { default?: PgRuntime };
  pg = (pgModule.default ?? (pgModule as unknown as PgRuntime)) as PgRuntime;
  harness = { teardownIsolatedEnv: isolatedEnvModule.teardownIsolatedEnv };

  ctx = runContextModule.getRunContext(WORKER_INDEX);
  const isolated = await isolatedEnvModule.provisionIsolatedEnv(ctx);
  if (isolated.marker.runId !== ctx.runId) {
    throw new Error(`marcador do run divergente: ${isolated.marker.runId} != ${ctx.runId}`);
  }
  isolatedDatabaseName = isolated.databaseName;
  process.env.DATABASE_URL = databaseUrl();
  pool = new pg.Pool({ connectionString: databaseUrl(), max: 8 });

  const { drizzle } = await import('drizzle-orm/node-postgres');
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  await migrate(drizzle(pool as never) as never, { migrationsFolder: MIGRATIONS_DIR });

  database = (await import(
    /* @vite-ignore */ '../../../../../packages/database/src/index.ts'
  )) as DatabaseModule;
  databasePool = database.getPool();

  process.env.GATEWAY_URL = gatewayUrl;
  process.env.GATEWAY_API_KEY = GATEWAY_API_KEY;

  const appModule = (await import('../../app.ts')) as {
    buildDeskApiApp: () => Promise<FastifyInstance>;
  };
  app = await appModule.buildDeskApiApp();
  await app.ready();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('PROD-11: sem porta efêmera para HTTP real');
  baseUrl = `http://127.0.0.1:${address.port}`;

  chat = (await import(
    /* @vite-ignore */ '../../../../../modules/chat/src/index.ts'
  )) as ChatModule;

  // Fixtures de sessão/autorização (papel compartilhado, nunca removido).
  const existingRole = (
    await pool.query<{ id: string }>('SELECT id FROM roles WHERE name = $1', [ROLE_NAME])
  ).rows[0];
  if (existingRole) {
    roleId = existingRole.id;
  } else {
    roleId = randomUUID();
    await pool.query(
      'INSERT INTO roles (id, name, description) VALUES ($1, $2, $3) ON CONFLICT (name) DO NOTHING',
      [roleId, ROLE_NAME, 'Role for PROD-11'],
    );
    roleId = (await pool.query<{ id: string }>('SELECT id FROM roles WHERE name = $1', [ROLE_NAME])).rows[0].id;
  }

  userId = randomUUID();
  userBId = randomUUID();
  const stamp = Date.now();
  const emailA = `prod11.a.${stamp}@example.com`;
  const emailB = `prod11.b.${stamp}@example.com`;
  await pool.query(
    `INSERT INTO users (id, name, email, password_hash, is_active)
     VALUES ($1, $2, $3, $4, true), ($5, $6, $7, $8, true)`,
    [userId, 'PROD-11 User', emailA, PASSWORD_HASH, userBId, 'PROD-11 User B', emailB, PASSWORD_HASH],
  );
  await pool.query(
    'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2), ($3, $2)',
    [userId, roleId, userBId],
  );

  const suffix = String(stamp).slice(-6);
  sectorId = (
    await pool.query<{ id: string }>(
      'INSERT INTO sectors (id, name, code) VALUES ($1, $2, $3) RETURNING id',
      [randomUUID(), `prod11 ${suffix}`, `prod11${suffix}`],
    )
  ).rows[0].id;
  await pool.query(
    'INSERT INTO user_sectors (user_id, sector_id, access_level) VALUES ($1, $2, $3), ($4, $2, $3)',
    [userId, sectorId, 'write', userBId],
  );

  const loginA = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: emailA, password: PASSWORD }),
  });
  if (loginA.status !== 200) {
    throw new Error(`PROD-11: login A falhou (${loginA.status})`);
  }
  tokenA = (await loginA.json() as { token: string }).token;

  const loginB = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: emailB, password: PASSWORD }),
  });
  if (loginB.status !== 200) {
    throw new Error(`PROD-11: login B falhou (${loginB.status})`);
  }
  tokenB = (await loginB.json() as { token: string }).token;
});

beforeEach(() => {
  gatewayState.mode = 'ok';
  gatewayState.requests = 0;
  gatewayState.bodies = [];
  releaseHangs();
});

afterEach(async () => {
  releaseHangs();
  await killChildren();
  await cleanupConversations(testConversations.splice(0));
});

afterAll(async () => {
  writeEvidenceJson('prod-11-evidence.json', {
    generatedAt: new Date().toISOString(),
    runId: RUN_ID,
    workerIndex: WORKER_INDEX,
    database: isolatedDatabaseName,
    postgresPort: ctx?.ports.postgres,
    redisPort: ctx?.ports.redis,
    cases: evidence,
  });
  await killChildren();
  try {
    const eventsModule = await import('@cvg/events');
    await eventsModule.stopSharedRealtimeBus();
  } catch {
    // Barramento é best-effort; o teardown do runner cobre o restante.
  }
  if (app) await app.close().catch(() => undefined);

  // Fixtures de sessão/usuário/setor removidas ANTES de fechar o pool; o role
  // é compartilhado com outras suítes e permanece.
  if (pool) {
    if (userId) {
      await pool
        .query('DELETE FROM audit_logs WHERE user_id = ANY($1::uuid[])', [[userId, userBId]])
        .catch(() => undefined);
      await pool
        .query('DELETE FROM sessions WHERE user_id = ANY($1::uuid[])', [[userId, userBId]])
        .catch(() => undefined);
      await pool
        .query('DELETE FROM user_roles WHERE user_id = ANY($1::uuid[])', [[userId, userBId]])
        .catch(() => undefined);
      await pool
        .query('DELETE FROM user_sectors WHERE user_id = ANY($1::uuid[])', [[userId, userBId]])
        .catch(() => undefined);
      await pool
        .query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[userId, userBId]])
        .catch(() => undefined);
    }
    if (sectorId) {
      await pool.query('DELETE FROM sectors WHERE id = $1', [sectorId]).catch(() => undefined);
    }
  }

  if (databasePool) await databasePool.end().catch(() => undefined);
  if (pool) await pool.end().catch(() => undefined);
  gatewayServer?.close();
  if (ctx && harness) {
    harness.teardownIsolatedEnv(ctx, { stopServices: true, dropDatabase: true });
  }
});

describe('PROD-11 — reconciliação outbound e retenção da intenção (PG+Redis reais)', () => {
  it('AC1 — mesma intenção devolve mesmo resultado, 409 em payload divergente e escopo ator+conversa', async () => {
    const conversationA = await createConversation();
    const conversationB = await createConversation();
    const key = `prod11-ac1-${randomUUID()}`;
    const payload = { content: 'AC1 — intenção retida' };

    const first = await sendHttp(conversationA, payload, key);
    expect(first.status).toBe(201);
    const firstBody = await jsonOf<SendBody>(first);
    expect(firstBody.deduplicated).toBe(false);

    const second = await sendHttp(conversationA, payload, key);
    expect(second.status).toBe(200);
    const secondBody = await jsonOf<SendBody>(second);
    expect(secondBody.messageId).toBe(firstBody.messageId);
    expect(secondBody.deduplicated).toBe(true);

    const divergent = await sendHttp(conversationA, { content: 'payload divergente' }, key);
    expect(divergent.status).toBe(409);
    const divergentBody = await jsonOf<SendBody>(divergent);
    expect(divergentBody.error).toBe('IDEMPOTENCY_KEY_CONFLICT');

    const otherConversation = await sendHttp(conversationB, payload, key);
    expect(otherConversation.status).toBe(201);
    const otherConversationBody = await jsonOf<SendBody>(otherConversation);
    expect(otherConversationBody.messageId).not.toBe(firstBody.messageId);

    const otherActor = await sendHttp(conversationA, payload, key, tokenB);
    expect(otherActor.status).toBe(201);
    const otherActorBody = await jsonOf<SendBody>(otherActor);
    expect(otherActorBody.messageId).not.toBe(firstBody.messageId);

    expect(await countsFor(conversationA)).toEqual({ messages: 2, deliveries: 2, events: 2 });
    expect(await countsFor(conversationB)).toEqual({ messages: 1, deliveries: 1, events: 1 });
    expect(gatewayState.requests).toBe(3);

    evidence.push({
      case: 'AC1-retida-conflito-escopo',
      messages: 2,
      deliveries: 2,
      events: 2,
      conflict: divergentBody.error,
      gatewayRequests: 3,
    });
  });

  it('AC1 — corrida real de 14 requisições da mesma chave: 1 mensagem, 1 delivery, 1 evento e 1 envio', async () => {
    const conversationId = await createConversation();
    const key = `prod11-ac1-race-${randomUUID()}`;
    const payload = { content: 'AC1 — corrida' };

    const responses = await Promise.all(
      Array.from({ length: 14 }, () => sendHttp(conversationId, payload, key)),
    );
    const parsed = await Promise.all(
      responses.map(async (response) => ({ status: response.status, body: (await response.json()) as SendBody })),
    );

    expect(await countsFor(conversationId)).toEqual({ messages: 1, deliveries: 1, events: 1 });
    expect(gatewayState.requests).toBe(1);
    expect(parsed.filter((row) => row.body.deduplicated === false)).toHaveLength(1);
    expect(new Set(parsed.map((row) => row.body.messageId)).size).toBe(1);
    for (const row of parsed) {
      expect([200, 201]).toContain(row.status);
      expect(['accepted', 'pending', 'sent']).toContain(row.body.outcome);
    }

    evidence.push({
      case: 'AC1-corrida-14',
      messages: 1,
      deliveries: 1,
      events: 1,
      gatewayRequests: 1,
      distinctMessageIds: 1,
    });
  });

  it('AC1 — TTL expirado é observável (expired:true), terminaliza com causa e nunca reenvia', async () => {
    const conversationId = await createConversation();
    const key = `prod11-ac1-ttl-${randomUUID()}`;
    const payload = { content: 'AC1 — TTL' };

    const first = await sendHttp(conversationId, payload, key);
    expect(first.status).toBe(201);
    const firstBody = await jsonOf<SendBody>(first);

    // Crash pós-persistência simulado: intenção não-terminal com TTL vencido.
    await pool.query(
      "UPDATE outbound_deliveries SET status = 'pending', expires_at = NOW() - INTERVAL '1 hour' WHERE client_key = $1",
      [key],
    );
    await pool.query("UPDATE messages SET status = 'pending' WHERE id = $1", [firstBody.messageId]);

    const retry = await sendHttp(conversationId, payload, key);
    expect(retry.status).toBe(200);
    const retryBody = await jsonOf<SendBody>(retry);
    expect(retryBody.deduplicated).toBe(true);
    expect(retryBody.expired).toBe(true);
    expect(retryBody.outcome).toBe('failed');

    const delivery = await deliveryByKey(key);
    expect(delivery?.status).toBe('failed');
    expect(delivery?.last_error).toBe('idempotency_ttl_expired');
    expect((await messageById(firstBody.messageId))?.status).toBe('failed');
    expect(gatewayState.requests).toBe(1);
    expect(await countsFor(conversationId)).toEqual({ messages: 1, deliveries: 1, events: 1 });

    evidence.push({
      case: 'AC1-ttl',
      expired: retryBody.expired,
      outcome: retryBody.outcome,
      lastError: delivery?.last_error,
      gatewayRequests: 1,
    });
  });

  it('AC2 — reset do provider vira unknown_reconciling; callback de sucesso resolve uma única vez e duplicado não regride', async () => {
    const conversationId = await createConversation();
    const key = `prod11-ac2-success-${randomUUID()}`;
    gatewayState.mode = 'reset';

    const sent = await sendHttp(conversationId, { content: 'AC2 — callback sucesso' }, key);
    expect(sent.status).toBe(201);
    const sentBody = await jsonOf<SendBody>(sent);
    expect(sentBody.outcome).toBe('unknown_reconciling');

    const delivery = await deliveryByKey(key);
    expect(delivery?.status).toBe('unknown_reconciling');
    expect((await messageById(sentBody.messageId))?.status).toBe('pending');
    // reset + retries do cliente (idempotente): 3 requests, nenhum reenvio de intenção.
    expect(gatewayState.requests).toBe(3);

    // Callback NÃO autorizado (sem HMAC) é rejeitado e não muda o estado.
    const unauthorized = await fetch(`${baseUrl}/gateway/receipt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event_type: 'WA_RECEIPT' }),
    });
    expect(unauthorized.status).toBe(401);
    expect((await deliveryByKey(key))?.status).toBe('unknown_reconciling');

    const receipt1 = await postReceipt({ reference: sentBody.messageId, status: 'delivered' });
    expect(receipt1.status).toBe(200);
    expect((await jsonOf<{ updated: boolean }>(receipt1)).updated).toBe(true);

    const resolved = await deliveryByKey(key);
    expect(resolved?.status).toBe('sent');
    expect(resolved?.provider_message_id).toBe(sentBody.messageId);
    const delivered = await messageById(sentBody.messageId);
    expect(delivered?.status).toBe('delivered');
    expect(delivered?.external_message_id).toBe(sentBody.messageId);

    const attemptAfterFirst = resolved?.attempt_count;
    const receipt2 = await postReceipt({ reference: sentBody.messageId, status: 'delivered' });
    expect(receipt2.status).toBe(200);
    expect((await jsonOf<{ updated: boolean }>(receipt2)).updated).toBe(true);
    const afterDuplicate = await deliveryByKey(key);
    expect(afterDuplicate?.status).toBe('sent');
    expect(afterDuplicate?.attempt_count).toBe(attemptAfterFirst);

    // Callback tardio de falha (outra versão do evento) não regride terminal.
    const lateFailure = await postReceipt({ reference: sentBody.messageId, status: 'failed' });
    expect(lateFailure.status).toBe(200);
    expect((await deliveryByKey(key))?.status).toBe('sent');
    expect((await messageById(sentBody.messageId))?.status).toBe('delivered');

    expect(await countsFor(conversationId)).toEqual({ messages: 1, deliveries: 1, events: 1 });
    expect(gatewayState.requests).toBe(3);

    evidence.push({
      case: 'AC2-callback-sucesso',
      initial: 'unknown_reconciling',
      final: 'sent',
      messageFinal: 'delivered',
      duplicateAttemptCountStable: true,
      lateFailureIgnored: true,
      gatewayRequests: 3,
    });
  });

  it('AC2 — callback de falha resolve unknown_reconciling e o retry não reenvia', async () => {
    const conversationId = await createConversation();
    const key = `prod11-ac2-failure-${randomUUID()}`;
    gatewayState.mode = 'weird200';

    const sent = await sendHttp(conversationId, { content: 'AC2 — callback falha' }, key);
    expect(sent.status).toBe(201);
    const sentBody = await jsonOf<SendBody>(sent);
    expect(sentBody.outcome).toBe('unknown_reconciling');
    expect(gatewayState.requests).toBe(1);

    const receipt = await postReceipt({ reference: sentBody.messageId, status: 'failed' });
    expect(receipt.status).toBe(200);
    const failed = await deliveryByKey(key);
    expect(failed?.status).toBe('failed');
    expect(failed?.last_error).toBe('provider_receipt_failed');
    expect((await messageById(sentBody.messageId))?.status).toBe('failed');

    const retry = await sendHttp(conversationId, { content: 'AC2 — callback falha' }, key);
    expect(retry.status).toBe(200);
    const retryBody = await jsonOf<SendBody>(retry);
    expect(retryBody.deduplicated).toBe(true);
    expect(retryBody.outcome).toBe('failed');
    expect(gatewayState.requests).toBe(1);

    evidence.push({
      case: 'AC2-callback-falha',
      final: 'failed',
      retryOutcome: retryBody.outcome,
      gatewayRequests: 1,
    });
  });

  it('AC2 — 429 após retries limitados termina failed e não reenvia', async () => {
    const conversationId = await createConversation();
    const key = `prod11-ac2-429-${randomUUID()}`;
    gatewayState.mode = 'rate429';

    const sent = await sendHttp(conversationId, { content: 'AC2 — 429' }, key);
    expect(sent.status).toBe(201);
    const sentBody = await jsonOf<SendBody>(sent);
    expect(sentBody.outcome).toBe('failed');
    // 1 tentativa + 2 retries do cliente idempotente; teto determinístico.
    expect(gatewayState.requests).toBe(3);

    const delivery = await deliveryByKey(key);
    expect(delivery?.status).toBe('failed');
    expect(delivery?.attempt_count).toBeGreaterThanOrEqual(1);

    const retry = await sendHttp(conversationId, { content: 'AC2 — 429' }, key);
    expect(retry.status).toBe(200);
    const retryBody = await jsonOf<SendBody>(retry);
    expect(retryBody.deduplicated).toBe(true);
    expect(retryBody.outcome).toBe('failed');
    expect(gatewayState.requests).toBe(3);

    evidence.push({ case: 'AC2-429', outcome: sentBody.outcome, gatewayRequests: 3, retryDeduplicated: true });
  });

  it('AC2 — corrida callback × retry converge para sent com um único envio', async () => {
    const conversationId = await createConversation();
    const key = `prod11-ac2-race-${randomUUID()}`;
    const payload = { content: 'AC2 — corrida callback x retry' };
    gatewayState.mode = 'hang';

    const sendPromise = sendHttp(conversationId, payload, key);
    expect(await waitFor(() => gatewayState.requests === 1)).toBe(true);
    const pending = await deliveryByKey(key);
    expect(pending?.status).toBe('pending');
    expect(gatewayState.hangs).toHaveLength(1);

    const callbackPromise = postReceipt({
      reference: pending!.internal_message_id,
      status: 'delivered',
    });
    const retryPromise = sendHttp(conversationId, payload, key);

    gatewayState.hangs[0].release();

    const [sendResponse, callbackResponse, retryResponse] = await Promise.all([
      sendPromise,
      callbackPromise,
      retryPromise,
    ]);
    expect(sendResponse.status).toBe(201);
    expect(callbackResponse.status).toBe(200);
    expect(retryResponse.status).toBe(200);
    const retryBody = await jsonOf<SendBody>(retryResponse);
    expect(retryBody.deduplicated).toBe(true);
    expect(['pending', 'accepted', 'sent']).toContain(retryBody.outcome);

    const finalDelivery = await deliveryByKey(key);
    expect(finalDelivery?.status).toBe('sent');
    expect((await messageById(finalDelivery!.internal_message_id))?.status).toBe('delivered');
    expect(await countsFor(conversationId)).toEqual({ messages: 1, deliveries: 1, events: 1 });
    expect(gatewayState.requests).toBe(1);

    evidence.push({
      case: 'AC2-corrida-callback-retry',
      finalDelivery: finalDelivery?.status,
      finalMessage: 'delivered',
      gatewayRequests: 1,
      retryDeduplicated: true,
    });
  });

  it('AC3 — intenção órfã é listável e a resolução explícita é idempotente (sem reenvio)', async () => {
    const conversationId = await createConversation();
    const key = `prod11-ac3-orphan-${randomUUID()}`;
    gatewayState.mode = 'weird200';

    const sent = await sendHttp(conversationId, { content: 'AC3 — órfã' }, key);
    expect(sent.status).toBe(201);
    const sentBody = await jsonOf<SendBody>(sent);
    const orphan = await deliveryByKey(key);
    expect(orphan?.status).toBe('unknown_reconciling');
    expect(gatewayState.requests).toBe(1);

    const listedBefore = await chat.outboundDeliveryRepository.listOutboundIntentsForReconciliation({ limit: 200 });
    expect(listedBefore.some((row) => row.id === orphan!.id)).toBe(true);

    const first = await chat.outboundDeliveryRepository.resolveOutboundIntentExplicitly({
      deliveryId: orphan!.id,
      resolution: 'failed',
      reason: 'operator_confirmed_not_sent',
    });
    expect(first.found).toBe(true);
    expect(first.resolved).toBe(true);
    expect(first.duplicate).toBe(false);

    const failed = await deliveryByKey(key);
    expect(failed?.status).toBe('failed');
    expect(failed?.last_error).toBe('operator_confirmed_not_sent');
    expect((await messageById(sentBody.messageId))?.status).toBe('failed');
    const attemptsAfterResolution = failed?.attempt_count;

    const second = await chat.outboundDeliveryRepository.resolveOutboundIntentExplicitly({
      deliveryId: orphan!.id,
      resolution: 'failed',
      reason: 'operator_confirmed_not_sent',
    });
    expect(second.resolved).toBe(false);
    expect(second.duplicate).toBe(true);
    expect((await deliveryByKey(key))?.attempt_count).toBe(attemptsAfterResolution);

    const listedAfter = await chat.outboundDeliveryRepository.listOutboundIntentsForReconciliation({ limit: 200 });
    expect(listedAfter.some((row) => row.id === orphan!.id)).toBe(false);
    expect(gatewayState.requests).toBe(1);
    expect(await countsFor(conversationId)).toEqual({ messages: 1, deliveries: 1, events: 1 });

    evidence.push({
      case: 'AC3-orfa-listavel-resolvivel',
      listedBefore: true,
      resolvedOnce: true,
      duplicateSecondNoop: true,
      gatewayRequests: 1,
    });
  });

  it('AC2 — confirmação do gateway por id interno (rota real) resolve a intenção e é idempotente', async () => {
    const conversationId = await createConversation();
    const key = `prod11-ac2-confirm-${randomUUID()}`;
    gatewayState.mode = 'weird200';

    const sent = await sendHttp(conversationId, { content: 'AC2 — confirmação do gateway' }, key);
    expect(sent.status).toBe(201);
    const sentBody = await jsonOf<SendBody>(sent);
    expect(sentBody.outcome).toBe('unknown_reconciling');

    const externalId = `gw-ext-${randomUUID()}`;
    const confirm = await postGatewayConfirm(sentBody.messageId, externalId);
    expect(confirm.status).toBe(200);
    expect((await jsonOf<{ success: boolean }>(confirm)).success).toBe(true);

    const resolved = await deliveryByKey(key);
    expect(resolved?.status).toBe('sent');
    expect(resolved?.provider_message_id).toBe(externalId);
    const message = await messageById(sentBody.messageId);
    expect(message?.status).toBe('sent');
    expect(message?.external_message_id).toBe(externalId);

    const attempts = resolved?.attempt_count;
    const confirmAgain = await postGatewayConfirm(sentBody.messageId, externalId);
    expect(confirmAgain.status).toBe(200);
    expect((await deliveryByKey(key))?.attempt_count).toBe(attempts);
    expect(gatewayState.requests).toBe(1);

    evidence.push({
      case: 'AC2-confirmacao-gateway',
      finalStatus: resolved?.status,
      externalMessageId: externalId,
      idempotent: true,
      gatewayRequests: 1,
    });
  });

  it('AC3 — crash real entre envio e callback: intenção sobrevive, retry não reenvia e receipt resolve', async () => {
    const conversationId = await createConversation();
    const key = `prod11-ac3-crash-${randomUUID()}`;
    const payload = { content: 'prod-11 crash window' };
    gatewayState.mode = 'hang';

    const crash = startCrashChild(conversationId, key, payload.content);
    try {
      expect(await waitFor(() => gatewayState.requests === 1, 40_000)).toBe(true);

      if (crash.child.pid) {
        try {
          process.kill(-crash.child.pid, 'SIGKILL');
        } catch {
          crash.child.kill('SIGKILL');
        }
      }
      const exit = await Promise.race([
        crash.exited,
        new Promise<null>((resolveWait) => setTimeout(() => resolveWait(null), 20_000)),
      ]);
      expect(exit).not.toBeNull();

      // A intenção commitada ANTES do envio sobreviveu ao crash.
      const delivery = await deliveryByKey(key);
      expect(delivery?.status).toBe('pending');
      expect((await messageById(delivery!.internal_message_id))?.status).toBe('pending');
      expect(await countsFor(conversationId)).toEqual({ messages: 1, deliveries: 1, events: 1 });
      const requestsAtCrash = gatewayState.requests;

      // Retomada: retry da mesma chave devolve o estado da intenção sem reenviar.
      const retry = await sendHttp(conversationId, payload, key);
      expect(retry.status).toBe(200);
      const retryBody = await jsonOf<SendBody>(retry);
      expect(retryBody.deduplicated).toBe(true);
      expect(retryBody.outcome).toBe('pending');
      expect(gatewayState.requests).toBe(requestsAtCrash);

      // Reconciliação resolve a intenção órfã do crash (nenhum segundo envio).
      const receipt = await postReceipt({
        reference: delivery!.internal_message_id,
        status: 'delivered',
      });
      expect(receipt.status).toBe(200);
      expect((await jsonOf<{ updated: boolean }>(receipt)).updated).toBe(true);

      const finalDelivery = await deliveryByKey(key);
      expect(finalDelivery?.status).toBe('sent');
      expect((await messageById(delivery!.internal_message_id))?.status).toBe('delivered');
      expect(await countsFor(conversationId)).toEqual({ messages: 1, deliveries: 1, events: 1 });
      expect(gatewayState.requests).toBe(requestsAtCrash);

      evidence.push({
        case: 'AC3-crash-entre-envio-e-callback',
        statusAfterCrash: '@pending',
        retryDeduplicated: true,
        finalStatus: finalDelivery?.status,
        finalMessage: 'delivered',
        gatewayRequests: requestsAtCrash,
        childExit: exit,
      });
    } finally {
      if (crash.child.exitCode === null && crash.child.signalCode === null && crash.child.pid) {
        try {
          process.kill(-crash.child.pid, 'SIGKILL');
        } catch {
          crash.child.kill('SIGKILL');
        }
      }
    }
  });

  it('AC4 — TTL: nada é apagado antes do vencimento; expirado terminaliza com causa; unknown não é purgado', async () => {
    const conversationId = await createConversation();
    const keyExpired = `prod11-ac4-ttl-${randomUUID()}`;
    const keyFuture = `prod11-ac4-future-${randomUUID()}`;
    gatewayState.mode = 'weird200';

    const expiredSend = await sendHttp(conversationId, { content: 'AC4 — expira' }, keyExpired);
    expect(expiredSend.status).toBe(201);
    const expiredBody = await jsonOf<SendBody>(expiredSend);
    const expiredDelivery = await deliveryByKey(keyExpired);

    const futureSend = await sendHttp(conversationId, { content: 'AC4 — futuro' }, keyFuture);
    expect(futureSend.status).toBe(201);
    const futureDelivery = await deliveryByKey(keyFuture);

    // Antes do TTL: nenhum candidato, nenhum efeito (dry-run e apply).
    const expiredNow = await chat.outboundDeliveryRepository.listExpiredOutboundIntents({ limit: 200 });
    expect(expiredNow.some((row) => row.id === expiredDelivery!.id)).toBe(false);
    const dryRunFresh = await chat.outboundDeliveryRepository.expireStaleOutboundIntents({ apply: false, limit: 200 });
    expect(dryRunFresh.applied).toBe(0);
    expect(dryRunFresh.candidates.some((row) => row.id === expiredDelivery!.id)).toBe(false);
    expect((await deliveryByKey(keyExpired))?.status).toBe('unknown_reconciling');

    // Vence o TTL: candidato; dry-run não muda; apply terminaliza com causa.
    await pool.query(
      "UPDATE outbound_deliveries SET expires_at = NOW() - INTERVAL '2 days' WHERE id = $1",
      [expiredDelivery!.id],
    );
    const listedExpired = await chat.outboundDeliveryRepository.listExpiredOutboundIntents({ limit: 200 });
    expect(listedExpired.some((row) => row.id === expiredDelivery!.id)).toBe(true);

    const dryRun = await chat.outboundDeliveryRepository.expireStaleOutboundIntents({ apply: false, limit: 200 });
    expect(dryRun.applied).toBe(0);
    expect((await deliveryByKey(keyExpired))?.status).toBe('unknown_reconciling');

    const applied = await chat.outboundDeliveryRepository.expireStaleOutboundIntents({ apply: true, limit: 200 });
    expect(applied.applied).toBeGreaterThanOrEqual(1);
    const afterExpire = await deliveryByKey(keyExpired);
    expect(afterExpire?.status).toBe('failed');
    expect(afterExpire?.last_error).toBe('idempotency_ttl_expired');
    // A linha permanece (material do tombstone) — nada apagado no TTL.
    expect(afterExpire).not.toBeNull();
    expect((await messageById(expiredBody.messageId))?.status).toBe('failed');

    // Intenção futura continua intocada e não elegível a purge.
    const secondApply = await chat.outboundDeliveryRepository.expireStaleOutboundIntents({ apply: true, limit: 200 });
    expect(secondApply.applied).toBe(0);
    expect((await deliveryByKey(keyFuture))?.status).toBe('unknown_reconciling');
    const purgeUnknown = await chat.outboundDeliveryRepository.purgeTerminalOutboundDeliveries({ limit: 200 });
    expect(purgeUnknown.candidates.some((row) => row.id === futureDelivery!.id)).toBe(false);

    evidence.push({
      case: 'AC4-ttl-politica',
      beforeTtlCandidates: 0,
      dryRunApplied: 0,
      expiredStatus: afterExpire?.status,
      expiredLastError: afterExpire?.last_error,
      rowRetained: true,
      unknownNeverPurged: true,
    });
  });

  it('AC4 — purge de terminal antigo respeita retenção e deixa tombstone que impede reenvio', async () => {
    const conversationId = await createConversation();
    const keyOldSent = `prod11-ac4-old-sent-${randomUUID()}`;
    const keyOldUnknown = `prod11-ac4-old-unknown-${randomUUID()}`;
    const keyFresh = `prod11-ac4-fresh-${randomUUID()}`;

    gatewayState.mode = 'ok';
    const oldSent = await sendHttp(conversationId, { content: 'AC4 — terminal antigo' }, keyOldSent);
    expect(oldSent.status).toBe(201);
    const oldSentBody = await jsonOf<SendBody>(oldSent);
    const oldSentDelivery = await deliveryByKey(keyOldSent);

    gatewayState.mode = 'weird200';
    const oldUnknown = await sendHttp(conversationId, { content: 'AC4 — unknown antigo' }, keyOldUnknown);
    expect(oldUnknown.status).toBe(201);
    const oldUnknownDelivery = await deliveryByKey(keyOldUnknown);

    gatewayState.mode = 'ok';
    const fresh = await sendHttp(conversationId, { content: 'AC4 — terminal recente' }, keyFresh);
    expect(fresh.status).toBe(201);
    const freshDelivery = await deliveryByKey(keyFresh);

    await pool.query(
      "UPDATE outbound_deliveries SET expires_at = NOW() - INTERVAL '40 days' WHERE id = ANY($1::uuid[])",
      [[oldSentDelivery!.id, oldUnknownDelivery!.id]],
    );

    const dryRun = await chat.outboundDeliveryRepository.purgeTerminalOutboundDeliveries({ limit: 200 });
    expect(dryRun.deleted).toBe(0);
    expect(dryRun.candidates.some((row) => row.id === oldSentDelivery!.id)).toBe(true);
    expect(dryRun.candidates.some((row) => row.id === oldUnknownDelivery!.id)).toBe(false);
    expect(dryRun.candidates.some((row) => row.id === freshDelivery!.id)).toBe(false);

    const applied = await chat.outboundDeliveryRepository.purgeTerminalOutboundDeliveries({ apply: true, limit: 200 });
    expect(applied.deleted).toBeGreaterThanOrEqual(1);
    expect(await deliveryById(oldSentDelivery!.id)).toBeNull();
    expect((await deliveryById(oldUnknownDelivery!.id))?.status).toBe('unknown_reconciling');
    expect((await deliveryById(freshDelivery!.id))?.status).toBe('sent');

    // A mensagem sobrevive ao purge da delivery.
    expect((await messageById(oldSentBody.messageId))?.status).toBe('sent');

    // Tombstone preserva a proibição de reenvio da chave purgada.
    const tombstone = await pool.query<{ client_key: string }>(
      'SELECT client_key FROM outbound_idempotency_tombstones WHERE client_key = $1 AND scope_conversation_id = $2',
      [keyOldSent, conversationId],
    );
    expect(tombstone.rows).toHaveLength(1);

    const requestsBeforeRetry = gatewayState.requests;
    const retry = await sendHttp(conversationId, { content: 'AC4 — terminal antigo' }, keyOldSent);
    expect(retry.status).toBe(409);
    expect((await jsonOf<SendBody>(retry)).error).toBe('IDEMPOTENCY_KEY_CONFLICT');
    expect(gatewayState.requests).toBe(requestsBeforeRetry);

    evidence.push({
      case: 'AC4-purge-retencao',
      purgedTerminalOld: applied.deleted,
      unknownPreserved: true,
      freshPreserved: true,
      tombstoneCreated: true,
      retryAfterPurge: 409,
      gatewayRequests: requestsBeforeRetry,
    });
  });
});
