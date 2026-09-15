/**
 * PROD-18 — Reprodução das lacunas ANTES do delta (candidato 754f9ba + worktree).
 *
 * Executa o CÓDIGO REAL dos módulos operacionais contra PostgreSQL ISOLADO do
 * harness AAA (exige marcador `cvg_aaa_*` no DATABASE_URL; nunca o banco do
 * host). A saída registrada em `logs/repro-antes.log` é o artefato do estado
 * anterior; a contraprova pós-delta é a suíte `prod-18.test.ts`.
 *
 * Lacunas reproduzidas (AC1/AC2 — BE04/BE05/BE11/UI05):
 *  A) `createNote` grava a nota antes da auditoria: falha na auditoria deixa a
 *     nota commitada sem trilha (não transacional) e sem evento outbox;
 *  B) `updateTaskStatus` muda status + histórico antes da auditoria: falha na
 *     auditoria deixa status mudado sem trilha e sem evento outbox;
 *  C) `acknowledgeAlert` muda status + histórico antes da auditoria: falha na
 *     auditoria deixa o alerta reconhecido sem trilha e sem evento outbox;
 *  D) `createTransfer` (autoAccept) cria a transferência, muda a conversa e só
 *     então mexe no vínculo do contato: falha no vínculo deixa transferência
 *     aceita + conversa movida + contato sem vínculo, sem auditoria/outbox;
 *  E) não existe operação pública HTTP de mudança de estado/atribuição/handoff
 *     de conversa (UI05) — inventário estático registrado no artefato.
 *
 * Uso (runner isolado):
 * node scripts/production/run-integration-isolated.mjs --run-id prod18-repro \
 *   --worker 42 -- pnpm exec tsx docs/producao-2026-09-13/evidencias/prod-18/repro-antes.ts
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool } from '@cvg/database';
import { createNote } from '@cvg/notes';
import { updateTaskStatus } from '@cvg/tasks';
import { acknowledgeAlert } from '@cvg/alerts';
import { createTransfer } from '@cvg/transfers';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATABASE_URL = process.env.DATABASE_URL || '';

if (!/cvg_aaa_/.test(DATABASE_URL)) {
  throw new Error('[PROD-18 repro] DATABASE_URL sem marcador cvg_aaa_* — abortado');
}

const pool = getPool();
const result: Record<string, unknown> = {
  generatedAt: new Date().toISOString(),
  runId: process.env.AAA_RUN_ID || null,
  workerIndex: process.env.AAA_WORKER_INDEX || null,
  database: DATABASE_URL.replace(/:\/\/[^@]*@/, '://***@'),
  scenarios: {},
};

async function count(query: string, params: unknown[] = []): Promise<number> {
  const rows = (await pool.query(query, params)).rows as Array<{ n: number }>;
  return Number(rows[0]?.n ?? 0);
}

async function installFailTrigger(target: string, name: string): Promise<void> {
  await pool.query(`
    CREATE OR REPLACE FUNCTION ${name}() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'prod18-injected failure on ${target}';
    END $$ LANGUAGE plpgsql;
  `);
  await pool.query(`CREATE TRIGGER ${name} BEFORE INSERT ON ${target} FOR EACH ROW EXECUTE FUNCTION ${name}()`);
}

async function dropFailTrigger(target: string, name: string): Promise<void> {
  await pool.query(`DROP TRIGGER IF EXISTS ${name} ON ${target}`);
  await pool.query(`DROP FUNCTION IF EXISTS ${name}()`);
}

async function createUser(tag: string): Promise<string> {
  const user = await pool.query<{ id: string }>(
    `INSERT INTO users (name, email, password_hash, is_active)
     VALUES ($1, $2, 'repro-hash', true) RETURNING id`,
    [`repro ${tag}`, `${tag}@repro.invalid`],
  );
  return user.rows[0]!.id;
}

async function fixtureContactConversation(tag: string): Promise<{ contactId: string; conversationId: string }> {
  const contact = await pool.query<{ id: string }>(
    'INSERT INTO contacts (name, phone) VALUES ($1, $2) RETURNING id',
    [`repro ${tag}`, `+5511${Date.now() % 1_000_000_000}`],
  );
  const conversation = await pool.query<{ id: string }>(
    `INSERT INTO conversations (external_conversation_id, external_channel_id, status, status_v2, contact_id)
     VALUES ($1, 'whatsapp', 'open', 'novo', $2) RETURNING id`,
    [`${tag}-conv`, contact.rows[0]!.id],
  );
  return { contactId: contact.rows[0]!.id, conversationId: conversation.rows[0]!.id };
}

async function scenarioNote(): Promise<void> {
  const tag = `prod18-note-${randomUUID()}`;
  const { conversationId } = await fixtureContactConversation(tag);
  const userId = await createUser(tag);
  await installFailTrigger('audit_logs', 'prod18_fail_note_audit');
  let isErr = false;
  let errorMessage: string | null = null;
  try {
    const outcome = await createNote({
      conversationId,
      content: 'nota de reprodução',
      authorId: userId,
      userId,
    });
    isErr = outcome.isErr();
    errorMessage = outcome.isErr() ? String(outcome.error.message) : null;
  } finally {
    await dropFailTrigger('audit_logs', 'prod18_fail_note_audit');
  }
  const notes = await count('SELECT count(*)::int AS n FROM internal_notes WHERE conversation_id = $1', [conversationId]);
  const audits = await count("SELECT count(*)::int AS n FROM audit_logs WHERE entity_type = 'note' AND entity_id IN (SELECT id FROM internal_notes WHERE conversation_id = $1)", [conversationId]);
  const outbox = await count("SELECT count(*)::int AS n FROM outbox_events WHERE aggregate_type = 'Note'");
  (result.scenarios as Record<string, unknown>).A_note = {
    isErr,
    errorMessage,
    notesPersisted: notes,
    auditRows: audits,
    outboxRows: outbox,
    defect: notes > 0 && audits === 0,
    expectedAfterFix: 'falha na auditoria => rollback total (0 notas, 0 auditoria, 0 outbox)',
  };
}

async function scenarioTask(): Promise<void> {
  const tag = `prod18-task-${randomUUID()}`;
  const { conversationId } = await fixtureContactConversation(tag);
  const userId = await createUser(tag);
  const task = await pool.query<{ id: string }>(
    `INSERT INTO tasks (conversation_id, title, status, priority, created_by)
     VALUES ($1, $2, 'pending', 'medium', $3) RETURNING id`,
    [conversationId, `repro task ${tag}`, userId],
  );
  const taskId = task.rows[0]!.id;
  await installFailTrigger('audit_logs', 'prod18_fail_task_audit');
  let isErr = false;
  try {
    const outcome = await updateTaskStatus({ taskId, status: 'completed', changedBy: userId, userId });
    isErr = outcome.isErr();
  } finally {
    await dropFailTrigger('audit_logs', 'prod18_fail_task_audit');
  }
  const status = (await pool.query<{ status: string }>('SELECT status FROM tasks WHERE id = $1', [taskId])).rows[0]?.status;
  const history = await count('SELECT count(*)::int AS n FROM task_status_history WHERE task_id = $1', [taskId]);
  const audits = await count("SELECT count(*)::int AS n FROM audit_logs WHERE entity_type = 'task' AND entity_id = $1", [taskId]);
  const outbox = await count("SELECT count(*)::int AS n FROM outbox_events WHERE aggregate_type = 'Task' AND aggregate_id = $1", [taskId]);
  (result.scenarios as Record<string, unknown>).B_task = {
    isErr,
    statusAfterFailure: status,
    historyRows: history,
    auditRows: audits,
    outboxRows: outbox,
    defect: status === 'completed' && audits === 0,
    expectedAfterFix: 'falha na auditoria => rollback total (status pendente, 0 histórico, 0 auditoria, 0 outbox)',
  };
}

async function scenarioAlert(): Promise<void> {
  const tag = `prod18-alert-${randomUUID()}`;
  const { conversationId } = await fixtureContactConversation(tag);
  const userId = await createUser(tag);
  const alert = await pool.query<{ id: string }>(
    `INSERT INTO alerts (conversation_id, type, title, severity, status)
     VALUES ($1, 'system', $2, 'info', 'active') RETURNING id`,
    [conversationId, `repro alert ${tag}`],
  );
  const alertId = alert.rows[0]!.id;
  await installFailTrigger('audit_logs', 'prod18_fail_alert_audit');
  let isErr = false;
  try {
    const outcome = await acknowledgeAlert({ alertId, acknowledgedBy: userId, userId });
    isErr = outcome.isErr();
  } finally {
    await dropFailTrigger('audit_logs', 'prod18_fail_alert_audit');
  }
  const status = (await pool.query<{ status: string }>('SELECT status FROM alerts WHERE id = $1', [alertId])).rows[0]?.status;
  const events = await count('SELECT count(*)::int AS n FROM alert_events WHERE alert_id = $1', [alertId]);
  const audits = await count("SELECT count(*)::int AS n FROM audit_logs WHERE entity_type = 'alert' AND entity_id = $1", [alertId]);
  const outbox = await count("SELECT count(*)::int AS n FROM outbox_events WHERE aggregate_type = 'Alert' AND aggregate_id = $1", [alertId]);
  (result.scenarios as Record<string, unknown>).C_alert = {
    isErr,
    statusAfterFailure: status,
    alertEvents: events,
    auditRows: audits,
    outboxRows: outbox,
    defect: status === 'acknowledged' && audits === 0,
    expectedAfterFix: 'falha na auditoria => rollback total (status ativo, 0 evento, 0 auditoria, 0 outbox)',
  };
}

async function scenarioTransfer(): Promise<void> {
  const tag = `prod18-transfer-${randomUUID()}`;
  const { contactId, conversationId } = await fixtureContactConversation(tag);
  const userId = await createUser(tag);
  const sectorA = (await pool.query<{ id: string }>('INSERT INTO sectors (name, code, is_active) VALUES ($1, $2, true) RETURNING id', [`A ${tag}`, `a${tag}`.slice(0, 50)])).rows[0]!.id;
  const sectorB = (await pool.query<{ id: string }>('INSERT INTO sectors (name, code, is_active) VALUES ($1, $2, true) RETURNING id', [`B ${tag}`, `b${tag}`.slice(0, 50)])).rows[0]!.id;
  await pool.query('INSERT INTO contact_sectors (contact_id, sector_id, status) VALUES ($1, $2, $3)', [contactId, sectorA, 'active']);
  await installFailTrigger('contact_sectors', 'prod18_fail_contact_sector');
  let isErr = false;
  let thrownMessage: string | null = null;
  try {
    const outcome = await createTransfer({
      contactId,
      conversationId,
      fromSectorId: sectorA,
      toSectorId: sectorB,
      fromUserId: userId,
      autoAccept: true,
    });
    isErr = outcome.isErr();
  } catch (error) {
    isErr = true;
    thrownMessage = error instanceof Error ? error.message : String(error);
  } finally {
    await dropFailTrigger('contact_sectors', 'prod18_fail_contact_sector');
  }
  const transferStatus = (await pool.query<{ status: string }>('SELECT status FROM contact_transfers WHERE conversation_id = $1', [conversationId])).rows[0]?.status;
  const conversationSector = (await pool.query<{ sector_id: string }>('SELECT sector_id FROM conversations WHERE id = $1', [conversationId])).rows[0]?.sector_id;
  const contactLinks = await count('SELECT count(*)::int AS n FROM contact_sectors WHERE contact_id = $1', [contactId]);
  const audits = await count("SELECT count(*)::int AS n FROM audit_logs WHERE entity_type = 'contact_transfer'");
  const outbox = await count("SELECT count(*)::int AS n FROM outbox_events WHERE aggregate_type = 'ContactTransfer'");
  (result.scenarios as Record<string, unknown>).D_transfer = {
    isErr,
    thrownMessage,
    transferStatusAfterFailure: transferStatus,
    conversationSectorAfterFailure: conversationSector === sectorB ? 'moved_to_B' : 'unchanged',
    contactLinkRows: contactLinks,
    auditRows: audits,
    outboxRows: outbox,
    defect: transferStatus === 'accepted' && conversationSector === sectorB && contactLinks < 2,
    expectedAfterFix: 'falha no vínculo => rollback total (0 transferência, conversa no setor A, vínculo original)',
  };
}

async function scenarioChatOperations(): Promise<void> {
  (result.scenarios as Record<string, unknown>).E_chat_operations = {
    publicRoutesBefore: [
      'GET /conversations',
      'GET /conversations/:id/messages',
      'POST /conversations/:id/read',
      'POST /messages',
      'PATCH /kanban/card/:id/move (status/assign fora do módulo chat)',
    ],
    missingPublicOperations: [
      'PATCH /conversations/:id/state',
      'POST /conversations/:id/assign',
      'POST /conversations/:id/handoff',
    ],
    defect: true,
    evidence: 'modules/chat/src/presentation/http/outbound.controller.ts registra apenas as rotas acima; não há controller de estado/atribuição/handoff (UI05).',
    expectedAfterFix: 'operações públicas de estado/atribuição/handoff transacionais com CAS, auditoria e outbox.',
  };
}

async function main(): Promise<void> {
  await scenarioNote();
  await scenarioTask();
  await scenarioAlert();
  await scenarioTransfer();
  await scenarioChatOperations();
  result.verdict = Object.values(result.scenarios as Record<string, { defect?: boolean }>).some((scenario) => scenario.defect)
    ? 'DEFECT_REPRODUCED'
    : 'NO_DEFECT_OBSERVED';
  mkdirSync(join(HERE, 'logs'), { recursive: true });
  writeFileSync(join(HERE, 'logs', 'repro-antes.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error('[PROD-18 repro] falha fatal:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
