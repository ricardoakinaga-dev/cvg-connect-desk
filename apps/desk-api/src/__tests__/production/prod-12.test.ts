/**
 * PROD-12 — Provar leases, DLQ e fanout entre processos REAIS (C04/G03).
 *
 * Roda com PostgreSQL + Redis REAIS do harness AAA isolado (`cvg_aaa_prod12_w40`,
 * 127.0.0.1:60432/57080 — nunca o banco do host). Todos os cenários usam
 * PROCESSOS FILHOS reais com o código de produção:
 *   - `apps/message-worker/src/index.ts` (worker real, handlers/processor);
 *   - `apps/desk-api/src/index.ts` (rotas /events e /dead-letter por HTTP);
 *   - `apps/realtime-service/src/index.ts` (2 réplicas WS + bus Redis);
 *   - `prod-12-lease-child.ts` (RPC de claim/renew/ack/nack com a
 *     porta de production `ConsumerAwareOutboxReader`).
 *
 * AC1 — dois workers simultâneos: claim exclusivo, renew mantém, geração/owner,
 *       ACK de geração antiga stale, takeover pós-expiração sem efeito duplicado.
 * AC2 — DLQ durável sobrevive ao restart do processo; claim/replay/resolve/
 *       discard administrativos pelo HTTP real com auditoria; sem ACK de evento
 *       perdido; envelope íntegro; ACK de worker não esconde evento do
 *       consumidor http-poll.
 * AC3 — fanout realtime entre 2 processos: entrega 1× por assinante autorizado,
 *       negação por destinatário, revogação corta.
 * AC4 — SIGKILL no meio do processamento + recuperação; DLQ após esgotar
 *       tentativas atravessando restart de processo; logs de cada processo.
 */
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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

interface EnvelopeLike {
  event_id: string;
  event_type: string;
  event_version?: number;
  aggregate_type?: string;
  aggregate_id?: string;
  occurred_at?: string;
  payload: unknown;
  correlation_id?: string;
  causation_id?: string;
  metadata?: Record<string, unknown>;
  version?: number;
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
  replay_count: number;
  resolution_reason: string | null;
  resolved_by: string | null;
  payload: EnvelopeLike;
}

interface EventsModuleLike {
  publishToOutbox(event: EnvelopeLike): Promise<void>;
  publishRealtimeHintsAfterCommit(events: readonly EnvelopeLike[]): Promise<number>;
  getSharedRealtimeBus(): Promise<{ isConnected(): boolean }>;
  stopSharedRealtimeBus(): Promise<void>;
}

interface SocketMessage {
  event?: string;
  data?: { type?: string; payload?: unknown; [key: string]: unknown };
  [key: string]: unknown;
}

interface WsClient {
  socket: WebSocket;
  messages: SocketMessage[];
  closeCode?: number;
}

interface ChildHandle {
  name: string;
  child: ChildProcess;
  output: () => string;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../../..');
const PROGRAM_DIR = process.env.CVG_PROGRAM_DIR || join(REPO_ROOT, 'docs', 'producao-2026-09-13');
const EVIDENCE_SEGMENT = process.env.CVG_EVIDENCE_SEGMENT?.trim();
const EVIDENCE_DIR = join(
  PROGRAM_DIR,
  'evidencias',
  'prod-12',
  ...(EVIDENCE_SEGMENT ? [EVIDENCE_SEGMENT] : []),
);
const LOG_DIR = join(EVIDENCE_DIR, 'logs');
const RUNTIME_DIR = process.env.CVG_RUNTIME_DIR || join(EVIDENCE_DIR, 'runtime');
const MIGRATIONS_DIR = join(REPO_ROOT, 'packages', 'database', 'supabase', 'migrations');
const LEASE_CHILD = join(HERE, 'prod-12-lease-child.ts');
const TSX = join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
const RUN_ID = process.env.AAA_RUN_ID || 'prod12';
const WORKER_INDEX = Number(process.env.AAA_WORKER_INDEX || '40');
const WORKER_CONSUMER = 'worker';
const PASSWORD = 'Str0ngPass!42';
const PASSWORD_HASH = '$2a$10$QMxMJ8QfVxjH93DvTDs2m.OVuALoBBR6S9d58BwIPb8rcXHsUBJWC';
const INTERNAL_SECRET = process.env.INTERNAL_EVENTS_SECRET || 'prod12-internal-secret';

process.env.CVG_PROGRAM_DIR = PROGRAM_DIR;
process.env.CVG_RUNTIME_DIR = RUNTIME_DIR;
process.env.AAA_RUN_ID = RUN_ID;
process.env.AAA_WORKER_INDEX = String(WORKER_INDEX);
process.env.NODE_ENV = 'test';
process.env.INTERNAL_EVENTS_SECRET = INTERNAL_SECRET;
// DATABASE_URL só depois de provisionar o PG isolado: evita qualquer conexão
// com o banco do host no carregamento dos módulos.
delete process.env.DATABASE_URL;

vi.setConfig({ testTimeout: 300_000, hookTimeout: 900_000 });

const evidence: Array<Record<string, unknown>> = [];
const ephemeralChildren: ChildHandle[] = [];
const persistentChildren: ChildHandle[] = [];
const logHandles: ChildHandle[] = [];

let ctx: RunContext;
let isolatedEnv: { databaseName: string; marker: { runId: string } };
let pg: PgRuntime;
let harness: Harness;
let pool: PgPoolLike;
let databaseModulePool: DatabasePoolLike | undefined;

let publishToOutbox: EventsModuleLike['publishToOutbox'];
let publishRealtimeHintsAfterCommit: EventsModuleLike['publishRealtimeHintsAfterCommit'];
let getSharedRealtimeBus: EventsModuleLike['getSharedRealtimeBus'];
let stopSharedRealtimeBus: EventsModuleLike['stopSharedRealtimeBus'];

let adminToken = '';
let adminUserId = '';
let receptionistToken = '';
let nextWorkerHealthPort = 0;

function apiUrl(): string {
  return `http://127.0.0.1:${ctx.ports.api}`;
}

function databaseUrl(): string {
  return `postgresql://cvg_aaa@127.0.0.1:${ctx.ports.postgres}/${isolatedEnv.databaseName}`;
}

function writeEvidenceJson(name: string, value: unknown): void {
  writeFileSync(join(EVIDENCE_DIR, name), `${JSON.stringify(value, null, 2)}\n`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function waitForAsync(
  predicate: () => Promise<boolean>,
  timeoutMs = 30_000,
  label = 'condição',
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(50);
  }
  throw new Error(`Timeout aguardando ${label}`);
}

async function count(query: string, params: unknown[] = []): Promise<number> {
  const result = await pool.query<{ n: number }>(query, params);
  return Number(result.rows[0]?.n ?? 0);
}

function parseJsonLines(output: string): Array<Record<string, unknown>> {
  const records: Array<Record<string, unknown>> = [];
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      records.push(JSON.parse(trimmed) as Record<string, unknown>);
    } catch {
      // Linha parcial de chunk; ignorar.
    }
  }
  return records;
}

// ============================================================
// Fixtures
// ============================================================

async function insertSector(tag: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    'INSERT INTO sectors (name, code) VALUES ($1, $2) RETURNING id',
    [`prod12 ${tag}`, `prod12-${tag}`],
  );
  return result.rows[0]!.id;
}

async function insertUser(params: {
  email: string;
  roleName: string;
  sectorId?: string;
  accessLevel?: string;
}): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO users (name, email, password_hash, is_active)
     VALUES ($1, $2, $3, true) RETURNING id`,
    [`prod12 ${params.roleName}`, params.email, PASSWORD_HASH],
  );
  const userId = result.rows[0]!.id;
  await pool.query(
    'INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name = $2',
    [userId, params.roleName],
  );
  if (params.sectorId) {
    await pool.query(
      `INSERT INTO user_sectors (user_id, sector_id, access_level)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, sector_id) DO UPDATE SET access_level = EXCLUDED.access_level`,
      [userId, params.sectorId, params.accessLevel ?? 'read'],
    );
  }
  return userId;
}

async function insertContactConversation(tag: string, sectorId?: string): Promise<string> {
  const contact = await pool.query<{ id: string }>(
    'INSERT INTO contacts (name, phone) VALUES ($1, $2) RETURNING id',
    [`prod12 ${tag}`, `+5511${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`],
  );
  const conversation = await pool.query<{ id: string }>(
    `INSERT INTO conversations (external_conversation_id, external_channel_id, status, status_v2, contact_id, sector_id)
     VALUES ($1, 'whatsapp', 'open', 'novo', $2, $3) RETURNING id`,
    [`${tag}-conv`, contact.rows[0]!.id, sectorId ?? null],
  );
  return conversation.rows[0]!.id;
}

async function seedOutboxEvent(input: {
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  aggregateType?: string;
  aggregateId?: string;
  eventVersion?: number;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await pool.query(
    `INSERT INTO outbox_events
       (event_id, event_type, event_version, aggregate_type, aggregate_id, occurred_at,
        payload, metadata, correlation_id, version, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8, 1, NOW())`,
    [
      input.eventId,
      input.eventType,
      input.eventVersion ?? 1,
      input.aggregateType ?? 'Conversation',
      input.aggregateId ?? input.eventId,
      JSON.stringify(input.payload),
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.correlationId ?? null,
    ],
  );
}

async function resetPipeline(): Promise<void> {
  await pool.query('DELETE FROM worker_effect_receipts');
  await pool.query('DELETE FROM alert_events');
  await pool.query('DELETE FROM alerts');
  await pool.query('DELETE FROM outbox_consumer_acks');
  await pool.query('DELETE FROM outbox_events');
  await pool.query('DELETE FROM dead_letter_events');
}

async function armFailures(remaining: number): Promise<void> {
  await pool.query(
    `INSERT INTO prod12_fault_gate (point, fail_remaining, slow_event_prefix, slow_seconds)
     VALUES ('alerts', $1, NULL, 0)
     ON CONFLICT (point) DO UPDATE
       SET fail_remaining = EXCLUDED.fail_remaining,
           slow_event_prefix = NULL,
           slow_seconds = 0`,
    [remaining],
  );
}

async function armSlow(prefix: string, seconds: number): Promise<void> {
  await pool.query(
    `INSERT INTO prod12_fault_gate (point, fail_remaining, slow_event_prefix, slow_seconds)
     VALUES ('alerts', 0, $1, $2)
     ON CONFLICT (point) DO UPDATE
       SET fail_remaining = 0,
           slow_event_prefix = EXCLUDED.slow_event_prefix,
           slow_seconds = EXCLUDED.slow_seconds`,
    [prefix, seconds],
  );
}

async function disarmFailures(): Promise<void> {
  await pool.query("DELETE FROM prod12_fault_gate WHERE point = 'alerts'");
}

async function expireLease(eventId: string, consumerId = WORKER_CONSUMER): Promise<void> {
  await pool.query(
    `UPDATE outbox_consumer_acks SET lease_until = now() - interval '1 second'
      WHERE event_id = $1 AND consumer_id = $2`,
    [eventId, consumerId],
  );
}

async function ackRow(eventId: string, consumerId = WORKER_CONSUMER): Promise<AckRow | null> {
  const result = await pool.query<AckRow>(
    `SELECT processed_at, retry_count, lease_owner, lease_until, generation, last_error
       FROM outbox_consumer_acks WHERE event_id = $1 AND consumer_id = $2`,
    [eventId, consumerId],
  );
  return result.rows[0] ?? null;
}

async function deadLetterFor(eventId: string, consumerId = WORKER_CONSUMER): Promise<DeadLetterRow | null> {
  const result = await pool.query<DeadLetterRow>(
    `SELECT id, status, error_code, error_message, attempt_count, replay_count,
            resolution_reason, resolved_by, payload
       FROM dead_letter_events WHERE original_event_id = $1 AND consumer_id = $2`,
    [eventId, consumerId],
  );
  return result.rows[0] ?? null;
}

async function receiptCount(eventId: string): Promise<number> {
  return count('SELECT count(*)::int AS n FROM worker_effect_receipts WHERE event_id = $1', [eventId]);
}

async function isProcessed(eventId: string, consumerId = WORKER_CONSUMER): Promise<boolean> {
  const row = await ackRow(eventId, consumerId);
  return row !== null && row.processed_at !== null;
}

async function alertCountForReceipt(eventId: string): Promise<number> {
  return count(
    `SELECT count(*)::int AS n FROM alerts a
       JOIN worker_effect_receipts r ON r.result_ref = a.id::text
      WHERE r.event_id = $1`,
    [eventId],
  );
}

async function outboxEnvelope(eventId: string): Promise<EnvelopeLike | null> {
  const result = await pool.query<{
    event_id: string;
    event_type: string;
    event_version: number;
    aggregate_type: string;
    aggregate_id: string;
    occurred_at: Date;
    payload: string;
    correlation_id: string | null;
    causation_id: string | null;
    version: number;
  }>('SELECT * FROM outbox_events WHERE event_id = $1', [eventId]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    event_id: row.event_id,
    event_type: row.event_type,
    event_version: row.event_version,
    aggregate_type: row.aggregate_type,
    aggregate_id: row.aggregate_id,
    occurred_at: row.occurred_at.toISOString(),
    payload: JSON.parse(row.payload),
    correlation_id: row.correlation_id ?? undefined,
    causation_id: row.causation_id ?? undefined,
    version: row.version,
  };
}

// ============================================================
// Processos filhos
// ============================================================

function spawnTracked(
  name: string,
  command: string,
  args: string[],
  options: { cwd: string; env: Record<string, string> },
  persistent = false,
): ChildHandle {
  const child = spawn(command, args, {
    cwd: options.cwd,
    detached: true,
    env: { ...process.env, ...options.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
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
  const handle: ChildHandle = { name, child, output: () => output, exited };
  logHandles.push(handle);
  (persistent ? persistentChildren : ephemeralChildren).push(handle);
  return handle;
}

async function stopChild(handle: ChildHandle | undefined, signal: NodeJS.Signals = 'SIGKILL'): Promise<void> {
  if (!handle) return;
  ephemeralChildren.splice(ephemeralChildren.indexOf(handle), 1);
  persistentChildren.splice(persistentChildren.indexOf(handle), 1);
  if (!handle.child.pid || handle.child.exitCode !== null || handle.child.signalCode !== null) return;
  try {
    process.kill(-handle.child.pid, signal);
  } catch {
    handle.child.kill(signal);
  }
  await Promise.race([handle.exited, sleep(5000)]);
  if (handle.child.exitCode === null && handle.child.signalCode === null) {
    try {
      handle.child.kill('SIGKILL');
    } catch {
      // best-effort
    }
  }
}

async function waitForExit(
  handle: ChildHandle,
  timeoutMs: number,
): Promise<{ code: number | null; signal: NodeJS.Signals | null } | null> {
  return Promise.race([handle.exited, sleep(timeoutMs).then(() => null)]);
}

async function waitForChildOutput(handle: ChildHandle, needle: string, timeoutMs = 30_000): Promise<void> {
  await waitForAsync(async () => handle.output().includes(needle), timeoutMs, `${handle.name}: "${needle}"`);
}

function startWorker(name: string, extraEnv: Record<string, string>): ChildHandle {
  const healthPort = nextWorkerHealthPort++;
  return spawnTracked(name, TSX, ['src/index.ts'], {
    cwd: join(REPO_ROOT, 'apps', 'message-worker'),
    env: {
      DATABASE_URL: databaseUrl(),
      REDIS_URL: ctx.redisUrl,
      NODE_ENV: 'test',
      OUTBOX_POLL_INTERVAL_MS: '120',
      WORKER_LEASE_SECONDS: '5',
      WORKER_RETRY_INITIAL_DELAY_MS: '50',
      WORKER_RETRY_MAX_DELAY_MS: '100',
      WORKER_RETRY_BACKOFF_MULTIPLIER: '1',
      WORKER_MAX_RETRIES: '3',
      WORKER_HEALTH_PORT: String(healthPort),
      ...extraEnv,
    },
  });
}

function startDeskApi(): ChildHandle {
  return spawnTracked(
    'desk-api',
    TSX,
    ['src/index.ts'],
    {
      cwd: join(REPO_ROOT, 'apps', 'desk-api'),
      env: {
        PORT: String(ctx.ports.api),
        DATABASE_URL: databaseUrl(),
        REDIS_URL: ctx.redisUrl,
        JWT_SECRET: process.env.JWT_SECRET || 'prod12-isolated-jwt-secret',
        INTERNAL_EVENTS_SECRET: INTERNAL_SECRET,
        REALTIME_INTERNAL_SECRET: INTERNAL_SECRET,
        NODE_ENV: 'test',
      },
    },
    true,
  );
}

function startRealtime(name: string, port: number): ChildHandle {
  return spawnTracked(
    name,
    TSX,
    ['src/index.ts'],
    {
      cwd: join(REPO_ROOT, 'apps', 'realtime-service'),
      env: {
        NODE_ENV: 'development',
        REALTIME_PORT: String(port),
        DESK_API_URL: apiUrl(),
        USE_DATABASE_OUTBOX: 'true',
        REALTIME_POLL_INTERVAL_MS: '300',
        REALTIME_LEASE_SECONDS: '10',
        REALTIME_AUTH_REVALIDATE_MS: '400',
        REALTIME_AUTHZ_CACHE_MS: '300',
        REALTIME_AUTH_TIMEOUT_MS: '1000',
        REDIS_URL: ctx.redisUrl,
        DATABASE_URL: databaseUrl(),
      },
    },
    true,
  );
}

async function waitForTcpPort(port: number, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const open = await new Promise<boolean>((resolveProbe) => {
      const socket = net.connect(port, '127.0.0.1');
      const finish = (value: boolean): void => {
        socket.removeAllListeners();
        socket.destroy();
        resolveProbe(value);
      };
      socket.once('connect', () => finish(true));
      socket.once('error', () => finish(false));
      socket.setTimeout(500, () => finish(false));
    });
    if (open) return;
    await sleep(100);
  }
  throw new Error(`porta ${port} não abriu`);
}

interface LeaseChildResult {
  code: number | null;
  stdout: string;
  payload: Record<string, unknown> | null;
}

function runLeaseChild(name: string, action: Record<string, unknown>): Promise<LeaseChildResult> {
  return new Promise<LeaseChildResult>((resolveRun) => {
    const child = spawn(TSX, [LEASE_CHILD], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl(),
        NODE_ENV: 'test',
        PROD12_LEASE_ACTION: JSON.stringify(action),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.on('exit', (code) => {
      try {
        writeFileSync(join(LOG_DIR, `lease-child-${name}.log`), stdout);
      } catch {
        // Evidência best-effort.
      }
      const lines = stdout.split('\n').filter((line) => line.trim().startsWith('{'));
      let payload: Record<string, unknown> | null = null;
      if (lines.length > 0) {
        try {
          payload = JSON.parse(lines[lines.length - 1]!) as Record<string, unknown>;
        } catch {
          payload = null;
        }
      }
      resolveRun({ code, stdout, payload });
    });
  });
}

// ============================================================
// HTTP / WS
// ============================================================

async function apiFetch(
  path: string,
  options: { method?: string; token?: string; body?: unknown; internalSecret?: string } = {},
): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = {};
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.internalSecret) headers['x-internal-service-key'] = options.internalSecret;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${apiUrl()}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    // sem corpo JSON
  }
  return { status: response.status, json };
}

async function login(email: string): Promise<string> {
  const response = await apiFetch('/auth/login', {
    method: 'POST',
    body: { email, password: PASSWORD },
  });
  if (response.status !== 200) {
    throw new Error(`login de ${email} falhou: HTTP ${response.status} ${JSON.stringify(response.json)}`);
  }
  return (response.json as { token: string }).token;
}

async function connectWs(port: number, token: string): Promise<WsClient> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  const client: WsClient = { socket, messages: [] };
  socket.addEventListener('message', (event: MessageEvent) => {
    try {
      client.messages.push(typeof event.data === 'string' ? (JSON.parse(event.data) as SocketMessage) : { raw: String(event.data) });
    } catch {
      client.messages.push({ raw: String(event.data) });
    }
  });
  socket.addEventListener('close', (event: CloseEvent) => {
    client.closeCode = event.code;
  });
  await new Promise<void>((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', () => resolveOpen(), { once: true });
    socket.addEventListener('error', () => rejectOpen(new Error('websocket error')), { once: true });
  });
  await waitForAsync(
    async () => client.messages.some((message) => message.event === 'auth.required'),
    10_000,
    'auth.required',
  );
  socket.send(JSON.stringify({ type: 'auth', token }));
  await waitForAsync(
    async () => client.messages.some((message) => message.event === 'auth.success'),
    10_000,
    'auth.success',
  );
  return client;
}

async function subscribeWs(client: WsClient, channel: string): Promise<'subscribed' | 'error'> {
  const before = client.messages.length;
  client.socket.send(JSON.stringify({ type: 'subscribe', channel }));
  await waitForAsync(
    async () =>
      client.messages
        .slice(before)
        .some((message) => message.event === 'subscribed' || message.event === 'error'),
    10_000,
    `subscribe ${channel}`,
  );
  const entry = client.messages.slice(before).find((message) => message.event === 'subscribed' || message.event === 'error');
  return entry?.event === 'subscribed' ? 'subscribed' : 'error';
}

function receivedContent(client: WsClient, correlationId: string, conversationId: string): SocketMessage[] {
  return client.messages.filter(
    (message) =>
      typeof message.event === 'string'
      && message.event !== 'subscribed'
      && message.event !== 'auth.success'
      && message.data?.correlationId === correlationId
      && (message.data?.payload as Record<string, unknown> | undefined)?.conversationId === conversationId,
  );
}

async function closeWs(client: WsClient): Promise<void> {
  if (client.socket.readyState === WebSocket.CLOSED) return;
  await new Promise<void>((resolveClose) => {
    const timer = setTimeout(() => {
      client.socket.close();
      resolveClose();
    }, 1000);
    client.socket.addEventListener('close', () => {
      clearTimeout(timer);
      resolveClose();
    }, { once: true });
    client.socket.close();
  });
}

// ============================================================
// Bootstrap
// ============================================================

beforeAll(async () => {
  mkdirSync(LOG_DIR, { recursive: true });
  const runContextSpecifier = '../../../../../e2e/support/aaa/run-context.ts';
  const isolatedEnvSpecifier = '../../../../../e2e/support/aaa/isolated-env.ts';
  const runContextModule = (await import(/* @vite-ignore */ runContextSpecifier)) as {
    getRunContext: (workerIndex?: number) => RunContext;
  };
  const isolatedEnvModule = (await import(/* @vite-ignore */ isolatedEnvSpecifier)) as {
    provisionIsolatedEnv: (context: RunContext) => Promise<{ databaseName: string; marker: { runId: string } }>;
    teardownIsolatedEnv: Harness['teardownIsolatedEnv'];
  };
  const pgSpecifier = 'pg';
  const pgModule = (await import(/* @vite-ignore */ pgSpecifier)) as { default?: PgRuntime };
  pg = (pgModule.default ?? (pgModule as unknown as PgRuntime)) as PgRuntime;
  harness = { teardownIsolatedEnv: isolatedEnvModule.teardownIsolatedEnv };

  ctx = runContextModule.getRunContext(WORKER_INDEX);
  isolatedEnv = await isolatedEnvModule.provisionIsolatedEnv(ctx);
  if (isolatedEnv.marker.runId !== ctx.runId) {
    throw new Error(`marcador do run divergente: ${isolatedEnv.marker.runId} != ${ctx.runId}`);
  }
  process.env.DATABASE_URL = databaseUrl();
  process.env.REDIS_URL = ctx.redisUrl;
  nextWorkerHealthPort = ctx.ports.api + 200;

  pool = new pg.Pool({ connectionString: databaseUrl(), max: 8 });

  const { drizzle } = await import('drizzle-orm/node-postgres');
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  await migrate(drizzle(pool as never) as never, { migrationsFolder: MIGRATIONS_DIR });
  await setupFaultInjection();

  const databaseSpecifier = '../../../../../packages/database/src/index.ts';
  const databaseModule = (await import(/* @vite-ignore */ databaseSpecifier)) as { getPool: () => DatabasePoolLike };
  databaseModulePool = databaseModule.getPool();

  const eventsSpecifier = '../../../../../packages/events/src/index.ts';
  const eventsModule = (await import(/* @vite-ignore */ eventsSpecifier)) as EventsModuleLike;
  publishToOutbox = eventsModule.publishToOutbox;
  publishRealtimeHintsAfterCommit = eventsModule.publishRealtimeHintsAfterCommit;
  getSharedRealtimeBus = eventsModule.getSharedRealtimeBus;
  stopSharedRealtimeBus = eventsModule.stopSharedRealtimeBus;

  const startedApi = startDeskApi();
  expect(startedApi.child.pid).toBeGreaterThan(0);
  await waitForAsync(async () => {
    try {
      const response = await fetch(`${apiUrl()}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }, 90_000, 'desk-api /health');

  const adminEmail = `prod12.admin.${RUN_ID}.${randomUUID().slice(0, 8)}@example.com`;
  adminUserId = await insertUser({ email: adminEmail, roleName: 'Admin' });
  adminToken = await login(adminEmail);

  const receptionistEmail = `prod12.recep.${RUN_ID}.${randomUUID().slice(0, 8)}@example.com`;
  await insertUser({ email: receptionistEmail, roleName: 'Receptionist' });
  receptionistToken = await login(receptionistEmail);
});

async function setupFaultInjection(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS prod12_fault_gate (
      point TEXT PRIMARY KEY,
      fail_remaining INTEGER NOT NULL DEFAULT 0,
      slow_event_prefix TEXT,
      slow_seconds NUMERIC NOT NULL DEFAULT 0
    );
    CREATE OR REPLACE FUNCTION prod12_alerts_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE gate RECORD;
    BEGIN
      SELECT * INTO gate FROM prod12_fault_gate WHERE point = 'alerts';
      IF gate.fail_remaining IS NOT NULL AND gate.fail_remaining > 0 THEN
        UPDATE prod12_fault_gate
           SET fail_remaining = gate.fail_remaining - 1
         WHERE point = 'alerts';
        RAISE EXCEPTION 'prod12 injected transient failure at alerts';
      END IF;
      IF gate.slow_event_prefix IS NOT NULL
         AND NEW.metadata IS NOT NULL
         AND COALESCE((NEW.metadata::jsonb)->>'eventId', '') LIKE gate.slow_event_prefix || '%' THEN
        PERFORM pg_sleep(gate.slow_seconds);
      END IF;
      RETURN NEW;
    END;
    $$;
    DROP TRIGGER IF EXISTS prod12_alerts_guard ON alerts;
    CREATE TRIGGER prod12_alerts_guard BEFORE INSERT ON alerts
      FOR EACH ROW EXECUTE FUNCTION prod12_alerts_guard();
  `);
}

afterEach(async () => {
  for (const handle of ephemeralChildren.splice(0)) {
    await stopChild(handle);
  }
  await disarmFailures();
});

afterAll(async () => {
  writeEvidenceJson('prod-12-evidence.json', {
    generatedAt: new Date().toISOString(),
    runId: RUN_ID,
    workerIndex: WORKER_INDEX,
    database: isolatedEnv?.databaseName,
    postgresPort: ctx?.ports.postgres,
    redisPort: ctx?.ports.redis,
    cases: evidence,
  });
  for (const handle of logHandles) {
    writeFileSync(join(LOG_DIR, `${handle.name}.log`), handle.output());
  }
  for (const handle of [...ephemeralChildren, ...persistentChildren]) {
    await stopChild(handle);
  }
  if (stopSharedRealtimeBus) await stopSharedRealtimeBus();
  if (databaseModulePool) await databaseModulePool.end().catch(() => undefined);
  if (pool) await pool.end().catch(() => undefined);
  if (ctx && harness) {
    harness.teardownIsolatedEnv(ctx, { stopServices: true, dropDatabase: true });
  }
});

// ============================================================
// AC1 — leases entre processos
// ============================================================

describe('PROD-12 AC1 — lease/owner/generation entre processos', () => {
  it('AC1a — dois workers reais disputam o outbox: cada evento processado por exatamente um processo', async () => {
    await resetPipeline();
    const tag = `ac1a-${randomUUID().slice(0, 8)}`;
    const conversationId = await insertContactConversation(tag);

    // Os dois processos sobem primeiro e disputam o MESMO lote semeado depois:
    // nenhum evento pode ser processado pelos dois.
    const workerA = startWorker(`${tag}-w1`, { WORKER_OWNER: `${tag}-owner-1` });
    const workerB = startWorker(`${tag}-w2`, { WORKER_OWNER: `${tag}-owner-2` });
    await Promise.all([
      waitForChildOutput(workerA, 'Worker started successfully'),
      waitForChildOutput(workerB, 'Worker started successfully'),
    ]);

    const eventIds: string[] = [];
    for (let index = 0; index < 10; index += 1) {
      const eventId = `${tag}-evt-${index}`;
      eventIds.push(eventId);
      await seedOutboxEvent({
        eventId,
        eventType: 'handoff.completed',
        payload: {
          conversationId,
          previousHandler: 'bot',
          newHandler: 'human',
          reason: `${tag}-reason-${index}`,
        },
        correlationId: `${tag}-corr-${index}`,
        aggregateId: conversationId,
      });
    }

    await waitForAsync(
      async () =>
        (await count(
          `SELECT count(*)::int AS n FROM outbox_consumer_acks
            WHERE consumer_id = 'worker' AND event_id = ANY($1) AND processed_at IS NOT NULL`,
          [eventIds],
        )) === eventIds.length,
      90_000,
      'todos os eventos ACKados pelos dois workers',
    );

    const logsA = parseJsonLines(workerA.output());
    const logsB = parseJsonLines(workerB.output());
    const processing = (records: Array<Record<string, unknown>>, eventId: string): number =>
      records.filter((record) => record.msg === '[Worker] Processing event' && record.event_id === eventId).length;

    const perEvent: Array<{ eventId: string; owner: string | null; generation: number | null; receipts: number; alerts: number; processedIn: string[] }> = [];
    const ownerByEvent = new Map<string, { owner: string | null; generation: number | null }>();
    for (const eventId of eventIds) {
      const row = await ackRow(eventId);
      ownerByEvent.set(eventId, { owner: row?.lease_owner ?? null, generation: row?.generation ?? null });
      const inA = processing(logsA, eventId);
      const inB = processing(logsB, eventId);
      const receipts = await receiptCount(eventId);
      const alerts = await alertCountForReceipt(eventId);
      perEvent.push({
        eventId,
        owner: row?.lease_owner ?? null,
        generation: row?.generation ?? null,
        receipts,
        alerts,
        processedIn: [inA > 0 ? 'w1' : null, inB > 0 ? 'w2' : null].filter((value): value is string => value !== null),
      });
      expect(row?.processed_at, eventId).not.toBeNull();
      expect(inA + inB, `${eventId} deve ter exatamente 1 processamento`).toBe(1);
      expect(receipts, `${eventId} deve ter exatamente 1 recibo de efeito`).toBe(1);
      expect(alerts, `${eventId} deve ter exatamente 1 alerta`).toBe(1);
      expect(row?.generation, `${eventId} claim inicial tem geração 1`).toBe(1);
    }

    const byWorker = {
      w1: perEvent.filter((entry) => entry.processedIn[0] === 'w1').length,
      w2: perEvent.filter((entry) => entry.processedIn[0] === 'w2').length,
    };
    evidence.push({
      case: 'AC1a-dois-workers-exclusao',
      eventCount: eventIds.length,
      perWorker: byWorker,
      perEvent,
      note: 'cada eventId aparece em exatamente um processo e tem 1 recibo/1 alerta',
    });

    await stopChild(workerA);
    await stopChild(workerB);
  });

  it('AC1b — claim concorrente de 4 processos: partição exclusiva e generation 1', async () => {
    await resetPipeline();
    const tag = `ac1b-${randomUUID().slice(0, 8)}`;
    const eventIds: string[] = [];
    for (let index = 0; index < 16; index += 1) {
      const eventId = `${tag}-evt-${index}`;
      eventIds.push(eventId);
      await seedOutboxEvent({
        eventId,
        eventType: 'message.persisted',
        payload: { messageId: `msg-${index}`, direction: 'inbound' },
        aggregateType: 'Message',
      });
    }

    const claimedIds = new Set<string>();
    const rounds: number[][] = [];
    let round = 0;
    while (claimedIds.size < eventIds.length && round < 10) {
      const startAtEpochMs = Date.now() + 3000;
      const results = await Promise.all(
        [0, 1, 2, 3].map((index) =>
          runLeaseChild(`${tag}-r${round}-p${index}`, {
            cmd: 'claim',
            owner: `${tag}-r${round}-owner-${index}`,
            leaseSeconds: 60,
            limit: 5,
            eventTypes: ['message.persisted'],
            startAtEpochMs,
          }),
        ),
      );

      const claimedBy: string[][] = results.map((result) => {
        expect(result.code, `lease-child exit ${result.code}: ${result.stdout}`).toBe(0);
        const payload = result.payload as { claimed?: Array<{ eventId: string }> } | null;
        return (payload?.claimed ?? []).map((entry) => entry.eventId);
      });

      // Exclusão mútua: nenhum evento pode voltar para dois processos na MESMA rodada.
      for (const ids of claimedBy) {
        for (const other of claimedBy) {
          if (ids === other) continue;
          expect(ids.filter((id) => other.includes(id))).toEqual([]);
        }
      }
      // E um evento já reivindicado não pode ser redistribuído em rodada seguinte.
      for (const id of claimedBy.flat()) {
        expect(claimedIds.has(id), `${id} reclamado duas vezes`).toBe(false);
        claimedIds.add(id);
      }
      rounds.push(claimedBy.map((ids) => ids.length));
      round += 1;
    }

    expect(claimedIds.size).toBe(eventIds.length);
    expect(rounds.length).toBeGreaterThanOrEqual(1);
    for (const eventId of eventIds) {
      const row = await ackRow(eventId);
      expect(row?.generation, eventId).toBe(1);
      expect(row?.processed_at, eventId).toBeNull();
    }
    expect(
      await count("SELECT count(*)::int AS n FROM outbox_consumer_acks WHERE consumer_id = 'worker'"),
    ).toBe(eventIds.length);

    evidence.push({
      case: 'AC1b-claim-concorrente-4-processos',
      processes: 4,
      events: eventIds.length,
      rounds,
      uniqueWinners: true,
      generations: [1],
    });
  });

  it('AC1c — renew mantém o lease entre processos e takeover pós-expiração; ACK antigo é stale', async () => {
    await resetPipeline();
    const tag = `ac1c-${randomUUID().slice(0, 8)}`;
    const eventId = `${tag}-evt`;
    await seedOutboxEvent({
      eventId,
      eventType: 'message.persisted',
      payload: { messageId: 'msg-ac1c', direction: 'inbound' },
      aggregateType: 'Message',
    });

    const claimResult = await runLeaseChild(`${tag}-claim`, {
      cmd: 'claim',
      owner: `${tag}-renew-owner`,
      leaseSeconds: 2,
      limit: 10,
      eventTypes: ['message.persisted'],
    });
    const claimed = (claimResult.payload as { claimed?: Array<{ eventId: string; lease: { owner: string; generation: number; leaseUntil: string } }> } | null)?.claimed ?? [];
    const initial = claimed.find((entry) => entry.eventId === eventId);
    expect(initial, claimResult.stdout).toBeDefined();
    expect(initial!.lease.owner).toBe(`${tag}-renew-owner`);
    expect(initial!.lease.generation).toBe(1);

    const renewResult = await runLeaseChild(`${tag}-renew`, {
      cmd: 'renew',
      eventId,
      owner: `${tag}-renew-owner`,
      generation: 1,
      leaseSeconds: 30,
    });
    const renewed = (renewResult.payload as { renewed?: { owner: string; generation: number; leaseUntil: string } | null } | null)?.renewed ?? null;
    expect(renewed, renewResult.stdout).not.toBeNull();
    expect(renewed!.generation).toBe(1);
    expect(new Date(renewed!.leaseUntil).getTime()).toBeGreaterThan(new Date(initial!.lease.leaseUntil).getTime());

    // Outro processo NÃO reclama enquanto o lease renovado está vigente.
    const competing = await runLeaseChild(`${tag}-competing`, {
      cmd: 'claim',
      owner: `${tag}-other-owner`,
      leaseSeconds: 60,
      limit: 10,
      eventTypes: ['message.persisted'],
    });
    const competingIds = ((competing.payload as { claimed?: Array<{ eventId: string }> } | null)?.claimed ?? []).map((entry) => entry.eventId);
    expect(competingIds).not.toContain(eventId);

    const wrongOwner = await runLeaseChild(`${tag}-wrong-owner`, {
      cmd: 'renew',
      eventId,
      owner: `${tag}-intruder`,
      generation: 1,
      leaseSeconds: 30,
    });
    expect((wrongOwner.payload as { renewed?: unknown } | null)?.renewed).toBeNull();

    // Simula queda do dono: o lease expira e outro processo toma com generation + 1.
    await expireLease(eventId);
    const takeover = await runLeaseChild(`${tag}-takeover`, {
      cmd: 'claim',
      owner: `${tag}-takeover-owner`,
      leaseSeconds: 60,
      limit: 10,
      eventTypes: ['message.persisted'],
    });
    const takeoverEntry = (((takeover.payload as { claimed?: Array<{ eventId: string; lease: { owner: string; generation: number } }> } | null)?.claimed) ?? []).find(
      (entry) => entry.eventId === eventId,
    );
    expect(takeoverEntry, takeover.stdout).toBeDefined();
    expect(takeoverEntry!.lease.owner).toBe(`${tag}-takeover-owner`);
    expect(takeoverEntry!.lease.generation).toBe(2);

    // ACK atrasado da geração antiga: stale, não conclui e não marca retry.
    const staleAck = await runLeaseChild(`${tag}-stale-ack`, {
      cmd: 'ack',
      eventId,
      owner: `${tag}-renew-owner`,
      generation: 1,
    });
    expect((staleAck.payload as { result?: string } | null)?.result).toBe('stale');
    const mid = await ackRow(eventId);
    expect(mid?.processed_at).toBeNull();
    expect(mid?.lease_owner).toBe(`${tag}-takeover-owner`);
    expect(mid?.generation).toBe(2);
    expect(mid?.retry_count).toBe(0);

    const freshAck = await runLeaseChild(`${tag}-fresh-ack`, {
      cmd: 'ack',
      eventId,
      owner: `${tag}-takeover-owner`,
      generation: 2,
    });
    expect((freshAck.payload as { result?: string } | null)?.result).toBe('acked');
    const done = await ackRow(eventId);
    expect(done?.processed_at).not.toBeNull();
    expect(done?.generation).toBe(2);

    evidence.push({
      case: 'AC1c-renew-takeover-stale-ack',
      eventId,
      initialGeneration: 1,
      renewedGeneration: renewed!.generation,
      competingClaims: competingIds,
      takeoverGeneration: takeoverEntry!.lease.generation,
      staleAck: (staleAck.payload as { result?: string } | null)?.result,
      freshAck: (freshAck.payload as { result?: string } | null)?.result,
      processed: true,
    });
  });

  it('AC1d — crash real do worker após o efeito: outro processo retoma com geração+1 sem duplicar', async () => {
    await resetPipeline();
    const tag = `ac1d-${randomUUID().slice(0, 8)}`;
    const conversationId = await insertContactConversation(tag);
    const eventId = `${tag}-evt`;
    await seedOutboxEvent({
      eventId,
      eventType: 'handoff.completed',
      payload: { conversationId, previousHandler: 'bot', newHandler: 'human', reason: `${tag}-reason` },
      correlationId: `${tag}-corr`,
      aggregateId: conversationId,
    });

    const crashed = startWorker(`${tag}-crashed`, {
      WORKER_OWNER: `${tag}-owner-1`,
      WORKER_FAULT_AFTER_EFFECT: 'crash',
    });
    const crashedExit = await waitForExit(crashed, 60_000);
    expect(crashedExit, `worker de crash não encerrou; saída:\n${crashed.output()}`).not.toBeNull();
    expect(crashedExit!.code).toBe(86);
    expect(crashed.output()).toContain('crashing after effect before ACK');
    expect(crashed.output()).not.toContain('Successfully processed event');

    const afterCrash = await ackRow(eventId);
    expect(afterCrash?.processed_at).toBeNull();
    expect(afterCrash?.lease_owner).toBe(`${tag}-owner-1`);
    expect(await receiptCount(eventId)).toBe(1);
    expect(await alertCountForReceipt(eventId)).toBe(1);

    await expireLease(eventId);
    const resumed = startWorker(`${tag}-resumed`, { WORKER_OWNER: `${tag}-owner-2` });
    await waitForAsync(
      async () => isProcessed(eventId),
      60_000,
      'worker #2 concluir o evento reclamado',
    );
    await stopChild(resumed);

    const done = await ackRow(eventId);
    expect(done?.lease_owner).toBe(`${tag}-owner-2`);
    expect(done?.generation).toBeGreaterThanOrEqual(2);
    expect(await receiptCount(eventId)).toBe(1);
    expect(await alertCountForReceipt(eventId)).toBe(1);
    expect(resumed.output()).toContain('"effect_status":"deduplicated"');

    evidence.push({
      case: 'AC1d-crash-takeover-sem-duplicata',
      eventId,
      crashedExitCode: crashedExit!.code,
      crashedGeneration: afterCrash?.generation ?? null,
      resumedGeneration: done?.generation ?? null,
      receipts: 1,
      alerts: 1,
    });
  });
});

// ============================================================
// AC2 — DLQ durável + HTTP administrativo
// ============================================================

describe('PROD-12 AC2 — DLQ durável e replay/claim administrativo via HTTP', () => {
  async function createDeadLetterEvent(tag: string, options: { maxRetries?: number } = {}): Promise<{
    eventId: string;
    conversationId: string;
    worker: ChildHandle;
  }> {
    const conversationId = await insertContactConversation(tag);
    const eventId = `${tag}-evt`;
    await seedOutboxEvent({
      eventId,
      eventType: 'handoff.completed',
      payload: { conversationId, previousHandler: 'bot', newHandler: 'human', reason: `${tag}-reason` },
      correlationId: `${tag}-corr`,
      aggregateId: conversationId,
    });
    await armFailures(999);
    const worker = startWorker(`${tag}-worker`, {
      WORKER_OWNER: `${tag}-owner`,
      WORKER_MAX_RETRIES: String(options.maxRetries ?? 2),
      OUTBOX_POLL_INTERVAL_MS: '120',
    });
    await waitForAsync(
      async () => (await deadLetterFor(eventId)) !== null,
      60_000,
      `DLQ de ${eventId}`,
    );
    await stopChild(worker);
    return { eventId, conversationId, worker };
  }

  it('AC2a — DLQ sobrevive ao restart: evento não ACKado, envelope íntegro e replay HTTP executa uma vez', async () => {
    await resetPipeline();
    const tag = `ac2a-${randomUUID().slice(0, 8)}`;
    const { eventId } = await createDeadLetterEvent(tag, { maxRetries: 2 });

    const dlq = await deadLetterFor(eventId);
    expect(dlq).not.toBeNull();
    expect(dlq!.status).toBe('PENDING');
    expect(dlq!.error_code).toBe('RETRY_BUDGET_EXHAUSTED');
    expect(dlq!.attempt_count).toBe(2);

    const source = await outboxEnvelope(eventId);
    expect(source).not.toBeNull();
    expect(dlq!.payload.event_id).toBe(source!.event_id);
    expect(dlq!.payload.event_type).toBe(source!.event_type);
    expect(dlq!.payload.correlation_id).toBe(source!.correlation_id);
    expect(dlq!.payload.event_version).toBe(source!.event_version);
    expect(dlq!.payload.payload).toEqual(source!.payload);

    const ack = await ackRow(eventId);
    expect(ack?.processed_at).toBeNull();
    expect(ack?.retry_count).toBe(2);

    // Restart com orçamento DIVERGENTE (maior): o fence durável da DLQ impede
    // que qualquer processo reclame o evento, mesmo com maxRetries diferente.
    const freshWorker = startWorker(`${tag}-fresh`, {
      WORKER_OWNER: `${tag}-fresh-owner`,
      WORKER_MAX_RETRIES: '5',
    });
    await waitForChildOutput(freshWorker, 'Worker started successfully');
    await sleep(800);
    const stillThere = await deadLetterFor(eventId);
    expect(stillThere!.id).toBe(dlq!.id);
    expect(await count('SELECT count(*)::int AS n FROM dead_letter_events WHERE original_event_id = $1', [eventId])).toBe(1);
    expect((await ackRow(eventId))?.retry_count).toBe(2);
    expect((await ackRow(eventId))?.lease_owner).toBeNull();

    await disarmFailures();
    const replayed = await apiFetch(`/dead-letter/${dlq!.id}/replay`, {
      method: 'POST',
      token: adminToken,
    });
    expect(replayed.status, JSON.stringify(replayed.json)).toBe(200);

    const resolved = await deadLetterFor(eventId);
    expect(resolved!.status).toBe('RESOLVED');
    expect(resolved!.replay_count).toBe(1);
    expect(resolved!.resolution_reason).toBe('replayed');
    expect(resolved!.payload).toEqual(dlq!.payload);

    const replayEventId = `${eventId}-replay-1`;
    await waitForAsync(
      async () => isProcessed(replayEventId),
      60_000,
      'worker processar o evento de replay',
    );
    const replayEnvelope = await outboxEnvelope(replayEventId);
    expect(replayEnvelope!.causation_id).toBe(eventId);
    expect(replayEnvelope!.payload).toEqual(source!.payload);
    expect(await receiptCount(replayEventId)).toBe(1);
    expect(await alertCountForReceipt(replayEventId)).toBe(1);
    expect(await receiptCount(eventId)).toBe(0);

    expect(
      await count(
        `SELECT count(*)::int AS n FROM audit_logs
          WHERE action = 'dlq.replay' AND metadata LIKE '%' || $1 || '%'`,
        [dlq!.id],
      ),
    ).toBeGreaterThanOrEqual(1);

    await stopChild(freshWorker);
    evidence.push({
      case: 'AC2a-dlq-restart-replay',
      eventId,
      dlqId: dlq!.id,
      statusBefore: 'PENDING',
      statusAfter: 'RESOLVED',
      replayCount: resolved!.replay_count,
      replayEventId,
      envelopeIntact: true,
      workerAck: { processedAt: ack?.processed_at ?? null, retryCount: ack?.retry_count ?? null },
      divergentWorkerBudget: 5,
      replayReceipts: 1,
      originalReceipts: 0,
      audit: 'dlq.replay',
    });
  });

  it('AC2b — replay concorrente: claim único (1×200 + 1×409), um único evento reenfileirado', async () => {
    await resetPipeline();
    const tag = `ac2b-${randomUUID().slice(0, 8)}`;
    const { eventId } = await createDeadLetterEvent(tag, { maxRetries: 1 });
    const dlq = await deadLetterFor(eventId);
    await disarmFailures();

    const [first, second] = await Promise.all([
      apiFetch(`/dead-letter/${dlq!.id}/replay`, { method: 'POST', token: adminToken }),
      apiFetch(`/dead-letter/${dlq!.id}/replay`, { method: 'POST', token: adminToken }),
    ]);
    const statuses = [first.status, second.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);

    expect(
      await count('SELECT count(*)::int AS n FROM outbox_events WHERE event_id LIKE $1', [`${eventId}-replay-%`]),
    ).toBe(1);
    const resolved = await deadLetterFor(eventId);
    expect(resolved!.status).toBe('RESOLVED');
    expect(resolved!.replay_count).toBe(1);

    const worker = startWorker(`${tag}-worker`, { WORKER_OWNER: `${tag}-owner` });
    await waitForChildOutput(worker, 'Worker started successfully');
    await waitForAsync(
      async () => isProcessed(`${eventId}-replay-1`),
      60_000,
      'processamento único do replay',
    );
    expect(await receiptCount(`${eventId}-replay-1`)).toBe(1);
    await stopChild(worker);

    evidence.push({
      case: 'AC2b-replay-concorrente-claim-unico',
      eventId,
      statuses,
      replayEvents: 1,
      replayCount: resolved!.replay_count,
    });
  });

  it('AC2c — resolve/discard HTTP com auditoria e autorização (401 sem token, 403 sem admin:write)', async () => {
    await resetPipeline();
    const tagResolve = `ac2c-resolve-${randomUUID().slice(0, 8)}`;
    const { eventId: resolveEventId } = await createDeadLetterEvent(tagResolve, { maxRetries: 1 });
    const resolveEntry = await deadLetterFor(resolveEventId);
    await disarmFailures();

    const unauthorized = await apiFetch(`/dead-letter/${resolveEntry!.id}/resolve`, { method: 'POST', body: {} });
    expect(unauthorized.status).toBe(401);
    const forbidden = await apiFetch(`/dead-letter/${resolveEntry!.id}/resolve`, {
      method: 'POST',
      token: receptionistToken,
      body: {},
    });
    expect(forbidden.status).toBe(403);

    const resolved = await apiFetch(`/dead-letter/${resolveEntry!.id}/resolve`, {
      method: 'POST',
      token: adminToken,
      body: { reason: 'tratado manualmente prod12' },
    });
    expect(resolved.status, JSON.stringify(resolved.json)).toBe(200);
    const resolvedRow = await deadLetterFor(resolveEventId);
    expect(resolvedRow!.status).toBe('RESOLVED');
    expect(resolvedRow!.resolution_reason).toBe('tratado manualmente prod12');
    expect(resolvedRow!.resolved_by).toBe(adminUserId);

    const tagDiscard = `ac2c-discard-${randomUUID().slice(0, 8)}`;
    const { eventId: discardEventId } = await createDeadLetterEvent(tagDiscard, { maxRetries: 1 });
    const discardEntry = await deadLetterFor(discardEventId);
    await disarmFailures();
    const discarded = await apiFetch(`/dead-letter/${discardEntry!.id}/discard`, {
      method: 'POST',
      token: adminToken,
      body: { reason: 'descartado prod12' },
    });
    expect(discarded.status, JSON.stringify(discarded.json)).toBe(200);
    const discardedRow = await deadLetterFor(discardEventId);
    expect(discardedRow!.status).toBe('DISCARDED');
    expect(discardedRow!.resolution_reason).toBe('descartado prod12');

    expect(
      await count(
        `SELECT count(*)::int AS n FROM audit_logs
          WHERE action = 'dlq.resolve' AND metadata LIKE '%' || $1 || '%'`,
        [resolveEntry!.id],
      ),
    ).toBeGreaterThanOrEqual(1);
    expect(
      await count(
        `SELECT count(*)::int AS n FROM audit_logs
          WHERE action = 'dlq.resolve' AND metadata LIKE '%' || $1 || '%'`,
        [discardEntry!.id],
      ),
    ).toBeGreaterThanOrEqual(1);

    evidence.push({
      case: 'AC2c-resolve-discard-http',
      resolveEventId,
      discardEventId,
      unauthorized: unauthorized.status,
      forbidden: forbidden.status,
      resolvedStatus: resolvedRow!.status,
      discardedStatus: discardedRow!.status,
      auditEntries: true,
    });
  });

  it('AC2d — ACK do worker não esconde o evento do http-poll; ACK stale do http-poll é 409', async () => {
    await resetPipeline();
    const tag = `ac2d-${randomUUID().slice(0, 8)}`;
    const conversationId = await insertContactConversation(tag);
    const eventId = `${tag}-evt`;
    await seedOutboxEvent({
      eventId,
      eventType: 'handoff.completed',
      payload: { conversationId, previousHandler: 'bot', newHandler: 'human', reason: `${tag}-reason` },
      correlationId: `${tag}-corr`,
      aggregateId: conversationId,
    });
    const worker = startWorker(`${tag}-worker`, { WORKER_OWNER: `${tag}-owner` });
    await waitForAsync(
      async () => isProcessed(eventId),
      60_000,
      'worker ACKar o evento',
    );
    await stopChild(worker);

    const noSecret = await apiFetch('/events?limit=100');
    expect(noSecret.status).toBe(401);

    const firstGet = await apiFetch('/events?limit=100', { internalSecret: INTERNAL_SECRET });
    expect(firstGet.status).toBe(200);
    const firstBody = firstGet.json as {
      events: EnvelopeLike[];
      leases: Array<{ eventId: string; owner: string; generation: number }>;
    };
    const found = firstBody.events.find((event) => event.event_id === eventId);
    expect(found, 'worker ACK não pode esconder o evento do consumidor http-poll').toBeDefined();
    const lease = firstBody.leases.find((entry) => entry.eventId === eventId);
    expect(lease).toBeDefined();

    const staleAck = await apiFetch(`/events/${encodeURIComponent(eventId)}/ack`, {
      method: 'POST',
      internalSecret: INTERNAL_SECRET,
      body: { owner: lease!.owner, generation: lease!.generation + 1 },
    });
    expect(staleAck.status).toBe(409);
    expect((await ackRow(eventId, 'http-poll'))?.processed_at).toBeNull();

    const goodAck = await apiFetch(`/events/${encodeURIComponent(eventId)}/ack`, {
      method: 'POST',
      internalSecret: INTERNAL_SECRET,
      body: { owner: lease!.owner, generation: lease!.generation },
    });
    expect(goodAck.status).toBe(200);
    expect((await ackRow(eventId, 'http-poll'))?.processed_at).not.toBeNull();
    expect((await ackRow(eventId))?.processed_at).not.toBeNull();

    const secondGet = await apiFetch('/events?limit=100', { internalSecret: INTERNAL_SECRET });
    const secondBody = secondGet.json as { events: EnvelopeLike[] };
    expect(secondBody.events.map((event) => event.event_id)).not.toContain(eventId);

    evidence.push({
      case: 'AC2d-consumers-independentes-http-ack',
      eventId,
      workerAck: true,
      httpPollSawEvent: true,
      staleAck: staleAck.status,
      ack: goodAck.status,
      hiddenAfterAck: false,
    });
  });
});

// ============================================================
// AC3 — fanout realtime entre processos
// ============================================================

describe('PROD-12 AC3 — fanout realtime entre 2 processos', () => {
  const realtimeA = { handle: undefined as ChildHandle | undefined, port: 0 };
  const realtimeB = { handle: undefined as ChildHandle | undefined, port: 0 };
  let sectorId = '';
  let authorizedUserId = '';
  let authorizedToken = '';
  let foreignUserId = '';
  let foreignToken = '';
  let conversationId = '';
  let clientOnA: WsClient | undefined;
  let clientOnB: WsClient | undefined;
  let foreignClient: WsClient | undefined;
  const eventIds: string[] = [];

  async function publishFanoutEvent(tag: string): Promise<{ eventId: string; correlationId: string }> {
    const eventId = `${tag}-evt`;
    const correlationId = `${tag}-corr`;
    const envelope: EnvelopeLike = {
      event_id: eventId,
      event_type: 'handoff.completed',
      event_version: 1,
      aggregate_type: 'Conversation',
      aggregate_id: conversationId,
      occurred_at: new Date().toISOString(),
      payload: {
        conversationId,
        previousHandler: 'bot',
        newHandler: 'human',
        reason: `${tag}-reason`,
      },
      correlation_id: correlationId,
      version: 1,
    };
    await publishToOutbox(envelope);
    const hinted = await publishRealtimeHintsAfterCommit([envelope]);
    expect(hinted).toBe(1);
    eventIds.push(eventId);
    return { eventId, correlationId };
  }

  beforeAll(async () => {
    const tag = `ac3-${randomUUID().slice(0, 8)}`;
    sectorId = await insertSector(tag);
    conversationId = await insertContactConversation(`${tag}-main`, sectorId);
    authorizedUserId = await insertUser({
      email: `prod12.rt.authorized.${tag}@example.com`,
      roleName: 'Receptionist',
      sectorId,
      accessLevel: 'read',
    });
    foreignUserId = await insertUser({
      email: `prod12.rt.foreign.${tag}@example.com`,
      roleName: 'Receptionist',
    });
    authorizedToken = await login(`prod12.rt.authorized.${tag}@example.com`);
    foreignToken = await login(`prod12.rt.foreign.${tag}@example.com`);

    const bus = await getSharedRealtimeBus();
    expect(bus.isConnected()).toBe(true);

    realtimeA.port = ctx.ports.realtime;
    realtimeB.port = ctx.ports.realtime + 1;
    realtimeA.handle = startRealtime('realtime-a', realtimeA.port);
    realtimeB.handle = startRealtime('realtime-b', realtimeB.port);
    await Promise.all([
      waitForTcpPort(realtimeA.port),
      waitForTcpPort(realtimeB.port),
    ]);
    await Promise.all([
      waitForChildOutput(realtimeA.handle, 'Redis bus subscribed'),
      waitForChildOutput(realtimeB.handle, 'Redis bus subscribed'),
    ]);

    clientOnA = await connectWs(realtimeA.port, authorizedToken);
    clientOnB = await connectWs(realtimeB.port, authorizedToken);
    expect(await subscribeWs(clientOnA, `conversation:${conversationId}`)).toBe('subscribed');
    expect(await subscribeWs(clientOnB, `conversation:${conversationId}`)).toBe('subscribed');
    foreignClient = await connectWs(realtimeB.port, foreignToken);
    expect(await subscribeWs(foreignClient, `conversation:${conversationId}`)).toBe('error');
  });

  afterAll(async () => {
    if (clientOnA) await closeWs(clientOnA);
    if (clientOnB) await closeWs(clientOnB);
    if (foreignClient) await closeWs(foreignClient);
    await stopChild(realtimeA.handle);
    await stopChild(realtimeB.handle);
  });

  it('AC3a — evento publicado no outbox é entregue 1× a cada assinante autorizado nas 2 réplicas', async () => {
    const tag = `ac3a-${randomUUID().slice(0, 8)}`;
    const { eventId, correlationId } = await publishFanoutEvent(tag);

    await Promise.all([
      waitForAsync(async () => receivedContent(clientOnA!, correlationId, conversationId).length >= 1, 20_000, 'entrega no realtime A'),
      waitForAsync(async () => receivedContent(clientOnB!, correlationId, conversationId).length >= 1, 20_000, 'entrega no realtime B'),
    ]);

    // A dedup (poll + bus) não pode duplicar a entrega para o mesmo assinante.
    await sleep(1500);
    expect(receivedContent(clientOnA!, correlationId, conversationId)).toHaveLength(1);
    expect(receivedContent(clientOnB!, correlationId, conversationId)).toHaveLength(1);
    expect(receivedContent(foreignClient!, correlationId, conversationId)).toHaveLength(0);

    await waitForAsync(
      async () => isProcessed(eventId, 'realtime'),
      30_000,
      'ACK do consumidor realtime',
    );

    const deliveredA = receivedContent(clientOnA!, correlationId, conversationId)[0]!;
    expect(deliveredA.event).toBe('handoff.completed');
    expect((deliveredA.data?.payload as Record<string, unknown>).conversationId).toBe(conversationId);

    evidence.push({
      case: 'AC3a-fanout-2-replicas-sem-duplicata',
      eventId,
      deliveriesA: 1,
      deliveriesB: 1,
      deliveriesForeign: 0,
      realtimeConsumerAck: true,
    });
  });

  it('AC3b — destinatário sem membership não assina nem recebe (entrega autorizada)', async () => {
    const tag = `ac3b-${randomUUID().slice(0, 8)}`;
    const { eventId, correlationId } = await publishFanoutEvent(tag);

    await Promise.all([
      waitForAsync(async () => receivedContent(clientOnA!, correlationId, conversationId).length >= 1, 20_000, 'entrega autorizada A'),
      waitForAsync(async () => receivedContent(clientOnB!, correlationId, conversationId).length >= 1, 20_000, 'entrega autorizada B'),
    ]);
    await sleep(800);
    expect(receivedContent(foreignClient!, correlationId, conversationId)).toHaveLength(0);
    expect(foreignClient!.messages.filter((message) => message.event === 'error').length).toBeGreaterThanOrEqual(1);

    evidence.push({
      case: 'AC3b-autorizacao-por-destinatario',
      eventId,
      foreignSubscribed: false,
      foreignDeliveries: 0,
      foreignUserId,
      authorizedUserId,
    });
  });

  it('AC3c — revogação de membership corta o canal e nenhuma entrega nova chega', async () => {
    await pool.query('DELETE FROM user_sectors WHERE user_id = $1 AND sector_id = $2', [authorizedUserId, sectorId]);

    await Promise.all([
      waitForAsync(
        async () => clientOnA!.messages.some((message) => message.event === 'subscription.revoked'),
        5000,
        'subscription.revoked no realtime A',
      ),
      waitForAsync(
        async () => clientOnB!.messages.some((message) => message.event === 'subscription.revoked'),
        5000,
        'subscription.revoked no realtime B',
      ),
    ]);

    const tag = `ac3c-${randomUUID().slice(0, 8)}`;
    const { eventId, correlationId } = await publishFanoutEvent(tag);
    await waitForAsync(
      async () => isProcessed(eventId, 'realtime'),
      30_000,
      'processamento do evento pós-revogação',
    );
    await sleep(1200);
    expect(receivedContent(clientOnA!, correlationId, conversationId)).toHaveLength(0);
    expect(receivedContent(clientOnB!, correlationId, conversationId)).toHaveLength(0);

    evidence.push({
      case: 'AC3c-revogacao-corta',
      eventId,
      revokedA: true,
      revokedB: true,
      deliveriesAfterRevocation: 0,
    });
  });
});

// ============================================================
// AC4 — falha de processo no meio e DLQ após esgotar tentativas
// ============================================================

describe('PROD-12 AC4 — kill no meio do processamento e DLQ entre processos', () => {
  it('AC4a — SIGKILL durante o handler: lease expira, outro processo recupera e o efeito aplica 1×', async () => {
    await resetPipeline();
    const tag = `ac4a-${randomUUID().slice(0, 8)}`;
    const conversationId = await insertContactConversation(tag);
    const eventId = `${tag}-evt`;
    await seedOutboxEvent({
      eventId,
      eventType: 'handoff.completed',
      payload: { conversationId, previousHandler: 'bot', newHandler: 'human', reason: `${tag}-reason` },
      correlationId: `${tag}-corr`,
      aggregateId: conversationId,
    });

    // O handler fica preso no INSERT do alerta por 4s; o kill externo acontece
    // com o claim já commitado e o efeito ainda não gravado.
    await armSlow(tag, 4);
    const victim = startWorker(`${tag}-victim`, { WORKER_OWNER: `${tag}-owner-1`, WORKER_LEASE_SECONDS: '2' });
    await waitForAsync(
      async () => (await ackRow(eventId))?.lease_owner === `${tag}-owner-1`,
      30_000,
      'claim do worker vítima',
    );
    await stopChild(victim, 'SIGKILL');
    const victimExit = await waitForExit(victim, 5000);
    expect(victimExit, 'worker vítima deveria ter encerrado').not.toBeNull();
    expect(victimExit!.signal).toBe('SIGKILL');
    expect(victim.output()).toContain('Processing event');
    expect(victim.output()).not.toContain('Successfully processed event');

    const mid = await ackRow(eventId);
    expect(mid?.processed_at).toBeNull();
    expect(await receiptCount(eventId)).toBe(0);
    expect(await count('SELECT count(*)::int AS n FROM alerts')).toBe(0);

    await disarmFailures();
    await expireLease(eventId);
    const rescuer = startWorker(`${tag}-rescuer`, { WORKER_OWNER: `${tag}-owner-2`, WORKER_LEASE_SECONDS: '10' });
    await waitForAsync(
      async () => isProcessed(eventId),
      60_000,
      'recuperação pelo segundo worker',
    );
    await stopChild(rescuer);

    const done = await ackRow(eventId);
    expect(done?.lease_owner).toBe(`${tag}-owner-2`);
    expect(done?.generation).toBeGreaterThanOrEqual(2);
    expect(await receiptCount(eventId)).toBe(1);
    expect(await alertCountForReceipt(eventId)).toBe(1);
    expect(rescuer.output()).toContain('Successfully processed event');

    evidence.push({
      case: 'AC4a-sigkill-meio-processamento-recuperacao',
      eventId,
      victimSignal: victimExit!.signal,
      victimReceipts: 0,
      rescuedGeneration: done?.generation ?? null,
      receipts: 1,
      alerts: 1,
    });
  });

  it('AC4b — DLQ após esgotar tentativas atravessando restart do processo worker', async () => {
    await resetPipeline();
    const tag = `ac4b-${randomUUID().slice(0, 8)}`;
    const conversationId = await insertContactConversation(tag);
    const eventId = `${tag}-evt`;
    await seedOutboxEvent({
      eventId,
      eventType: 'handoff.completed',
      payload: { conversationId, previousHandler: 'bot', newHandler: 'human', reason: `${tag}-reason` },
      correlationId: `${tag}-corr`,
      aggregateId: conversationId,
    });
    await armFailures(999);

    const first = startWorker(`${tag}-w1`, {
      WORKER_OWNER: `${tag}-owner-1`,
      WORKER_MAX_RETRIES: '3',
      OUTBOX_POLL_INTERVAL_MS: '700',
    });
    await waitForAsync(
      async () => ((await ackRow(eventId))?.retry_count ?? 0) >= 1,
      60_000,
      'primeiro NACK persistido',
    );
    await stopChild(first);
    const afterFirst = await ackRow(eventId);
    expect(afterFirst!.processed_at).toBeNull();
    expect(afterFirst!.retry_count).toBeGreaterThanOrEqual(1);

    const second = startWorker(`${tag}-w2`, {
      WORKER_OWNER: `${tag}-owner-2`,
      WORKER_MAX_RETRIES: '3',
      OUTBOX_POLL_INTERVAL_MS: '200',
    });
    await waitForAsync(
      async () => (await deadLetterFor(eventId)) !== null,
      90_000,
      'DLQ após esgotar tentativas entre processos',
    );
    await stopChild(second);
    await disarmFailures();

    const dlq = await deadLetterFor(eventId);
    expect(dlq!.status).toBe('PENDING');
    expect(dlq!.error_code).toBe('RETRY_BUDGET_EXHAUSTED');
    expect(dlq!.attempt_count).toBe(3);
    const finalAck = await ackRow(eventId);
    expect(finalAck!.processed_at).toBeNull();
    expect(finalAck!.retry_count).toBe(3);
    expect(await receiptCount(eventId)).toBe(0);
    expect(second.output()).toContain('dead-lettered');
    expect(
      await count('SELECT count(*)::int AS n FROM worker_effect_receipts WHERE event_id = $1', [eventId]),
    ).toBe(0);

    evidence.push({
      case: 'AC4b-dlq-entre-restarts',
      eventId,
      retryAfterFirstProcess: afterFirst!.retry_count,
      finalRetryCount: finalAck!.retry_count,
      attemptCount: dlq!.attempt_count,
      errorCode: dlq!.error_code,
      processedAt: null,
      receipts: 0,
    });
  });
});
