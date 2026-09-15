#!/usr/bin/env node
// SA-010/AC2 — controles negativos do verificador de DR.
//
// Uso: DATABASE_URL=<isolado> node infra/scripts/dr-verify-fixture.test.mjs [--out json]
//
// Cria a fixture completa, prova que o verificador APROVA, e então injeta cada
// defeito (sem mensagem, sem evento, sem DLQ, valor trocado, backup vazio) e
// exige exit != 0 com a checagem exata reprovada.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL é obrigatório');
const args = process.argv.slice(2);
const outPath = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;

const tag = `dr-adv-${Date.now()}`;
const fixturePath = join('/tmp', `opencode/${tag}.fixture.json`);
mkdirSync('/tmp/opencode', { recursive: true });

const pool = new pg.Pool({ connectionString: databaseUrl });
const client = await pool.connect();
const ids = {};

async function createFixture() {
  const user = await client.query(
    "INSERT INTO users(name,email,password_hash) VALUES('DR Adv',$1,'x') RETURNING id",
    [`${tag}@example.com`],
  );
  const contact = await client.query(
    'INSERT INTO contacts(phone,name) VALUES($1,$2) RETURNING id',
    [`+55${Date.now().toString().slice(-10)}`, tag],
  );
  const conversation = await client.query(
    "INSERT INTO conversations(contact_id,status) VALUES($1,'open') RETURNING id",
    [contact.rows[0].id],
  );
  const message = await client.query(
    'INSERT INTO messages(conversation_id,direction,content,external_message_id) VALUES($1,$2,$3,$4) RETURNING id',
    [conversation.rows[0].id, 'inbound', tag, `${tag}-msg`],
  );
  await client.query(
    "INSERT INTO outbox_events(event_id,event_type,aggregate_type,aggregate_id,occurred_at,payload,version) VALUES($1,'message.persisted','Message',$2,NOW(),'{}',1)",
    [`${tag}-evt`, message.rows[0].id],
  );
  await client.query(
    "INSERT INTO audit_logs(action,entity_type,entity_id) VALUES('dr.fixture','fixture',$1)",
    [conversation.rows[0].id],
  );
  await client.query(
    "INSERT INTO dead_letter_events(original_event_id,consumer_id,event_type,payload) VALUES($1,'worker','message.persisted','{}')",
    [`${tag}-evt`],
  );
  return {
    userId: user.rows[0].id,
    contactId: contact.rows[0].id,
    conversationId: conversation.rows[0].id,
    messageId: message.rows[0].id,
  };
}

async function destroyFixture() {
  await client.query('DELETE FROM dead_letter_events WHERE original_event_id = $1', [`${tag}-evt`]);
  await client.query("DELETE FROM audit_logs WHERE action = 'dr.fixture' AND entity_id = $1", [ids.conversationId]);
  await client.query('DELETE FROM outbox_events WHERE event_id = $1', [`${tag}-evt`]);
  await client.query('DELETE FROM messages WHERE external_message_id = $1', [`${tag}-msg`]);
  await client.query('DELETE FROM conversations WHERE id = $1', [ids.conversationId]);
  await client.query('DELETE FROM contacts WHERE id = $1', [ids.contactId]);
  await client.query('DELETE FROM users WHERE id = $1', [ids.userId]);
}

function runVerifier() {
  const result = spawnSync(
    process.execPath,
    [join(REPO_ROOT, 'infra', 'scripts', 'dr-verify-fixture.mjs'), '--fixture', fixturePath],
    { encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl, DR_FIXTURE_TAG: tag }, timeout: 60_000 },
  );
  let report = null;
  try { report = JSON.parse(result.stdout.trim().split('\n').at(-1)); } catch { /* saída não-JSON */ }
  return { status: result.status, report, stdout: result.stdout, stderr: result.stderr };
}

const cases = [];

try {
  const created = await createFixture();
  Object.assign(ids, created);
  writeFileSync(fixturePath, `${JSON.stringify(ids, null, 2)}\n`);

  const baseline = runVerifier();
  cases.push({ case: 'fixture_completa_aprova', expectedNonZero: false, observedStatus: baseline.status, ok: baseline.status === 0, failedChecks: baseline.report?.failedChecks ?? null });

  // 1) sem mensagem
  await client.query('DELETE FROM messages WHERE external_message_id = $1', [`${tag}-msg`]);
  const noMessage = runVerifier();
  cases.push({ case: 'sem_mensagem_reprova', expectedNonZero: true, observedStatus: noMessage.status, ok: noMessage.status !== 0 && (noMessage.stdout ?? '').includes('mensagem_presente'), failedChecks: noMessage.report?.failedChecks ?? null });
  await client.query('INSERT INTO messages(conversation_id,direction,content,external_message_id) VALUES($1,$2,$3,$4) RETURNING id', [ids.conversationId, 'inbound', tag, `${tag}-msg`]);

  // 2) sem evento de outbox
  await client.query('DELETE FROM outbox_events WHERE event_id = $1', [`${tag}-evt`]);
  const noEvent = runVerifier();
  cases.push({ case: 'sem_evento_reprova', expectedNonZero: true, observedStatus: noEvent.status, ok: noEvent.status !== 0 && (noEvent.stdout ?? '').includes('outbox_presente'), failedChecks: noEvent.report?.failedChecks ?? null });
  const { rows: msgRows } = await client.query('SELECT id FROM messages WHERE external_message_id = $1', [`${tag}-msg`]);
  await client.query("INSERT INTO outbox_events(event_id,event_type,aggregate_type,aggregate_id,occurred_at,payload,version) VALUES($1,'message.persisted','Message',$2,NOW(),'{}',1)", [`${tag}-evt`, msgRows[0].id]);

  // 3) sem DLQ
  await client.query('DELETE FROM dead_letter_events WHERE original_event_id = $1', [`${tag}-evt`]);
  const noDlq = runVerifier();
  cases.push({ case: 'sem_dlq_reprova', expectedNonZero: true, observedStatus: noDlq.status, ok: noDlq.status !== 0 && (noDlq.stdout ?? '').includes('dlq_presente'), failedChecks: noDlq.report?.failedChecks ?? null });
  await client.query("INSERT INTO dead_letter_events(original_event_id,consumer_id,event_type,payload) VALUES($1,'worker','message.persisted','{}')", [`${tag}-evt`]);

  // 3b) vínculo DLQ→evento trocado (a UPDATE agora encontra a linha real)
  await client.query('UPDATE dead_letter_events SET original_event_id = $1 WHERE original_event_id = $2', [`${tag}-evt-trocado`, `${tag}-evt`]);
  const swappedDlq = runVerifier();
  cases.push({ case: 'vinculo_dlq_trocado_reprova', expectedNonZero: true, observedStatus: swappedDlq.status, ok: swappedDlq.status !== 0 && (swappedDlq.stdout ?? '').includes('dlq_presente'), failedChecks: swappedDlq.report?.failedChecks ?? null });
  await client.query('UPDATE dead_letter_events SET original_event_id = $1 WHERE original_event_id = $2', [`${tag}-evt`, `${tag}-evt-trocado`]);

  // 4) valor trocado (conteúdo divergente)
  await client.query('UPDATE messages SET content = $1 WHERE external_message_id = $2', ['conteudo-trocado', `${tag}-msg`]);
  const swapped = runVerifier();
  cases.push({ case: 'valor_trocado_reprova', expectedNonZero: true, observedStatus: swapped.status, ok: swapped.status !== 0 && (swapped.stdout ?? '').includes('mensagem_conteudo'), failedChecks: swapped.report?.failedChecks ?? null });
  await client.query('UPDATE messages SET content = $1 WHERE external_message_id = $2', [tag, `${tag}-msg`]);

  // 5) backup vazio (fixture removida)
  await destroyFixture();
  const empty = runVerifier();
  cases.push({ case: 'backup_vazio_reprova', expectedNonZero: true, observedStatus: empty.status, ok: empty.status !== 0 && (empty.stdout ?? '').includes('contagem_'), failedChecks: empty.report?.failedChecks ?? null });
} catch (error) {
  cases.push({ case: 'execucao', ok: false, error: String(error) });
} finally {
  try { await destroyFixture(); } catch { /* já removida */ }
  client.release();
  await pool.end();
}

const report = {
  runAt: new Date().toISOString(),
  tag,
  result: cases.every((entry) => entry.ok) ? 'PASS' : 'FAIL',
  cases,
};
if (outPath) writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
process.exit(report.result === 'PASS' ? 0 : 1);
