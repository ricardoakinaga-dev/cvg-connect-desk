import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schemaModule from './schema';
import { webhookReplayLog } from './webhook-replay';

// SA-009/AC1: em produção a configuração é obrigatória e a ausência falha
// CEDO com mensagem sem segredo (o fallback de desenvolvimento continua válido
// apenas fora de produção).
if (!process.env.DATABASE_URL && process.env.NODE_ENV === 'production') {
  console.error('[database] DATABASE_URL ausente: configuração obrigatória em produção.');
  process.exit(1);
}

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
// SA-009/AC3: erro de conexão OCIOSA (ex.: banco reiniciado/derrubado) não
// pode derrubar o processo inteiro. Registramos apenas o código — sem
// connection string, sem PII — e deixamos readiness degradar e recuperar.
pool.on('error', (error: unknown) => {
  const code = (error as { code?: string } | null)?.code ?? 'UNKNOWN';
  console.error(JSON.stringify({ msg: '[database] erro em conexão ociosa do pool', code, level: 'error' }));
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

/**
 * Handle devolvido pelo callback de `db.transaction` (AAA-08/C03 D-C03-1).
 * Métodos de escrita de mensagem/estado/outbox aceitam este executor para
 * participar da MESMA transação de banco.
 */
export type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Executor compatível com o pool (`db`) e com uma transação (`tx`). */
export type DatabaseExecutor = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;
