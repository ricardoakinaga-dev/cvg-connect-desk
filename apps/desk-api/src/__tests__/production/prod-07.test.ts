/**
 * PROD-07 — Recibo de webhook recuperável sem enfraquecer anti-replay.
 *
 * Prova real em PostgreSQL isolado do harness AAA (run `prod07-20260913`,
 * worker 11, `cvg_aaa_prod07_20260913_w11`), HTTP real via `app.inject` do
 * app de produção (`buildDeskApiApp`) — nunca o banco do host:
 *
 *   AC1 — falha injetada por trigger APÓS HMAC/timestamp válidos e ANTES do
 *         commit do negócio: o retry do MESMO evento persiste a mensagem uma
 *         única vez; evento concluído não reexecuta efeito (ACK 2xx);
 *   AC2 — recibo pending/failed/completed vinculado a payload_hash e à
 *         assinatura da tentativa, claim atômico sob concorrência, erro transitório do
 *         store responde 5xx (não 409) e HMAC/timestamp/skew permanecem;
 *   AC3 — dedup por identidade E payload; replay/mismatch sem efeito;
 *         negativos de assinatura/timestamp/bytes exatos não criam recibo;
 *   AC4 — log/estado distinguem recuperação (claimed_retry), repetição
 *         (duplicate) e ataque (mismatch); TTL de 24h preservado.
 *
 * Limitação registrada: sem sandbox real do Gateway/Evolution neste ambiente a
 * política de redelivery do provider não é exercitada; o contrato HTTP local
 * (2xx/409/5xx + reason) é o artefato observado.
 */
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RunContext } from '../../../../../e2e/support/aaa/run-context.ts';

interface PgQueryResult<R> {
  rows: R[];
  rowCount: number | null;
}

interface PgClientLike {
  connect(): Promise<unknown>;
  query<R = Record<string, unknown>>(text: string, values?: unknown[]): Promise<PgQueryResult<R>>;
  end(): Promise<void>;
}

type PgPoolLike = PgClientLike;

interface PgRuntime {
  Client: new (config: { connectionString: string }) => PgClientLike;
  Pool: new (config: { connectionString: string; max?: number }) => PgPoolLike;
}

interface Harness {
  teardownIsolatedEnv: (
    ctx: RunContext,
    options?: { stopServices?: boolean; dropDatabase?: boolean },
  ) => Record<string, unknown>;
}

interface ReplayRow {
  event_id: string;
  state: string;
  payload_hash: string | null;
  signature_hash: string;
  attempts: number;
  completed_at: string | null;
  processed_at: string;
  expires_at: string;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../../..');
const PROGRAM_DIR = process.env.CVG_PROGRAM_DIR || join(REPO_ROOT, 'docs', 'producao-2026-09-13');
const EVIDENCE_SEGMENT = process.env.CVG_EVIDENCE_SEGMENT?.trim();
const EVIDENCE_DIR = join(
  PROGRAM_DIR,
  'evidencias',
  'prod-07',
  ...(EVIDENCE_SEGMENT ? [EVIDENCE_SEGMENT] : []),
);
const LOG_DIR = join(EVIDENCE_DIR, 'logs');
const RUNTIME_DIR = process.env.CVG_RUNTIME_DIR || join(EVIDENCE_DIR, 'runtime');
const MIGRATIONS_DIR = join(REPO_ROOT, 'packages', 'database', 'supabase', 'migrations');
const RUN_ID = process.env.AAA_RUN_ID || 'prod07-20260913';
const WORKER_INDEX = Number(process.env.AAA_WORKER_INDEX || '11');
const WEBHOOK_SECRET = 'prod07-webhook-secret';

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

vi.setConfig({ testTimeout: 120_000, hookTimeout: 600_000 });

const evidence: Array<Record<string, unknown>> = [];

let ctx: RunContext;
let isolatedEnv: { databaseName: string; marker: { runId: string } };
let pg: PgRuntime;
let harness: Harness;
let pool: PgPoolLike;
let app: FastifyInstance | null = null;
let databaseModulePool: PgPoolLike | undefined;

function writeEvidenceJson(name: string, value: unknown): void {
  writeFileSync(join(EVIDENCE_DIR, name), `${JSON.stringify(value, null, 2)}\n`);
}

function databaseUrl(): string {
  return `postgresql://cvg_aaa@127.0.0.1:${ctx.ports.postgres}/${isolatedEnv.databaseName}`;
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

/** Hashes como o guard calcula: sha256(hex da assinatura) e sha256(rawBody). */
function claimHashes(rawBody: string, timestamp: number): { signatureHash: string; payloadHash: string } {
  return {
    signatureHash: createHash('sha256').update(signRawBody(rawBody, timestamp), 'utf8').digest('hex'),
    payloadHash: createHash('sha256').update(rawBody, 'utf8').digest('hex'),
  };
}

/** Corpo com bytes exatos (não canônico): a assinatura cobre ESTA string. */
function bodyFor(messageId: string, conversationId: string, content: string): string {
  return `{"messageId":"${messageId}","conversationId":"${conversationId}","from":"+5511999000711","content":"${content}","timestamp":"2026-09-13T12:00:00.000Z"}`;
}

async function postWebhook(rawBody: string, headers: Record<string, string>) {
  if (!app) throw new Error('app não inicializado');
  return app.inject({
    method: 'POST',
    url: '/webhook/inbound',
    headers: { 'content-type': 'application/json', ...headers },
    payload: rawBody,
  });
}

async function replayRow(eventId: string): Promise<ReplayRow | undefined> {
  const result = await pool.query<ReplayRow>('SELECT * FROM webhook_replay_log WHERE event_id = $1', [eventId]);
  return result.rows[0];
}

async function messageCount(externalMessageId: string): Promise<number> {
  const result = await pool.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM messages WHERE external_message_id = $1',
    [externalMessageId],
  );
  return result.rows[0]?.n ?? 0;
}

async function effectCounts(externalMessageId: string): Promise<{
  messages: number;
  messagePersistedEvents: number;
  conversationCreatedEvents: number;
  unread: number;
}> {
  const messages = await pool.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM messages WHERE external_message_id = $1',
    [externalMessageId],
  );
  const outbox = await pool.query<{ n: number; created: number; unread: number }>(
    `SELECT
       (SELECT count(*)::int FROM outbox_events o
          JOIN messages m ON m.id = o.aggregate_id::uuid
         WHERE o.event_type = 'message.persisted' AND m.external_message_id = $1) AS n,
       (SELECT count(*)::int FROM outbox_events o
          JOIN conversations c ON c.id = o.aggregate_id::uuid
         WHERE o.event_type = 'conversation.created'
           AND c.external_conversation_id = (SELECT c2.external_conversation_id FROM messages m2
                                               JOIN conversations c2 ON c2.id = m2.conversation_id
                                              WHERE m2.external_message_id = $1 LIMIT 1)) AS created,
       (SELECT COALESCE(max(c3.unread_count), 0)::int FROM conversations c3
          JOIN messages m3 ON m3.conversation_id = c3.id
         WHERE m3.external_message_id = $1) AS unread`,
    [externalMessageId],
  );
  return {
    messages: messages.rows[0]?.n ?? 0,
    messagePersistedEvents: outbox.rows[0]?.n ?? 0,
    conversationCreatedEvents: outbox.rows[0]?.created ?? 0,
    unread: outbox.rows[0]?.unread ?? 0,
  };
}

async function insertManualReplay(input: {
  eventId: string;
  signatureHash: string;
  payloadHash: string;
  state: 'pending';
  processedAtSql: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO webhook_replay_log (event_id, signature_hash, state, payload_hash, attempts, processed_at, expires_at)
     VALUES ($1, $2, $3, $4, 1, ${input.processedAtSql}, NOW() + INTERVAL '24 hours')`,
    [input.eventId, input.signatureHash, input.state, input.payloadHash],
  );
}

async function setupFaultInjection(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS prod07_fault_gate (
      message_id TEXT PRIMARY KEY,
      fail_remaining INTEGER NOT NULL
    );
    CREATE OR REPLACE FUNCTION prod07_fail_insert() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE remaining integer;
    BEGIN
      SELECT fail_remaining INTO remaining FROM prod07_fault_gate WHERE message_id = NEW.external_message_id;
      IF remaining IS NOT NULL AND remaining > 0 THEN
        UPDATE prod07_fault_gate SET fail_remaining = remaining - 1 WHERE message_id = NEW.external_message_id;
        RAISE EXCEPTION 'prod07 injected business failure';
      END IF;
      RETURN NEW;
    END;
    $$;
    DROP TRIGGER IF EXISTS prod07_fail_messages ON messages;
    CREATE TRIGGER prod07_fail_messages BEFORE INSERT ON messages
      FOR EACH ROW EXECUTE FUNCTION prod07_fail_insert();
  `);
}

async function armFault(messageId: string): Promise<void> {
  await pool.query(
    `INSERT INTO prod07_fault_gate (message_id, fail_remaining) VALUES ($1, 1)
     ON CONFLICT (message_id) DO UPDATE SET fail_remaining = 1`,
    [messageId],
  );
}

beforeAll(async () => {
  mkdirSync(LOG_DIR, { recursive: true });
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
  if (isolatedEnv.marker.runId !== RUN_ID) {
    throw new Error(`marcador do run divergente: ${isolatedEnv.marker.runId}`);
  }
  process.env.DATABASE_URL = databaseUrl();

  pool = new pg.Pool({ connectionString: databaseUrl(), max: 6 });

  const { drizzle } = await import('drizzle-orm/node-postgres');
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  await migrate(drizzle(pool as never) as never, { migrationsFolder: MIGRATIONS_DIR });
  await setupFaultInjection();

  const appModule = await import('../../app.ts');
  app = await appModule.buildDeskApiApp();
  await app.ready();

  const databaseModule = await import('../../../../../packages/database/src/index.ts');
  databaseModulePool = databaseModule.getPool() as unknown as PgPoolLike;
});

afterAll(async () => {
  writeEvidenceJson('webhook-replay-evidence.json', {
    generatedAt: new Date().toISOString(),
    runId: RUN_ID,
    workerIndex: WORKER_INDEX,
    database: isolatedEnv?.databaseName,
    postgresPort: ctx?.ports.postgres,
    cases: evidence,
  });
  // F4: `app.close()` não encerra o singleton do @cvg/events. O subscriber do
  // RealtimeBus (criado por publishRealtimeHintsAfterCommit durante o teste)
  // precisa ser fechado ANTES do teardown do Redis; caso contrário o socket
  // cai junto com o serviço e o @redis/client emite erro não tratado.
  try {
    const eventsModule = await import('@cvg/events');
    await eventsModule.stopSharedRealtimeBus();
  } catch {
    // Barramento é best-effort; o teardown do runner cobre o restante.
  }
  if (app) {
    await app.close().catch(() => undefined);
  }
  if (databaseModulePool) {
    await databaseModulePool.end().catch(() => undefined);
  }
  if (pool) {
    await pool.end().catch(() => undefined);
  }
  if (ctx && harness) {
    harness.teardownIsolatedEnv(ctx, { stopServices: true, dropDatabase: true });
  }
});

describe('PROD-07 — recibo de webhook recuperável (HTTP + PostgreSQL reais)', () => {
  it('AC1 — falha injetada após HMAC válido e o retry persistem a mensagem uma única vez', async () => {
    const suffix = randomUUID();
    const eventId = `prod07-retry-${suffix}`;
    const messageId = `prod07-retry-msg-${suffix}`;
    const conversationId = `prod07-retry-conv-${suffix}`;
    const rawBody = bodyFor(messageId, conversationId, 'recuperacao');
    await armFault(messageId);

    const first = await postWebhook(rawBody, signedHeaders(rawBody, eventId));
    expect(first.statusCode).toBe(500);
    const afterFailure = await replayRow(eventId);
    expect(afterFailure?.state).toBe('failed');
    expect(await messageCount(messageId)).toBe(0);

    // O gate de falha vive DENTRO da transação do negócio; o rollback restaura
    // o contador. Desarmar aqui representa a causa transitória cessando antes
    // do próximo redelivery do gateway.
    await pool.query('DELETE FROM prod07_fault_gate WHERE message_id = $1', [messageId]);

    // Retry legítimo do MESMO evento/assinatura: recuperação, não 409.
    const retry = await postWebhook(rawBody, signedHeaders(rawBody, eventId));
    expect(retry.statusCode).toBe(200);
    const retryBody = retry.json() as { success: boolean; messageId: string };
    expect(retryBody.success).toBe(true);

    const counts = await effectCounts(messageId);
    expect(counts.messages).toBe(1);
    expect(counts.messagePersistedEvents).toBe(1);
    expect(counts.conversationCreatedEvents).toBe(1);
    expect(counts.unread).toBe(1);

    const completed = await replayRow(eventId);
    expect(completed?.state).toBe('completed');
    expect(completed?.completed_at).not.toBeNull();
    expect(Number(completed?.attempts)).toBeGreaterThanOrEqual(2);

    evidence.push({
      case: 'AC1-falha-retry',
      eventId,
      messageId,
      firstStatus: first.statusCode,
      firstState: afterFailure?.state,
      retryStatus: retry.statusCode,
      finalState: completed?.state,
      attempts: completed?.attempts,
      counts,
    });
  });

  it('AC1 — crash após o commit do negócio (recibo pending) retoma sem duplicar a mensagem', async () => {
    const suffix = randomUUID();
    const eventId = `prod07-postcommit-${suffix}`;
    const messageId = `prod07-postcommit-msg-${suffix}`;
    const conversationId = `prod07-postcommit-conv-${suffix}`;
    const rawBody = bodyFor(messageId, conversationId, 'crash pos-commit');
    const timestamp = Math.floor(Date.now() / 1000);

    // Estado que um crash entre o commit do negócio e o `complete` deixaria:
    // mensagem durável + recibo pending envelhecido.
    await pool.query(
      `INSERT INTO conversations (external_conversation_id, external_channel_id, status, is_active)
       VALUES ($1, 'whatsapp', 'open', true)`,
      [conversationId],
    );
    await pool.query(
      `INSERT INTO messages (conversation_id, direction, content, external_message_id, status, created_at)
       SELECT id, 'inbound', 'crash pos-commit', $1, 'pending', NOW() FROM conversations
        WHERE external_conversation_id = $2`,
      [messageId, conversationId],
    );
    await insertManualReplay({
      eventId,
      ...claimHashes(rawBody, timestamp),
      state: 'pending',
      processedAtSql: "NOW() - INTERVAL '10 minutes'",
    });

    const retry = await postWebhook(rawBody, signedHeaders(rawBody, eventId, timestamp));
    expect(retry.statusCode).toBe(200);
    expect((retry.json() as { messageId: string }).messageId).toBeTypeOf('string');

    const counts = await effectCounts(messageId);
    expect(counts.messages).toBe(1);
    // Nenhum evento novo é gravado: o negócio já havia commitado no crash.
    expect(counts.messagePersistedEvents).toBe(0);
    const row = await replayRow(eventId);
    expect(row?.state).toBe('completed');
    expect(Number(row?.attempts)).toBe(2);

    evidence.push({
      case: 'AC1-crash-pos-commit',
      eventId,
      retryStatus: retry.statusCode,
      counts,
      finalState: row?.state,
      attempts: row?.attempts,
    });
  });

  it('AC3 — replay verdadeiro após completed recebe ACK idempotente sem novo efeito', async () => {
    const suffix = randomUUID();
    const eventId = `prod07-replay-${suffix}`;
    const messageId = `prod07-replay-msg-${suffix}`;
    const conversationId = `prod07-replay-conv-${suffix}`;
    const rawBody = bodyFor(messageId, conversationId, 'replay');
    const headers = signedHeaders(rawBody, eventId);

    const first = await postWebhook(rawBody, headers);
    expect(first.statusCode).toBe(200);
    const completed = await replayRow(eventId);
    const attemptsAfterFirst = Number(completed?.attempts);

    const replay = await postWebhook(rawBody, headers);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ success: true, deduplicated: true, eventId });

    const counts = await effectCounts(messageId);
    expect(counts.messages).toBe(1);
    expect(counts.messagePersistedEvents).toBe(1);
    expect(Number((await replayRow(eventId))?.attempts)).toBe(attemptsAfterFirst);

    evidence.push({
      case: 'AC3-replay-completed',
      eventId,
      firstStatus: first.statusCode,
      replayStatus: replay.statusCode,
      replayDeduplicated: (replay.json() as { deduplicated: boolean }).deduplicated,
      counts,
      attemptsAfterFirst,
    });
  });

  it('AC3 — mesmo eventId com payload diferente é rejeitado (mismatch) sem efeito', async () => {
    const suffix = randomUUID();
    const eventId = `prod07-mismatch-${suffix}`;
    const messageIdA = `prod07-mismatch-a-${suffix}`;
    const messageIdB = `prod07-mismatch-b-${suffix}`;
    const rawBodyA = bodyFor(messageIdA, `prod07-mismatch-conv-${suffix}`, 'payload A');
    const rawBodyB = bodyFor(messageIdB, `prod07-mismatch-conv-${suffix}`, 'payload B');

    const first = await postWebhook(rawBodyA, signedHeaders(rawBodyA, eventId));
    expect(first.statusCode).toBe(200);
    const hashA = (await replayRow(eventId))?.payload_hash;

    const mismatch = await postWebhook(rawBodyB, signedHeaders(rawBodyB, eventId));
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json()).toMatchObject({ error: 'CONFLICT', reason: 'event_payload_mismatch' });

    expect(await messageCount(messageIdA)).toBe(1);
    expect(await messageCount(messageIdB)).toBe(0);
    const row = await replayRow(eventId);
    expect(row?.payload_hash).toBe(hashA);
    expect(row?.state).toBe('completed');

    evidence.push({
      case: 'AC3-mismatch',
      eventId,
      firstStatus: first.statusCode,
      mismatchStatus: mismatch.statusCode,
      mismatchReason: (mismatch.json() as { reason: string }).reason,
      messageIdACount: await messageCount(messageIdA),
      messageIdBCount: await messageCount(messageIdB),
    });
  });

  it('AC1/AC2 — crash entre claim e commit (pending stale) recupera; pending recente é in_progress', async () => {
    const suffix = randomUUID();
    const staleEventId = `prod07-stale-${suffix}`;
    const inProgressEventId = `prod07-inprogress-${suffix}`;
    const staleMessageId = `prod07-stale-msg-${suffix}`;
    const inProgressMessageId = `prod07-inprogress-msg-${suffix}`;
    const staleRawBody = bodyFor(staleMessageId, `prod07-stale-conv-${suffix}`, 'crash');
    const inProgressRawBody = bodyFor(inProgressMessageId, `prod07-inprogress-conv-${suffix}`, 'em andamento');
    const staleTimestamp = Math.floor(Date.now() / 1000);
    const inProgressTimestamp = Math.floor(Date.now() / 1000);

    await insertManualReplay({
      eventId: staleEventId,
      ...claimHashes(staleRawBody, staleTimestamp),
      state: 'pending',
      processedAtSql: "NOW() - INTERVAL '10 minutes'",
    });
    await insertManualReplay({
      eventId: inProgressEventId,
      ...claimHashes(inProgressRawBody, inProgressTimestamp),
      state: 'pending',
      processedAtSql: 'NOW()',
    });

    const inProgress = await postWebhook(
      inProgressRawBody,
      signedHeaders(inProgressRawBody, inProgressEventId, inProgressTimestamp),
    );
    expect(inProgress.statusCode).toBe(409);
    expect(inProgress.json()).toMatchObject({ reason: 'event_in_progress' });
    expect(await messageCount(inProgressMessageId)).toBe(0);

    const recovered = await postWebhook(
      staleRawBody,
      signedHeaders(staleRawBody, staleEventId, staleTimestamp),
    );
    expect(recovered.statusCode).toBe(200);
    expect(await messageCount(staleMessageId)).toBe(1);
    const staleRow = await replayRow(staleEventId);
    expect(staleRow?.state).toBe('completed');
    expect(Number(staleRow?.attempts)).toBe(2);

    evidence.push({
      case: 'AC1-crash-stale-e-in-progress',
      staleEventId,
      inProgressEventId,
      inProgressStatus: inProgress.statusCode,
      inProgressReason: (inProgress.json() as { reason: string }).reason,
      recoveredStatus: recovered.statusCode,
      staleAttempts: staleRow?.attempts,
      staleState: staleRow?.state,
    });
  });

  it('AC2 — entregas concorrentes do mesmo evento produzem um único efeito', async () => {
    const suffix = randomUUID();
    const eventId = `prod07-concurrent-${suffix}`;
    const messageId = `prod07-concurrent-msg-${suffix}`;
    const rawBody = bodyFor(messageId, `prod07-concurrent-conv-${suffix}`, 'concorrencia');
    const headers = signedHeaders(rawBody, eventId);

    const [first, second] = await Promise.all([
      postWebhook(rawBody, headers),
      postWebhook(rawBody, headers),
    ]);
    const statuses = [first.statusCode, second.statusCode].sort();
    expect(statuses.every((status) => status === 200 || status === 409)).toBe(true);
    expect(statuses.filter((status) => status === 200).length).toBeGreaterThanOrEqual(1);
    const duplicate = [first, second].find((response) => response.json().deduplicated === true);
    const rejected = first.statusCode === 409 ? first : second;
    if (rejected.statusCode === 409) {
      expect((rejected.json() as { reason: string }).reason).toBe('event_in_progress');
    }
    if (duplicate) {
      expect(duplicate.json()).toMatchObject({ success: true, deduplicated: true, eventId });
    }

    const counts = await effectCounts(messageId);
    expect(counts.messages).toBe(1);
    expect(counts.messagePersistedEvents).toBe(1);

    evidence.push({
      case: 'AC2-concorrencia',
      eventId,
      statuses,
      rejectedReason: rejected.statusCode === 409 ? (rejected.json() as { reason: string }).reason : null,
      counts,
    });
  });

  it('AC2 — erro transitório do store responde 5xx (nunca 409) e o retry consolida', async () => {
    const suffix = randomUUID();
    const eventId = `prod07-dberror-${suffix}`;
    const messageId = `prod07-dberror-msg-${suffix}`;
    const rawBody = bodyFor(messageId, `prod07-dberror-conv-${suffix}`, 'db fora');
    const headers = signedHeaders(rawBody, eventId);

    await pool.query('ALTER TABLE webhook_replay_log RENAME TO prod07_replay_backup');
    let broken;
    try {
      broken = await postWebhook(rawBody, headers);
    } finally {
      await pool.query('ALTER TABLE prod07_replay_backup RENAME TO webhook_replay_log');
    }
    expect(broken.statusCode).toBe(500);
    expect((broken.json() as { reason?: string }).reason).toBeUndefined();
    expect(await messageCount(messageId)).toBe(0);

    const retry = await postWebhook(rawBody, headers);
    expect(retry.statusCode).toBe(200);
    expect(await messageCount(messageId)).toBe(1);
    expect((await replayRow(eventId))?.state).toBe('completed');

    evidence.push({
      case: 'AC2-erro-transitorio',
      eventId,
      brokenStatus: broken.statusCode,
      brokenBody: broken.json(),
      retryStatus: retry.statusCode,
      finalState: (await replayRow(eventId))?.state,
    });
  });

  it('AC3 — negativos de assinatura/timestamp/bytes exatos não criam recibo nem efeito', async () => {
    const suffix = randomUUID();
    const signatureEventId = `prod07-badsig-${suffix}`;
    const timestampEventId = `prod07-oldts-${suffix}`;
    const futureEventId = `prod07-futurets-${suffix}`;
    const exactBytesEventId = `prod07-exact-${suffix}`;
    const signatureMessageId = `prod07-badsig-msg-${suffix}`;
    const timestampMessageId = `prod07-oldts-msg-${suffix}`;
    const futureMessageId = `prod07-futurets-msg-${suffix}`;
    const exactMessageId = `prod07-exact-msg-${suffix}`;

    const signatureRaw = bodyFor(signatureMessageId, `prod07-badsig-conv-${suffix}`, 'assinatura errada');
    const invalidSignature = await postWebhook(signatureRaw, {
      'x-webhook-signature': `sha256=${'0'.repeat(64)}`,
      'x-webhook-timestamp': String(Math.floor(Date.now() / 1000)),
      'x-webhook-event-id': signatureEventId,
    });
    expect(invalidSignature.statusCode).toBe(401);
    expect(invalidSignature.json()).toMatchObject({ reason: 'invalid_signature' });

    const oldRaw = bodyFor(timestampMessageId, `prod07-oldts-conv-${suffix}`, 'timestamp antigo');
    const oldTimestamp = Math.floor(Date.now() / 1000) - 3600;
    const old = await postWebhook(oldRaw, signedHeaders(oldRaw, timestampEventId, oldTimestamp));
    expect(old.statusCode).toBe(401);
    expect(old.json()).toMatchObject({ reason: 'timestamp_too_old' });

    const futureRaw = bodyFor(futureMessageId, `prod07-futurets-conv-${suffix}`, 'timestamp futuro');
    const futureTimestamp = Math.floor(Date.now() / 1000) + 3600;
    const future = await postWebhook(futureRaw, signedHeaders(futureRaw, futureEventId, futureTimestamp));
    expect(future.statusCode).toBe(401);
    expect(future.json()).toMatchObject({ reason: 'timestamp_too_future' });

    // Bytes exatos: assinatura de rawBody, envio de rawBody + espaço extra.
    const exactRaw = bodyFor(exactMessageId, `prod07-exact-conv-${suffix}`, 'bytes exatos');
    const exact = await postWebhook(`${exactRaw} `, signedHeaders(exactRaw, exactBytesEventId));
    expect(exact.statusCode).toBe(401);
    expect(exact.json()).toMatchObject({ reason: 'invalid_signature' });

    for (const [eventId, messageId] of [
      [signatureEventId, signatureMessageId],
      [timestampEventId, timestampMessageId],
      [futureEventId, futureMessageId],
      [exactBytesEventId, exactMessageId],
    ] as const) {
      expect(await replayRow(eventId), `recibo não deve existir para ${eventId}`).toBeUndefined();
      expect(await messageCount(messageId), `mensagem não deve existir para ${messageId}`).toBe(0);
    }

    evidence.push({
      case: 'AC3-negativos',
      invalidSignature: { status: invalidSignature.statusCode, reason: (invalidSignature.json() as { reason: string }).reason },
      oldTimestamp: { status: old.statusCode, reason: (old.json() as { reason: string }).reason },
      futureTimestamp: { status: future.statusCode, reason: (future.json() as { reason: string }).reason },
      exactBytes: { status: exact.statusCode, reason: (exact.json() as { reason: string }).reason },
    });
  });

  it('AC4 — TTL de 24h preservado e recibo concluído registra hashes/completed_at/attempts', async () => {
    const suffix = randomUUID();
    const eventId = `prod07-ttl-${suffix}`;
    const messageId = `prod07-ttl-msg-${suffix}`;
    const rawBody = bodyFor(messageId, `prod07-ttl-conv-${suffix}`, 'ttl');
    const timestamp = Math.floor(Date.now() / 1000);
    const response = await postWebhook(rawBody, signedHeaders(rawBody, eventId, timestamp));
    expect(response.statusCode).toBe(200);

    const row = await replayRow(eventId);
    const expected = claimHashes(rawBody, timestamp);
    expect(row?.payload_hash).toBe(expected.payloadHash);
    expect(row?.signature_hash).toBe(expected.signatureHash);
    expect(row?.state).toBe('completed');
    expect(Number(row?.attempts)).toBe(1);

    const ttl = await pool.query<{ hours_to_expiry: number; completed_before_expiry: boolean }>(
      `SELECT EXTRACT(EPOCH FROM (expires_at - NOW())) / 3600 AS hours_to_expiry,
              completed_at <= expires_at AS completed_before_expiry
         FROM webhook_replay_log WHERE event_id = $1`,
      [eventId],
    );
    const hours = Number(ttl.rows[0]?.hours_to_expiry);
    expect(hours).toBeGreaterThan(23);
    expect(hours).toBeLessThanOrEqual(24);
    expect(ttl.rows[0]?.completed_before_expiry).toBe(true);

    evidence.push({
      case: 'AC4-ttl-e-estado',
      eventId,
      state: row?.state,
      attempts: row?.attempts,
      payloadHash: row?.payload_hash,
      hoursToExpiry: Number(hours.toFixed(2)),
      completedBeforeExpiry: ttl.rows[0]?.completed_before_expiry,
    });
  });
});
