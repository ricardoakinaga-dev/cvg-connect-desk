/**
 * PROD-08 — Reprodução dos defeitos de corrida no primeiro inbound.
 *
 * Candidato-base: 754f9bad (worktree preservada). Este script usa o código REAL
 * de `persistInboundAtomically` no estado ANTERIOR ao delta, contra PostgreSQL
 * ISOLADO do harness AAA (exige marcador `cvg_aaa_*` no DATABASE_URL; nunca o
 * banco do host). A saída registrada em `logs/repro-antes.log` é o artefato do
 * estado anterior; a contraprova pós-delta é a mesma execução com o fix.
 *
 * Uso (runner isolado, worker 16 → PG:58032/Redis:56840):
 * node scripts/production/run-integration-isolated.mjs --run-id prod08-repro \
 *   --worker 16 -- pnpm exec tsx docs/producao-2026-09-13/evidencias/prod-08/repro-antes.ts
 *
 * Defeitos observados (BE08):
 *  A) mesma primeira mensagem concorrente SEM externalConversationId: a
 *     transação perdedora detecta a duplicata da mensagem e RETORNA (commit),
 *     deixando uma CONVERSA ÓRFÃ (sem mensagem) + `conversation.created` no
 *     outbox;
 *  B) mesma primeira mensagem concorrente COM externalConversationId: o
 *     perdedor colide no índice único e FALHA (não é 2xx idempotente).
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool } from '@cvg/database';
import { getSharedRealtimeBus, setSharedRealtimeBus } from '@cvg/events';
import { persistInboundAtomically } from '../../../../modules/chat/src/infrastructure/repositories/inbound-atomic.repository';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATABASE_URL = process.env.DATABASE_URL || '';

const result: Record<string, unknown> = {
  generatedAt: new Date().toISOString(),
  runId: process.env.AAA_RUN_ID || null,
  database: DATABASE_URL.replace(/:\/\/[^@]*@/, '://***@'),
};

function assertIsolated(): void {
  if (!/cvg_aaa_/.test(DATABASE_URL)) {
    throw new Error(`[PROD-08 repro] DATABASE_URL sem marcador cvg_aaa_* — abortado: ${DATABASE_URL}`);
  }
}

const pool = getPool();

async function count(query: string, params: unknown[]): Promise<number> {
  const rows = (await pool.query(query, params)).rows as Array<{ n: number }>;
  return Number(rows[0]?.n ?? 0);
}

interface ScenarioA {
  winnerConversationId: string | null;
  loserConversationId: string | null;
  messages: number;
  orphanConversations: number;
  orphanConversationCreatedEvents: number;
  orphanStatusHistory: number;
  winnerUnread: number;
}

async function scenarioA(): Promise<ScenarioA> {
  const tag = `prod08-repro-a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const phone = `+5511${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
  const phoneDigits = phone.replace(/\D/g, '');
  const input = {
    externalMessageId: `${tag}-msg`,
    content: `repro-antes-a-${tag}`,
    sender: phone,
    senderType: 'contact' as const,
    contactPhone: phone,
    contactName: 'Repro PROD-08',
    sentAt: new Date(),
  };

  const [a, b] = await Promise.all([persistInboundAtomically(input), persistInboundAtomically(input)]);

  const messages = await count('SELECT count(*)::int AS n FROM messages WHERE external_message_id = $1', [input.externalMessageId]);
  const conversationsForMessage = (await pool.query(
    'SELECT conversation_id FROM messages WHERE external_message_id = $1',
    [input.externalMessageId],
  )).rows as Array<{ conversation_id: string }>;

  const orphanRows = (await pool.query(
    `SELECT c.id
       FROM conversations c
       JOIN contacts ct ON ct.id = c.contact_id
      WHERE ct.phone = $1
        AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id)`,
    [phoneDigits],
  )).rows as Array<{ id: string }>;
  const orphanIds = orphanRows.map((row) => row.id);

  let orphanEvents = 0;
  let orphanHistory = 0;
  if (orphanIds.length > 0) {
    orphanEvents = await count(
      `SELECT count(*)::int AS n FROM outbox_events
        WHERE event_type = 'conversation.created' AND aggregate_id = ANY($1::text[])`,
      [orphanIds],
    );
    orphanHistory = await count(
      `SELECT count(*)::int AS n FROM conversation_status_history WHERE conversation_id = ANY($1::uuid[])`,
      [orphanIds],
    );
  }

  const unreadRows = (await pool.query(
    `SELECT max(c.unread_count)::int AS unread
       FROM conversations c
       JOIN messages m ON m.conversation_id = c.id
      WHERE m.external_message_id = $1`,
    [input.externalMessageId],
  )).rows as Array<{ unread: number }>;

  return {
    winnerConversationId: conversationsForMessage[0]?.conversation_id ?? null,
    loserConversationId: orphanIds[0] ?? null,
    messages,
    orphanConversations: orphanIds.length,
    orphanConversationCreatedEvents: orphanEvents,
    orphanStatusHistory: orphanHistory,
    winnerUnread: Number(unreadRows[0]?.unread ?? 0),
  };
}

interface ScenarioB {
  iterations: number;
  loserErrors: number;
  bothOk: number;
  maxConversations: number;
  maxMessages: number;
  sampleError: string | null;
}

async function scenarioB(iterations = 8): Promise<ScenarioB> {
  let loserErrors = 0;
  let bothOk = 0;
  let maxConversations = 0;
  let maxMessages = 0;
  let sampleError: string | null = null;

  for (let i = 0; i < iterations; i += 1) {
    const tag = `prod08-repro-b-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`;
    const externalConversationId = `${tag}-conv`;
    const input = {
      externalMessageId: `${tag}-msg`,
      externalConversationId,
      content: `repro-antes-b-${tag}`,
      sender: '+5511900000000',
      senderType: 'contact' as const,
      sentAt: new Date(),
    };

    const settled = await Promise.allSettled([
      persistInboundAtomically(input),
      persistInboundAtomically(input),
    ]);
    const failures = settled.filter((entry) => entry.status === 'rejected');
    loserErrors += failures.length;
    if (failures.length === 0) bothOk += 1;
    if (failures.length > 0 && sampleError === null) {
      sampleError = String((failures[0] as PromiseRejectedResult).reason?.message ?? failures[0]);
    }

    maxConversations = Math.max(
      maxConversations,
      await count('SELECT count(*)::int AS n FROM conversations WHERE external_conversation_id = $1', [externalConversationId]),
    );
    maxMessages = Math.max(
      maxMessages,
      await count('SELECT count(*)::int AS n FROM messages WHERE external_message_id = $1', [input.externalMessageId]),
    );
  }

  return { iterations, loserErrors, bothOk, maxConversations, maxMessages, sampleError };
}

async function main(): Promise<void> {
  assertIsolated();
  const a = await scenarioA();
  const b = await scenarioB();

  result.scenarioA = a;
  result.scenarioB = b;
  result.defects = {
    orphanConversationsCommitted: a.orphanConversations > 0,
    orphanOutboxEventsCommitted: a.orphanConversationCreatedEvents > 0,
    duplicateLogicalConversations: a.messages > 0 && a.orphanConversations > 0,
    loserNotIdempotent: b.loserErrors > 0,
  };
  result.verdict =
    a.orphanConversations > 0 || b.loserErrors > 0
      ? 'DEFECT_REPRODUCED'
      : 'NO_DEFECT_OBSERVED';

  writeFileSync(join(HERE, 'repro-result.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result));
  // Hints pós-commit abrem o bus compartilhado (Redis); encerra para o runner
  // completar o teardown em vez de ficar preso em sockets abertos.
  try {
    const bus = await getSharedRealtimeBus();
    await bus.stop();
  } catch {
    // best-effort: um hint perdido não invalida a reprodução
  }
  setSharedRealtimeBus(null);
  await pool.end();
  process.exit(0);
}

main().catch((error) => {
  console.error('[PROD-08 repro] falha:', error);
  process.exitCode = 1;
});
