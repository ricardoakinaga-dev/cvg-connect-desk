/**
 * PROD-10 — Secretary em execução durável assíncrona (C04/G03, C05, C08).
 *
 * Prova real em PostgreSQL + Redis isolados do harness AAA (run `prod10*`,
 * worker 24, `cvg_aaa_prod10_*`), usando o CÓDIGO DE PRODUÇÃO:
 *  - recepção: `buildDeskApiApp()` + `POST /webhook/inbound` (HMAC real);
 *  - worker: handlers/processor reais, lease/@cvg/events e claim por (eventId,
 *    consumer) com generation;
 *  - Secretary: sandbox HTTP local controlado (lento/erro/handoff) — consumidor
 *    real do contrato `/invoke` (nunca mock de módulo);
 *  - Gateway: sandbox HTTP local do contrato outbound (real `gatewayService`);
 *  - nunca o banco do host.
 *
 * AC1 — webhook responde sem esperar a IA; intenção durável comita com o
 *       inbound (`message.persisted`) e o worker a processa sob lease.
 * AC2 — crash antes da invocação retoma; replay/crash pós-efeito não duplica a
 *       resposta (invocação `completed` + caminho idempotente C05); duplicata
 *       inbound não perde a invocação; estado pending/processing/completed/
 *       failed/unknown registrado.
 * AC3 — timeout/retry com orçamento limitado; resultado ambíguo fica `unknown`
 *       sem retry cego/DLQ; handoff humano/estado antigo cancelam resposta
 *       tardia.
 * AC4 — texto humano persiste sem IA; resposta concluída usa o outbound
 *       idempotente (C05); logs do worker sem PII (conteúdo/telefone).
 */
import { createHmac, randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, writeFileSync } from 'node:fs';
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

interface Harness {
  teardownIsolatedEnv: (
    ctx: RunContext,
    options?: { stopServices?: boolean; dropDatabase?: boolean },
  ) => Record<string, unknown>;
}

interface DatabasePoolLike {
  end(): Promise<void>;
}

interface EventEnvelopeLike {
  event_id: string;
  event_type: string;
  event_version?: number;
  aggregate_type?: string;
  aggregate_id?: string;
  occurred_at?: string;
  payload: unknown;
  correlation_id?: string;
  causation_id?: string;
  version?: number;
  [key: string]: unknown;
}

interface LeaseTokenLike {
  eventId: string;
  consumerId: string;
  owner: string;
  generation: number;
  leaseUntil: Date;
}

interface ReaderLike {
  claim(input: {
    owner: string;
    leaseSeconds?: number;
    limit?: number;
    eventTypes?: readonly string[];
  }): Promise<Array<{ event: EventEnvelopeLike; lease: LeaseTokenLike }>>;
  acknowledge(
    eventId: string,
    token: { owner: string; generation: number },
  ): Promise<string>;
  ack(input: { eventId: string; owner: string; generation: number }): Promise<string>;
  nack(input: {
    eventId: string;
    owner: string;
    generation: number;
    error: string;
    errorCode?: string;
    permanent?: boolean;
  }): Promise<string>;
}

interface HandlerEffectReportLike {
  effectType: string;
  alertId?: string;
  deduplicated: boolean;
  invocationId?: string;
  status?: string;
  outboundMessageId?: string;
}

interface ProcessOutcomeLike {
  eventId: string;
  eventType: string;
  outcome: string;
  attempts: number;
  effect?: HandlerEffectReportLike;
  error?: string;
  errorCode?: string;
}

type ProcessEventFn = (event: EventEnvelopeLike, lease: LeaseTokenLike) => Promise<ProcessOutcomeLike>;

interface LogRecordLike {
  [key: string]: unknown;
  msg?: string;
  level?: string;
  event_id?: string;
  correlation_id?: string;
}

interface LoggerLike {
  info(fields: LogRecordLike): void;
  warn(fields: LogRecordLike): void;
  error(fields: LogRecordLike): void;
}

interface InvocationRow {
  id: string;
  invocation_key: string;
  conversation_id: string;
  message_id: string | null;
  event_id: string | null;
  consumer_id: string | null;
  action: string;
  status: string;
  attempt_count: number;
  last_error: string | null;
  error_code: string | null;
  result_ref: string | null;
  detail: Record<string, unknown> | null;
  completed_at: Date | null;
}

interface AckRow {
  processed_at: Date | null;
  retry_count: number;
  lease_owner: string | null;
  lease_until: Date | null;
  generation: number;
  last_error: string | null;
}

interface DeadLetterRow {
  id: string;
  status: string;
  error_code: string | null;
  error_message: string | null;
  attempt_count: number;
  payload: EventEnvelopeLike;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../../..');
const PROGRAM_DIR = process.env.CVG_PROGRAM_DIR || join(REPO_ROOT, 'docs', 'producao-2026-09-13');
const EVIDENCE_SEGMENT = process.env.CVG_EVIDENCE_SEGMENT?.trim();
const EVIDENCE_DIR = join(
  PROGRAM_DIR,
  'evidencias',
  'prod-10',
  ...(EVIDENCE_SEGMENT ? [EVIDENCE_SEGMENT] : []),
);
const LOG_DIR = join(EVIDENCE_DIR, 'logs');
const RUNTIME_DIR = process.env.CVG_RUNTIME_DIR || join(EVIDENCE_DIR, 'runtime');
const MIGRATIONS_DIR = join(REPO_ROOT, 'packages', 'database', 'supabase', 'migrations');
const RUN_ID = process.env.AAA_RUN_ID || 'prod10';
const WORKER_INDEX = Number(process.env.AAA_WORKER_INDEX || '24');
const WORKER_CONSUMER = 'worker';
const WEBHOOK_SECRET = 'prod10-webhook-secret';
const SECRETARY_API_KEY = 'prod10-secretary-sandbox';
const GATEWAY_API_KEY = 'prod10-gateway-sandbox';
const SECRETARY_REPLY_TEXT = 'Resposta automática da Secretary';

process.env.CVG_PROGRAM_DIR = PROGRAM_DIR;
process.env.CVG_RUNTIME_DIR = RUNTIME_DIR;
process.env.AAA_RUN_ID = RUN_ID;
process.env.AAA_WORKER_INDEX = String(WORKER_INDEX);
process.env.NODE_ENV = 'test';
process.env.DESK_ENV = 'production';
process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;
// O DATABASE_URL só é definido após provisionar o PG isolado (evita qualquer
// conexão com o banco do host no carregamento dos módulos).
delete process.env.DATABASE_URL;

vi.setConfig({ testTimeout: 150_000, hookTimeout: 600_000 });

interface SecretarySandboxState {
  mode: 'ok' | 'handoff' | 'fail503' | 'slow';
  delayMs: number;
  started: number;
  completed: number;
  bodies: Array<{
    action?: string;
    conversation_id?: string;
    message_id?: string;
    invocation_id?: string;
    context?: { content?: string };
  }>;
  idempotencyKeys: string[];
}

interface GatewaySandboxState {
  requests: number;
  bodies: Array<Record<string, unknown>>;
}

const secretaryState: SecretarySandboxState = {
  mode: 'ok',
  delayMs: 0,
  started: 0,
  completed: 0,
  bodies: [],
  idempotencyKeys: [],
};
const gatewayState: GatewaySandboxState = { requests: 0, bodies: [] };
let secretaryServer: Server | null = null;
let gatewayServer: Server | null = null;
let secretaryUrl = '';
let gatewayUrl = '';

const evidence: Array<Record<string, unknown>> = [];
const spawnedChildren: ChildProcess[] = [];
let nextHealthPortOffset = 0;

let ctx: RunContext;
let isolatedEnv: { databaseName: string; marker: { runId: string } };
let pg: PgRuntime;
let harness: Harness;
let pool: PgPoolLike;
let databaseModulePool: DatabasePoolLike | undefined;
let app: FastifyInstance | null = null;

let makeReader: (maxRetries?: number) => ReaderLike;
let makeProcessor: (reader: ReaderLike, overrides?: Record<string, unknown>) => {
  processEvent: ProcessEventFn;
  logs: LogRecordLike[];
};
let workerHandlers: Record<string, (event: EventEnvelopeLike) => Promise<HandlerEffectReportLike | null>>;

function databaseUrl(): string {
  return `postgresql://cvg_aaa@127.0.0.1:${ctx.ports.postgres}/${isolatedEnv.databaseName}`;
}

function writeEvidenceJson(name: string, value: unknown): void {
  writeFileSync(join(EVIDENCE_DIR, name), `${JSON.stringify(value, null, 2)}\n`);
}

function startSandboxServers(): void {
  secretaryServer = createServer((request, response) => {
    if (request.url !== '/invoke' || request.method !== 'POST') {
      response.writeHead(404).end();
      return;
    }
    let raw = '';
    request.on('data', (chunk: Buffer) => {
      raw += chunk.toString();
    });
    request.on('end', () => {
      secretaryState.started += 1;
      const idempotencyKey = request.headers['idempotency-key'];
      secretaryState.idempotencyKeys.push(typeof idempotencyKey === 'string' ? idempotencyKey : '');
      try {
        secretaryState.bodies.push(JSON.parse(raw) as SecretarySandboxState['bodies'][number]);
      } catch {
        secretaryState.bodies.push({});
      }
      const reply = () => {
        if (secretaryState.mode === 'fail503') {
          secretaryState.completed += 1;
          response.writeHead(503, { 'content-type': 'text/plain' });
          response.end('secretary unavailable');
          return;
        }
        secretaryState.completed += 1;
        response.writeHead(200, { 'content-type': 'application/json' });
        if (secretaryState.mode === 'handoff') {
          response.end(JSON.stringify({
            success: true,
            response: 'Transferindo para atendimento humano',
            action: 'handoff',
            classification: { category: 'urgent', priority: 'high', confidence: 0.97 },
            handoffReason: 'prod10 sandbox handoff',
          }));
          return;
        }
        response.end(JSON.stringify({
          success: true,
          response: SECRETARY_REPLY_TEXT,
          classification: { category: 'general', priority: 'low', confidence: 0.93 },
        }));
      };
      if (secretaryState.mode === 'slow' && secretaryState.delayMs > 0) {
        const timer = setTimeout(reply, secretaryState.delayMs);
        timer.unref();
      } else {
        reply();
      }
    });
  });

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
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: 'queued', operation_id: `gw-op-${gatewayState.requests}` }));
    });
  });
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const port = (server.address() as AddressInfo).port;
  return `http://127.0.0.1:${port}`;
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  return check();
}

async function count(query: string, params: unknown[] = []): Promise<number> {
  const result = await pool.query<{ n: number }>(query, params);
  return Number(result.rows[0]?.n ?? 0);
}

function signRawBody(rawBody: string, timestamp: number): string {
  return createHmac('sha256', WEBHOOK_SECRET).update(`${timestamp}.${rawBody}`).digest('hex');
}

function signedHeaders(rawBody: string, eventId: string, timestamp = Math.floor(Date.now() / 1000)): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-webhook-signature': `sha256=${signRawBody(rawBody, timestamp)}`,
    'x-webhook-timestamp': String(timestamp),
    'x-webhook-event-id': eventId,
  };
}

function bodyFor(messageId: string, conversationId: string, content: string): string {
  return JSON.stringify({
    messageId,
    conversationId,
    from: '+5511900070707',
    content,
    timestamp: '2026-09-13T18:00:00.000Z',
  });
}

async function postWebhook(rawBody: string, eventId: string): Promise<{ status: number; json: () => Record<string, unknown> }> {
  if (!app) throw new Error('app não inicializado');
  const response = await app.inject({
    method: 'POST',
    url: '/webhook/inbound',
    headers: signedHeaders(rawBody, eventId),
    payload: rawBody,
  });
  return { status: response.statusCode, json: () => response.json() as Record<string, unknown> };
}

async function messageRow(externalMessageId: string): Promise<{
  id: string;
  conversation_id: string;
  content: string;
  direction: string;
  sender: string | null;
  external_message_id: string | null;
} | null> {
  const result = await pool.query<{
    id: string;
    conversation_id: string;
    content: string;
    direction: string;
    sender: string | null;
    external_message_id: string | null;
  }>(
    'SELECT id, conversation_id, content, direction, sender, external_message_id FROM messages WHERE external_message_id = $1',
    [externalMessageId],
  );
  return result.rows[0] ?? null;
}

async function outboxEventForMessage(messageId: string): Promise<{ event_id: string; event_type: string; payload: EventEnvelopeLike } | null> {
  const result = await pool.query<{ event_id: string; event_type: string; payload: EventEnvelopeLike }>(
    "SELECT event_id, event_type, payload FROM outbox_events WHERE event_type = 'message.persisted' AND aggregate_id = $1",
    [messageId],
  );
  return result.rows[0] ?? null;
}

async function invocationByKey(invocationKey: string): Promise<InvocationRow | null> {
  const result = await pool.query<InvocationRow>('SELECT * FROM secretary_invocations WHERE invocation_key = $1', [invocationKey]);
  return result.rows[0] ?? null;
}

async function ackRow(eventId: string): Promise<AckRow | null> {
  const result = await pool.query<AckRow>(
    'SELECT processed_at, retry_count, lease_owner, lease_until, generation, last_error FROM outbox_consumer_acks WHERE event_id = $1 AND consumer_id = $2',
    [eventId, WORKER_CONSUMER],
  );
  return result.rows[0] ?? null;
}

async function expireLease(eventId: string, consumerId = WORKER_CONSUMER): Promise<void> {
  await pool.query(
    "UPDATE outbox_consumer_acks SET lease_until = now() - interval '1 second' WHERE event_id = $1 AND consumer_id = $2",
    [eventId, consumerId],
  );
}

async function deadLetterFor(eventId: string): Promise<DeadLetterRow | null> {
  const result = await pool.query<DeadLetterRow>(
    'SELECT id, status, error_code, error_message, attempt_count, payload FROM dead_letter_events WHERE original_event_id = $1',
    [eventId],
  );
  return result.rows[0] ?? null;
}

async function outboundRows(conversationId: string): Promise<Array<{ id: string; content: string; status: string }>> {
  const result = await pool.query<{ id: string; content: string; status: string }>(
    "SELECT id, content, status FROM messages WHERE conversation_id = $1 AND direction = 'outbound' ORDER BY created_at ASC",
    [conversationId],
  );
  return result.rows;
}

async function outboundDeliveriesFor(clientKey: string): Promise<Array<{ id: string; client_key: string; status: string; internal_message_id: string }>> {
  const result = await pool.query<{ id: string; client_key: string; status: string; internal_message_id: string }>(
    'SELECT id, client_key, status, internal_message_id FROM outbound_deliveries WHERE client_key = $1',
    [clientKey],
  );
  return result.rows;
}

function startWorkerProcess(extraEnv: Record<string, string>): {
  child: ChildProcess;
  output: () => string;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
} {
  nextHealthPortOffset += 1;
  const child = spawn(join(REPO_ROOT, 'node_modules', '.bin', 'tsx'), ['src/index.ts'], {
    cwd: join(REPO_ROOT, 'apps', 'message-worker'),
    // `detached` cria um process group próprio: o `tsx` lança um processo filho
    // Node e o kill de grupo garante que NENHUM worker sobreviva ao teste
    // (um grandchild órfão reclamaria eventos dos testes seguintes).
    detached: true,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl(),
      REDIS_URL: ctx.redisUrl,
      NODE_ENV: 'test',
      SECRETARY_URL: secretaryUrl,
      SECRETARY_API_KEY,
      SECRETARY_TIMEOUT_MS: '2000',
      SECRETARY_MAX_RETRIES: '1',
      GATEWAY_URL: gatewayUrl,
      GATEWAY_API_KEY,
      OUTBOX_POLL_INTERVAL_MS: '100',
      WORKER_LEASE_SECONDS: '3',
      WORKER_RETRY_INITIAL_DELAY_MS: '50',
      WORKER_RETRY_MAX_DELAY_MS: '100',
      WORKER_RETRY_BACKOFF_MULTIPLIER: '1',
      WORKER_MAX_RETRIES: '2',
      WORKER_HEALTH_PORT: String(ctx.ports.api + 300 + nextHealthPortOffset),
      ...extraEnv,
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
  const logFile = join(LOG_DIR, `worker-${child.pid ?? randomUUID()}.log`);
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit) => {
    child.on('exit', (code, signal) => {
      try {
        writeFileSync(logFile, output);
      } catch {
        // Evidência best-effort; nunca falha o teste.
      }
      resolveExit({ code, signal });
    });
  });
  return { child, output: () => output, exited };
}

async function waitForExit(
  handle: { exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }> },
  timeoutMs: number,
): Promise<{ code: number | null; signal: NodeJS.Signals | null } | null> {
  return Promise.race([
    handle.exited,
    new Promise<null>((resolveWait) => setTimeout(() => resolveWait(null), timeoutMs)),
  ]);
}

async function killChildren(): Promise<void> {
  for (const child of spawnedChildren.splice(0)) {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      try {
        // Process group inteiro (tsx wrapper + Node filho).
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }
  }
}

beforeAll(async () => {
  mkdirSync(LOG_DIR, { recursive: true });
  startSandboxServers();
  secretaryUrl = await listen(secretaryServer!);
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
  isolatedEnv = await isolatedEnvModule.provisionIsolatedEnv(ctx);
  if (isolatedEnv.marker.runId !== ctx.runId) {
    throw new Error(`marcador do run divergente: ${isolatedEnv.marker.runId} != ${ctx.runId}`);
  }
  process.env.DATABASE_URL = databaseUrl();

  pool = new pg.Pool({ connectionString: databaseUrl(), max: 8 });

  const { drizzle } = await import('drizzle-orm/node-postgres');
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  await migrate(drizzle(pool as never) as never, { migrationsFolder: MIGRATIONS_DIR });

  const databaseSpecifier = '../../../../../packages/database/src/index.ts';
  const databaseModule = (await import(/* @vite-ignore */ databaseSpecifier)) as { getPool: () => DatabasePoolLike };
  databaseModulePool = databaseModule.getPool();

  process.env.SECRETARY_URL = secretaryUrl;
  process.env.SECRETARY_API_KEY = SECRETARY_API_KEY;
  process.env.SECRETARY_TIMEOUT_MS = '2000';
  process.env.GATEWAY_URL = gatewayUrl;
  process.env.GATEWAY_API_KEY = GATEWAY_API_KEY;

  const appModule = await import('../../app.ts');
  app = await appModule.buildDeskApiApp();
  await app.ready();

  const eventsSpecifier = '../../../../../packages/events/src/index.ts';
  const eventsModule = (await import(/* @vite-ignore */ eventsSpecifier)) as {
    ConsumerAwareOutboxReader: new (options: Record<string, unknown>) => ReaderLike;
    CONSUMER_IDS: { WORKER: string };
  };

  const contractSpecifier = '../../../../../apps/message-worker/src/contract.ts';
  const contractModule = (await import(/* @vite-ignore */ contractSpecifier)) as {
    WORKER_EVENT_TYPES: readonly string[];
  };

  const handlersSpecifier = '../../../../../apps/message-worker/src/handlers.ts';
  const handlersModule = (await import(/* @vite-ignore */ handlersSpecifier)) as {
    createHandlers: (logger: LoggerLike) => Record<string, (event: EventEnvelopeLike) => Promise<HandlerEffectReportLike | null>>;
  };

  const processorSpecifier = '../../../../../apps/message-worker/src/processor.ts';
  const processorModule = (await import(/* @vite-ignore */ processorSpecifier)) as {
    createEventProcessor: (options: {
      handlers: Record<string, (event: EventEnvelopeLike) => Promise<HandlerEffectReportLike | null>>;
      ports: { ack: ReaderLike['ack']; nack: ReaderLike['nack'] };
      retryConfig: { maxRetries: number; initialDelayMs: number; maxDelayMs: number; backoffMultiplier: number };
      logger: LoggerLike;
      sleep?: (delayMs: number) => Promise<void>;
      onBeforeEffect?: (event: EventEnvelopeLike) => void | Promise<void>;
      onAfterEffect?: (event: EventEnvelopeLike) => void | Promise<void>;
      onDeadLetter?: (handoff: Record<string, unknown>) => void | Promise<void>;
    }) => ProcessEventFn;
  };

  workerHandlers = handlersModule.createHandlers({
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  });

  makeReader = (maxRetries = 3): ReaderLike =>
    new eventsModule.ConsumerAwareOutboxReader({
      consumerId: eventsModule.CONSUMER_IDS.WORKER,
      batchSize: 50,
      maxRetries,
      eventTypes: contractModule.WORKER_EVENT_TYPES,
    });

  makeProcessor = (reader, overrides = {}) => {
    const logs: LogRecordLike[] = [];
    const logger: LoggerLike = {
      info: (fields) => logs.push({ ...fields, level: 'info' }),
      warn: (fields) => logs.push({ ...fields, level: 'warn' }),
      error: (fields) => logs.push({ ...fields, level: 'error' }),
    };
    const handlers = handlersModule.createHandlers(logger);
    const processEvent = processorModule.createEventProcessor({
      handlers,
      ports: { ack: (input) => reader.ack(input), nack: (input) => reader.nack(input) },
      retryConfig: { maxRetries: 1, initialDelayMs: 1, maxDelayMs: 2, backoffMultiplier: 1 },
      logger,
      ...overrides,
    });
    return { processEvent, logs };
  };
});

beforeEach(() => {
  secretaryState.mode = 'ok';
  secretaryState.delayMs = 0;
  secretaryState.started = 0;
  secretaryState.completed = 0;
  secretaryState.bodies = [];
  secretaryState.idempotencyKeys = [];
  gatewayState.requests = 0;
  gatewayState.bodies = [];
});

afterEach(async () => {
  vi.restoreAllMocks();
  await killChildren();
});

afterAll(async () => {
  writeEvidenceJson('prod-10-evidence.json', {
    generatedAt: new Date().toISOString(),
    runId: RUN_ID,
    workerIndex: WORKER_INDEX,
    database: isolatedEnv?.databaseName,
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
  if (databaseModulePool) await databaseModulePool.end().catch(() => undefined);
  if (pool) await pool.end().catch(() => undefined);
  secretaryServer?.close();
  gatewayServer?.close();
  if (ctx && harness) {
    harness.teardownIsolatedEnv(ctx, { stopServices: true, dropDatabase: true });
  }
});

async function claimEvent(eventId: string, owner: string, reader: ReaderLike): Promise<{ event: EventEnvelopeLike; lease: LeaseTokenLike }> {
  const claimed = await reader.claim({ owner, leaseSeconds: 30, limit: 50 });
  const item = claimed.find((candidate) => candidate.event.event_id === eventId);
  if (!item) throw new Error(`evento ${eventId} não reclamado (owner ${owner})`);
  return item;
}

describe('PROD-10 — Secretary em execução durável assíncrona (PG+Redis reais)', () => {
  it('AC1 — webhook responde sem esperar a IA; intenção durável completa via worker', async () => {
    const suffix = randomUUID();
    const externalMessageId = `prod10-ac1-msg-${suffix}`;
    const externalConversationId = `prod10-ac1-conv-${suffix}`;
    const content = `conteudo-ac1-${suffix}`;
    secretaryState.mode = 'slow';
    secretaryState.delayMs = 3000;

    startWorkerProcess({ SECRETARY_TIMEOUT_MS: '20000' });
    const rawBody = bodyFor(externalMessageId, externalConversationId, content);
    const startedAt = Date.now();
    const response = await postWebhook(rawBody, `prod10-ac1-evt-${suffix}`);
    const elapsedMs = Date.now() - startedAt;

    expect(response.status).toBe(200);
    expect(elapsedMs).toBeLessThan(1500);
    // A IA (lenta) ainda não respondeu quando o webhook confirmou o recibo.
    expect(secretaryState.completed).toBe(0);

    const message = await messageRow(externalMessageId);
    expect(message?.content).toBe(content);
    expect(message?.direction).toBe('inbound');
    const outboxEvent = await outboxEventForMessage(message!.id);
    expect(outboxEvent).not.toBeNull();

    // O worker reclamou a intenção e está com a invocação em `processing`.
    const processing = await waitFor(async () => (await invocationByKey(`inbound:${message!.id}`))?.status === 'processing', 10_000);
    expect(processing).toBe(true);
    const duringRow = await invocationByKey(`inbound:${message!.id}`);
    expect(duringRow?.event_id).toBe(outboxEvent!.event_id);
    expect(duringRow?.attempt_count).toBe(1);

    const completed = await waitFor(async () => (await invocationByKey(`inbound:${message!.id}`))?.status === 'completed', 30_000);
    expect(completed).toBe(true);
    expect(secretaryState.completed).toBe(1);

    const finalRow = await invocationByKey(`inbound:${message!.id}`);
    expect(finalRow?.error_code).toBeNull();
    expect(finalRow?.result_ref).not.toBeNull();

    const replies = await outboundRows(message!.conversation_id);
    expect(replies).toHaveLength(1);
    expect(replies[0]!.content).toBe(SECRETARY_REPLY_TEXT);
    const deliveries = await outboundDeliveriesFor(`secretary-reply:${externalMessageId}`);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.internal_message_id).toBe(replies[0]!.id);
    expect(gatewayState.requests).toBe(1);
    expect(await count('SELECT count(*)::int AS n FROM secretary_invocations WHERE conversation_id = $1', [message!.conversation_id])).toBe(1);
    expect(await ackRow(outboxEvent!.event_id).then((row) => row?.processed_at)).not.toBeNull();

    evidence.push({
      case: 'AC1-webhook-nao-espera-ia',
      externalMessageId,
      webhookElapsedMs: elapsedMs,
      secretaryDelayMs: 3000,
      outboxEventId: outboxEvent!.event_id,
      invocationStatusDuring: duringRow?.status,
      invocationStatusFinal: finalRow?.status,
      outboundReplies: replies.length,
      gatewayRequests: gatewayState.requests,
    });
  });

  it('AC2 — crash ANTES da invocação retoma no próximo worker: um único efeito', async () => {
    const suffix = randomUUID();
    const externalMessageId = `prod10-ac2a-msg-${suffix}`;
    const externalConversationId = `prod10-ac2a-conv-${suffix}`;
    const content = `conteudo-ac2a-${suffix}`;

    const worker1 = startWorkerProcess({ WORKER_FAULT_BEFORE_EFFECT: 'crash' });
    const response = await postWebhook(bodyFor(externalMessageId, externalConversationId, content), `prod10-ac2a-evt-${suffix}`);
    expect(response.status).toBe(200);

    const exit = await waitForExit(worker1, 20_000);
    expect(exit, `worker1 não encerrou; saída: ${worker1.output().slice(-1200)}`).not.toBeNull();
    expect(exit?.code).toBe(86);

    const message = await messageRow(externalMessageId);
    expect(message?.content).toBe(content);
    const outboxEvent = await outboxEventForMessage(message!.id);
    expect(outboxEvent).not.toBeNull();

    // Crash antes do efeito: nada foi invocado/respondido e o evento não foi ACK.
    expect(secretaryState.started).toBe(0);
    expect(await invocationByKey(`inbound:${message!.id}`)).toBeNull();
    expect(await outboundRows(message!.conversation_id)).toHaveLength(0);
    const crashedAck = await ackRow(outboxEvent!.event_id);
    expect(crashedAck?.processed_at).toBeNull();
    expect(crashedAck?.retry_count).toBe(0);

    await expireLease(outboxEvent!.event_id);
    const worker2 = startWorkerProcess({});
    const recovered = await waitFor(async () => (await invocationByKey(`inbound:${message!.id}`))?.status === 'completed', 30_000);
    expect(recovered).toBe(true);

    const finalRow = await invocationByKey(`inbound:${message!.id}`);
    expect(finalRow?.attempt_count).toBe(1);
    expect(finalRow?.last_error).toBeNull();
    expect(secretaryState.completed).toBe(1);
    const replies = await outboundRows(message!.conversation_id);
    expect(replies).toHaveLength(1);
    expect(gatewayState.requests).toBe(1);
    const recoveredAck = await ackRow(outboxEvent!.event_id);
    expect(recoveredAck?.processed_at).not.toBeNull();

    evidence.push({
      case: 'AC2-crash-antes-invocacao',
      externalMessageId,
      crashedExitCode: exit?.code,
      crashInvocationRows: 0,
      recoveredAttempts: finalRow?.attempt_count,
      outboundReplies: replies.length,
      gatewayRequests: gatewayState.requests,
    });
    void worker2;
  });

  it('AC2 — replay pós-efeito (sem ACK) não reexecuta a IA nem duplica a resposta', async () => {
    const suffix = randomUUID();
    const externalMessageId = `prod10-ac2b-msg-${suffix}`;
    const externalConversationId = `prod10-ac2b-conv-${suffix}`;
    const content = `conteudo-ac2b-${suffix}`;

    const response = await postWebhook(bodyFor(externalMessageId, externalConversationId, content), `prod10-ac2b-evt-${suffix}`);
    expect(response.status).toBe(200);
    const message = await messageRow(externalMessageId);
    const outboxEvent = await outboxEventForMessage(message!.id);
    expect(outboxEvent).not.toBeNull();

    const reader = makeReader(3);
    const firstClaim = await claimEvent(outboxEvent!.event_id, `${suffix}-owner-a`, reader);
    // Efeito REAL aplicado pelo handler, mas o processo "morre" antes do ACK.
    const firstEffect = await workerHandlers['message.persisted']!(firstClaim.event);
    expect(firstEffect?.status).toBe('completed');
    expect(firstEffect?.deduplicated).toBe(false);
    expect((await ackRow(outboxEvent!.event_id))?.processed_at).toBeNull();
    expect(secretaryState.completed).toBe(1);
    expect((await outboundRows(message!.conversation_id))).toHaveLength(1);

    // Reclaim (generation+1) e replay: invocação concluída ⇒ dedup.
    await expireLease(outboxEvent!.event_id);
    const reader2 = makeReader(3);
    const secondClaim = await claimEvent(outboxEvent!.event_id, `${suffix}-owner-b`, reader2);
    expect(secondClaim.lease.generation).toBe(2);
    const { processEvent } = makeProcessor(reader2);
    const outcome = await processEvent(secondClaim.event, secondClaim.lease);

    expect(outcome.outcome).toBe('acked');
    expect(outcome.effect?.effectType).toBe('secretary:invoke');
    expect(outcome.effect?.deduplicated).toBe(true);
    expect(secretaryState.completed).toBe(1);
    const finalRow = await invocationByKey(`inbound:${message!.id}`);
    expect(finalRow?.status).toBe('completed');
    expect(finalRow?.attempt_count).toBe(1);
    const replies = await outboundRows(message!.conversation_id);
    expect(replies).toHaveLength(1);
    expect(gatewayState.requests).toBe(1);
    expect((await ackRow(outboxEvent!.event_id))?.processed_at).not.toBeNull();

    evidence.push({
      case: 'AC2-replay-pos-efeito',
      externalMessageId,
      firstEffectDeduplicated: firstEffect?.deduplicated,
      replayDeduplicated: outcome.effect?.deduplicated,
      invocationAttempts: finalRow?.attempt_count,
      outboundReplies: replies.length,
      secretaryCalls: secretaryState.completed,
    });
  });

  it('AC2 — duplicata inbound não perde a invocação nem duplica a resposta', async () => {
    const suffix = randomUUID();
    const externalMessageId = `prod10-ac2c-msg-${suffix}`;
    const externalConversationId = `prod10-ac2c-conv-${suffix}`;
    const content = `conteudo-ac2c-${suffix}`;
    const rawBody = bodyFor(externalMessageId, externalConversationId, content);

    const first = await postWebhook(rawBody, `prod10-ac2c-evt1-${suffix}`);
    const duplicate = await postWebhook(rawBody, `prod10-ac2c-evt2-${suffix}`);
    expect(first.status).toBe(200);
    expect(duplicate.status).toBe(200);

    const message = await messageRow(externalMessageId);
    expect(await count('SELECT count(*)::int AS n FROM messages WHERE external_message_id = $1', [externalMessageId])).toBe(1);
    expect(await count("SELECT count(*)::int AS n FROM outbox_events WHERE event_type = 'message.persisted' AND aggregate_id = $1", [message!.id])).toBe(1);

    // A invocação continua durável e é executada UMA vez pelo worker.
    const outboxEvent = await outboxEventForMessage(message!.id);
    const reader = makeReader(3);
    const claim = await claimEvent(outboxEvent!.event_id, `${suffix}-owner`, reader);
    const { processEvent } = makeProcessor(reader);
    const outcome = await processEvent(claim.event, claim.lease);

    expect(outcome.outcome).toBe('acked');
    expect(outcome.effect?.status).toBe('completed');
    expect(secretaryState.completed).toBe(1);
    const replies = await outboundRows(message!.conversation_id);
    expect(replies).toHaveLength(1);
    expect(gatewayState.requests).toBe(1);

    evidence.push({
      case: 'AC2-duplicata-inbound',
      externalMessageId,
      duplicateStatus: duplicate.status,
      messages: 1,
      messagePersistedEvents: 1,
      invocationStatus: (await invocationByKey(`inbound:${message!.id}`))?.status,
      outboundReplies: replies.length,
    });
  });

  it('AC3 — timeout da Secretary: estado unknown sem retry cego, inbound preservado e sem PII no log', async () => {
    const suffix = randomUUID();
    const externalMessageId = `prod10-ac3a-msg-${suffix}`;
    const externalConversationId = `prod10-ac3a-conv-${suffix}`;
    const content = `conteudo-sensivel-${suffix}`;
    const phone = '+5511900070707';
    secretaryState.mode = 'slow';
    secretaryState.delayMs = 3000;

    const worker = startWorkerProcess({
      SECRETARY_TIMEOUT_MS: '300',
      WORKER_MAX_RETRIES: '2',
      WORKER_RETRY_INITIAL_DELAY_MS: '50',
      WORKER_RETRY_MAX_DELAY_MS: '100',
    });
    const response = await postWebhook(bodyFor(externalMessageId, externalConversationId, content), `prod10-ac3a-evt-${suffix}`);
    expect(response.status).toBe(200);

    const message = await messageRow(externalMessageId);
    expect(message?.content).toBe(content);
    const outboxEvent = await outboxEventForMessage(message!.id);
    expect(outboxEvent).not.toBeNull();

    const reachedUnknown = await waitFor(
      async () => (await invocationByKey(`inbound:${message!.id}`))?.status === 'unknown',
      10_000,
    );
    expect(reachedUnknown).toBe(true);
    const invocation = await invocationByKey(`inbound:${message!.id}`);
    expect(invocation?.status).toBe('unknown');
    expect(invocation?.error_code).toBe('SECRETARY_TIMEOUT');
    // Uma tentativa lógica usa a chave estável no provider; o cliente pode
    // reintentar dentro do orçamento, mas o worker não reabre `unknown`.
    expect(invocation?.attempt_count).toBe(1);
    expect(secretaryState.started).toBe(2);
    expect(secretaryState.idempotencyKeys).toEqual([
      `inbound:${message!.id}`,
      `inbound:${message!.id}`,
    ]);
    expect(secretaryState.bodies.every((body) => body.invocation_id === `inbound:${message!.id}`)).toBe(true);

    const ack = await waitFor(async () => (await ackRow(outboxEvent!.event_id))?.processed_at !== null, 10_000);
    expect(ack).toBe(true);
    expect(await deadLetterFor(outboxEvent!.event_id)).toBeNull();

    const acks = await ackRow(outboxEvent!.event_id);
    expect(acks?.processed_at).not.toBeNull();
    expect(acks?.retry_count).toBe(0);
    expect(acks?.last_error).toBeNull();
    expect(await outboundRows(message!.conversation_id)).toHaveLength(0);

    // AC4 — texto humano persiste intacto sem IA; log do worker não vaza PII.
    const output = worker.output();
    expect(output).toContain(outboxEvent!.event_id);
    expect(output).not.toContain(content);
    expect(output).not.toContain(phone);
    expect(output).not.toContain('conteudo-sensivel');

    evidence.push({
      case: 'AC3-timeout-unknown-no-blind-retry',
      externalMessageId,
      outboxEventId: outboxEvent!.event_id,
      invocationStatus: invocation?.status,
      invocationErrorCode: invocation?.error_code,
      invocationAttempts: invocation?.attempt_count,
      secretaryCalls: secretaryState.started,
      secretaryIdempotencyKeys: [...secretaryState.idempotencyKeys],
      secretaryInvocationIds: secretaryState.bodies.map((body) => body.invocation_id),
      unknownNoBlindRetry: true,
      messageContentPreserved: message?.content === content,
      logHasEventIdOnly: output.includes(outboxEvent!.event_id) && !output.includes(content) && !output.includes(phone),
    });
  });

  it('AC3 — handoff humano cancela resposta tardia; nova mensagem em conversa humana não invoca IA', async () => {
    const suffix = randomUUID();
    const externalMessageId = `prod10-ac3b-msg-${suffix}`;
    const externalConversationId = `prod10-ac3b-conv-${suffix}`;
    secretaryState.mode = 'handoff';

    const response = await postWebhook(bodyFor(externalMessageId, externalConversationId, `conteudo-ac3b-${suffix}`), `prod10-ac3b-evt-${suffix}`);
    expect(response.status).toBe(200);
    const message = await messageRow(externalMessageId);
    const outboxEvent = await outboxEventForMessage(message!.id);

    const reader = makeReader(3);
    const claim = await claimEvent(outboxEvent!.event_id, `${suffix}-owner`, reader);
    const { processEvent } = makeProcessor(reader);
    const outcome = await processEvent(claim.event, claim.lease);
    expect(outcome.outcome).toBe('acked');
    expect(outcome.effect?.status).toBe('completed');
    expect(secretaryState.started).toBe(1);
    expect(await count('SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1 AND direction = $2', [message!.conversation_id, 'outbound'])).toBe(0);

    const conversation = await pool.query<{ current_handler: string }>('SELECT current_handler FROM conversations WHERE id = $1', [message!.conversation_id]);
    expect(conversation.rows[0]?.current_handler).toBe('human');
    expect(await count("SELECT count(*)::int AS n FROM outbox_events WHERE event_type = 'handoff.completed' AND aggregate_id = $1", [message!.conversation_id])).toBe(1);
    const handoffInvocation = await invocationByKey(`inbound:${message!.id}`);
    expect(handoffInvocation?.detail?.handoffTriggered).toBe(true);

    // Nova mensagem com a conversa em atendimento humano: cancelada ANTES da IA.
    const secondMessageId = `prod10-ac3b-msg2-${suffix}`;
    const secondResponse = await postWebhook(bodyFor(secondMessageId, externalConversationId, `conteudo-ac3b-2-${suffix}`), `prod10-ac3b-evt2-${suffix}`);
    expect(secondResponse.status).toBe(200);
    const secondMessage = await messageRow(secondMessageId);
    const secondEvent = await outboxEventForMessage(secondMessage!.id);

    const reader2 = makeReader(3);
    const claim2 = await claimEvent(secondEvent!.event_id, `${suffix}-owner2`, reader2);
    const { processEvent: processEvent2 } = makeProcessor(reader2);
    const outcome2 = await processEvent2(claim2.event, claim2.lease);
    expect(outcome2.outcome).toBe('acked');
    expect(outcome2.effect?.status).toBe('skipped');
    expect(secretaryState.started).toBe(1);
    const secondInvocation = await invocationByKey(`inbound:${secondMessage!.id}`);
    expect(secondInvocation?.status).toBe('completed');
    expect(secondInvocation?.detail?.skipped).toBe('handler_not_bot');
    expect(await outboundRows(secondMessage!.conversation_id)).toHaveLength(0);

    evidence.push({
      case: 'AC3-handoff-cancela-resposta',
      firstMessageId: externalMessageId,
      handoffHandler: conversation.rows[0]?.current_handler,
      secretaryCalls: secretaryState.started,
      secondInvocationDetail: secondInvocation?.detail,
      outboundReplies: 0,
    });
  });

  it('AC3 — mensagem superseded (estado antigo) não gera resposta tardia', async () => {
    const suffix = randomUUID();
    const firstMessageId = `prod10-ac3c-msg1-${suffix}`;
    const secondMessageId = `prod10-ac3c-msg2-${suffix}`;
    const externalConversationId = `prod10-ac3c-conv-${suffix}`;
    const firstContent = `conteudo-ac3c-1-${suffix}`;
    const secondContent = `conteudo-ac3c-2-${suffix}`;

    expect((await postWebhook(bodyFor(firstMessageId, externalConversationId, firstContent), `prod10-ac3c-evt1-${suffix}`)).status).toBe(200);
    await new Promise((resolveWait) => setTimeout(resolveWait, 30));
    expect((await postWebhook(bodyFor(secondMessageId, externalConversationId, secondContent), `prod10-ac3c-evt2-${suffix}`)).status).toBe(200);

    const firstMessage = await messageRow(firstMessageId);
    const secondMessage = await messageRow(secondMessageId);
    expect(secondMessage!.conversation_id).toBe(firstMessage!.conversation_id);
    const firstEvent = await outboxEventForMessage(firstMessage!.id);
    const secondEvent = await outboxEventForMessage(secondMessage!.id);

    const reader = makeReader(3);
    const claimed = await reader.claim({ owner: `${suffix}-owner`, leaseSeconds: 30, limit: 50 });
    const firstClaim = claimed.find((candidate) => candidate.event.event_id === firstEvent!.event_id);
    const secondClaim = claimed.find((candidate) => candidate.event.event_id === secondEvent!.event_id);
    expect(firstClaim).toBeDefined();
    expect(secondClaim).toBeDefined();
    const { processEvent } = makeProcessor(reader);

    const firstOutcome = await processEvent(firstClaim!.event, firstClaim!.lease);
    expect(firstOutcome.outcome).toBe('acked');
    expect(firstOutcome.effect?.status).toBe('skipped');
    expect(secretaryState.started).toBe(0);
    const firstInvocation = await invocationByKey(`inbound:${firstMessage!.id}`);
    expect(firstInvocation?.detail?.skipped).toBe('superseded_by_newer_inbound');

    const secondOutcome = await processEvent(secondClaim!.event, secondClaim!.lease);
    expect(secondOutcome.outcome).toBe('acked');
    expect(secondOutcome.effect?.status).toBe('completed');
    expect(secretaryState.started).toBe(1);
    expect(secretaryState.bodies[0]?.context?.content).toBe(secondContent);

    const replies = await outboundRows(firstMessage!.conversation_id);
    expect(replies).toHaveLength(1);
    expect(replies[0]!.content).toBe(SECRETARY_REPLY_TEXT);
    expect(gatewayState.requests).toBe(1);

    evidence.push({
      case: 'AC3-superseded',
      firstInvocationDetail: firstInvocation?.detail,
      secondInvocationStatus: (await invocationByKey(`inbound:${secondMessage!.id}`))?.status,
      secretaryCalls: secretaryState.started,
      outboundReplies: replies.length,
    });
  });
});
