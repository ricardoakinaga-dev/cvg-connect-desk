/**
 * PROD-09 — Contraprova DEPOIS do delta (mesmos cenários de repro-antes.ts).
 *
 * Roda com o CÓDIGO CORRIGIDO contra PostgreSQL isolado do harness AAA:
 *  A) mesmo efeito idempotente 2x → UM alerta (recibo durável);
 *  B) Err persistente do efeito no worker REAL → NACK/retry com orçamento e,
 *     esgotado, DLQ durável com envelope íntegro — nunca ACK de sucesso;
 *  C) o efeito de handoff (`type: 'handoff'`) passa a ser criável.
 *
 * Uso (runner isolado):
 * node scripts/production/run-integration-isolated.mjs --run-id prod09-contra \
 *   --worker 27 -- pnpm exec tsx docs/producao-2026-09-13/evidencias/prod-09/repro-depois.ts
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
  throw new Error('[PROD-09 contraprova] DATABASE_URL sem marcador cvg_aaa_* — abortado');
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

async function waitFor(check: () => Promise<boolean>, timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return check();
}

async function main(): Promise<void> {
  const tag = `prod09-contra-${randomUUID()}`;

  const contact = await pool.query<{ id: string }>(
    'INSERT INTO contacts (name, phone) VALUES ($1, $2) RETURNING id',
    [`contra ${tag}`, `+5511${Date.now() % 1_000_000_000}`],
  );
  const conversation = await pool.query<{ id: string }>(
    `INSERT INTO conversations (external_conversation_id, external_channel_id, status, status_v2, contact_id)
     VALUES ($1, 'whatsapp', 'open', 'novo', $2) RETURNING id`,
    [`${tag}-conv`, contact.rows[0]!.id],
  );
  const conversationId = conversation.rows[0]!.id;

  // A) Replay do MESMO (eventId, consumer, efeito): dedup durável.
  const replayEventId = `${tag}-replay`;
  const key = { eventId: replayEventId, consumerId: 'worker', effectType: 'alert:handoff.completed' };
  const replayInput = {
    conversationId,
    type: 'handoff',
    title: 'Replay com dedup',
    message: 'Motivo: contra-replay',
    severity: 'info' as const,
    metadata: { eventId: replayEventId },
  };
  const first = await createAlert(replayInput, { idempotency: key });
  const second = await createAlert(replayInput, { idempotency: key });
  const replayAlerts = await count(
    'SELECT count(*)::int AS n FROM worker_effect_receipts r JOIN alerts a ON a.id::text = r.result_ref WHERE r.event_id = $1',
    [replayEventId],
  );
  result.scenarios = {
    ...(result.scenarios as Record<string, unknown>),
    A_replay_com_dedup: {
      firstIsOk: first.isOk(),
      secondIsOk: second.isOk(),
      firstDeduplicated: first.isOk() ? first.value.deduplicated : null,
      secondDeduplicated: second.isOk() ? second.value.deduplicated : null,
      sameAlertId: first.isOk() && second.isOk() ? first.value.id === second.value.id : false,
      alertsCreated: replayAlerts,
      defect: !(first.isOk() && second.isOk() && replayAlerts === 1 && second.value.deduplicated === true),
    },
  };

  // B) Err persistente do efeito no worker REAL: retry orçado → DLQ durável.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS prod09_contra_gate (point TEXT PRIMARY KEY, fail_remaining INTEGER NOT NULL);
    CREATE OR REPLACE FUNCTION prod09_contra_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE remaining integer;
    BEGIN
      SELECT fail_remaining INTO remaining FROM prod09_contra_gate WHERE point = 'alerts';
      IF remaining IS NOT NULL AND remaining > 0 THEN
        UPDATE prod09_contra_gate SET fail_remaining = remaining - 1 WHERE point = 'alerts';
        RAISE EXCEPTION 'prod09 contra injected persistent failure at alerts';
      END IF;
      RETURN NEW;
    END;
    $$;
    DROP TRIGGER IF EXISTS prod09_contra_fail_alerts ON alerts;
    CREATE TRIGGER prod09_contra_fail_alerts BEFORE INSERT ON alerts
      FOR EACH ROW EXECUTE FUNCTION prod09_contra_guard();
    INSERT INTO prod09_contra_gate (point, fail_remaining) VALUES ('alerts', 1000000)
      ON CONFLICT (point) DO UPDATE SET fail_remaining = 1000000;
  `);

  const lostEventId = `${tag}-lost`;
  await pool.query(
    `INSERT INTO outbox_events
       (event_id, event_type, event_version, aggregate_type, aggregate_id, occurred_at, payload, correlation_id, version)
     VALUES ($1, 'handoff.completed', 1, 'Conversation', $2, NOW(), $3, $4, 1)`,
    [
      lostEventId,
      conversationId,
      JSON.stringify({
        conversationId,
        previousHandler: 'bot',
        newHandler: 'human',
        reason: 'contra-erro-persistente',
      }),
      `${tag}-corr`,
    ],
  );

  process.env.WORKER_OWNER = `contra-${process.pid}`;
  process.env.WORKER_HEALTH_PORT = String(19200 + Number(process.env.AAA_WORKER_INDEX || 0));
  process.env.OUTBOX_POLL_INTERVAL_MS = '100';
  process.env.WORKER_MAX_RETRIES = '2';
  process.env.WORKER_LEASE_SECONDS = '3';
  process.env.WORKER_RETRY_INITIAL_DELAY_MS = '50';
  process.env.WORKER_RETRY_MAX_DELAY_MS = '100';
  await import('../../../../apps/message-worker/src/index.ts');

  const dlqArrived = await waitFor(async () => {
    const n = await count('SELECT count(*)::int AS n FROM dead_letter_events WHERE original_event_id = $1', [lostEventId]);
    return n === 1;
  });

  const ack = await pool.query<{ processed_at: Date | null; retry_count: number; last_error: string | null }>(
    "SELECT processed_at, retry_count, last_error FROM outbox_consumer_acks WHERE event_id = $1 AND consumer_id = 'worker'",
    [lostEventId],
  );
  const dlq = await pool.query<{ status: string; error_code: string; payload: Record<string, unknown> }>(
    'SELECT status, error_code, payload FROM dead_letter_events WHERE original_event_id = $1',
    [lostEventId],
  );
  const lostAlerts = await count('SELECT count(*)::int AS n FROM worker_effect_receipts WHERE event_id = $1', [lostEventId]);
  const envelope = dlq.rows[0]?.payload as { event_id?: string; event_type?: string; payload?: { conversationId?: string } } | undefined;

  result.scenarios = {
    ...(result.scenarios as Record<string, unknown>),
    B_err_persistente_dlq: {
      dlqArrived,
      processedAtSet: ack.rows[0]?.processed_at != null,
      consumerRetryCount: ack.rows[0]?.retry_count ?? null,
      lastErrorPresent: Boolean(ack.rows[0]?.last_error),
      dlqStatus: dlq.rows[0]?.status ?? null,
      dlqErrorCode: dlq.rows[0]?.error_code ?? null,
      envelopeEventIdMatches: envelope?.event_id === lostEventId,
      envelopeConversationMatches: envelope?.payload?.conversationId === conversationId,
      alertsCreated: lostAlerts,
      defect: !(dlqArrived && ack.rows[0]?.processed_at == null && ack.rows[0]?.retry_count === 2 && lostAlerts === 0),
    },
  };

  // Desarma a falha injetada ANTES do cenário C (o gate é só do cenário B).
  await pool.query('DROP TRIGGER IF EXISTS prod09_contra_fail_alerts ON alerts');
  await pool.query('DELETE FROM prod09_contra_gate');

  // C) Efeito de handoff agora é criável (enum aditivo).
  const handoffAttempt = await createAlert({
    conversationId,
    type: 'handoff',
    title: 'Conversa transferida para atendimento humano',
    message: 'Motivo: contra-handoff',
    severity: 'info',
    metadata: { eventId: `${tag}-handoff`, newHandler: 'human' },
  });
  result.scenarios = {
    ...(result.scenarios as Record<string, unknown>),
    C_handoff_valido: {
      isOk: handoffAttempt.isOk(),
      deduplicated: handoffAttempt.isOk() ? handoffAttempt.value.deduplicated : null,
      alertsCreated: await count(
        "SELECT count(*)::int AS n FROM alerts WHERE conversation_id = $1 AND title = 'Conversa transferida para atendimento humano' AND message = 'Motivo: contra-handoff'",
        [conversationId],
      ),
      defect: !handoffAttempt.isOk(),
    },
  };

  await pool.query('DROP TRIGGER IF EXISTS prod09_contra_fail_alerts ON alerts');
  await pool.query('DELETE FROM prod09_contra_gate');

  const scenarios = result.scenarios as Record<string, { defect: boolean }>;
  result.verdict = Object.values(scenarios).every((scenario) => !scenario.defect)
    ? 'NO_DEFECT_OBSERVED'
    : 'DEFECT_STILL_PRESENT';

  writeFileSync(join(HERE, 'repro-depois.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error('[PROD-09 contraprova] falha:', error);
  process.exit(1);
});
