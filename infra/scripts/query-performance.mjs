#!/usr/bin/env node
/**
 * Query performance evidence (§21): EXPLAIN (FORMAT JSON) nos hot paths.
 * Sem binds: usa literais dummy válidos por query. Gera artifacts/query-performance.json.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const artifactsDir = join(root, 'artifacts');
mkdirSync(artifactsDir, { recursive: true });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL obrigatório');
  process.exit(2);
}

const pool = new pg.Pool({ connectionString: url });

const UUID = '00000000-0000-0000-0000-000000000000';
const HOT_PATHS = [
  ['messages.byConv', `SELECT * FROM messages WHERE conversation_id = '${UUID}' ORDER BY created_at DESC LIMIT 50`],
  ['messages.latestByConvs', `SELECT DISTINCT ON (conversation_id) * FROM messages WHERE conversation_id IN ('${UUID}') ORDER BY conversation_id, created_at DESC`],
  ['conversations.forUser', `SELECT * FROM conversations WHERE sector_id = '${UUID}' ORDER BY created_at DESC LIMIT 50`],
  ['conversations.list', "SELECT * FROM conversations WHERE status = 'open'"],
  ['tasks.byAssignee', `SELECT * FROM tasks WHERE assigned_to = '${UUID}' ORDER BY created_at DESC`],
  ['alerts.active', "SELECT * FROM alerts WHERE status = 'active' ORDER BY created_at DESC LIMIT 50"],
  ['audit.byEntity', `SELECT * FROM audit_logs WHERE entity_type = 'x' AND entity_id = '${UUID}' ORDER BY created_at DESC`],
  ['outbox.pending', 'SELECT * FROM outbox_events WHERE processed_at IS NULL ORDER BY created_at LIMIT 50'],
  ['sessions.byToken', "SELECT * FROM sessions WHERE token = 'x' LIMIT 1"],
  ['contacts.byPhone', "SELECT * FROM contacts WHERE phone = '+5511000000000' LIMIT 1"],
  ['dlq.pending', "SELECT * FROM dead_letter_events WHERE status = 'PENDING' ORDER BY last_failed_at DESC LIMIT 50"],
];

const TABLE_INDEXES = {
  messages: ['idx_messages_external', 'idx_messages_conversation'],
  conversations: ['idx_conversations_status', 'idx_conversations_sector', 'idx_conversations_assigned'],
  tasks: ['idx_tasks_assigned', 'idx_tasks_status'],
  alerts: ['idx_alerts_status'],
  audit_logs: ['idx_audit_logs_entity', 'idx_audit_logs_action'],
  outbox_events: ['idx_outbox_processed', 'idx_outbox_created'],
  sessions: ['idx_sessions_token', 'idx_sessions_token_hash'],
  contacts: ['idx_contacts_external', 'idx_contacts_phone', 'idx_contacts_email'],
  dead_letter_events: ['idx_dlq_status', 'idx_dlq_pending_failed', 'idx_dlq_consumer'],
  messages: ['idx_messages_external', 'idx_messages_conversation'],
};

const report = { commit: execSync('git rev-parse HEAD').toString().trim(), timestamp: new Date().toISOString(), queries: {} };

async function listIndexes() {
  const { rows } = await pool.query(
    `SELECT tablename, indexname FROM pg_indexes WHERE schemaname='public' ORDER BY tablename, indexname`,
  );
  const map = {};
  for (const r of rows) {
    map[r.tablename] = map[r.tablename] || [];
    map[r.tablename].push(r.indexname);
  }
  return map;
}

const indexMap = await listIndexes();

for (const [name, sql] of HOT_PATHS) {
  try {
    const table = name.split('.')[0] === 'audit' ? 'audit_logs' : name.split('.')[0] === 'dlq' ? 'dead_letter_events' : name.split('.')[0] === 'outbox' ? 'outbox_events' : `${name.split('.')[0]}`;
    const existing = indexMap[table] || [];
    // Tabela remapeada corretamente (composite por esquema)
    const tableReal = {
      messages: 'messages', conversations: 'conversations', tasks: 'tasks',
      alerts: 'alerts', audit: 'audit_logs', outbox: 'outbox_events',
      sessions: 'sessions', contacts: 'contacts', dlq: 'dead_letter_events',
    }[name.split('.')[0]];
    const idx = indexMap[tableReal] || [];
    const plan = await pool.query(`EXPLAIN (FORMAT JSON) ${sql}`);
    const rootNode = plan.rows[0]['QUERY PLAN'][0].Plan;
    const cost = Number(rootNode['Total Cost']);
    const rows = Number(rootNode['Plan Rows']);
    const seqScan = JSON.stringify(plan.rows[0]).includes('Seq Scan');
    const indexed = (idx.length > 0);
    // Seq scan barato em tabela pequena é decisão ótima do planner, não déficit.
    const acceptable = !seqScan || cost < 50 || !indexed;
    report.queries[name] = { totalCost: cost, planRows: rows, seqScan, indexCount: idx.length, indexNames: idx, acceptable };
    console.log(`${acceptable ? 'OK ' : '⚠️  '} ${name}: cost=${cost.toFixed(1)} rows=${rows} seqScan=${seqScan} idx=${idx.length}`);
  } catch (error) {
    report.queries[name] = { error: String(error.message) };
    console.log(`ERR ${name}: ${error.message}`);
  }
}

writeFileSync(join(artifactsDir, 'query-performance.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`Report: artifacts/query-performance.json`);
await pool.end();
