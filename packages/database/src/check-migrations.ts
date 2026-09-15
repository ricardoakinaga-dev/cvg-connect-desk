/**
 * Migration tooling (Phase 9): fresh DB → run all migrations → assert critical
 * schema → drop. Falha o CI se qualquer migration quebrar do zero.
 *
 * Também expõe o probe de readiness (AAA-09/C08): conexão nova e limitada por
 * timeout, comparando o ledger `drizzle.__drizzle_migrations` com o schema
 * esperado (journal + SQL) sem vazar string de conexão ou mensagem de erro.
 *
 * Uso CLI: DATABASE_URL=<admin> MIGCHECK_DB=connect_desk_migcheck tsx src/check-migrations.ts
 */
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const baseDir = dirname(__dirname);
const DEFAULT_MIGRATIONS_FOLDER = join(baseDir, 'supabase', 'migrations');

const REQUIRED_TABLES = [
  'users', 'roles', 'permissions', 'role_permissions', 'user_roles',
  'sessions', 'contacts', 'tutors', 'patients', 'conversations', 'messages',
  'tasks', 'internal_notes', 'alerts', 'audit_logs', 'labels', 'sectors',
  'contact_sectors', 'contact_groups', 'contact_transfers', 'user_sectors',
  'outbox_events', 'outbox_consumer_acks', 'webhook_replay_log', 'outbound_deliveries',
  'dead_letter_events', 'media_assets', 'ai_action_approvals', 'privacy_operations',
  'conversation_status_history', 'conversation_assignments', 'contact_labels',
  'conversation_labels', 'contact_group_members', 'alert_events', 'task_status_history',
  'outbound_idempotency_tombstones',
];

const REQUIRED_INDEXES = [
  'idx_messages_external', 'idx_outbox_event_id', 'user_roles_pkey',
  'role_permissions_pkey', 'idx_sessions_token_hash', 'idx_outbound_deliveries_key',
  'idx_outbound_deliveries_scope_key', 'dead_letter_events_unique_event_consumer',
  'outbound_idempotency_tombstones_pkey', 'idx_acks_lease_due',
  'idx_messages_conversation_created_id', 'idx_messages_conversation_direction_created_id',
  'idx_messages_media_intake_recovery',
];

/**
 * Colunas de deadline/instante que DEVEM ser TIMESTAMPTZ no DDL real.
 * PROD-06/DT01: `sessions.expires_at`/`created_at` nasceram sem fuso (0003) e
 * deslocavam deadlines pelo offset do cliente; a 0023 converteu ambas.
 * Um schema com estas colunas em `timestamp` sem fuso é drift e bloqueia
 * readiness (SCHEMA_DRIFT), mesmo com o ledger completo.
 */
const REQUIRED_TIMESTAMPTZ_COLUMNS: Array<[string, string]> = [
  ['sessions', 'last_seen_at'],
  ['sessions', 'absolute_expires_at'],
  ['sessions', 'revoked_at'],
  ['sessions', 'expires_at'],
  ['sessions', 'created_at'],
  ['outbox_consumer_acks', 'lease_until'],
  ['outbound_deliveries', 'expires_at'],
  ['ai_action_approvals', 'expires_at'],
  ['webhook_replay_log', 'expires_at'],
  ['messages', 'media_intake_next_attempt_at'],
  ['messages', 'media_intake_lease_until'],
];

/** Códigos públicos do probe de banco — nunca carregam mensagem/host/credencial. */
export type DatabaseProbeCode =
  | 'DB_URL_MISSING'
  | 'DB_TIMEOUT'
  | 'DB_UNAVAILABLE';

/** Códigos públicos do probe de schema — nunca carregam mensagem/host/credencial. */
export type MigrationProbeCode =
  | 'SCHEMA_BEHIND'
  | 'SCHEMA_MISMATCH'
  | 'SCHEMA_DRIFT'
  | 'SCHEMA_UNVERIFIABLE'
  | 'SCHEMA_EXPECTATION_UNAVAILABLE';

export interface ExpectedMigration {
  tag: string;
  hash: string;
}

export interface DatabaseReadinessResult {
  database: {
    status: 'ok' | 'error';
    latencyMs: number;
    code?: DatabaseProbeCode;
  };
  migrations: {
    status: 'ok' | 'error';
    latencyMs: number;
    applied: number;
    expected: number;
    missing: string[];
    mismatched: string[];
    /** Invariantes físicas ausentes/divergentes quando code = SCHEMA_DRIFT. */
    drift?: string[];
    code?: MigrationProbeCode;
  };
}

const expectedMigrationsCache = new Map<string, ExpectedMigration[]>();

/**
 * Schema esperado = ordem do journal drizzle com o SHA-256 do SQL aplicado.
 * É exatamente o hash que o migrator do drizzle grava no ledger.
 * O conteúdo é imutável em runtime; o processo é reiniciado no deploy.
 */
export function listExpectedMigrations(
  migrationsFolder: string = DEFAULT_MIGRATIONS_FOLDER,
): ExpectedMigration[] {
  const cached = expectedMigrationsCache.get(migrationsFolder);
  if (cached) return cached;
  const journal = JSON.parse(
    readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: Array<{ tag: string }> };
  const expected = journal.entries.map((entry) => ({
    tag: entry.tag,
    hash: createHash('sha256')
      .update(readFileSync(join(migrationsFolder, `${entry.tag}.sql`), 'utf8'))
      .digest('hex'),
  }));
  expectedMigrationsCache.set(migrationsFolder, expected);
  return expected;
}

const READINESS_TIMEOUT_MARKER = 'CVG_READINESS_TIMEOUT';

function classifyDatabaseError(error: unknown): DatabaseProbeCode {
  const code = (error as { code?: string } | null)?.code ?? '';
  const message = error instanceof Error ? error.message : '';
  if (code === 'ETIMEDOUT' || message === READINESS_TIMEOUT_MARKER || /timeout/i.test(message)) {
    return 'DB_TIMEOUT';
  }
  return 'DB_UNAVAILABLE';
}

/**
 * Invariantes físicas mínimas do schema aplicado (PROD-06/AC2).
 * O ledger prova QUAIS migrations rodaram; não prova que o schema físico
 * permanece íntegro. Drop/rename manual de tabela, índice ou conversão de uma
 * coluna de deadline para `timestamp` sem fuso é drift e bloqueia readiness.
 * Retorna apenas identificadores públicos (nome/tipo), nunca mensagem/credencial.
 */
async function collectSchemaDrift(client: pg.Client): Promise<string[]> {
  const drift: string[] = [];

  const tables = await client.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
  );
  const tableNames = new Set(tables.rows.map((row) => row.tablename));
  for (const table of REQUIRED_TABLES) {
    if (!tableNames.has(table)) drift.push(`table:${table}`);
  }

  const indexes = await client.query<{ indexname: string }>(
    "SELECT indexname FROM pg_indexes WHERE schemaname = 'public'",
  );
  const constraints = await client.query<{ conname: string }>('SELECT conname FROM pg_constraint');
  const objectNames = new Set([
    ...indexes.rows.map((row) => row.indexname),
    ...constraints.rows.map((row) => row.conname),
  ]);
  for (const index of REQUIRED_INDEXES) {
    if (!objectNames.has(index)) drift.push(`index:${index}`);
  }

  const tzColumns = await client.query<{ table_name: string; column_name: string; data_type: string }>(
    `SELECT table_name, column_name, data_type
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (table_name, column_name) IN (SELECT * FROM unnest($1::text[], $2::text[]))`,
    [
      REQUIRED_TIMESTAMPTZ_COLUMNS.map(([table]) => table),
      REQUIRED_TIMESTAMPTZ_COLUMNS.map(([, column]) => column),
    ],
  );
  const tzTypes = new Map(
    tzColumns.rows.map((row) => [`${row.table_name}.${row.column_name}`, row.data_type]),
  );
  for (const [table, column] of REQUIRED_TIMESTAMPTZ_COLUMNS) {
    const type = tzTypes.get(`${table}.${column}`);
    if (type !== 'timestamp with time zone') {
      drift.push(`timestamptz:${table}.${column}=${type ?? 'missing'}`);
    }
  }

  return drift;
}

/**
 * Probe de readiness: abre conexão própria (não reusa o pool da aplicação),
 * com timeout integral, e compara o ledger de migrations com o esperado.
 * Nunca retorna `error.message`/connection string — apenas códigos.
 */
export async function checkDatabaseReadiness(
  options: {
    connectionString?: string;
    timeoutMs?: number;
    migrationsFolder?: string;
  } = {},
): Promise<DatabaseReadinessResult> {
  const timeoutMs = Math.max(
    200,
    Number(options.timeoutMs) || Number(process.env.READINESS_DB_TIMEOUT_MS) || 2000,
  );
  const connectionString = options.connectionString ?? process.env.DATABASE_URL;
  const migrationsStarted = Date.now();

  let expected: ExpectedMigration[] = [];
  let expectationError = false;
  try {
    expected = listExpectedMigrations(options.migrationsFolder);
  } catch {
    expectationError = true;
  }

  const emptyLedger = { applied: 0, expected: expected.length, missing: [] as string[], mismatched: [] as string[] };

  if (!connectionString) {
    return {
      database: { status: 'error', latencyMs: 0, code: 'DB_URL_MISSING' },
      migrations: {
        status: 'error',
        latencyMs: Date.now() - migrationsStarted,
        ...emptyLedger,
        code: 'SCHEMA_UNVERIFIABLE',
      },
    };
  }

  const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: timeoutMs,
    query_timeout: timeoutMs,
    statement_timeout: timeoutMs,
    application_name: 'cvg-desk-readiness',
  });

  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(READINESS_TIMEOUT_MARKER)), timeoutMs + 250);
    timer.unref?.();
  });
  const withDeadline = <T>(work: Promise<T>): Promise<T> => Promise.race([work, deadline]);

  const databaseStarted = Date.now();
  try {
    await withDeadline(client.connect());
    await withDeadline(client.query('SELECT 1'));
    const database = { status: 'ok' as const, latencyMs: Date.now() - databaseStarted };

    try {
      const ledger = await withDeadline(
        client.query<{ hash: string }>('SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id ASC'),
      );
      const appliedHashes = ledger.rows.map((row) => String(row.hash));
      const applied = appliedHashes.length;
      const missing = expected.slice(applied).map((entry) => entry.tag);
      const mismatched = expected
        .slice(0, Math.min(applied, expected.length))
        .filter((entry, index) => appliedHashes[index] !== entry.hash)
        .map((entry) => entry.tag);
      const migrationsLatency = Date.now() - migrationsStarted;

      if (expectationError) {
        return {
          database,
          migrations: { status: 'error', latencyMs: migrationsLatency, ...emptyLedger, applied, code: 'SCHEMA_EXPECTATION_UNAVAILABLE' },
        };
      }
      if (mismatched.length > 0) {
        return {
          database,
          migrations: { status: 'error', latencyMs: migrationsLatency, applied, expected: expected.length, missing, mismatched, code: 'SCHEMA_MISMATCH' },
        };
      }
      if (applied < expected.length) {
        return {
          database,
          migrations: { status: 'error', latencyMs: migrationsLatency, applied, expected: expected.length, missing, mismatched, code: 'SCHEMA_BEHIND' },
        };
      }
      const drift = await withDeadline(collectSchemaDrift(client));
      if (drift.length > 0) {
        return {
          database,
          migrations: { status: 'error', latencyMs: migrationsLatency, applied, expected: expected.length, missing, mismatched, code: 'SCHEMA_DRIFT', drift },
        };
      }
      return {
        database,
        migrations: { status: 'ok', latencyMs: migrationsLatency, applied, expected: expected.length, missing: [], mismatched: [] },
      };
    } catch (error) {
      const ledgerMissing = (error as { code?: string } | null)?.code === '42P01'
        || (error as { code?: string } | null)?.code === '3F000';
      return {
        database,
        migrations: {
          status: 'error',
          latencyMs: Date.now() - migrationsStarted,
          ...emptyLedger,
          code: ledgerMissing ? 'SCHEMA_BEHIND' : 'SCHEMA_UNVERIFIABLE',
        },
      };
    }
  } catch (error) {
    return {
      database: { status: 'error', latencyMs: Date.now() - databaseStarted, code: classifyDatabaseError(error) },
      migrations: {
        status: 'error',
        latencyMs: Date.now() - migrationsStarted,
        ...emptyLedger,
        code: 'SCHEMA_UNVERIFIABLE',
      },
    };
  } finally {
    if (timer) clearTimeout(timer);
    await client.end().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const adminUrl = process.env.DATABASE_URL;
  if (!adminUrl) {
    console.error('[migcheck] DATABASE_URL é obrigatório');
    process.exit(2);
  }
  const dbName = process.env.MIGCHECK_DB || `connect_desk_migcheck_${Date.now()}`;
  const adminPool = new pg.Pool({ connectionString: adminUrl });
  const admin = await adminPool.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    await admin.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    admin.release();
    await adminPool.end();
  }

  const targetUrl = adminUrl.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`);
  const pool = new pg.Pool({ connectionString: targetUrl });
  try {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: DEFAULT_MIGRATIONS_FOLDER });

    const tables = await pool.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    );
    const tableNames = new Set(tables.rows.map((r) => r.tablename));
    const missingTables = REQUIRED_TABLES.filter((t) => !tableNames.has(t));
    if (missingTables.length > 0) {
      console.error(`[migcheck] tabelas ausentes: ${missingTables.join(', ')}`);
      process.exit(1);
    }

    const indexes = await pool.query(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`);
    const indexNames = new Set(indexes.rows.map((r) => r.indexname));
    const constraints = await pool.query(`SELECT conname FROM pg_constraint`);
    const constraintNames = new Set(constraints.rows.map((r) => r.conname));
    const missingIdx = REQUIRED_INDEXES.filter((i) => !indexNames.has(i) && !constraintNames.has(i));
    if (missingIdx.length > 0) {
      console.error(`[migcheck] índices/constraints ausentes: ${missingIdx.join(', ')}`);
      process.exit(1);
    }

    console.log(`[migcheck] OK: ${tableNames.size} tabelas, migrations aplicadas em fresh DB ${dbName}`);
  } finally {
    await pool.end();
    const cleanup = new pg.Pool({ connectionString: adminUrl });
    const c = await cleanup.connect();
    try {
      await c.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    } finally {
      c.release();
      await cleanup.end();
    }
  }
}

const directlyExecuted = process.argv[1]
  ? pathToFileURL(process.argv[1]).href === import.meta.url
  : false;

if (directlyExecuted) {
  void main().then(
    () => process.exit(0),
    (error) => {
      console.error('[migcheck] FAILED:', error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}
