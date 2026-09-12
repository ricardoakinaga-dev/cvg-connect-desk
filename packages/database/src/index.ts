import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schemaModule from './schema';
import { webhookReplayLog } from './webhook-replay';

const connectionString = process.env.DATABASE_URL || 'postgresql://connect_desk:root@localhost:5432/connect_desk_db';

// Pool config (PUBLIC_INFO): connection/query/statement/lock/idle-transaction
// timeouts como defaults de produção via env (§21). Fail-fast por padrão.
const pool = new Pool({
  connectionString,
  max: Number(process.env.PG_POOL_MAX) || 10,
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS) || 30_000,
  connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS) || 5_000,
  query_timeout: Number(process.env.PG_QUERY_TIMEOUT_MS) || 15_000,
  statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS) || 15_000,
  lock_timeout: Number(process.env.PG_LOCK_TIMEOUT_MS) || 10_000,
  idle_in_transaction_session_timeout: Number(process.env.PG_IDLE_TX_TIMEOUT_MS) || 60_000,
});
const fullSchema = { ...schemaModule, webhookReplayLog };
export const db = drizzle(pool, { schema: fullSchema });
export const schema = fullSchema;

export * from './schema';
export * from './webhook-replay';

/** Expose pool para diagnóstico (EXPLAIN/health) sem vazar conexões. */
export function getPool(): Pool {
  return pool;
}
