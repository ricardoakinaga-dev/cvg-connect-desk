/**
 * PROD-06 — Harmonizar schema e timezone; preparar evolução relacional.
 *
 * Prova real em PostgreSQL isolado (harness AAA) + Redis do run
 * `prod06-20260913` (worker 8), nunca no banco do host:
 *   AC1 — confronto schema.ts × DDL real, timestamptz de sessão e instantes
 *         históricos preservados em UTC e America/Sao_Paulo (rotação/expiração);
 *   AC2 — invariantes de FK/unique/delete, migration fresh e upgrade de cópia
 *         populada como caminhos independentes, drift/checksum bloqueando
 *         readiness, e `db:migrate`/`db:check` reais;
 *   AC3 — inventário tutor_patients N:N × patients.tutor_id com proposta D03
 *         (N:N NÃO implementado; decisão permanece OPEN);
 *   AC4 — 0023 numerada e ensaio de interrupção/restart/roll-forward sem editar
 *         SQL já aplicado (baseline 0000-0022 conferido por hash).
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { getTableConfig } from 'drizzle-orm/pg-core';
import * as schemaModule from '../../../../../packages/database/src/schema.ts';
import { webhookReplayLog } from '../../../../../packages/database/src/webhook-replay.ts';
import {
  checkDatabaseReadiness,
  listExpectedMigrations,
} from '../../../../../packages/database/src/check-migrations.ts';
import type { RunContext } from '../../../../../e2e/support/aaa/run-context.ts';

/**
 * Facade mínima do driver `pg`. O teste roda no programa do @cvg/desk-api, que
 * não declara @types/pg; o harness e o driver são carregados por import
 * dinâmico computado para não trazê-los ao programa TypeScript do app.
 */
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

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../../..');
const PROGRAM_DIR = process.env.CVG_PROGRAM_DIR || join(REPO_ROOT, 'docs', 'producao-2026-09-13');
const EVIDENCE_SEGMENT = process.env.CVG_EVIDENCE_SEGMENT?.trim();
const PROD00_EVIDENCE_SEGMENT = process.env.CVG_PROD00_EVIDENCE_SEGMENT?.trim();
const EVIDENCE_DIR = join(
  PROGRAM_DIR,
  'evidencias',
  'prod-06',
  ...(EVIDENCE_SEGMENT ? [EVIDENCE_SEGMENT] : []),
);
const LOG_DIR = join(EVIDENCE_DIR, 'logs');
const RUNTIME_DIR = process.env.CVG_RUNTIME_DIR || join(EVIDENCE_DIR, 'runtime');
const MIGRATIONS_DIR = join(REPO_ROOT, 'packages', 'database', 'supabase', 'migrations');
const SCHEMA_PATH = join(REPO_ROOT, 'packages', 'database', 'src', 'schema.ts');
function resolveBaselineLedger(): string {
  const root = join(PROGRAM_DIR, 'evidencias', 'prod-00');
  if (PROD00_EVIDENCE_SEGMENT) {
    return join(root, PROD00_EVIDENCE_SEGMENT, 'baseline', 'migration-ledger.txt');
  }

  const candidates = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const directory = join(root, entry.name);
      const ledger = join(directory, 'baseline', 'migration-ledger.txt');
      const manifest = join(directory, 'manifest.json');
      const candidateManifest = join(directory, 'baseline', 'candidate-manifest.json');
      const mtime = existsSync(candidateManifest)
        ? statSync(candidateManifest).mtimeMs
        : existsSync(manifest)
          ? statSync(manifest).mtimeMs
          : 0;
      return { ledger, mtime, name: entry.name };
    })
    .filter((candidate) => existsSync(candidate.ledger))
    .sort((left, right) => right.mtime - left.mtime || right.name.localeCompare(left.name));

  if (candidates.length > 0) return candidates[0].ledger;
  return join(root, 'baseline', 'migration-ledger.txt');
}

const BASELINE_LEDGER = resolveBaselineLedger();
const D03_PROPOSAL_SOURCE = join(PROGRAM_DIR, 'D03-PROPOSTA.md');
const RUN_ID = process.env.AAA_RUN_ID || 'prod06-20260913';
const WORKER_INDEX = Number(process.env.AAA_WORKER_INDEX || '8');

process.env.CVG_PROGRAM_DIR = PROGRAM_DIR;
process.env.CVG_RUNTIME_DIR = RUNTIME_DIR;
process.env.AAA_RUN_ID = RUN_ID;
process.env.AAA_WORKER_INDEX = String(WORKER_INDEX);

// O provisionamento/migração real é mais lento que o default do Vitest.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 600_000 });

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

const journal = JSON.parse(
  readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8'),
) as { entries: JournalEntry[] };
const journalEntries = [...journal.entries].sort((a, b) => a.idx - b.idx);
const UPGRADE_BOUNDARY_IDX = 18;
const INTERRUPT_BOUNDARY_IDX = 22;

const SUFFIX = `${RUN_ID.replace(/-/g, '_')}_w${WORKER_INDEX}`;
const DB = {
  fresh: `cvg_aaa_${SUFFIX}_fresh`,
  upgrade: `cvg_aaa_${SUFFIX}_upgrade`,
  drift: `cvg_aaa_${SUFFIX}_drift`,
  interrupt: `cvg_aaa_${SUFFIX}_interrupt`,
  cli: `cvg_aaa_${SUFFIX}_cli`,
  check: `cvg_aaa_${SUFFIX}_check`,
};

/** Valores históricos usados em AC1.3 (anteriores a 2026 para serem "legado"). */
const HISTORICAL = {
  createdAt: Date.UTC(2020, 2, 10, 14, 45, 30, 250),
  expiresAt: Date.UTC(2020, 2, 17, 14, 45, 30, 250),
  absoluteExpiresAt: Date.UTC(2020, 3, 9, 14, 45, 30, 250),
  lastSeenAt: Date.UTC(2020, 2, 15, 9, 0, 0, 0),
  revokedAt: Date.UTC(2020, 2, 16, 10, 11, 12, 345),
} as const;

/**
 * Drift conhecido e documentado em schema-confronto.json, fora do escopo de
 * correção do PROD-06 (o aceite corrige timestamps de sessão):
 *   - 4 enums de status declarados no drizzle cujo DDL real usa TEXT + CHECK;
 *   - webhook_replay_log.processed_at/expires_at declarados sem fuso, enquanto
 *     0013 usa TIMESTAMPTZ (arquivo webhook-replay.ts não pertence ao lock).
 */
const KNOWN_ENUM_TEXT_DRIFT = [
  'ai_action_approvals.status',
  'dead_letter_events.status',
  'media_assets.scan_status',
  'media_assets.storage_status',
  'outbound_deliveries.status',
];
const KNOWN_TIMESTAMP_DRIFT = ['webhook_replay_log.expires_at', 'webhook_replay_log.processed_at'];

const SESSION_TZ_COLUMNS = [
  'last_seen_at',
  'absolute_expires_at',
  'revoked_at',
  'expires_at',
  'created_at',
];

let ctx: RunContext;
let isolatedEnv: { databaseName: string; marker: { runId: string } };
let pg: PgRuntime;
let harness: Harness;
let adminPool: PgPoolLike;
let freshPool: PgPoolLike;
let upgradePool: PgPoolLike;
let driftPool: PgPoolLike;
let interruptPool: PgPoolLike;
let freshDb: ReturnType<typeof drizzle>;
let upgradeDb: ReturnType<typeof drizzle>;
let driftDb: ReturnType<typeof drizzle>;
let interruptDb: ReturnType<typeof drizzle>;
let databaseModulePool: PgPoolLike | undefined;

const createdOwnedDatabases = [DB.fresh, DB.upgrade, DB.drift, DB.interrupt, DB.cli];

const legacyUpgrade = {
  sessionId: '',
  expiresEpoch: 0,
  createdEpoch: 0,
  userIds: [] as string[],
  messageId: '',
  conversationId: '',
};

function databaseUrl(name: string): string {
  return `postgresql://cvg_aaa@127.0.0.1:${ctx.ports.postgres}/${name}`;
}

function makePool(url: string): PgPoolLike {
  return new pg.Pool({ connectionString: url, max: 4 });
}

function newClient(url: string): PgClientLike {
  return new pg.Client({ connectionString: url });
}

function makeDrizzle(pool: PgPoolLike): ReturnType<typeof drizzle> {
  return drizzle(pool as never);
}

function writeLog(label: string, content: string): void {
  writeFileSync(join(LOG_DIR, `${label}.log`), content.endsWith('\n') ? content : `${content}\n`);
}

function writeEvidenceJson(name: string, value: unknown): void {
  writeFileSync(join(EVIDENCE_DIR, name), `${JSON.stringify(value, null, 2)}\n`);
}

function materializeD03Proposal(): void {
  const legacyProposal = join(PROGRAM_DIR, 'evidencias', 'prod-06', 'D03-PROPOSTA.md');
  const source = existsSync(D03_PROPOSAL_SOURCE) ? D03_PROPOSAL_SOURCE : legacyProposal;
  if (!existsSync(source)) {
    throw new Error(`proposta D03 ausente: ${D03_PROPOSAL_SOURCE}`);
  }
  writeFileSync(join(EVIDENCE_DIR, 'D03-PROPOSTA.md'), readFileSync(source));
}

function runCommand(
  label: string,
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): ReturnType<typeof spawnSync> {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, ...env },
  });
  writeLog(
    label,
    [
      `$ ${command} ${args.join(' ')}`,
      `exit=${result.status ?? 'null'} signal=${result.signal ?? 'none'}`,
      result.stdout ?? '',
      result.stderr ?? '',
    ].join('\n'),
  );
  return result;
}

async function createOwnedDatabase(name: string): Promise<void> {
  await adminPool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await adminPool.query(`CREATE DATABASE "${name}"`);
}

async function dropOwnedDatabases(): Promise<void> {
  for (const name of [...createdOwnedDatabases, DB.check]) {
    await adminPool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  }
}

async function applyMigrationsThrough(client: PgClientLike, maxIdx: number): Promise<void> {
  await client.query('CREATE SCHEMA IF NOT EXISTS drizzle');
  await client.query(
    'CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)',
  );
  for (const entry of journalEntries.filter((candidate) => candidate.idx <= maxIdx)) {
    const sqlText = readFileSync(join(MIGRATIONS_DIR, `${entry.tag}.sql`), 'utf8');
    for (const statement of sqlText.split('--> statement-breakpoint')) {
      if (statement.trim().length === 0) continue;
      await client.query(statement);
    }
    const hash = createHash('sha256').update(sqlText).digest('hex');
    await client.query(
      'INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)',
      [hash, entry.when],
    );
  }
}

async function ledgerRows(client: PgClientLike): Promise<Array<{ hash: string; created_at: string }>> {
  const result = await client.query<{ hash: string; created_at: string }>(
    'SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id ASC',
  );
  return result.rows;
}

async function columnTypes(client: PgClientLike): Promise<Map<string, string>> {
  const result = await client.query<{ table_name: string; column_name: string; data_type: string }>(
    `SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public'`,
  );
  return new Map(result.rows.map((row) => [`${row.table_name}.${row.column_name}`, row.data_type]));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

/** SIGKILL no grupo do processo, ignorando corrida com saída normal. */
function killProcessGroup(child: { pid?: number; signalCode: string | null }): void {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    // ESRCH: o grupo já terminou (inclusive por sinal).
  }
}

function expectedAndRealTimestamp(
  declaredSqlType: string,
  dataType: string,
): { declared: string; real: string } {
  const declared = declaredSqlType.replace(/\s+/g, ' ').trim();
  const real = dataType;
  return { declared, real };
}

beforeAll(async () => {
  mkdirSync(LOG_DIR, { recursive: true });
  materializeD03Proposal();
  // Imports computados: o harness vive fora do pacote e não pertence ao
  // programa TypeScript do @cvg/desk-api (não declara @types/pg).
  const runContextSpecifier = '../../../../../e2e/support/aaa/run-context.ts';
  const isolatedEnvSpecifier = '../../../../../e2e/support/aaa/isolated-env.ts';
  const pgSpecifier = 'pg';
  const runContextModule = (await import(/* @vite-ignore */ runContextSpecifier)) as {
    getRunContext: (workerIndex?: number) => RunContext;
  };
  const isolatedEnvModule = (await import(/* @vite-ignore */ isolatedEnvSpecifier)) as {
    provisionIsolatedEnv: (context: RunContext) => Promise<{
      databaseName: string;
      marker: { runId: string };
    }>;
    teardownIsolatedEnv: Harness['teardownIsolatedEnv'];
  };
  const pgModule = (await import(/* @vite-ignore */ pgSpecifier)) as {
    default?: PgRuntime;
  };
  pg = (pgModule.default ?? (pgModule as unknown as PgRuntime)) as PgRuntime;
  harness = { teardownIsolatedEnv: isolatedEnvModule.teardownIsolatedEnv };

  ctx = runContextModule.getRunContext(WORKER_INDEX);
  isolatedEnv = await isolatedEnvModule.provisionIsolatedEnv(ctx);
  if (isolatedEnv.marker.runId !== RUN_ID) {
    throw new Error(`marcador do run divergente: ${isolatedEnv.marker.runId}`);
  }

  adminPool = makePool(`postgresql://cvg_aaa@127.0.0.1:${ctx.ports.postgres}/postgres`);
  for (const name of createdOwnedDatabases) {
    await createOwnedDatabase(name);
  }

  freshPool = makePool(databaseUrl(DB.fresh));
  upgradePool = makePool(databaseUrl(DB.upgrade));
  driftPool = makePool(databaseUrl(DB.drift));
  interruptPool = makePool(databaseUrl(DB.interrupt));
  freshDb = makeDrizzle(freshPool);
  upgradeDb = makeDrizzle(upgradePool);
  driftDb = makeDrizzle(driftPool);
  interruptDb = makeDrizzle(interruptPool);

  // Caminho fresh completo (0000..0023) e base do probe de drift.
  await migrate(freshDb, { migrationsFolder: MIGRATIONS_DIR });
  await migrate(driftDb, { migrationsFolder: MIGRATIONS_DIR });

  // Caminho upgrade: cópia "implantada" em 0018, populada, depois migrada.
  const upgradeClient = newClient(databaseUrl(DB.upgrade));
  await upgradeClient.connect();
  try {
    await applyMigrationsThrough(upgradeClient, UPGRADE_BOUNDARY_IDX);
    const user = await upgradeClient.query<{ id: string }>(
      `INSERT INTO users (name, email, password_hash)
       VALUES ('PROD06 legado', 'prod06.legacy@example.test', 'x') RETURNING id`,
    );
    const secondUser = await upgradeClient.query<{ id: string }>(
      `INSERT INTO users (name, email, password_hash)
       VALUES ('PROD06 legado 2', 'prod06.legacy2@example.test', 'x') RETURNING id`,
    );
    legacyUpgrade.userIds = [user.rows[0].id, secondUser.rows[0].id];
    const role = await upgradeClient.query<{ id: string }>(
      `INSERT INTO roles (name) VALUES ('PROD06 legado role') RETURNING id`,
    );
    const permission = await upgradeClient.query<{ id: string }>(
      `INSERT INTO permissions (name) VALUES ('prod06:legacy') RETURNING id`,
    );
    await upgradeClient.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [
      user.rows[0].id,
      role.rows[0].id,
    ]);
    await upgradeClient.query(
      'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)',
      [role.rows[0].id, permission.rows[0].id],
    );
    const tutor = await upgradeClient.query<{ id: string }>(
      `INSERT INTO tutors (name) VALUES ('PROD06 tutor legado') RETURNING id`,
    );
    const patient = await upgradeClient.query<{ id: string }>(
      `INSERT INTO patients (name, tutor_id) VALUES ('PROD06 paciente legado', $1) RETURNING id`,
      [tutor.rows[0].id],
    );
    const contact = await upgradeClient.query<{ id: string }>(
      `INSERT INTO contacts (name, tutor_id, patient_id) VALUES ('PROD06 contato legado', $1, $2) RETURNING id`,
      [tutor.rows[0].id, patient.rows[0].id],
    );
    const sector = await upgradeClient.query<{ id: string }>(
      `INSERT INTO sectors (name, code) VALUES ('PROD06 setor legado', 'prod06-legacy') RETURNING id`,
    );
    const conversation = await upgradeClient.query<{ id: string }>(
      `INSERT INTO conversations (contact_id, sector_id) VALUES ($1, $2) RETURNING id`,
      [contact.rows[0].id, sector.rows[0].id],
    );
    legacyUpgrade.conversationId = conversation.rows[0].id;
    const message = await upgradeClient.query<{ id: string }>(
      `INSERT INTO messages (conversation_id, direction, content, created_at)
       VALUES ($1, 'outbound', 'mensagem legada prod-06', '2026-08-01 12:00:00') RETURNING id`,
      [conversation.rows[0].id],
    );
    legacyUpgrade.messageId = message.rows[0].id;
    await upgradeClient.query(
      `INSERT INTO outbound_deliveries (internal_message_id, idempotency_key, provider, status, created_at)
       VALUES ($1, 'prod06-legacy-key', 'evolution', 'sent', '2026-08-01 12:00:00')`,
      [message.rows[0].id],
    );
    await upgradeClient.query(
      `INSERT INTO outbox_events (event_id, event_type, aggregate_type, aggregate_id, occurred_at, payload)
       VALUES ('prod06-legacy-event', 'prod06.legacy', 'conversation', $1, '2026-08-01 12:00:00', '{}')`,
      [conversation.rows[0].id],
    );
    await upgradeClient.query(
      `INSERT INTO dead_letter_events (original_event_id, consumer_id, event_type, payload)
       VALUES ('prod06-legacy-dlq', 'prod06-consumer', 'prod06.legacy', '{}')`,
    );
    const session = await upgradeClient.query<{ id: string }>(
      `INSERT INTO sessions (user_id, token, expires_at, created_at)
       VALUES ($1, 'prod06-legacy-session', '2031-01-15 12:00:00', '2026-09-01 08:00:00')
       RETURNING id`,
      [user.rows[0].id],
    );
    legacyUpgrade.sessionId = session.rows[0].id;
    const epochs = await upgradeClient.query<{ expires_epoch: string; created_epoch: string }>(
      `SELECT extract(epoch FROM '2031-01-15 12:00:00'::timestamp AT TIME ZONE 'UTC') AS expires_epoch,
              extract(epoch FROM '2026-09-01 08:00:00'::timestamp AT TIME ZONE current_setting('TimeZone')) AS created_epoch`,
    );
    legacyUpgrade.expiresEpoch = Math.round(Number(epochs.rows[0].expires_epoch) * 1000);
    legacyUpgrade.createdEpoch = Math.round(Number(epochs.rows[0].created_epoch) * 1000);
  } finally {
    await upgradeClient.end();
  }
  await migrate(upgradeDb, { migrationsFolder: MIGRATIONS_DIR });

  // Caminho interrupção: parado antes da 0023, com uma sessão legada.
  const interruptClient = newClient(databaseUrl(DB.interrupt));
  await interruptClient.connect();
  try {
    await applyMigrationsThrough(interruptClient, INTERRUPT_BOUNDARY_IDX);
    const user = await interruptClient.query<{ id: string }>(
      `INSERT INTO users (name, email, password_hash)
       VALUES ('PROD06 interrupt', 'prod06.interrupt@example.test', 'x') RETURNING id`,
    );
    await interruptClient.query(
      `INSERT INTO sessions (user_id, token, expires_at, created_at)
       VALUES ($1, 'prod06-interrupt-session', '2032-02-02 10:00:00', '2026-02-02 10:00:00')`,
      [user.rows[0].id],
    );
  } finally {
    await interruptClient.end();
  }

  // Caminhos CLI reais contra o PG isolado: db:migrate e db:check.
  const migrateCli = runCommand(
    'db-migrate-cli',
    'pnpm',
    ['--filter', '@cvg/database', 'run', 'db:migrate'],
    { DATABASE_URL: databaseUrl(DB.cli) },
    180_000,
  );
  if (migrateCli.status !== 0) {
    throw new Error(`db:migrate falhou: ${migrateCli.stdout}\n${migrateCli.stderr}`);
  }
  const checkCli = runCommand(
    'db-check-cli',
    'pnpm',
    ['--filter', '@cvg/database', 'run', 'db:check'],
    {
      DATABASE_URL: `postgresql://cvg_aaa@127.0.0.1:${ctx.ports.postgres}/postgres`,
      MIGCHECK_DB: DB.check,
    },
    180_000,
  );
  if (checkCli.status !== 0) {
    throw new Error(`db:check falhou: ${checkCli.stdout}\n${checkCli.stderr}`);
  }
});

afterAll(async () => {
  if (databaseModulePool) {
    await databaseModulePool.end().catch(() => undefined);
  }
  for (const pool of [freshPool, upgradePool, driftPool, interruptPool]) {
    await pool?.end().catch(() => undefined);
  }
  if (adminPool) {
    await dropOwnedDatabases().catch(() => undefined);
    await adminPool.end().catch(() => undefined);
  }
  if (ctx && harness) {
    harness.teardownIsolatedEnv(ctx, { stopServices: true, dropDatabase: true });
  }
});

describe('PROD-06 AC1 — confronto schema × DDL e timezone de sessão', () => {
  it('AC1.1 confronta o schema completo com o DDL real; sessões são timestamptz', async () => {
    const client = newClient(databaseUrl(DB.fresh));
    await client.connect();
    let report: Record<string, unknown>;
    try {
      const real = await client.query<{
        table_name: string;
        column_name: string;
        data_type: string;
        udt_name: string;
        character_maximum_length: number | null;
      }>(
        `SELECT table_name, column_name, data_type, udt_name, character_maximum_length
           FROM information_schema.columns WHERE table_schema = 'public'`,
      );
      const realByKey = new Map(
        real.rows.map((row) => [`${row.table_name}.${row.column_name}`, row]),
      );

      const declared: Array<{ table: string; column: string; sqlType: string }> = [];
      for (const value of [...Object.values(schemaModule), webhookReplayLog]) {
        let config: ReturnType<typeof getTableConfig>;
        try {
          config = getTableConfig(value as Parameters<typeof getTableConfig>[0]);
        } catch {
          continue;
        }
        if (!config?.name) continue;
        for (const column of config.columns) {
          declared.push({ table: config.name, column: column.name, sqlType: column.getSQLType() });
        }
      }

      const normalizeDeclared = (sqlType: string): string => {
        const trimmed = sqlType.replace(/\s+/g, ' ').trim();
        if (trimmed.startsWith('varchar(')) {
          return `character varying(${trimmed.slice('varchar('.length, -1)})`;
        }
        if (trimmed === 'timestamp') return 'timestamp without time zone';
        if (trimmed === 'timestamp with time zone') return 'timestamp with time zone';
        return trimmed;
      };
      const normalizeReal = (row: {
        data_type: string;
        udt_name: string;
        character_maximum_length: number | null;
      }): string => {
        if (row.data_type === 'character varying') {
          return `character varying(${row.character_maximum_length})`;
        }
        if (row.data_type === 'USER-DEFINED') return row.udt_name;
        return row.data_type;
      };

      const typeMismatches: Array<{
        table: string;
        column: string;
        declared: string;
        real: string;
      }> = [];
      for (const column of declared) {
        const realColumn = realByKey.get(`${column.table}.${column.column}`);
        if (!realColumn) {
          typeMismatches.push({
            table: column.table,
            column: column.column,
            declared: column.sqlType,
            real: 'missing',
          });
          continue;
        }
        const { declared: declaredType, real: realType } = expectedAndRealTimestamp(
          column.sqlType,
          normalizeReal(realColumn),
        );
        if (normalizeDeclared(declaredType) !== realType) {
          typeMismatches.push({
            table: column.table,
            column: column.column,
            declared: normalizeDeclared(declaredType),
            real: realType,
          });
        }
      }

      const mismatchedKeys = typeMismatches
        .map((item) => `${item.table}.${item.column}`)
        .sort();
      const timestampMismatches = typeMismatches.filter(
        (item) => item.declared.startsWith('timestamp') || item.real.startsWith('timestamp'),
      );
      const enumTextMismatches = typeMismatches.filter(
        (item) => !item.declared.startsWith('timestamp') && !item.real.startsWith('timestamp'),
      );
      expect(timestampMismatches.map((item) => `${item.table}.${item.column}`).sort()).toEqual(
        KNOWN_TIMESTAMP_DRIFT,
      );
      expect(enumTextMismatches.map((item) => `${item.table}.${item.column}`).sort()).toEqual(
        [...KNOWN_ENUM_TEXT_DRIFT].sort(),
      );
      const markerColumns = real.rows.filter(
        (row) => row.table_name === 'aaa_environment_marker',
      ).length;
      // Os bancos `_fresh` não carregam a tabela-marcador do harness; o DDL
      // confrontado é o do run isolado, sem ajuste de contagem.
      expect(markerColumns).toBe(0);
      expect(declared.length).toBe(real.rows.length);

      const sessionTypes = await columnTypes(client);
      for (const column of SESSION_TZ_COLUMNS) {
        expect(sessionTypes.get(`sessions.${column}`)).toBe('timestamp with time zone');
      }
      expect((schemaModule.sessions.expiresAt as { withTimezone?: boolean }).withTimezone).toBe(true);
      expect((schemaModule.sessions.createdAt as { withTimezone?: boolean }).withTimezone).toBe(true);
      expect((schemaModule.sessions.lastSeenAt as { withTimezone?: boolean }).withTimezone).toBe(true);
      expect((schemaModule.sessions.absoluteExpiresAt as { withTimezone?: boolean }).withTimezone).toBe(true);
      expect((schemaModule.sessions.revokedAt as { withTimezone?: boolean }).withTimezone).toBe(true);

      // Tabelas/colunas reais sem declaração drizzle (marcador do harness é esperado).
      const declaredKeys = new Set(declared.map((item) => `${item.table}.${item.column}`));
      const undeclared = real.rows
        .map((row) => `${row.table_name}.${row.column_name}`)
        .filter((key) => !declaredKeys.has(key) && !key.startsWith('aaa_environment_marker.'))
        .sort();
      expect(undeclared).toEqual([]);

      const sessionsInReport = Object.fromEntries(
        SESSION_TZ_COLUMNS.map((column) => [column, sessionTypes.get(`sessions.${column}`)]),
      );
      report = {
        generatedAt: new Date().toISOString(),
        runId: RUN_ID,
        database: isolatedEnv.databaseName,
        counts: { declaredColumns: declared.length, realColumns: real.rows.length },
        knownDrift: {
          enumDeclaredTextInDdl: KNOWN_ENUM_TEXT_DRIFT,
          timestampDeclaredWithoutTimezone: KNOWN_TIMESTAMP_DRIFT,
        },
        timestampMismatches,
        enumTextMismatches,
        mismatchedKeys,
        sessions: sessionsInReport,
      };
    } finally {
      await client.end();
    }
    writeEvidenceJson('schema-confronto.json', report);
  });

  it('AC1.2 FKs declaradas existem no DDL real (incluindo resolved_by da 0023)', async () => {
    const client = newClient(databaseUrl(DB.fresh));
    await client.connect();
    try {
      const real = await client.query<{ tbl: string; def: string; validated: boolean }>(
        `SELECT conrelid::regclass::text AS tbl,
                pg_get_constraintdef(oid) AS def,
                convalidated AS validated
           FROM pg_constraint
          WHERE contype = 'f' AND connamespace = 'public'::regnamespace`,
      );
      const declaredFks: Array<{
        table: string;
        columns: string[];
        referenceTable: string;
        referenceColumns: string[];
      }> = [];
      for (const value of [...Object.values(schemaModule), webhookReplayLog]) {
        let config: ReturnType<typeof getTableConfig>;
        try {
          config = getTableConfig(value as Parameters<typeof getTableConfig>[0]);
        } catch {
          continue;
        }
        if (!config?.name) continue;
        for (const foreignKey of config.foreignKeys ?? []) {
          const reference = foreignKey.reference();
          declaredFks.push({
            table: config.name,
            columns: reference.columns.map((column) => column.name),
            referenceTable: getTableConfig(
              reference.foreignTable as Parameters<typeof getTableConfig>[0],
            ).name,
            referenceColumns: reference.foreignColumns.map((column) => column.name),
          });
        }
      }

      const missing: string[] = [];
      for (const fk of declaredFks) {
        const expected = `FOREIGN KEY (${fk.columns.join(', ')}) REFERENCES ${fk.referenceTable}(${fk.referenceColumns.join(', ')})`;
        const found = real.rows.some(
          (row) =>
            row.tbl.replace(/^public\./, '') === fk.table
            && row.def.toUpperCase().includes(expected.toUpperCase()),
        );
        if (!found) missing.push(`${fk.table}(${fk.columns.join(',')}) -> ${fk.referenceTable}`);
      }
      expect(missing).toEqual([]);

      const resolvedBy = real.rows.find(
        (row) =>
          row.tbl.replace(/^public\./, '') === 'dead_letter_events'
          && row.def.toUpperCase().startsWith('FOREIGN KEY (RESOLVED_BY)'),
      );
      expect(resolvedBy).toBeDefined();
      expect(resolvedBy?.validated).toBe(true);
    } finally {
      await client.end();
    }
  });

  it('AC1.3 preserva instantes históricos em UTC e America/Sao_Paulo e nos deadlines', async () => {
    const tokenSuffix = randomUUID();
    const [user] = await freshDb
      .insert(schemaModule.users)
      .values({
        name: 'PROD06 TZ',
        email: `prod06.tz.${tokenSuffix}@example.test`,
        passwordHash: 'x',
      })
      .returning();
    const [session] = await freshDb
      .insert(schemaModule.sessions)
      .values({
        userId: user.id,
        token: `prod06-tz-${tokenSuffix}`,
        lastSeenAt: new Date(HISTORICAL.lastSeenAt),
        absoluteExpiresAt: new Date(HISTORICAL.absoluteExpiresAt),
        revokedAt: new Date(HISTORICAL.revokedAt),
        expiresAt: new Date(HISTORICAL.expiresAt),
        createdAt: new Date(HISTORICAL.createdAt),
      })
      .returning();

    const expectedByColumn: Record<string, number> = {
      created_at: HISTORICAL.createdAt,
      expires_at: HISTORICAL.expiresAt,
      absolute_expires_at: HISTORICAL.absoluteExpiresAt,
      last_seen_at: HISTORICAL.lastSeenAt,
      revoked_at: HISTORICAL.revokedAt,
    };

    for (const timezone of ['UTC', 'America/Sao_Paulo']) {
      const client = newClient(databaseUrl(DB.fresh));
      await client.connect();
      try {
        await client.query("SELECT set_config('TimeZone', $1, false)", [timezone]);
        const read = await client.query<Record<string, string>>(
          `SELECT extract(epoch FROM created_at) * 1000 AS created_at,
                  extract(epoch FROM expires_at) * 1000 AS expires_at,
                  extract(epoch FROM absolute_expires_at) * 1000 AS absolute_expires_at,
                  extract(epoch FROM last_seen_at) * 1000 AS last_seen_at,
                  extract(epoch FROM revoked_at) * 1000 AS revoked_at
             FROM sessions WHERE id = $1`,
          [session.id],
        );
        for (const [column, epoch] of Object.entries(expectedByColumn)) {
          expect(
            Math.round(Number(read.rows[0][column])),
            `${column} em ${timezone}`,
          ).toBe(epoch);
        }
      } finally {
        await client.end();
      }
    }

    const [mapped] = await freshDb
      .select()
      .from(schemaModule.sessions)
      .where(eq(schemaModule.sessions.id, session.id));
    expect(mapped.createdAt.getTime()).toBe(HISTORICAL.createdAt);
    expect(mapped.expiresAt?.getTime()).toBe(HISTORICAL.expiresAt);
    expect(mapped.absoluteExpiresAt?.getTime()).toBe(HISTORICAL.absoluteExpiresAt);
    expect(mapped.lastSeenAt?.getTime()).toBe(HISTORICAL.lastSeenAt);
    expect(mapped.revokedAt?.getTime()).toBe(HISTORICAL.revokedAt);

    // Cliente real com TZ America/Sao_Paulo lendo o schema.ts real via drizzle.
    const childCode = [
      'const run = async () => {',
      "  const pg = (await import('pg')).default;",
      "  const { drizzle } = await import('drizzle-orm/node-postgres');",
      "  const { eq } = await import('drizzle-orm');",
      `  const schema = await import(${JSON.stringify(pathToFileURL(SCHEMA_PATH).href)});`,
      '  const pool = new pg.Pool({ connectionString: process.env.CHILD_DB_URL });',
      '  const db = drizzle(pool);',
      '  const [row] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, process.env.CHILD_SESSION_ID));',
      "  console.log('PROD06_CHILD ' + JSON.stringify({",
      '    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,',
      '    createdAt: row.createdAt.getTime(),',
      '    expiresAt: row.expiresAt.getTime(),',
      '    absoluteExpiresAt: row.absoluteExpiresAt.getTime(),',
      '    lastSeenAt: row.lastSeenAt.getTime(),',
      '    revokedAt: row.revokedAt.getTime(),',
      '    expiresWithTimezone: schema.sessions.expiresAt.withTimezone,',
      '  }));',
      '  await pool.end();',
      '};',
      'run().catch((error) => { console.error(String(error)); process.exit(1); });',
    ].join('\n');
    const child = spawnSync(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', childCode],
      {
        cwd: join(REPO_ROOT, 'packages', 'database'),
        encoding: 'utf8',
        timeout: 60_000,
        env: {
          ...process.env,
          TZ: 'America/Sao_Paulo',
          CHILD_DB_URL: databaseUrl(DB.fresh),
          CHILD_SESSION_ID: session.id,
        },
      },
    );
    writeLog(
      'tz-child-america-sao-paulo',
      [`exit=${child.status ?? 'null'} signal=${child.signal ?? 'none'}`, child.stdout ?? '', child.stderr ?? ''].join('\n'),
    );
    expect(child.status).toBe(0);
    const childLine = (child.stdout ?? '').split('\n').find((line) => line.startsWith('PROD06_CHILD '));
    expect(childLine).toBeDefined();
    const childRead = JSON.parse((childLine ?? '').slice('PROD06_CHILD '.length)) as Record<
      string,
      number | string | boolean
    >;
    expect(childRead.timezone).toBe('America/Sao_Paulo');
    expect(childRead.expiresWithTimezone).toBe(true);
    for (const [column, epoch] of Object.entries(expectedByColumn)) {
      expect(childRead[column.replace(/_(\w)/g, (_match, letter: string) => letter.toUpperCase())]).toBe(epoch);
    }

    // Deadlines derivados dos valores lidos do banco (UTC acima, BR no child).
    const { evaluateSession } = await import('../../../../../packages/auth/src/session-policy.ts');
    const principal = { id: user.id, email: user.email, name: user.name, isActive: true };
    const sessionLike = {
      id: session.id,
      userId: user.id,
      createdAt: mapped.createdAt,
      expiresAt: mapped.expiresAt,
      absoluteExpiresAt: mapped.absoluteExpiresAt,
      lastSeenAt: new Date(HISTORICAL.expiresAt - 1000),
      revokedAt: null,
    };
    expect(
      evaluateSession(sessionLike, principal, new Date(HISTORICAL.expiresAt - 1)).ok,
    ).toBe(true);
    expect(
      evaluateSession(sessionLike, principal, new Date(HISTORICAL.expiresAt)),
    ).toMatchObject({ ok: false, reason: 'expired' });

    const absoluteSession = {
      ...sessionLike,
      expiresAt: new Date(HISTORICAL.absoluteExpiresAt + 3_600_000),
      lastSeenAt: new Date(HISTORICAL.absoluteExpiresAt - 1000),
    };
    expect(
      evaluateSession(absoluteSession, principal, new Date(HISTORICAL.absoluteExpiresAt)),
    ).toMatchObject({ ok: false, reason: 'absolute_expired' });

    const idleSession = { ...sessionLike, lastSeenAt: new Date(HISTORICAL.lastSeenAt) };
    const idleBoundary = new Date(HISTORICAL.lastSeenAt + 24 * 60 * 60 * 1000);
    expect(evaluateSession(idleSession, principal, new Date(idleBoundary.getTime() - 1)).ok).toBe(
      true,
    );
    expect(evaluateSession(idleSession, principal, idleBoundary)).toMatchObject({
      ok: false,
      reason: 'idle',
    });
  });

  it('AC1.4 rotação/expiração pelo repositório real preserva o deadline absoluto', async () => {
    process.env.DATABASE_URL = databaseUrl(DB.fresh);
    const databaseModule = await import('../../../../../packages/database/src/index.ts');
    databaseModulePool = databaseModule.getPool();
    const { authRepository } = await import(
      '../../../../../packages/auth/src/infrastructure/repositories/auth.repository.ts'
    );

    const [user] = await freshDb
      .insert(schemaModule.users)
      .values({
        name: 'PROD06 rotate',
        email: `prod06.rotate.${randomUUID()}@example.test`,
        passwordHash: 'x',
      })
      .returning();

    const token = await authRepository.createSession(user.id);
    const beforeRotation = await authRepository.findSessionByToken(token);
    expect(beforeRotation).not.toBeNull();

    const now = new Date();
    const rotated = await authRepository.rotateSession(token, now);
    expect(rotated.ok).toBe(true);
    if (!rotated.ok) return;

    const oldSession = await authRepository.findSessionByToken(token);
    expect(oldSession?.revokedAt?.getTime()).toBe(now.getTime());

    const newSession = await authRepository.findSessionByToken(rotated.token);
    expect(newSession).not.toBeNull();
    // C01: a rotação não estende o deadline absoluto.
    expect(newSession?.absoluteExpiresAt?.getTime()).toBe(beforeRotation?.absoluteExpiresAt?.getTime());
    const expectedExpiresAt = Math.min(
      now.getTime() + 7 * 24 * 60 * 60 * 1000,
      beforeRotation?.absoluteExpiresAt?.getTime() ?? Number.POSITIVE_INFINITY,
    );
    expect(newSession?.expiresAt?.getTime()).toBe(expectedExpiresAt);
    expect(newSession?.lastSeenAt?.getTime()).toBe(now.getTime());

    const secondRotation = await authRepository.rotateSession(token, now);
    expect(secondRotation).toMatchObject({ ok: false, reason: 'invalid_token' });

    const expiredToken = await authRepository.createSession(
      user.id,
      new Date(now.getTime() - 3_600_000),
    );
    const expiredRotation = await authRepository.rotateSession(expiredToken, now);
    expect(expiredRotation).toMatchObject({ ok: false, reason: 'expired' });
  });
});

describe('PROD-06 AC2 — invariantes, migração fresh/upgrade e readiness', () => {
  it('AC2.1 fresh: ledger completo, hashes conferem e readiness saudável', async () => {
    const client = newClient(databaseUrl(DB.fresh));
    await client.connect();
    try {
      const expected = listExpectedMigrations(MIGRATIONS_DIR);
      const applied = await ledgerRows(client);
      expect(applied.length).toBe(expected.length);
      expect(applied.map((row) => row.hash)).toEqual(expected.map((entry) => entry.hash));
      expect(expected.length).toBe(journalEntries.length);
    } finally {
      await client.end();
    }
    const readiness = await checkDatabaseReadiness({
      connectionString: databaseUrl(DB.fresh),
      migrationsFolder: MIGRATIONS_DIR,
      timeoutMs: 5_000,
    });
    expect(readiness.migrations.status).toBe('ok');
    expect(readiness.migrations.applied).toBe(readiness.migrations.expected);
  });

  it('AC2.2 violações de FK/unique falham e delete cascateia arquivando tombstone', async () => {
    const violationCode = async (work: () => Promise<unknown>): Promise<string> => {
      try {
        await work();
        return 'no-error';
      } catch (error) {
        const direct = (error as { code?: string }).code;
        if (direct) return direct;
        const cause = (error as { cause?: { code?: string } }).cause;
        return cause?.code ?? 'unknown';
      }
    };

    const [user] = await freshDb
      .insert(schemaModule.users)
      .values({ name: 'PROD06 inv', email: `prod06.inv.${randomUUID()}@example.test`, passwordHash: 'x' })
      .returning();
    const [role] = await freshDb
      .insert(schemaModule.roles)
      .values({ name: `PROD06 role ${randomUUID()}` })
      .returning();
    const [permission] = await freshDb
      .insert(schemaModule.permissions)
      .values({ name: `prod06:inv:${randomUUID()}` })
      .returning();
    await freshDb.insert(schemaModule.userRoles).values({ userId: user.id, roleId: role.id });
    await freshDb
      .insert(schemaModule.rolePermissions)
      .values({ roleId: role.id, permissionId: permission.id });

    expect(
      await violationCode(() =>
        freshDb.insert(schemaModule.userRoles).values({ userId: user.id, roleId: role.id }),
      ),
    ).toBe('23505');
    expect(
      await violationCode(() =>
        freshDb
          .insert(schemaModule.rolePermissions)
          .values({ roleId: role.id, permissionId: permission.id }),
      ),
    ).toBe('23505');
    const duplicateSession = async (): Promise<void> => {
      const [first] = await freshDb
        .insert(schemaModule.sessions)
        .values({ userId: user.id, token: `prod06-dup-${randomUUID()}` })
        .returning();
      await freshDb.insert(schemaModule.sessions).values({ userId: user.id, token: first.token });
    };
    expect(await violationCode(duplicateSession)).toBe('23505');
    const duplicateEvent = async (): Promise<void> => {
      const event = {
        eventId: `prod06-dup-event-${randomUUID()}`,
        eventType: 'prod06.dup',
        aggregateType: 'test',
        aggregateId: 'test',
        occurredAt: new Date(),
        payload: '{}',
      };
      await freshDb.insert(schemaModule.outboxEvents).values(event);
      await freshDb.insert(schemaModule.outboxEvents).values(event);
    };
    expect(await violationCode(duplicateEvent)).toBe('23505');
    expect(
      await violationCode(() =>
        freshDb.insert(schemaModule.messages).values({
          conversationId: randomUUID(),
          direction: 'inbound',
          content: 'FK inválida',
        }),
      ),
    ).toBe('23503');
    expect(
      await violationCode(() =>
        freshDb.insert(schemaModule.deadLetterEvents).values({
          originalEventId: 'prod06-dlq-fk',
          consumerId: 'prod06',
          eventType: 'prod06.fk',
          payload: {},
          resolvedBy: randomUUID(),
        }),
      ),
    ).toBe('23503');

    const [contact] = await freshDb
      .insert(schemaModule.contacts)
      .values({ name: `PROD06 cascade ${randomUUID()}` })
      .returning();
    const [conversation] = await freshDb
      .insert(schemaModule.conversations)
      .values({ contactId: contact.id })
      .returning();
    const [message] = await freshDb
      .insert(schemaModule.messages)
      .values({ conversationId: conversation.id, direction: 'outbound', content: 'cascade' })
      .returning();
    const scopeActor = `prod06-actor-${randomUUID()}`;
    const scopeConversation = conversation.id;
    const clientKey = `prod06-key-${randomUUID()}`;
    await freshDb.insert(schemaModule.outboundDeliveries).values({
      internalMessageId: message.id,
      idempotencyKey: `c04:${clientKey}`,
      scopeActorId: scopeActor,
      scopeConversationId: scopeConversation,
      clientKey,
      status: 'sent',
      providerMessageId: 'provider-prod06',
    });
    expect(
      await violationCode(() =>
        freshDb.insert(schemaModule.outboundDeliveries).values({
          internalMessageId: message.id,
          idempotencyKey: `c04:${clientKey}-other`,
          scopeActorId: scopeActor,
          scopeConversationId: scopeConversation,
          clientKey,
          status: 'pending',
        }),
      ),
    ).toBe('23505');

    await freshDb.delete(schemaModule.messages).where(eq(schemaModule.messages.id, message.id));

    const remaining = await freshDb
      .select()
      .from(schemaModule.outboundDeliveries)
      .where(eq(schemaModule.outboundDeliveries.idempotencyKey, `c04:${clientKey}`));
    expect(remaining).toHaveLength(0);

    const tombstones = await freshDb
      .select()
      .from(schemaModule.outboundIdempotencyTombstones)
      .where(eq(schemaModule.outboundIdempotencyTombstones.clientKey, clientKey));
    expect(tombstones).toHaveLength(1);
    expect(tombstones[0]).toMatchObject({
      scopeActorId: scopeActor,
      scopeConversationId: scopeConversation,
      providerMessageId: 'provider-prod06',
    });

    // Delete dos pais em cascata remove vínculos declarados como CASCADE.
    await freshDb.delete(schemaModule.conversations).where(eq(schemaModule.conversations.id, conversation.id));
    const orphanMessages = await freshDb
      .select()
      .from(schemaModule.messages)
      .where(eq(schemaModule.messages.id, message.id));
    expect(orphanMessages).toHaveLength(0);
  });

  it('AC2.3 upgrade de cópia populada preserva dados e aplica 0019..0023', async () => {
    const client = newClient(databaseUrl(DB.upgrade));
    await client.connect();
    try {
      const expected = listExpectedMigrations(MIGRATIONS_DIR);
      const applied = await ledgerRows(client);
      expect(applied.length).toBe(expected.length);
      expect(applied.map((row) => row.hash)).toEqual(expected.map((entry) => entry.hash));

      const counts = await client.query<{
        users: string;
        sessions: string;
        messages: string;
        outbox_events: string;
        outbound_deliveries: string;
      }>(
        `SELECT (SELECT count(*) FROM users) AS users,
                (SELECT count(*) FROM sessions) AS sessions,
                (SELECT count(*) FROM messages) AS messages,
                (SELECT count(*) FROM outbox_events) AS outbox_events,
                (SELECT count(*) FROM outbound_deliveries) AS outbound_deliveries`,
      );
      expect(Number(counts.rows[0].sessions)).toBe(1);
      expect(Number(counts.rows[0].messages)).toBe(1);
      expect(Number(counts.rows[0].outbox_events)).toBe(1);
      expect(Number(counts.rows[0].outbound_deliveries)).toBe(1);

      const session = await client.query<{
        expires_epoch: string;
        created_epoch: string;
        expires_type: string;
      }>(
        `SELECT extract(epoch FROM s.expires_at) * 1000 AS expires_epoch,
                extract(epoch FROM s.created_at) * 1000 AS created_epoch,
                (SELECT data_type FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'sessions' AND column_name = 'expires_at') AS expires_type
           FROM sessions s WHERE s.id = $1`,
        [legacyUpgrade.sessionId],
      );
      expect(Math.round(Number(session.rows[0].expires_epoch))).toBe(legacyUpgrade.expiresEpoch);
      expect(Math.round(Number(session.rows[0].created_epoch))).toBe(legacyUpgrade.createdEpoch);
      expect(session.rows[0].expires_type).toBe('timestamp with time zone');

      const backfill = await client.query<{
        scope_actor_id: string;
        scope_conversation_id: string;
        client_key: string;
        expires_at: string;
      }>(
        `SELECT scope_actor_id, scope_conversation_id, client_key, expires_at
           FROM outbound_deliveries WHERE internal_message_id = $1`,
        [legacyUpgrade.messageId],
      );
      expect(backfill.rows[0]).toMatchObject({
        scope_actor_id: 'legacy',
        scope_conversation_id: legacyUpgrade.conversationId,
        client_key: 'prod06-legacy-key',
      });
      expect(backfill.rows[0].expires_at).not.toBeNull();

      const newStructures = await client.query<{ tablename: string }>(
        `SELECT tablename FROM pg_tables
          WHERE schemaname = 'public'
            AND tablename IN ('privacy_operations', 'outbound_idempotency_tombstones')`,
      );
      expect(newStructures.rows.map((row) => row.tablename).sort()).toEqual([
        'outbound_idempotency_tombstones',
        'privacy_operations',
      ]);
      const lease = await client.query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'outbox_consumer_acks'
            AND column_name = 'lease_until' AND data_type = 'timestamp with time zone'`,
      );
      expect(lease.rowCount).toBe(1);
    } finally {
      await client.end();
    }
  });

  it('AC2.4 checksum divergente e drift físico bloqueiam readiness', async () => {
    const client = newClient(databaseUrl(DB.drift));
    await client.connect();
    try {
      const healthy = await checkDatabaseReadiness({
        connectionString: databaseUrl(DB.drift),
        migrationsFolder: MIGRATIONS_DIR,
        timeoutMs: 5_000,
      });
      expect(healthy.migrations.status).toBe('ok');

      const last = (await ledgerRows(client)).at(-1);
      expect(last).toBeDefined();
      await client.query('UPDATE drizzle.__drizzle_migrations SET hash = $1 WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations)', [
        'prod06-checksum-divergente',
      ]);
      const checksum = await checkDatabaseReadiness({
        connectionString: databaseUrl(DB.drift),
        migrationsFolder: MIGRATIONS_DIR,
        timeoutMs: 5_000,
      });
      expect(checksum.migrations.status).toBe('error');
      expect(checksum.migrations.code).toBe('SCHEMA_MISMATCH');
      expect(checksum.migrations.mismatched?.length).toBeGreaterThan(0);
      await client.query('UPDATE drizzle.__drizzle_migrations SET hash = $1 WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations)', [
        last?.hash,
      ]);

      await client.query('DROP INDEX IF EXISTS idx_messages_conversation_created_id');
      const indexDrift = await checkDatabaseReadiness({
        connectionString: databaseUrl(DB.drift),
        migrationsFolder: MIGRATIONS_DIR,
        timeoutMs: 5_000,
      });
      expect(indexDrift.migrations.status).toBe('error');
      expect(indexDrift.migrations.code).toBe('SCHEMA_DRIFT');
      expect(indexDrift.migrations.drift).toContain('index:idx_messages_conversation_created_id');
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_id
           ON messages (conversation_id, created_at DESC, id DESC)`,
      );

      await client.query('ALTER TABLE sessions ALTER COLUMN last_seen_at TYPE timestamp');
      const tzDrift = await checkDatabaseReadiness({
        connectionString: databaseUrl(DB.drift),
        migrationsFolder: MIGRATIONS_DIR,
        timeoutMs: 5_000,
      });
      expect(tzDrift.migrations.status).toBe('error');
      expect(tzDrift.migrations.code).toBe('SCHEMA_DRIFT');
      expect(tzDrift.migrations.drift).toContain(
        'timestamptz:sessions.last_seen_at=timestamp without time zone',
      );
      await client.query(
        "ALTER TABLE sessions ALTER COLUMN last_seen_at TYPE timestamptz USING (last_seen_at AT TIME ZONE 'UTC')",
      );

      const lastId = await client.query<{ id: number; hash: string; created_at: string }>(
        'SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 1',
      );
      await client.query('DELETE FROM drizzle.__drizzle_migrations WHERE id = $1', [
        lastId.rows[0].id,
      ]);
      const behind = await checkDatabaseReadiness({
        connectionString: databaseUrl(DB.drift),
        migrationsFolder: MIGRATIONS_DIR,
        timeoutMs: 5_000,
      });
      expect(behind.migrations.status).toBe('error');
      expect(behind.migrations.code).toBe('SCHEMA_BEHIND');
      await client.query(
        'INSERT INTO drizzle.__drizzle_migrations (id, hash, created_at) VALUES ($1, $2, $3)',
        [lastId.rows[0].id, lastId.rows[0].hash, lastId.rows[0].created_at],
      );

      const restored = await checkDatabaseReadiness({
        connectionString: databaseUrl(DB.drift),
        migrationsFolder: MIGRATIONS_DIR,
        timeoutMs: 5_000,
      });
      expect(restored.migrations.status).toBe('ok');
    } finally {
      await client.end();
    }
  });

  it('AC2.5 db:migrate e db:check reais no PG isolado encerram com sucesso', async () => {
    const migrateLog = readFileSync(join(LOG_DIR, 'db-migrate-cli.log'), 'utf8');
    expect(migrateLog).toContain('exit=0');
    expect(migrateLog).toContain('Migrations completed successfully');

    const checkLog = readFileSync(join(LOG_DIR, 'db-check-cli.log'), 'utf8');
    expect(checkLog).toContain('exit=0');
    expect(checkLog).toContain('[migcheck] OK:');

    const client = newClient(databaseUrl(DB.cli));
    await client.connect();
    try {
      const expected = listExpectedMigrations(MIGRATIONS_DIR);
      const applied = await ledgerRows(client);
      expect(applied.length).toBe(expected.length);
      expect(applied.map((row) => row.hash)).toEqual(expected.map((entry) => entry.hash));
    } finally {
      await client.end();
    }
  });
});

describe('PROD-06 AC3 — inventário tutor_patients N:N × patient.tutorId', () => {
  it('AC3.1 documenta o N:N, registra o 1:N implementado e não implementa N:N', () => {
    const dataModel = readFileSync(join(REPO_ROOT, 'docs', '09-data-model.md'), 'utf8');
    expect(dataModel).toContain('### 6.4 `tutor_patients`');
    expect(dataModel).toContain('Relacionamento N:N entre tutor e paciente');
    expect(dataModel).toContain('(`tutor_id`, `patient_id`) em `tutor_patients`');

    const schemaSource = readFileSync(SCHEMA_PATH, 'utf8');
    expect(schemaSource).not.toContain('tutor_patients');
    expect(Object.keys(schemaModule).some((key) => /tutorPatients/.test(key))).toBe(false);
    expect((schemaModule.patients.tutorId as { name: string }).name).toBe('tutor_id');

    const patientRepository = readFileSync(
      join(REPO_ROOT, 'modules', 'patients', 'src', 'infrastructure', 'repositories', 'patient.repository.ts'),
      'utf8',
    );
    expect(patientRepository).toContain('schema.patients.tutorId');
    const tutorRepository = readFileSync(
      join(REPO_ROOT, 'modules', 'tutors', 'src', 'infrastructure', 'repositories', 'tutor.repository.ts'),
      'utf8',
    );
    expect(tutorRepository).toContain('schema.patients.tutorId');

    const proposalPath = join(EVIDENCE_DIR, 'D03-PROPOSTA.md');
    expect(existsSync(proposalPath)).toBe(true);
    const proposal = readFileSync(proposalPath, 'utf8');
    for (const section of ['## Impacto', '## Migração', '## Compatibilidade', '## Decisão']) {
      expect(proposal).toContain(section);
    }
    expect(proposal.toLowerCase()).toContain('open');
    expect(proposal).toMatch(/não implementad/i);

    const migration = readFileSync(
      join(MIGRATIONS_DIR, '0023_sessions_timezone_harmonization.sql'),
      'utf8',
    );
    expect(migration).not.toContain('tutor_patients');
  });
});

describe('PROD-06 AC4 — migrations imutáveis, interrupção e roll-forward', () => {
  it('AC4.1 migrations 0000-0022 mantêm o hash do baseline do PROD-00', () => {
    const baseline = readFileSync(BASELINE_LEDGER, 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        const [hash, path] = line.trim().split(/\s+/);
        return { hash, tag: (path ?? '').replace(/^packages\/database\/supabase\/migrations\//, '').replace(/\.sql$/, '') };
      });
    expect(baseline.length).toBeGreaterThanOrEqual(22);
    for (const entry of baseline) {
      if (!journalEntries.some((candidate) => candidate.tag === entry.tag)) continue;
      const sqlText = readFileSync(join(MIGRATIONS_DIR, `${entry.tag}.sql`), 'utf8');
      expect(createHash('sha256').update(sqlText).digest('hex'), entry.tag).toBe(entry.hash);
    }
  });

  it('AC4.2 interrupção durante a 0023 não deixa estado parcial e roll-forward recupera', async () => {
    const client = newClient(databaseUrl(DB.interrupt));
    await client.connect();
    let child: ReturnType<typeof spawn> | undefined;
    let childLog = '';
    try {
      const before = await ledgerRows(client);
      expect(before.length).toBe(INTERRUPT_BOUNDARY_IDX + 1);
      const beforeTypes = await columnTypes(client);
      expect(beforeTypes.get('sessions.expires_at')).toBe('timestamp without time zone');

      await client.query('BEGIN');
      await client.query('LOCK TABLE sessions IN ACCESS EXCLUSIVE MODE');

      child = spawn('pnpm', ['--filter', '@cvg/database', 'run', 'db:migrate'], {
        cwd: REPO_ROOT,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PGAPPNAME: 'prod06-interrupt',
          DATABASE_URL: `${databaseUrl(DB.interrupt)}?application_name=prod06-interrupt`,
        },
      });
      child.stdout?.on('data', (chunk: Buffer) => {
        childLog += chunk.toString();
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        childLog += chunk.toString();
      });

      let observed = false;
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        // pg_locks é independente de snapshot; a view pg_stat_activity pode
        // ocultar o backend novo enquanto a transação de lock está aberta.
        const waiting = await client.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_locks
            WHERE NOT granted AND locktype = 'relation'`,
        );
        if (Number(waiting.rows[0].n) > 0) {
          observed = true;
          break;
        }
        if (child.exitCode !== null) break;
        await sleep(250);
      }
      if (!observed) {
        const activity = await client.query<{
          pid: number;
          datname: string | null;
          application_name: string;
          state: string | null;
          wait_event_type: string | null;
          query: string;
        }>(
          `SELECT pid, datname, application_name, state, wait_event_type, left(query, 60) AS query
             FROM pg_stat_activity WHERE backend_type = 'client backend'`,
        );
        const locks = await client.query(
          'SELECT locktype, mode, granted, pid FROM pg_locks WHERE NOT granted',
        );
        throw new Error(
          `migração não observada bloqueada na 0023; exitCode=${String(child.exitCode)} ` +
            `signalCode=${String(child.signalCode)} activity=${JSON.stringify(activity.rows)} ` +
            `locks=${JSON.stringify(locks.rows)} log do filho:\n${childLog}`,
        );
      }

      if (child.pid) killProcessGroup(child);
      await new Promise<void>((resolvePromise) => {
        if (!child) return resolvePromise();
        if (child.exitCode !== null || child.signalCode !== null) return resolvePromise();
        child.once('exit', () => resolvePromise());
        setTimeout(() => resolvePromise(), 10_000);
      });
      await sleep(500);

      const afterKill = await ledgerRows(client);
      expect(afterKill.length).toBe(before.length);
      const afterTypes = await columnTypes(client);
      expect(afterTypes.get('sessions.expires_at')).toBe('timestamp without time zone');

      await client.query('ROLLBACK');

      await migrate(interruptDb, { migrationsFolder: MIGRATIONS_DIR });

      const expected = listExpectedMigrations(MIGRATIONS_DIR);
      const rolledForward = await ledgerRows(client);
      expect(rolledForward.length).toBe(expected.length);
      expect(rolledForward.map((row) => row.hash)).toEqual(expected.map((entry) => entry.hash));
      const forwardTypes = await columnTypes(client);
      expect(forwardTypes.get('sessions.expires_at')).toBe('timestamp with time zone');

      const preserved = await client.query<{ expires_epoch: string }>(
        `SELECT extract(epoch FROM expires_at) * 1000 AS expires_epoch FROM sessions
          WHERE token = 'prod06-interrupt-session'`,
      );
      expect(Math.round(Number(preserved.rows[0].expires_epoch))).toBe(
        Date.UTC(2032, 1, 2, 10, 0, 0, 0),
      );
    } finally {
      if (child) killProcessGroup(child);
      await client.query('ROLLBACK').catch(() => undefined);
      await client.end().catch(() => undefined);
      writeLog('interrupt-roll-forward', childLog);
    }
  });
});
