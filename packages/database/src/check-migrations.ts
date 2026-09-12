/**
 * Migration check (Phase 9): fresh DB → run all migrations → assert critical
 * schema → drop. Falha o CI se qualquer migration quebrar do zero.
 *
 * Uso: DATABASE_URL=<admin> MIGCHECK_DB=connect_desk_migcheck tsx src/check-migrations.ts
 */
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const baseDir = dirname(__dirname);

const REQUIRED_TABLES = [
  'users', 'roles', 'permissions', 'role_permissions', 'user_roles',
  'sessions', 'contacts', 'tutors', 'patients', 'conversations', 'messages',
  'tasks', 'internal_notes', 'alerts', 'audit_logs', 'labels', 'sectors',
  'contact_sectors', 'contact_groups', 'contact_transfers', 'user_sectors',
  'outbox_events', 'outbox_consumer_acks', 'webhook_replay_log', 'outbound_deliveries',
  'dead_letter_events', 'media_assets', 'ai_action_approvals',
];

const REQUIRED_INDEXES = [
  'idx_messages_external', 'idx_outbox_event_id', 'user_roles_pkey',
  'role_permissions_pkey', 'idx_sessions_token_hash', 'idx_outbound_deliveries_key',
];

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
    await migrate(db, { migrationsFolder: join(baseDir, 'supabase', 'migrations') });

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

void main().then(
  () => process.exit(0),
  (error) => {
    console.error('[migcheck] FAILED:', error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
