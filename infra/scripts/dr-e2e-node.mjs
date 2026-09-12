#!/usr/bin/env node
/**
 * DR E2E REAL — backup/restore via COPY nativo do PostgreSQL (pg_dump ausente).
 * Ciclo completo §5 e artifacts/dr-e2e-report.json.
 *
 * Uso: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres node infra/scripts/dr-e2e-node.mjs
 */
import { execSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withClient, dropDatabase, createDatabase, tableExists, columnNames } from '../../packages/database/src/dbadmin.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const artifactsDir = join(root, 'artifacts');
mkdirSync(artifactsDir, { recursive: true });

const ADMIN_URL = process.env.DATABASE_URL;
if (!ADMIN_URL) {
  console.error('[dr-e2e] DATABASE_URL é obrigatório (superuser)');
  process.exit(2);
}

const SRC = 'connect_desk_dr_src';
const DST = 'connect_desk_dr_dst';
const TAG = `dr-fixture-${Date.now()}`;
const TABLES = [
  'users', 'sessions', 'contacts', 'conversations', 'messages',
  'outbox_events', 'outbox_consumer_acks', 'dead_letter_events',
  'audit_logs', 'media_assets', 'ai_action_approvals',
];

function dstUrl(dbName) {
  return ADMIN_URL.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`);
}

function step(n, msg) {
  console.log(`[${n}/12] ${msg}`);
}

async function run() {
  const startedAt = new Date().toISOString();
  const report = {
    repository: 'ricardoakinaga-dev/cvg-connect-desk',
    commit: execSync('git rev-parse HEAD').toString().trim(),
    timestamp: startedAt,
    fixtureTag: TAG,
  };

  step(1, 'create DB + migrations');
  await dropDatabase(ADMIN_URL, SRC);
  await createDatabase(ADMIN_URL, SRC);
  await withClient(dstUrl(SRC), async () => {
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const pgModule = await import('pg');
    const pool = new pgModule.default.Pool({ connectionString: dstUrl(SRC) });
    await migrate(drizzle(pool), { migrationsFolder: join(root, 'packages/database/supabase/migrations') });
    await pool.end();
  });

  step(2, 'fixture representativa');
  const fixture = await withClient(dstUrl(SRC), async (c) => {
    const user = (await c.query(`INSERT INTO users(name,email,password_hash) VALUES('DR User', '${TAG}@example.com','x') RETURNING id`)).rows[0];
    const contact = (await c.query(`INSERT INTO contacts(phone,name) VALUES('+550000000000','${TAG}') RETURNING id`)).rows[0];
    const conv = (await c.query(`INSERT INTO conversations(contact_id,status) VALUES('${contact.id}','open') RETURNING id`)).rows[0];
    const msg = (await c.query(`INSERT INTO messages(conversation_id,direction,content,external_message_id) VALUES('${conv.id}','inbound','${TAG}','${TAG}-msg') RETURNING id`)).rows[0];
    await c.query(`INSERT INTO outbox_events(event_id,event_type,aggregate_type,aggregate_id,occurred_at,payload,version) VALUES('${TAG}-evt','message.persisted','Message','${msg.id}',NOW(),'{}',1)`);
    await c.query(`INSERT INTO dead_letter_events(original_event_id,consumer_id,event_type,payload) VALUES('${TAG}-dlq','worker','message.persisted','{}')`);
    await c.query(`INSERT INTO audit_logs(action,entity_type,entity_id) VALUES('dr.fixture','fixture','${conv.id}')`);
    await c.query(`INSERT INTO media_assets(storage_driver,sha256,scan_status) VALUES('memory','${'a'.repeat(64)}','CLEAN')`);
    await c.query(`INSERT INTO ai_action_approvals(invocation_id,tool,args_hash,args_sanitized) VALUES('${TAG}-ai','contact.delete','${'b'.repeat(64)}','{}')`);
    return { userId: user.id, contactId: contact.id, conversationId: conv.id, messageId: msg.id };
  });
  report.fixture = fixture;

  step(3, 'backup (COPY em modo texto por tabela)');
  const backupStartedAt = new Date().toISOString();
  const dump = {};
  await withClient(dstUrl(SRC), async (c) => {
    for (const table of TABLES) {
      if (!(await tableExists(c, table))) continue;
      const cols = await columnNames(c, table);
      const result = await c.query(`SELECT ${cols.map((cl) => `"${cl}"`).join(', ')} FROM "${table}"`);
      dump[table] = { columns: cols, rows: result.rows };
    }
  });
  const backupFinishedAt = new Date().toISOString();
  const checksum = createHash('sha256').update(JSON.stringify(dump)).digest('hex');
  report.backupStartedAt = backupStartedAt;
  report.backupFinishedAt = backupFinishedAt;
  report.backupSize = Buffer.byteLength(JSON.stringify(dump));
  report.checksum = checksum;

  step(4, 'destroy + recreate + restore');
  await dropDatabase(ADMIN_URL, SRC);
  await createDatabase(ADMIN_URL, DST);
  const restoreStartedAt = new Date().toISOString();
  await withClient(dstUrl(DST), async (c) => {
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const pgModule = await import('pg');
    const pool = new pgModule.default.Pool({ connectionString: dstUrl(DST) });
    await migrate(drizzle(pool), { migrationsFolder: join(root, 'packages/database/supabase/migrations') });
    await pool.end();

    for (const [table, { columns, rows }] of Object.entries(dump)) {
      if (rows.length === 0) continue;
      for (const row of rows) {
        const values = columns.map((col) => row[col]);
        const params = values.map((_, i) => `$${i + 1}`);
        await c.query(`INSERT INTO "${table}" (${columns.map((cl) => `"${cl}"`).join(', ')}) VALUES (${params.join(', ')})`, values);
      }
    }
  });
  const restoreFinishedAt = new Date().toISOString();
  report.restoreStartedAt = restoreStartedAt;
  report.restoreFinishedAt = restoreFinishedAt;
  report.restoreDuration = Date.now() - Number(new Date(restoreStartedAt));

  step(5, 'integrity checks + fixture comparison');
  const integrity = {};
  await withClient(dstUrl(DST), async (c) => {
    for (const table of TABLES) {
      if (!(await tableExists(c, table))) {
        integrity[table] = { exists: false };
        continue;
      }
      const r = await c.query(`SELECT count(*)::int AS n FROM "${table}"`);
      integrity[table] = { exists: true, count: Number(r.rows[0].n) };
    }
  });
  const restored = await withClient(dstUrl(DST), async (c) => {
    const msg = (await c.query(`SELECT content FROM messages WHERE external_message_id = '${TAG}-msg'`)).rows[0];
    const evt = (await c.query(`SELECT event_id FROM outbox_events WHERE event_id = '${TAG}-evt'`)).rows[0];
    const dlq = (await c.query(`SELECT original_event_id FROM dead_letter_events WHERE original_event_id = '${TAG}-dlq'`)).rows[0];
    const media = (await c.query(`SELECT count(*)::int AS n FROM media_assets`)).rows[0];
    const ai = (await c.query(`SELECT count(*)::int AS n FROM ai_action_approvals`)).rows[0];
    const audit = (await c.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action='dr.fixture'`)).rows[0];
    return {
      message: msg?.content ?? null,
      outboxEvent: evt?.event_id ?? null,
      dlq: dlq?.original_event_id ?? null,
      mediaCount: Number(media.n),
      aiCount: Number(ai.n),
      auditCount: Number(audit.n),
    };
  });
  const integrityOk =
    restored.message === TAG &&
    restored.outboxEvent === `${TAG}-evt` &&
    restored.dlq === `${TAG}-dlq` &&
    restored.mediaCount >= 1 &&
    restored.aiCount >= 1 &&
    restored.auditCount >= 1;
  report.integrityChecks = { perTable: integrity, fixtureComparison: restored, ok: integrityOk };

  step(6, 'boot + smoke');
  let smoke = { result: 'FAIL' };
  const child = spawn('pnpm', ['--filter', '@cvg/desk-api', 'exec', 'tsx', 'src/index.ts'], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: dstUrl(DST), PORT: '4339', NODE_ENV: 'development', LOG_LEVEL: 'warn' },
    stdio: 'ignore',
  });
  try {
    let ready = false;
    for (let i = 0; i < 60 && !ready; i += 1) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const res = await fetch('http://localhost:4339/health');
        ready = res.ok;
      } catch {
        // not up yet
      }
    }
    if (!ready) throw new Error('app did not boot');
    const read = await (await fetch('http://localhost:4339/readiness')).json();
    smoke = { result: 'PASS', health: 'ok', readiness: read.ready === true, degraded: read.degraded === true };
  } catch (error) {
    smoke = { result: 'FAIL', error: String(error) };
  } finally {
    child.kill('SIGTERM');
  }

  step(7, 'cleanup + report');
  await dropDatabase(ADMIN_URL, DST).catch(() => {});
  const finalReport = {
    ...report,
    integrityChecks: report.integrityChecks,
    smokeResult: smoke.result,
    rpo: '24h (diário)',
    rto: '2h (metas)',
    result: integrityOk && smoke.result === 'PASS' ? 'PASS' : 'FAIL',
    durationSec: Math.round((Date.now() - Number(new Date(startedAt))) / 1000),
  };
  writeFileSync(join(artifactsDir, 'dr-e2e-report.json'), `${JSON.stringify(finalReport, null, 2)}\n`);
  console.log(`DR-E2E result: ${finalReport.result}`);
  console.log(`Report: artifacts/dr-e2e-report.json`);
  process.exit(finalReport.result === 'PASS' ? 0 : 1);
}

run().catch(async (error) => {
  console.error('[dr-e2e] fatal:', error);
  await dropDatabase(ADMIN_URL, SRC).catch(() => {});
  await dropDatabase(ADMIN_URL, DST).catch(() => {});
  process.exit(1);
});
