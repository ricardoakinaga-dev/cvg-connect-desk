/**
 * PROD-09 — efeitos idempotentes de worker e falhas observáveis (C04/G03).
 *
 * Prova real em PostgreSQL + Redis isolados do harness AAA (run `prod09`,
 * worker 22, `cvg_aaa_prod09_w22`), usando o CÓDIGO DE PRODUÇÃO do worker
 * (handlers/processor), do lease/DLQ (`@cvg/events`) e do módulo de alertas —
 * nunca o banco do host:
 *
 *   AC1 — efeito de handler idempotente por (eventId, consumer, effectType):
 *         replay sequencial/concorrente/pós-crash produz EXATAMENTE um alerta
 *         lógico e um histórico; chave durável em worker_effect_receipts.
 *   AC2 — `Err` de createAlert (e demais falhas) propaga: NACK/retry conforme
 *         orçamento; esgotado o orçamento vai para DLQ durável com envelope
 *         íntegro e causa; poison/malformed/versão não suportada DLQ imediata;
 *         tipo fora do contrato não é claimado (não some nem vira DLQ em massa).
 *   AC3 — crash real do processo após o efeito e antes do ACK + retomada:
 *         replay não duplica; ACK/NACK stale de worker antigo é observado e
 *         não conclui (lease owner+generation fence).
 *   AC4 — registros distinguem retry, dead-letter e recuperação; logs
 *         estruturados com eventId/correlation e sem PII de payload.
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
  alertId: string;
  deduplicated: boolean;
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

interface AlertsModuleLike {
  createAlert: (
    input: Record<string, unknown>,
    options?: { idempotency?: { eventId: string; consumerId: string; effectType: string } },
  ) => Promise<{
    isOk(): boolean;
    isErr(): boolean;
    value?: { id: string; type: string; title: string; deduplicated?: boolean };
    error?: Error;
  }>;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../../..');
const PROGRAM_DIR = process.env.CVG_PROGRAM_DIR || join(REPO_ROOT, 'docs', 'producao-2026-09-13');
const EVIDENCE_SEGMENT = process.env.CVG_EVIDENCE_SEGMENT?.trim();
const EVIDENCE_DIR = join(
  PROGRAM_DIR,
  'evidencias',
  'prod-09',
  ...(EVIDENCE_SEGMENT ? [EVIDENCE_SEGMENT] : []),
);
const LOG_DIR = join(EVIDENCE_DIR, 'logs');
const RUNTIME_DIR = process.env.CVG_RUNTIME_DIR || join(EVIDENCE_DIR, 'runtime');
const MIGRATIONS_DIR = join(REPO_ROOT, 'packages', 'database', 'supabase', 'migrations');
const RUN_ID = process.env.AAA_RUN_ID || 'prod09';
const WORKER_INDEX = Number(process.env.AAA_WORKER_INDEX || '22');
const WORKER_CONSUMER = 'worker';
const HANDOFF_EFFECT = 'alert:handoff.completed';
const SECRETARY_EFFECT = 'alert:secretary.invocation';

process.env.CVG_PROGRAM_DIR = PROGRAM_DIR;
process.env.CVG_RUNTIME_DIR = RUNTIME_DIR;
process.env.AAA_RUN_ID = RUN_ID;
process.env.AAA_WORKER_INDEX = String(WORKER_INDEX);
process.env.NODE_ENV = 'test';
// DATABASE_URL só depois de provisionar o PG isolado: evita qualquer conexão
// com o banco do host no carregamento dos módulos.
delete process.env.DATABASE_URL;

vi.setConfig({ testTimeout: 180_000, hookTimeout: 600_000 });

const evidence: Array<Record<string, unknown>> = [];
const childLogs: string[] = [];
const spawnedChildren: ChildProcess[] = [];

let ctx: RunContext;
let isolatedEnv: { databaseName: string; marker: { runId: string } };
let pg: PgRuntime;
let harness: Harness;
let pool: PgPoolLike;
let databaseModulePool: DatabasePoolLike | undefined;

let createAlert: AlertsModuleLike['createAlert'];
let makeReader: (maxRetries?: number) => ReaderLike;
let makeProcessor: (reader: ReaderLike, overrides?: Record<string, unknown>) => {
  processEvent: ProcessEventFn;
  logs: LogRecordLike[];
  readonly deadLetterMirrors: number;
};
let sharedHandlers: Record<string, (event: EventEnvelopeLike) => Promise<HandlerEffectReportLike | null>>;
let handoffHandler: (event: EventEnvelopeLike) => Promise<HandlerEffectReportLike | null>;
let persistentDeadLetterStore: {
  getById(id: string): Promise<{ id: string; status: string } | null>;
  claimForReplay(id: string): Promise<{ id: string; status: string; payload: EventEnvelopeLike } | null>;
  markReplayed(id: string): Promise<{ status: string; replayCount: number; resolutionReason: string | null } | null>;
};

function databaseUrl(): string {
  return `postgresql://cvg_aaa@127.0.0.1:${ctx.ports.postgres}/${isolatedEnv.databaseName}`;
}

function writeEvidenceJson(name: string, value: unknown): void {
  writeFileSync(join(EVIDENCE_DIR, name), `${JSON.stringify(value, null, 2)}\n`);
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return check();
}

async function count(query: string, params: unknown[] = []): Promise<number> {
  const result = await pool.query<{ n: number }>(query, params);
  return Number(result.rows[0]?.n ?? 0);
}

async function insertConversation(tag: string): Promise<string> {
  const contact = await pool.query<{ id: string }>(
    'INSERT INTO contacts (name, phone) VALUES ($1, $2) RETURNING id',
    [`prod09 ${tag}`, `+5511${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`],
  );
  const conversation = await pool.query<{ id: string }>(
    `INSERT INTO conversations (external_conversation_id, external_channel_id, status, status_v2, contact_id)
     VALUES ($1, 'whatsapp', 'open', 'novo', $2) RETURNING id`,
    [`${tag}-conv`, contact.rows[0]!.id],
  );
  return conversation.rows[0]!.id;
}

async function seedOutboxEvent(input: {
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  eventVersion?: number;
  correlationId?: string;
  conversationId?: string;
  createdAt?: Date;
}): Promise<void> {
  await pool.query(
    `INSERT INTO outbox_events
       (event_id, event_type, event_version, aggregate_type, aggregate_id, occurred_at,
        payload, correlation_id, version, created_at)
     VALUES ($1, $2, $3, 'Conversation', $4, NOW(), $5, $6, 1, $7)`,
    [
      input.eventId,
      input.eventType,
      input.eventVersion ?? 1,
      input.conversationId ?? input.eventId,
      JSON.stringify(input.payload),
      input.correlationId ?? null,
      input.createdAt ?? new Date(),
    ],
  );
}

async function expireLease(eventId: string, consumerId = WORKER_CONSUMER): Promise<void> {
  await pool.query(
    `UPDATE outbox_consumer_acks SET lease_until = now() - interval '1 second'
      WHERE event_id = $1 AND consumer_id = $2`,
    [eventId, consumerId],
  );
}

async function ackRow(eventId: string): Promise<{
  processed_at: Date | null;
  retry_count: number;
  lease_owner: string | null;
  generation: number;
  last_error: string | null;
} | null> {
  const result = await pool.query<{
    processed_at: Date | null;
    retry_count: number;
    lease_owner: string | null;
    generation: number;
    last_error: string | null;
  }>(
    `SELECT processed_at, retry_count, lease_owner, generation, last_error
       FROM outbox_consumer_acks WHERE event_id = $1 AND consumer_id = $2`,
    [eventId, WORKER_CONSUMER],
  );
  return result.rows[0] ?? null;
}

async function alertsByReceipt(eventId: string, effectType?: string): Promise<Array<{ id: string; title: string; message: string | null }>> {
  const typeFilter = effectType ? 'AND r.effect_type = $2' : '';
  const params: unknown[] = [eventId];
  if (effectType) params.push(effectType);
  const result = await pool.query<{ id: string; title: string; message: string | null }>(
    `SELECT a.id, a.title, a.message
       FROM alerts a JOIN worker_effect_receipts r ON r.result_ref = a.id::text
      WHERE r.event_id = $1 ${typeFilter}`,
    params,
  );
  return result.rows;
}

async function receiptCount(eventId: string): Promise<number> {
  return count('SELECT count(*)::int AS n FROM worker_effect_receipts WHERE event_id = $1', [eventId]);
}

async function alertEventCountForReceipt(eventId: string): Promise<number> {
  return count(
    `SELECT count(*)::int AS n FROM alert_events e
       JOIN worker_effect_receipts r ON r.result_ref = e.alert_id::text
      WHERE r.event_id = $1`,
    [eventId],
  );
}

async function deadLetterFor(eventId: string): Promise<{
  id: string;
  status: string;
  error_code: string | null;
  error_message: string | null;
  attempt_count: number;
  payload: EventEnvelopeLike;
} | null> {
  const result = await pool.query<{
    id: string;
    status: string;
    error_code: string | null;
    error_message: string | null;
    attempt_count: number;
    payload: EventEnvelopeLike;
  }>('SELECT id, status, error_code, error_message, attempt_count, payload FROM dead_letter_events WHERE original_event_id = $1', [eventId]);
  return result.rows[0] ?? null;
}

async function armAlertFailure(remaining: number): Promise<void> {
  await pool.query(
    `INSERT INTO prod09_fault_gate (point, fail_remaining) VALUES ('alerts', $1)
     ON CONFLICT (point) DO UPDATE SET fail_remaining = EXCLUDED.fail_remaining`,
    [remaining],
  );
}

async function disarmAlertFailures(): Promise<void> {
  await pool.query('DELETE FROM prod09_fault_gate');
}

async function setupFaultInjection(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS prod09_fault_gate (
      point TEXT PRIMARY KEY,
      fail_remaining INTEGER NOT NULL
    );
    CREATE OR REPLACE FUNCTION prod09_fault_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE remaining integer;
    BEGIN
      SELECT fail_remaining INTO remaining FROM prod09_fault_gate WHERE point = 'alerts';
      IF remaining IS NOT NULL AND remaining > 0 THEN
        UPDATE prod09_fault_gate SET fail_remaining = remaining - 1 WHERE point = 'alerts';
        RAISE EXCEPTION 'prod09 injected transient failure at alerts';
      END IF;
      RETURN NEW;
    END;
    $$;
    DROP TRIGGER IF EXISTS prod09_fault_alerts ON alerts;
    CREATE TRIGGER prod09_fault_alerts BEFORE INSERT ON alerts
      FOR EACH ROW EXECUTE FUNCTION prod09_fault_guard();
  `);
}

function redisPing(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const socket = net.connect(Number(parsed.port), parsed.hostname);
    let data = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('redis ping timeout'));
    }, 5000);
    socket.on('connect', () => socket.write('PING\r\n'));
    socket.on('data', (chunk: Buffer) => {
      data += chunk.toString();
      if (data.includes('PONG')) {
        clearTimeout(timer);
        socket.end();
        resolve('PONG');
      }
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function startWorkerProcess(extraEnv: Record<string, string>): {
  child: ChildProcess;
  output: () => string;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
} {
  const child = spawn(join(REPO_ROOT, 'node_modules', '.bin', 'tsx'), ['src/index.ts'], {
    cwd: join(REPO_ROOT, 'apps', 'message-worker'),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl(),
      REDIS_URL: ctx.redisUrl,
      NODE_ENV: 'test',
      OUTBOX_POLL_INTERVAL_MS: '150',
      WORKER_LEASE_SECONDS: '5',
      WORKER_HEALTH_PORT: String(ctx.ports.api + 200),
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
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on('exit', (code, signal) => resolve({ code, signal }));
  });
  return { child, output: () => output, exited };
}

async function waitForExit(
  handle: { exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }> },
  timeoutMs: number,
): Promise<{ code: number | null; signal: NodeJS.Signals | null } | null> {
  return Promise.race([
    handle.exited,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
}

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

  pool = new pg.Pool({ connectionString: databaseUrl(), max: 8 });

  const { drizzle } = await import('drizzle-orm/node-postgres');
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  await migrate(drizzle(pool as never) as never, { migrationsFolder: MIGRATIONS_DIR });
  await setupFaultInjection();

  const databaseSpecifier = '../../../../../packages/database/src/index.ts';
  const databaseModule = (await import(/* @vite-ignore */ databaseSpecifier)) as { getPool: () => DatabasePoolLike };
  databaseModulePool = databaseModule.getPool();

  const eventsSpecifier = '../../../../../packages/events/src/index.ts';
  const eventsModule = (await import(/* @vite-ignore */ eventsSpecifier)) as {
    ConsumerAwareOutboxReader: new (options: Record<string, unknown>) => ReaderLike;
    CONSUMER_IDS: { WORKER: string };
    persistentDeadLetterStore: typeof persistentDeadLetterStore;
  };
  persistentDeadLetterStore = eventsModule.persistentDeadLetterStore;

  const alertsSpecifier = '../../../../../modules/alerts/src/application/use-cases/create-alert.use-case.ts';
  const alertsModule = (await import(/* @vite-ignore */ alertsSpecifier)) as AlertsModuleLike;
  createAlert = alertsModule.createAlert;

  const contractSpecifier = '../../../../../apps/message-worker/src/contract.ts';
  const contractModule = (await import(/* @vite-ignore */ contractSpecifier)) as {
    WORKER_EVENT_TYPES: readonly string[];
    WORKER_CONSUMER_ID: string;
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
      onAfterEffect?: (event: EventEnvelopeLike) => void | Promise<void>;
      onDeadLetter?: (handoff: Record<string, unknown>) => void | Promise<void>;
    }) => ProcessEventFn;
  };

  makeReader = (maxRetries = 3): ReaderLike =>
    new eventsModule.ConsumerAwareOutboxReader({
      consumerId: eventsModule.CONSUMER_IDS.WORKER,
      batchSize: 50,
      maxRetries,
      eventTypes: contractModule.WORKER_EVENT_TYPES,
    });

  sharedHandlers = handlersModule.createHandlers({
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  });
  handoffHandler = sharedHandlers['handoff.completed']!;

  makeProcessor = (reader, overrides = {}) => {
    const logs: LogRecordLike[] = [];
    const state = { deadLetterMirrors: 0 };
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
      onDeadLetter: () => {
        state.deadLetterMirrors += 1;
      },
      ...overrides,
    });
    return {
      processEvent,
      logs,
      get deadLetterMirrors() {
        return state.deadLetterMirrors;
      },
    };
  };

  await redisPing(ctx.redisUrl);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await disarmAlertFailures();
});

afterAll(async () => {
  writeEvidenceJson('prod-09-evidence.json', {
    generatedAt: new Date().toISOString(),
    runId: RUN_ID,
    workerIndex: WORKER_INDEX,
    database: isolatedEnv?.databaseName,
    postgresPort: ctx?.ports.postgres,
    redisPort: ctx?.ports.redis,
    cases: evidence,
  });
  for (const child of spawnedChildren) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  }
  if (databaseModulePool) await databaseModulePool.end().catch(() => undefined);
  if (pool) await pool.end().catch(() => undefined);
  if (ctx && harness) {
    harness.teardownIsolatedEnv(ctx, { stopServices: true, dropDatabase: true });
  }
});

function handoffInput(conversationId: string, reason: string): Record<string, unknown> {
  return {
    conversationId,
    type: 'handoff',
    title: 'Conversa transferida para atendimento humano',
    message: `Motivo: ${reason}`,
    severity: 'info',
    metadata: { newHandler: 'human' },
  };
}

function handoffPayload(conversationId: string, reason: string): Record<string, unknown> {
  return {
    conversationId,
    previousHandler: 'bot',
    newHandler: 'human',
    reason,
  };
}

describe('PROD-09 — efeitos idempotentes e falhas observáveis (PG+Redis reais)', () => {
  describe('AC1 — idempotência por (eventId, consumer, efeito)', () => {
    it('AC1a — replay sequencial do mesmo efeito produz UM alerta e UM histórico', async () => {
      const tag = `prod09-ac1a-${randomUUID()}`;
      const conversationId = await insertConversation(tag);
      const eventId = `${tag}-evt`;
      const input = handoffInput(conversationId, tag);
      const key = { eventId, consumerId: WORKER_CONSUMER, effectType: HANDOFF_EFFECT };

      const first = await createAlert(input, { idempotency: key });
      const second = await createAlert(input, { idempotency: key });

      expect(first.isOk()).toBe(true);
      expect(second.isOk()).toBe(true);
      expect(first.value!.id).toBe(second.value!.id);
      expect(first.value!.deduplicated).toBe(false);
      expect(second.value!.deduplicated).toBe(true);
      expect(await receiptCount(eventId)).toBe(1);
      expect((await alertsByReceipt(eventId)).length).toBe(1);
      expect(await alertEventCountForReceipt(eventId)).toBe(1);
      expect(await count('SELECT count(*)::int AS n FROM alerts WHERE conversation_id = $1', [conversationId])).toBe(1);

      evidence.push({
        case: 'AC1a-replay-sequencial',
        eventId,
        alertId: first.value!.id,
        deduplicatedFlags: [first.value!.deduplicated, second.value!.deduplicated],
        receipts: 1,
        alerts: 1,
        alertEvents: 1,
      });
    });

    it('AC1b — 5 aplicações concorrentes do mesmo efeito produzem UM alerta', async () => {
      const tag = `prod09-ac1b-${randomUUID()}`;
      const conversationId = await insertConversation(tag);
      const eventId = `${tag}-evt`;
      const key = { eventId, consumerId: WORKER_CONSUMER, effectType: HANDOFF_EFFECT };

      const results = await Promise.all(
        Array.from({ length: 5 }, () => createAlert(handoffInput(conversationId, tag), { idempotency: key })),
      );

      expect(results.every((result) => result.isOk())).toBe(true);
      const ids = new Set(results.map((result) => result.value!.id));
      expect(ids.size).toBe(1);
      expect(results.filter((result) => result.value!.deduplicated === false)).toHaveLength(1);
      expect(results.filter((result) => result.value!.deduplicated === true)).toHaveLength(4);
      expect(await receiptCount(eventId)).toBe(1);
      expect((await alertsByReceipt(eventId)).length).toBe(1);

      evidence.push({
        case: 'AC1b-concorrencia',
        eventId,
        callers: results.length,
        distinctAlertIds: ids.size,
        appliedOnce: 1,
        deduplicated: 4,
      });
    });

    it('AC1c — a chave é por efeito e por consumidor (efeitos independentes não colidem)', async () => {
      const tag = `prod09-ac1c-${randomUUID()}`;
      const conversationId = await insertConversation(tag);
      const eventId = `${tag}-evt`;
      const input = handoffInput(conversationId, tag);

      await createAlert(input, { idempotency: { eventId, consumerId: WORKER_CONSUMER, effectType: HANDOFF_EFFECT } });
      await createAlert(input, { idempotency: { eventId, consumerId: WORKER_CONSUMER, effectType: 'alert:secondary' } });
      await createAlert(input, { idempotency: { eventId, consumerId: 'other-consumer', effectType: HANDOFF_EFFECT } });

      expect(await receiptCount(eventId)).toBe(3);
      expect((await alertsByReceipt(eventId)).length).toBe(3);

      evidence.push({
        case: 'AC1c-granularidade',
        eventId,
        receipts: 3,
        alerts: 3,
        note: 'mesmo evento com 2 efeitos + mesmo efeito em outro consumidor',
      });
    });

    it('AC1d — efeito commitado sem ACK (crash simulado) + reclaim: replay não duplica', async () => {
      const tag = `prod09-ac1d-${randomUUID()}`;
      const conversationId = await insertConversation(tag);
      const eventId = `${tag}-evt`;
      await seedOutboxEvent({
        eventId,
        eventType: 'handoff.completed',
        payload: handoffPayload(conversationId, tag),
        correlationId: `${tag}-corr`,
        conversationId,
      });

      const reader = makeReader(3);
      const firstClaim = await reader.claim({ owner: `${tag}-owner-a`, leaseSeconds: 30, limit: 10 });
      const claimed = firstClaim.find((item) => item.event.event_id === eventId)!;
      expect(claimed.lease.generation).toBe(1);
      // Efeito aplicado pelo handler real, mas o processo "morre" antes do ACK:
      const effect = await handoffHandler(claimed.event);
      expect(effect?.deduplicated).toBe(false);
      expect((await ackRow(eventId))?.processed_at).toBeNull();
      expect(await receiptCount(eventId)).toBe(1);

      await expireLease(eventId);
      const secondClaim = await reader.claim({ owner: `${tag}-owner-b`, leaseSeconds: 30, limit: 10 });
      const reclaimed = secondClaim.find((item) => item.event.event_id === eventId)!;
      expect(reclaimed.lease.generation).toBe(2);

      const { processEvent } = makeProcessor(reader);
      const outcome = await processEvent(reclaimed.event, reclaimed.lease);

      expect(outcome.outcome).toBe('acked');
      expect(outcome.effect?.deduplicated).toBe(true);
      expect(await receiptCount(eventId)).toBe(1);
      expect((await alertsByReceipt(eventId)).length).toBe(1);
      expect(await alertEventCountForReceipt(eventId)).toBe(1);
      expect((await ackRow(eventId))?.processed_at).not.toBeNull();

      evidence.push({
        case: 'AC1d-crash-simulado-replay',
        eventId,
        generations: [1, 2],
        deduplicatedOnReplay: true,
        receipts: 1,
        alerts: 1,
      });
    });
  });

  describe('AC2 — propagação de falha, orçamento e DLQ durável', () => {
    it('AC2a — falha transitória não dá ACK: NACK/retry e depois aplica', async () => {
      const tag = `prod09-ac2a-${randomUUID()}`;
      const conversationId = await insertConversation(tag);
      const eventId = `${tag}-evt`;
      await seedOutboxEvent({
        eventId,
        eventType: 'secretary.invocation',
        payload: { conversationId, status: 'failed', action: 'respond', errorMessage: `falha ${tag}` },
        correlationId: `${tag}-corr`,
        conversationId,
      });
      await armAlertFailure(1);

      const reader = makeReader(3);
      const { processEvent, logs } = makeProcessor(reader);

      const firstClaim = await reader.claim({ owner: `${tag}-a`, leaseSeconds: 30, limit: 10 });
      const firstItem = firstClaim.find((item) => item.event.event_id === eventId)!;
      const first = await processEvent(firstItem.event, firstItem.lease);
      expect(first.outcome).toBe('retry');
      expect(first.errorCode).toBe('RETRY_BUDGET_EXHAUSTED');
      const afterFirst = await ackRow(eventId);
      expect(afterFirst?.processed_at).toBeNull();
      expect(afterFirst?.retry_count).toBe(1);
      expect(afterFirst?.last_error).toContain('prod09 injected transient failure');
      expect(logs.some((record) => record.retry_decision === 'retry')).toBe(true);
      expect(logs.some((record) => record.msg === '[Worker] Successfully processed event')).toBe(false);
      const retryLog = logs.find((record) => record.retry_decision === 'retry');
      expect(String(retryLog?.error)).not.toContain(tag);
      expect(String(retryLog?.error)).not.toContain('params:');

      // O contador do gate roda na MESMA transação do insert que falha, então
      // o rollback o restaura; desarmar explícito simula a dependência voltar.
      await disarmAlertFailures();
      const secondClaim = await reader.claim({ owner: `${tag}-b`, leaseSeconds: 30, limit: 10 });
      const secondItem = secondClaim.find((item) => item.event.event_id === eventId)!;
      const second = await processEvent(secondItem.event, secondItem.lease);
      expect(second.outcome, JSON.stringify({ error: second.error, errorCode: second.errorCode })).toBe('acked');
      expect((await ackRow(eventId))?.processed_at).not.toBeNull();
      expect((await alertsByReceipt(eventId)).length).toBe(1);

      evidence.push({
        case: 'AC2a-transitoria-retry',
        eventId,
        firstOutcome: first.outcome,
        retryCountAfterFirst: 1,
        secondOutcome: second.outcome,
        alertApplied: true,
      });
    });

    it('AC2b — orçamento esgotado vai para DLQ durável com envelope íntegro e causa', async () => {
      const tag = `prod09-ac2b-${randomUUID()}`;
      const conversationId = await insertConversation(tag);
      const eventId = `${tag}-evt`;
      const correlationId = `${tag}-corr`;
      await seedOutboxEvent({
        eventId,
        eventType: 'handoff.completed',
        payload: handoffPayload(conversationId, tag),
        correlationId,
        conversationId,
      });
      await armAlertFailure(999);

      const reader = makeReader(2);
      const processor = makeProcessor(reader);
      const { processEvent } = processor;

      const firstClaim = await reader.claim({ owner: `${tag}-a`, leaseSeconds: 30, limit: 10 });
      const firstItem = firstClaim.find((item) => item.event.event_id === eventId)!;
      const first = await processEvent(firstItem.event, firstItem.lease);
      expect(first.outcome).toBe('retry');

      const secondClaim = await reader.claim({ owner: `${tag}-b`, leaseSeconds: 30, limit: 10 });
      const secondItem = secondClaim.find((item) => item.event.event_id === eventId)!;
      const second = await processEvent(secondItem.event, secondItem.lease);
      expect(second.outcome).toBe('dead-letter');
      expect(second.errorCode).toBe('RETRY_BUDGET_EXHAUSTED');

      const ack = await ackRow(eventId);
      expect(ack?.processed_at).toBeNull();
      expect(ack?.retry_count).toBe(2);

      const dlq = await deadLetterFor(eventId);
      expect(dlq).not.toBeNull();
      expect(dlq!.status).toBe('PENDING');
      expect(dlq!.error_code).toBe('RETRY_BUDGET_EXHAUSTED');
      expect(dlq!.error_message).toContain('prod09 injected transient failure');
      expect(dlq!.attempt_count).toBe(2);
      expect(dlq!.payload.event_id).toBe(eventId);
      expect(dlq!.payload.event_type).toBe('handoff.completed');
      expect(dlq!.payload.correlation_id).toBe(correlationId);
      expect(typeof dlq!.payload.occurred_at).toBe('string');
      expect((dlq!.payload.payload as Record<string, unknown>).conversationId).toBe(conversationId);

      const thirdClaim = await reader.claim({ owner: `${tag}-c`, leaseSeconds: 30, limit: 10 });
      expect(thirdClaim.filter((item) => item.event.event_id === eventId)).toHaveLength(0);
      expect((await alertsByReceipt(eventId)).length).toBe(0);
      expect(await receiptCount(eventId)).toBe(0);
      await disarmAlertFailures();
      expect(processor.deadLetterMirrors).toBe(1);

      evidence.push({
        case: 'AC2b-orcamento-DLQ',
        eventId,
        outcomes: [first.outcome, second.outcome],
        retryCount: 2,
        dlqErrorCode: dlq!.error_code,
        envelopeIntact: true,
        claimableAfterDeadLetter: false,
        alerts: 0,
      });
    });

    it('AC2c — poison/malformed vai para DLQ imediata com motivo, sem consumir retry', async () => {
      const tag = `prod09-ac2c-${randomUUID()}`;
      const conversationId = await insertConversation(tag);
      const eventId = `${tag}-evt`;
      await seedOutboxEvent({
        eventId,
        eventType: 'handoff.completed',
        payload: { conversationId, previousHandler: 'bot', newHandler: 'human', reason: 12345 },
        correlationId: `${tag}-corr`,
        conversationId,
      });

      const reader = makeReader(3);
      const { processEvent } = makeProcessor(reader);
      const claimed = (await reader.claim({ owner: `${tag}-a`, leaseSeconds: 30, limit: 10 }))
        .find((item) => item.event.event_id === eventId)!;
      const outcome = await processEvent(claimed.event, claimed.lease);

      expect(outcome.outcome).toBe('dead-letter');
      expect(outcome.errorCode).toBe('MALFORMED_PAYLOAD');
      expect(outcome.error).toContain('malformed payload');
      expect(outcome.error).not.toContain('12345');

      const ack = await ackRow(eventId);
      expect(ack?.processed_at).toBeNull();
      expect(ack?.retry_count).toBe(3);

      const dlq = await deadLetterFor(eventId);
      expect(dlq!.error_code).toBe('MALFORMED_PAYLOAD');
      expect((dlq!.payload.payload as Record<string, unknown>).reason).toBe(12345);
      expect((await reader.claim({ owner: `${tag}-b`, leaseSeconds: 30, limit: 10 })).filter((item) => item.event.event_id === eventId)).toHaveLength(0);

      evidence.push({
        case: 'AC2c-malformed-DLQ-imediata',
        eventId,
        errorCode: outcome.errorCode,
        retryCountAtDlq: 3,
        claimableAfterDeadLetter: false,
      });
    });

    it('AC2d — versão de evento não suportada vai para DLQ com o sourceEvent íntegro', async () => {
      const tag = `prod09-ac2d-${randomUUID()}`;
      const conversationId = await insertConversation(tag);
      const eventId = `${tag}-evt`;
      await seedOutboxEvent({
        eventId,
        eventType: 'handoff.completed',
        payload: handoffPayload(conversationId, tag),
        eventVersion: 2,
        correlationId: `${tag}-corr`,
        conversationId,
      });

      const reader = makeReader(3);
      const { processEvent } = makeProcessor(reader);
      const claimed = (await reader.claim({ owner: `${tag}-a`, leaseSeconds: 30, limit: 10 }))
        .find((item) => item.event.event_id === eventId)!;
      const outcome = await processEvent(claimed.event, claimed.lease);

      expect(outcome.outcome).toBe('dead-letter');
      expect(outcome.errorCode).toBe('UNSUPPORTED_EVENT_VERSION');
      const dlq = await deadLetterFor(eventId);
      expect(dlq!.error_code).toBe('UNSUPPORTED_EVENT_VERSION');
      expect(dlq!.payload.event_version).toBe(2);
      expect(dlq!.payload.event_id).toBe(eventId);

      evidence.push({
        case: 'AC2d-versao-nao-suportada',
        eventId,
        errorCode: outcome.errorCode,
        envelopeVersion: 2,
      });
    });

    it('AC2e — tipo fora do contrato não é claimado nem ACKado (trabalho de outro consumidor preservado)', async () => {
      const tag = `prod09-ac2e-${randomUUID()}`;
      const conversationId = await insertConversation(tag);
      const eventId = `${tag}-evt`;
      await seedOutboxEvent({
        eventId,
        eventType: 'conversation.created',
        payload: { conversationId },
        conversationId,
      });

      const reader = makeReader(3);
      const claimed = await reader.claim({ owner: `${tag}-a`, leaseSeconds: 30, limit: 50 });

      expect(claimed.filter((item) => item.event.event_id === eventId)).toHaveLength(0);
      expect(await ackRow(eventId)).toBeNull();
      expect(
        await count('SELECT count(*)::int AS n FROM outbox_events WHERE event_id = $1 AND processed_at IS NULL', [eventId]),
      ).toBe(1);

      evidence.push({
        case: 'AC2e-contrato-de-tipos',
        eventId,
        claimed: false,
        workerAck: false,
        eventStillPending: true,
      });
    });
  });

  describe('AC3 — fencing de lease e crash real de processo', () => {
    it('AC3a — ACK stale do worker antigo é observado e não conclui; geração nova deduplica', async () => {
      const tag = `prod09-ac3a-${randomUUID()}`;
      const conversationId = await insertConversation(tag);
      const eventId = `${tag}-evt`;
      await seedOutboxEvent({
        eventId,
        eventType: 'handoff.completed',
        payload: handoffPayload(conversationId, tag),
        correlationId: `${tag}-corr`,
        conversationId,
      });

      const reader = makeReader(3);
      const claimA = (await reader.claim({ owner: `${tag}-old`, leaseSeconds: 30, limit: 10 }))
        .find((item) => item.event.event_id === eventId)!;
      await expireLease(eventId);
      const claimB = (await reader.claim({ owner: `${tag}-new`, leaseSeconds: 30, limit: 10 }))
        .find((item) => item.event.event_id === eventId)!;
      expect(claimB.lease.generation).toBe(claimA.lease.generation + 1);

      const { processEvent, logs } = makeProcessor(reader);
      const staleOutcome = await processEvent(claimA.event, claimA.lease);
      expect(staleOutcome.outcome).toBe('stale');
      const midAck = await ackRow(eventId);
      expect(midAck?.processed_at).toBeNull();
      expect(midAck?.lease_owner).toBe(`${tag}-new`);
      expect(midAck?.generation).toBe(claimB.lease.generation);
      expect(logs.some((record) => record.msg === '[Worker] ACK rejected (lease fenced or unknown); event not completed')).toBe(true);
      // O efeito do worker antigo foi aplicado; o fence impediu o ACK.
      expect(await receiptCount(eventId)).toBe(1);

      const freshOutcome = await processEvent(claimB.event, claimB.lease);
      expect(freshOutcome.outcome).toBe('acked');
      expect(freshOutcome.effect?.deduplicated).toBe(true);
      expect((await ackRow(eventId))?.processed_at).not.toBeNull();
      expect((await alertsByReceipt(eventId)).length).toBe(1);

      evidence.push({
        case: 'AC3a-stale-ack-fence',
        eventId,
        oldOutcome: staleOutcome.outcome,
        newOutcome: freshOutcome.outcome,
        generations: [claimA.lease.generation, claimB.lease.generation],
        alerts: 1,
      });
    });

    it('AC3b — processo real: crash após o efeito e antes do ACK; retomada não duplica', async () => {
      // O teste de processo roda no fim: limpa pendências para que o crash
      // aconteça deterministicamente no evento semeado.
      await pool.query('DELETE FROM outbox_consumer_acks');
      await pool.query('DELETE FROM outbox_events');

      const tag = `prod09-ac3b-${randomUUID()}`;
      const conversationId = await insertConversation(tag);
      const eventId = `${tag}-evt`;
      const correlationId = `${tag}-corr`;
      const piiMarker = `pii-${randomUUID()}`;
      await seedOutboxEvent({
        eventId,
        eventType: 'handoff.completed',
        payload: handoffPayload(conversationId, piiMarker),
        correlationId,
        conversationId,
        createdAt: new Date('2000-01-01T00:00:00.000Z'),
      });

      const crashed = startWorkerProcess({
        WORKER_OWNER: `${tag}-w1`,
        WORKER_FAULT_AFTER_EFFECT: 'crash',
      });
      const crashedExit = await waitForExit(crashed, 60_000);
      const crashedOutput = crashed.output();
      expect(crashedOutput).not.toBe('');
      expect(crashedExit, `worker #1 deveria encerrar pelo crash injetado; saída:\n${crashedOutput}`).not.toBeNull();
      expect(crashedExit!.code, `saída do worker #1:\n${crashedOutput}`).toBe(86);
      childLogs.push(`[worker-w1]\n${crashedOutput}`);
      expect(crashedOutput).toContain('crashing after effect before ACK');
      expect(crashedOutput).not.toContain('Successfully processed event');

      const afterCrash = await ackRow(eventId);
      expect(afterCrash?.processed_at).toBeNull();
      expect(afterCrash?.lease_owner).toBe(`${tag}-w1`);
      expect(await receiptCount(eventId)).toBe(1);
      expect((await alertsByReceipt(eventId)).length).toBe(1);
      expect((await alertsByReceipt(eventId))[0]!.message).toContain(piiMarker);

      await expireLease(eventId);
      const resumed = startWorkerProcess({ WORKER_OWNER: `${tag}-w2` });
      const resumedOk = await waitFor(async () => (await ackRow(eventId))?.processed_at != null, 60_000);
      expect(resumedOk, 'worker #2 deveria concluir o evento reclamado').toBe(true);
      resumed.child.kill('SIGTERM');
      const resumedExit = await waitForExit(resumed, 30_000);
      expect(resumedExit?.code).toBe(0);
      const resumedOutput = resumed.output();
      childLogs.push(`[worker-w2]\n${resumedOutput}`);
      writeFileSync(join(LOG_DIR, 'worker-prod-09-process.log'), childLogs.join('\n'));

      const finishedAck = await ackRow(eventId);
      expect(finishedAck?.generation).toBeGreaterThanOrEqual(2);
      expect(finishedAck?.lease_owner).toBe(`${tag}-w2`);
      expect(await receiptCount(eventId)).toBe(1);
      expect((await alertsByReceipt(eventId)).length).toBe(1);
      expect(await alertEventCountForReceipt(eventId)).toBe(1);
      expect(resumedOutput).toContain(eventId);
      expect(resumedOutput).toContain(correlationId);
      expect(resumedOutput).toContain('"effect_status":"deduplicated"');
      expect(resumedOutput).not.toContain(piiMarker);

      evidence.push({
        case: 'AC3b-crash-real-processo',
        eventId,
        crashedExitCode: crashedExit!.code,
        resumedExitCode: resumedExit?.code ?? null,
        generations: [afterCrash?.generation ?? null, finishedAck?.generation ?? null],
        receipts: 1,
        alerts: 1,
        alertEvents: 1,
        piiInLogs: resumedOutput.includes(piiMarker),
      });
    });
  });

  describe('AC4 — observabilidade: retry/DLQ/recuperação e ausência de PII', () => {
    it('AC4a — logs têm eventId/correlation e não carregam conteúdo do payload', async () => {
      const tag = `prod09-ac4a-${randomUUID()}`;
      const conversationId = await insertConversation(tag);
      const eventId = `${tag}-evt`;
      const correlationId = `${tag}-corr`;
      const piiMarker = `pii-${randomUUID()}`;
      await seedOutboxEvent({
        eventId,
        eventType: 'secretary.invocation',
        payload: { conversationId, status: 'failed', action: 'respond', errorMessage: piiMarker },
        correlationId,
        conversationId,
      });

      const reader = makeReader(3);
      const { processEvent, logs } = makeProcessor(reader);
      const claimed = await reader.claim({ owner: `${tag}-a`, leaseSeconds: 30, limit: 10 });
      const outcome = await processEvent(claimed[0]!.event, claimed[0]!.lease);
      expect(outcome.outcome).toBe('acked');

      const processing = logs.find((record) => record.msg === '[Worker] Processing event');
      const success = logs.find((record) => record.msg === '[Worker] Successfully processed event');
      expect(processing?.event_id).toBe(eventId);
      expect(processing?.correlation_id).toBe(correlationId);
      expect(success?.event_id).toBe(eventId);
      expect(success?.correlation_id).toBe(correlationId);
      expect(success?.effect_type).toBe(SECRETARY_EFFECT);
      expect(success?.effect_status).toBe('applied');
      expect(success?.ack_result).toBe('acked');

      const serialized = JSON.stringify(logs);
      expect(serialized).not.toContain(piiMarker);
      expect(serialized).not.toContain('errorMessage');
      // O efeito persistente (negócio) preserva a causa; os logs não.
      expect((await alertsByReceipt(eventId))[0]!.message).toContain(piiMarker);

      evidence.push({
        case: 'AC4a-logs-sem-pii',
        eventId,
        logFields: { event_id: true, correlation_id: true, effect_type: true, ack_result: true },
        piiInLogs: false,
        piiInEffect: true,
      });
    });

    it('AC4b — registros distinguem retry, dead-letter e recuperação', async () => {
      const tag = `prod09-ac4b-${randomUUID()}`;
      const conversationId = await insertConversation(tag);
      const retryEventId = `${tag}-retry`;
      await seedOutboxEvent({
        eventId: retryEventId,
        eventType: 'secretary.invocation',
        payload: { conversationId, status: 'failed', action: 'respond', errorMessage: `transitória ${tag}` },
        conversationId,
      });
      await armAlertFailure(1);

      const reader = makeReader(2);
      const { processEvent } = makeProcessor(reader);
      const claimA = await reader.claim({ owner: `${tag}-a`, leaseSeconds: 30, limit: 10 });
      const retryTarget = claimA.find((item) => item.event.event_id === retryEventId)!;
      const first = await processEvent(retryTarget.event, retryTarget.lease);
      expect(first.outcome).toBe('retry');
      const retryRecord = await ackRow(retryEventId);
      expect(retryRecord?.processed_at).toBeNull();
      expect(retryRecord?.retry_count).toBe(1);
      expect(retryRecord?.last_error).toBeTruthy();

      const dlqEventId = `${tag}-dlq`;
      await seedOutboxEvent({
        eventId: dlqEventId,
        eventType: 'handoff.completed',
        payload: handoffPayload(conversationId, tag),
        conversationId,
      });
      await armAlertFailure(999);
      const claimB = await reader.claim({ owner: `${tag}-b`, leaseSeconds: 30, limit: 10 });
      const target = claimB.find((item) => item.event.event_id === dlqEventId)!;
      const firstDlq = await processEvent(target.event, target.lease);
      expect(firstDlq.outcome).toBe('retry');
      const claimC = await reader.claim({ owner: `${tag}-c`, leaseSeconds: 30, limit: 10 });
      const secondTarget = claimC.find((item) => item.event.event_id === dlqEventId)!;
      const secondDlq = await processEvent(secondTarget.event, secondTarget.lease);
      expect(secondDlq.outcome).toBe('dead-letter');
      await disarmAlertFailures();

      const dlq = await deadLetterFor(dlqEventId);
      expect(dlq?.status).toBe('PENDING');
      const sourceEvent = dlq!.payload;
      const replayed = await persistentDeadLetterStore.claimForReplay(dlq!.id);
      expect(replayed?.status).toBe('REPLAYING');
      const resolved = await persistentDeadLetterStore.markReplayed(dlq!.id);
      expect(resolved?.status).toBe('RESOLVED');
      expect(resolved?.replayCount).toBe(1);
      expect(resolved?.resolutionReason).toBe('replayed');
      const after = await deadLetterFor(dlqEventId);
      expect(after?.payload).toEqual(sourceEvent);

      evidence.push({
        case: 'AC4b-estados',
        retryEventId,
        retryRecord: { processedAtNull: true, retryCount: 1, lastError: true },
        dlqEventId,
        dlqStatus: 'PENDING',
        replayClaim: 'REPLAYING',
        replayFinal: `${resolved?.status} (replayCount=${resolved?.replayCount})`,
        sourceEventImmutable: true,
      });
    });
  });
});
