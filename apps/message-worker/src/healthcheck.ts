/**
 * Healthcheck real do message-worker (Phase 7).
 * Verifica a dependência crítica (PostgreSQL) com SELECT 1.
 * Exit 0 = saudável; exit 1 = não saudável.
 */
async function main(): Promise<void> {
  const { Pool } = await import('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 3000,
  });
  try {
    const client = await pool.connect();
    try {
      await client.query('SELECT 1');
    } finally {
      client.release();
    }
    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('[worker-healthcheck] unhealthy:', error instanceof Error ? error.message : error);
    try {
      await pool.end();
    } catch {
      // ignorar
    }
    process.exit(1);
  }
}

void main();
