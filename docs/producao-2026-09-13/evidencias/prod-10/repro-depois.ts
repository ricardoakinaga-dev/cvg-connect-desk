/**
 * PROD-10 — Contraprova DEPOIS do delta (mesmos cenários do repro-antes).
 *
 * Executa o CÓDIGO NOVO contra PostgreSQL ISOLADO do harness AAA (marcador
 * `cvg_aaa_*` obrigatório) com o worker REAL em processo e sandboxes HTTP de
 * Secretary/Gateway; a saída é o artefato de veredito pós-delta.
 *
 *  A) webhook NÃO espera a IA: com Secretary lenta (3s) o retorno é rápido e a
 *     resposta chega de forma assíncrona pelo worker;
 *  B) duplicata inbound NÃO perde a invocação: a intenção durável sobrevive ao
 *     1º erro da IA e conclui quando o provider volta (exatamente 1 resposta);
 *  C) `message.persisted` deixa de ser só log: a invocação é registrada em
 *     `secretary_invocations` (estado + resultado).
 *
 * Uso (runner isolado):
 * node scripts/production/run-integration-isolated.mjs --run-id prod10-contra \
 *   --worker 32 -- pnpm exec tsx docs/producao-2026-09-13/evidencias/prod-10/repro-depois.ts
 */
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool } from '@cvg/database';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATABASE_URL = process.env.DATABASE_URL || '';

if (!/cvg_aaa_/.test(DATABASE_URL)) {
  throw new Error('[PROD-10 contra] DATABASE_URL sem marcador cvg_aaa_* — abortado');
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

async function waitFor(check: () => Promise<boolean>, timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return check();
}

type SecretaryMode = 'ok' | 'fail';

let secretaryMode: SecretaryMode = 'ok';
let secretaryDelayMs = 0;
let secretaryInvocations = 0;

function startServers(): Promise<{ close: () => void }> {
  return new Promise((resolveServers) => {
    const secretary: Server = createServer((request, response) => {
      if (request.url !== '/invoke') {
        response.writeHead(404).end();
        return;
      }
      secretaryInvocations += 1;
      const reply = () => {
        if (secretaryMode === 'fail') {
          response.writeHead(503, { 'content-type': 'text/plain' });
          response.end('secretary unavailable');
          return;
        }
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          success: true,
          response: 'resposta-da-ia',
          classification: { category: 'general', priority: 'low', confidence: 0.9 },
        }));
      };
      if (secretaryDelayMs > 0) {
        const timer = setTimeout(reply, secretaryDelayMs);
        timer.unref();
      } else {
        reply();
      }
    });
    const gateway: Server = createServer((request, response) => {
      if (request.url !== '/webhooks/desk') {
        response.writeHead(404).end();
        return;
      }
      request.on('data', () => undefined);
      request.on('end', () => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ status: 'queued', operation_id: `gw-${randomUUID().slice(0, 8)}` }));
      });
    });

    secretary.listen(0, '127.0.0.1', () => {
      gateway.listen(0, '127.0.0.1', () => {
        const secretaryPort = (secretary.address() as AddressInfo).port;
        const gatewayPort = (gateway.address() as AddressInfo).port;
        process.env.SECRETARY_URL = `http://127.0.0.1:${secretaryPort}`;
        process.env.SECRETARY_API_KEY = 'prod10-contra';
        process.env.SECRETARY_TIMEOUT_MS = '20000';
        process.env.GATEWAY_URL = `http://127.0.0.1:${gatewayPort}`;
        process.env.GATEWAY_API_KEY = 'prod10-contra';
        process.env.GATEWAY_PROVIDER_IDEMPOTENCY = 'true';
        process.env.WORKER_HEALTH_PORT = String(19500 + Number(process.env.AAA_WORKER_INDEX || 0));
        process.env.OUTBOX_POLL_INTERVAL_MS = '100';
        process.env.WORKER_MAX_RETRIES = '3';
        process.env.WORKER_RETRY_INITIAL_DELAY_MS = '200';
        process.env.WORKER_RETRY_MAX_DELAY_MS = '500';
        process.env.WORKER_RETRY_BACKOFF_MULTIPLIER = '1';
        resolveServers({
          close: () => {
            secretary.close();
            gateway.close();
          },
        });
      });
    });
  });
}

async function main(): Promise<void> {
  const servers = await startServers();
  // O worker REAL (index.ts) inicia o poller no import; os sandboxes já estão
  // no ambiente e o banco é o isolado do runner.
  const workerModule = await import('../../../../apps/message-worker/src/index.ts');
  const { receiveInboundMessage } = await import('../../../../modules/chat/src/application/use-cases/receive-inbound-message.use-case.ts');
  void workerModule;

  const tag = `prod10-contra-${randomUUID()}`;

  // A) Webhook rápido com IA lenta.
  secretaryDelayMs = 3_000;
  secretaryMode = 'ok';
  const aMessageId = `${tag}-A-msg`;
  const aConversationId = `${tag}-A-conv`;
  const aStarted = Date.now();
  const a = await receiveInboundMessage({
    externalMessageId: aMessageId,
    externalConversationId: aConversationId,
    content: `conteudo-A-${tag}`,
    sender: '+5511900030303',
    senderType: 'contact',
    sentAt: new Date(),
  });
  const aElapsed = Date.now() - aStarted;
  const aReplyArrived = await waitFor(async () => {
    return (
      await count(
        `SELECT count(*)::int AS n FROM messages m
           JOIN conversations c ON c.id = m.conversation_id
          WHERE c.external_conversation_id = $1 AND m.direction = 'outbound' AND m.content = 'resposta-da-ia'`,
        [aConversationId],
      )
    ) === 1;
  }, 30_000);
  result.scenarios = {
    ...(result.scenarios as Record<string, unknown>),
    A_webhook_assincrono: {
      isOk: a.isOk(),
      elapsedMs: aElapsed,
      secretaryDelayMs: 3000,
      asyncReplyArrived: aReplyArrived,
      defect: !(a.isOk() && aElapsed < 1_000 && aReplyArrived),
    },
  };

  // B) Duplicata inbound com 1ª tentativa falhando: intenção durável sobrevive.
  secretaryDelayMs = 0;
  secretaryMode = 'fail';
  const bMessageId = `${tag}-B-msg`;
  const bConversationId = `${tag}-B-conv`;
  const bFirst = await receiveInboundMessage({
    externalMessageId: bMessageId,
    externalConversationId: bConversationId,
    content: `conteudo-B-${tag}`,
    sender: '+5511900030404',
    senderType: 'contact',
    sentAt: new Date(),
  });
  const bDuplicate = await receiveInboundMessage({
    externalMessageId: bMessageId,
    externalConversationId: bConversationId,
    content: `conteudo-B-${tag}`,
    sender: '+5511900030404',
    senderType: 'contact',
    sentAt: new Date(),
  });
  // Provider "volta" logo depois; o worker retenta a intenção durável.
  setTimeout(() => {
    secretaryMode = 'ok';
  }, 800).unref();

  const bReplyArrived = await waitFor(async () => {
    return (
      await count(
        `SELECT count(*)::int AS n FROM messages m
           JOIN conversations c ON c.id = m.conversation_id
          WHERE c.external_conversation_id = $1 AND m.direction = 'outbound'`,
        [bConversationId],
      )
    ) === 1;
  }, 40_000);
  const bMessages = await count('SELECT count(*)::int AS n FROM messages WHERE external_message_id = $1', [bMessageId]);
  result.scenarios = {
    ...(result.scenarios as Record<string, unknown>),
    B_duplicata_recupera_via_worker: {
      firstIsOk: bFirst.isOk(),
      duplicateIsOk: bDuplicate.isOk(),
      persistedMessages: bMessages,
      replyArrived: bReplyArrived,
      defect: !(bFirst.isOk() && bDuplicate.isOk() && bMessages === 1 && bReplyArrived),
    },
  };

  // C) Estado durável da invocação (não é mais "apenas log"). A resposta é
  //    persistida antes de o worker marcar `completed`; esperar o estado final
  //    evita ler a janela invocação→completion.
  const bMessageRows = (
    await pool.query<{ id: string; conversation_id: string }>(
      'SELECT id, conversation_id FROM messages WHERE external_message_id = $1',
      [bMessageId],
    )
  ).rows;
  const invocationKey = `inbound:${bMessageRows[0]!.id}`;
  await waitFor(async () => {
    const row = (
      await pool.query<{ status: string; result_ref: string | null }>(
        'SELECT status, result_ref FROM secretary_invocations WHERE invocation_key = $1',
        [invocationKey],
      )
    ).rows[0];
    return row?.status === 'completed' && row.result_ref != null;
  }, 20_000);
  const invocation = (
    await pool.query<{ status: string; attempt_count: number; result_ref: string | null; error_code: string | null }>(
      'SELECT status, attempt_count, result_ref, error_code FROM secretary_invocations WHERE invocation_key = $1',
      [invocationKey],
    )
  ).rows[0];
  result.scenarios = {
    ...(result.scenarios as Record<string, unknown>),
    C_estado_duravel_da_invocacao: {
      invocationStatus: invocation?.status ?? null,
      attemptCount: invocation?.attempt_count ?? null,
      resultRef: invocation?.result_ref ?? null,
      errorCode: invocation?.error_code ?? null,
      defect: invocation?.status !== 'completed' || !invocation?.result_ref,
    },
  };

  const scenarios = result.scenarios as Record<string, { defect: boolean }>;
  result.verdict = Object.values(scenarios).every((scenario) => !scenario.defect)
    ? 'NO_DEFECT_OBSERVED'
    : 'DEFECT_OBSERVED';
  result.secretaryInvocations = secretaryInvocations;

  writeFileSync(join(HERE, 'repro-depois.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  servers.close();
  process.exit(0);
}

main().catch((error) => {
  console.error('[PROD-10 contra] falha:', error);
  process.exit(1);
});
