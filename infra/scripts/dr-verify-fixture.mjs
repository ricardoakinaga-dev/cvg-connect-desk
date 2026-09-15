#!/usr/bin/env node
// SA-010 — verificador ESTRITO da fixture de DR.
//
// Uso:
//   DATABASE_URL=<restaurado> DR_FIXTURE_TAG=<tag> \
//     node infra/scripts/dr-verify-fixture.mjs --fixture /caminho/fixture.json \
//     [--source-revision <sha>] [--out <json>]
//
// Diferente do predicado antigo (`grep -q <tag>`), cada entidade e cada VÍNCULO
// é comparado individualmente. Qualquer ausência, valor trocado ou backup vazio
// produz exit != 0 e um relatório estruturado com a checagem exata que falhou.
import { readFileSync, writeFileSync } from 'node:fs';
import pg from 'pg';

function parseArgs(argv) {
  const options = { fixture: null, out: null, sourceRevision: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--fixture') options.fixture = argv[++i];
    else if (arg === '--out') options.out = argv[++i];
    else if (arg === '--source-revision') options.sourceRevision = argv[++i];
    else throw new Error(`Argumento invalido: ${arg}`);
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const databaseUrl = process.env.DATABASE_URL;
const tag = process.env.DR_FIXTURE_TAG;
if (!databaseUrl) throw new Error('DATABASE_URL é obrigatório');
if (!tag) throw new Error('DR_FIXTURE_TAG é obrigatório');

const expected = options.fixture ? JSON.parse(readFileSync(options.fixture, 'utf8')) : null;
const checks = [];
let failed = 0;

function record(name, ok, detail) {
  checks.push({ name, ok, ...detail });
  if (!ok) failed += 1;
  console.log(`[dr-verify] ${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` :: ${JSON.stringify(detail)}`}`);
}

const pool = new pg.Pool({ connectionString: databaseUrl });
const client = await pool.connect();

async function one(sql, params) {
  const result = await client.query(sql, params);
  return result.rows[0] ?? null;
}

try {
  // 1) Usuário
  const user = await one('SELECT id, email FROM users WHERE email = $1', [`${tag}@example.com`]);
  record('user_presente', Boolean(user), { found: Boolean(user) });
  if (expected) {
    record('user_id_esperado', user?.id === expected.userId, { esperado: expected.userId, observado: user?.id ?? null });
  }

  // 2) Contato
  const contact = await one('SELECT id, name FROM contacts WHERE name = $1', [tag]);
  record('contact_presente', Boolean(contact), { found: Boolean(contact) });

  // 3) Conversa (vínculo com o contato)
  const conversation = await one(
    'SELECT id, contact_id, status FROM conversations WHERE contact_id = $1',
    [expected?.contactId ?? contact?.id ?? null],
  );
  record('conversation_presente', Boolean(conversation), { found: Boolean(conversation) });
  if (contact && conversation) {
    record('vinculo_contato_conversa', conversation.contact_id === contact.id, {
      esperado: contact.id,
      observado: conversation.contact_id,
    });
  }
  if (expected) {
    record('conversation_id_esperado', conversation?.id === expected.conversationId, {
      esperado: expected.conversationId,
      observado: conversation?.id ?? null,
    });
  }

  // 4) Mensagem (conteúdo + vínculo com a conversa)
  const message = await one(
    'SELECT id, content, conversation_id, external_message_id FROM messages WHERE external_message_id = $1',
    [`${tag}-msg`],
  );
  record('mensagem_presente', Boolean(message), { found: Boolean(message) });
  if (message) {
    record('mensagem_conteudo', message.content === tag, { esperado: tag, observado: message.content });
    record('vinculo_mensagem_conversa', message.conversation_id === conversation?.id, {
      esperado: conversation?.id ?? null,
      observado: message.conversation_id,
    });
  }
  if (expected) {
    record('mensagem_id_esperado', message?.id === expected.messageId, {
      esperado: expected.messageId,
      observado: message?.id ?? null,
    });
  }

  // 5) Evento de outbox (tipo + vínculo com a mensagem)
  const event = await one(
    'SELECT event_id, event_type, aggregate_type, aggregate_id FROM outbox_events WHERE event_id = $1',
    [`${tag}-evt`],
  );
  record('outbox_presente', Boolean(event), { found: Boolean(event) });
  if (event) {
    record('outbox_tipo', event.event_type === 'message.persisted' && event.aggregate_type === 'Message', {
      tipo: event.event_type,
      agregado: event.aggregate_type,
    });
    record('vinculo_evento_mensagem', event.aggregate_id === message?.id, {
      esperado: message?.id ?? null,
      observado: event.aggregate_id,
    });
  }

  // 6) DLQ (vínculo com o evento original)
  // Seleciona a DLQ por PADRÃO do run (não pelo vínculo esperado): assim a
  // comparação de vínculo abaixo é falsificável — um vínculo trocado encontra
  // a linha e reprova em `vinculo_dlq_evento`.
  const dlq = await one(
    "SELECT original_event_id, consumer_id, event_type FROM dead_letter_events WHERE original_event_id LIKE $1 AND consumer_id = 'worker' AND event_type = 'message.persisted'",
    [`${tag}%`],
  );
  record('dlq_presente', Boolean(dlq), { found: Boolean(dlq) });
  if (dlq) {
    record('dlq_consumer', dlq.consumer_id === 'worker' && dlq.event_type === 'message.persisted', {
      consumer: dlq.consumer_id,
      tipo: dlq.event_type,
    });
    // SA-010/AC1: a relação restaurada DLQ→evento precisa apontar para o MESMO
    // identificador do outbox restaurado, não apenas existir.
    record('vinculo_dlq_evento', dlq.original_event_id === event?.event_id, {
      esperado: event?.event_id ?? null,
      observado: dlq.original_event_id,
    });
  }

  // 7) Auditoria ligada à conversa
  const audit = await one(
    `SELECT count(*)::int AS total FROM audit_logs WHERE entity_id = $1 AND action = 'dr.fixture'`,
    [conversation?.id ?? null],
  );
  record('auditoria_presente', Number(audit?.total ?? 0) >= 1, { total: audit?.total ?? 0 });

  // 8) Backup não vazio: contagens mínimas por tabela
  for (const table of ['users', 'contacts', 'conversations', 'messages', 'outbox_events', 'dead_letter_events', 'audit_logs']) {
    const count = await one(`SELECT count(*)::int AS total FROM ${table}`);
    record(`contagem_${table}`, Number(count?.total ?? 0) > 0, { total: count?.total ?? 0 });
  }

  // 9) Vínculos cruzados devem APONTAR para os mesmos identificadores
  if (message && conversation) {
    record('cadeia_restaurada', message.conversation_id === conversation.id && conversation.contact_id === contact?.id, {
      message: message.conversation_id,
      conversation: conversation.contact_id,
    });
  }
} catch (error) {
  record('execucao_verificador', false, { error: String(error) });
} finally {
  client.release();
  await pool.end();
}

const report = {
  runAt: new Date().toISOString(),
  tag,
  databaseUrlHash: (await import('node:crypto')).createHash('sha256').update(databaseUrl).digest('hex'),
  sourceRevision: options.sourceRevision,
  totalChecks: checks.length,
  failedChecks: failed,
  result: failed === 0 ? 'PASS' : 'FAIL',
  checks,
};

if (options.out) writeFileSync(options.out, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ result: report.result, totalChecks: report.totalChecks, failedChecks: failed }));
process.exit(failed === 0 ? 0 : 1);
