/**
 * PROD-09 — Reprodução dos defeitos ANTES do delta (candidato 754f9bad + worktree).
 *
 * Executa o CÓDIGO REAL do worker no estado anterior contra PostgreSQL
 * ISOLADO do harness AAA (exige marcador `cvg_aaa_*` no DATABASE_URL; nunca o
 * banco do host). A saída registrada em `logs/repro-antes.log` é o artefato do
 * estado anterior; a contraprova pós-delta é a suíte `prod-09.test.ts`.
 *
 * Defeitos reproduzidos (BE11/BE12):
 *  A) `createAlert` não tem chave de dedup por (eventId, consumer, efeito):
 *     replay do MESMO eventId cria um SEGUNDO alerta lógico;
 *  B) `Err` de `createAlert` é apenas logado e o handler resolve: o worker
 *     ACK o evento SEM efeito (perda silenciosa), sem retry/NACK e sem DLQ;
 *  C) o efeito de handoff usa `type: 'handoff'`, que NÃO existe no enum
 *     `alert_type` — o alerta de handoff nunca pôde ser criado (efeito
 *     permanentemente perdido, mascarado pelo ACK de B).
 *
 * Uso (runner isolado):
 * node scripts/production/run-integration-isolated.mjs --run-id prod09-repro \
 *   --worker 23 -- pnpm exec tsx docs/producao-2026-09-13/evidencias/prod-09/repro-antes.ts
 */
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool } from '@cvg/database';
import { createAlert } from '@cvg/alerts';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATABASE_URL = process.env.DATABASE_URL || '';

if (!/cvg_aaa_/.test(DATABASE_URL)) {
  throw new Error(`[PROD-09 repro] DATABASE_URL sem marcador cvg_aaa_* — abortado`);
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

async function waitFor(check: () => Promise<boolean>, timeoutMs = 20_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return check();
}

async function main(): Promise<void> {
  const tag = `prod09-repro-${randomUUID()}`;

  // Fixture mínima: alertas exigem conversa existente (FK).
  const contact = await pool.query<{ id: string }>(
    "INSERT INTO contacts (name, phone) VALUES ($1, $2) RETURNING id",
    [`repro ${tag}`, `+5511${Date.now() % 1_000_000_000}`],
  );
  const conversation = await pool.query<{ id: string }>(
    `INSERT INTO conversations (external_conversation_id, external_channel_id, status, status_v2, contact_id)
     VALUES ($1, 'whatsapp', 'open', 'novo', $2) RETURNING id`,
    [`${tag}-conv`, contact.rows[0]!.id],
  );
  const conversationId = conversation.rows[0]!.id;

  // A) Replay do MESMO eventId: sem chave (eventId, consumer, efeito) o efeito
  //    é recriado. type 'system' é válido para isolar o defeito de dedup do
  //    defeito de enum do cenário C.
  const replayEventId = `${tag}-replay`;
  const replayInput = {
    conversationId,
    type: 'system',
    title: 'Replay sem dedup',
    message: 'Motivo: repro-replay',
    severity: 'info' as const,
    metadata: { eventId: replayEventId },
  };
  const first = await createAlert(replayInput);
  const second = await createAlert(replayInput);
  const replayAlerts = await count(
    "SELECT count(*)::int AS n FROM alerts WHERE conversation_id = $1 AND metadata LIKE '%' || $2 || '%'",
    [conversationId, replayEventId],
  );
  result.scenarios = {
    ...(result.scenarios as Record<string, unknown>),
    A_replay_sem_dedup: {
      description: 'mesmo eventId aplicado 2x (replay)',
      eventId: replayEventId,
      firstIsOk: first.isOk(),
      secondIsOk: second.isOk(),
      alertsCreated: replayAlerts,
      expectedWithDedup: 1,
      defect: replayAlerts > 1,
    },
  };

  // B) Err de createAlert engolido: um trigger real faz o insert de alerta
  //    falhar UMA vez; o evento secretary.invocation (type 'system', válido)
  //    é publicado no outbox e o worker REAL (index.ts) processa. Estado
  //    anterior: loga o Err com o conteúdo do payload, resolve o handler, dá
  //    ACK e não grava DLQ — efeito perdido e PII no log.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS prod09_repro_gate (point TEXT PRIMARY KEY, fail_remaining INTEGER NOT NULL);
    CREATE OR REPLACE FUNCTION prod09_repro_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE remaining integer;
    BEGIN
      SELECT fail_remaining INTO remaining FROM prod09_repro_gate WHERE point = 'alerts';
      IF remaining IS NOT NULL AND remaining > 0 THEN
        UPDATE prod09_repro_gate SET fail_remaining = remaining - 1 WHERE point = 'alerts';
        RAISE EXCEPTION 'prod09 repro injected failure at alerts';
      END IF;
      RETURN NEW;
    END;
    $$;
    DROP TRIGGER IF EXISTS prod09_repro_fail_alerts ON alerts;
    CREATE TRIGGER prod09_repro_fail_alerts BEFORE INSERT ON alerts
      FOR EACH ROW EXECUTE FUNCTION prod09_repro_guard();
    INSERT INTO prod09_repro_gate (point, fail_remaining) VALUES ('alerts', 1)
      ON CONFLICT (point) DO UPDATE SET fail_remaining = 1;
  `);

  const piiMarker = `pii-${randomUUID()}`;
  const lostEventId = `${tag}-lost`;
  await pool.query(
    `INSERT INTO outbox_events
       (event_id, event_type, event_version, aggregate_type, aggregate_id, occurred_at, payload, correlation_id, version)
     VALUES ($1, 'secretary.invocation', 1, 'Conversation', $2, NOW(), $3, $4, 1)`,
    [
      lostEventId,
      conversationId,
      JSON.stringify({
        conversationId,
        status: 'failed',
        action: 'respond',
        errorMessage: `falha com ${piiMarker}`,
      }),
      `${tag}-corr`,
    ],
  );

  process.env.WORKER_OWNER = `repro-${process.pid}`;
  process.env.WORKER_HEALTH_PORT = String(19090 + Number(process.env.AAA_WORKER_INDEX || 0));
  process.env.OUTBOX_POLL_INTERVAL_MS = '200';
  const workerModule = await import('../../../../apps/message-worker/src/index.ts');
  void workerModule;

  const processed = await waitFor(async () => {
    const rows = await pool.query<{ processed_at: Date | null }>(
      "SELECT processed_at FROM outbox_consumer_acks WHERE event_id = $1 AND consumer_id = 'worker'",
      [lostEventId],
    );
    return rows.rows[0]?.processed_at != null;
  });

  const ack = await pool.query<{ processed_at: Date | null; retry_count: number; last_error: string | null }>(
    "SELECT processed_at, retry_count, last_error FROM outbox_consumer_acks WHERE event_id = $1 AND consumer_id = 'worker'",
    [lostEventId],
  );
  const lostAlerts = await count(
    "SELECT count(*)::int AS n FROM alerts WHERE conversation_id = $1 AND message LIKE '%' || $2 || '%'",
    [conversationId, piiMarker],
  );
  const dlqRows = await count(
    'SELECT count(*)::int AS n FROM dead_letter_events WHERE original_event_id = $1',
    [lostEventId],
  );

  result.scenarios = {
    ...(result.scenarios as Record<string, unknown>),
    B_err_engolido_ack_sem_efeito: {
      description: 'falha injetada no INSERT do alerta; worker processa o evento',
      eventId: lostEventId,
      processedAtSet: ack.rows[0]?.processed_at != null,
      consumerRetryCount: ack.rows[0]?.retry_count ?? null,
      alertsCreated: lostAlerts,
      deadLetterRows: dlqRows,
      defect: processed && ack.rows[0]?.processed_at != null && lostAlerts === 0 && dlqRows === 0,
    },
  };

  // C) Efeito real de handoff: `type: 'handoff'` não existe no enum alert_type.
  const handoffAttempt = await createAlert({
    conversationId,
    type: 'handoff',
    title: 'Conversa transferida para atendimento humano',
    message: 'Motivo: repro-handoff',
    severity: 'info',
    metadata: { eventId: `${tag}-handoff`, newHandler: 'human' },
  });
  result.scenarios = {
    ...(result.scenarios as Record<string, unknown>),
    C_handoff_enum_invalido: {
      description: "mesmo input do worker (type 'handoff')",
      isErr: handoffAttempt.isErr(),
      error: handoffAttempt.isErr() ? handoffAttempt.error.message.slice(0, 200) : null,
      alertsCreated: await count(
        "SELECT count(*)::int AS n FROM alerts WHERE conversation_id = $1 AND title = 'Conversa transferida para atendimento humano'",
        [conversationId],
      ),
      defect: handoffAttempt.isErr(),
    },
  };

  const scenarios = result.scenarios as Record<string, { defect: boolean }>;
  result.verdict =
    scenarios.A_replay_sem_dedup.defect && scenarios.B_err_engolido_ack_sem_efeito.defect && scenarios.C_handoff_enum_invalido.defect
      ? 'DEFECT_REPRODUCED'
      : 'NO_DEFECT_OBSERVED';

  writeFileSync(join(HERE, 'repro-antes.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error('[PROD-09 repro] falha:', error);
  process.exit(1);
});
