/**
 * Helpers administrativos (scripts de DR/QA) sobre pg — sem drizzle.
 */
import pg from 'pg';

export function client(url) {
  return new pg.Pool({ connectionString: url, max: 1 });
}

export async function withClient(url, fn) {
  const pool = client(url);
  const c = await pool.connect();
  try {
    return await fn(c);
  } finally {
    c.release();
    try {
      await pool.end();
    } catch {
      // best-effort
    }
  }
}

export async function dropDatabase(adminUrl, dbName) {
  await withClient(adminUrl, async (c) => {
    await c.query(`DROP DATABASE IF EXISTS "${dbName}"`);
  });
}

export async function createDatabase(adminUrl, dbName) {
  await withClient(adminUrl, async (c) => {
    await c.query(`CREATE DATABASE "${dbName}"`);
  });
}

export async function tableExists(c, table) {
  const r = await c.query(`SELECT to_regclass('public."${table}"') AS t`);
  return Boolean(r.rows[0]?.t);
}

export async function columnNames(c, table) {
  const r = await c.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
    [table],
  );
  return r.rows.map((row) => row.column_name);
}

/** Escapa valor para INSERT literal (parâmetro posicional). */
export function param(values) {
  return values.map((v, i) => `$${i + 1}`);
}
