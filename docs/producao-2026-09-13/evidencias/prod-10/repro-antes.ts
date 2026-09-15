/**
 * PROD-10 — Reprodução dos defeitos ANTES do delta (candidato HEAD + worktree).
 *
 * Executa o CÓDIGO REAL de `receiveInboundMessage` e do handler
 * `message.persisted` do worker contra PostgreSQL ISOLADO do harness AAA
 * (exige marcador `cvg_aaa_*` no DATABASE_URL; nunca o banco do host). O
 * sandbox da Secretary é um HTTP local controlado pelo script (lento/erro).
 *
 * Defeitos reproduzidos (BE13/BE14/BE01):
 *  A) webhook SÍNCRONO: `receiveInboundMessage` aguarda a IA — com Secretary
 *     lenta (3s) o retorno demora >= 3s e a resposta outbound só existe
 *     depois que a IA responde;
 *  B) duplicata retorna ANTES da IA: com a 1ª tentativa falhando, o reenvio do
 *     MESMO messageId retorna 200 sem tentar a invocação de novo — a
 *     invocação fica perdida (mensagem persistida, sem resposta e sem retry);
 *  C) o worker apenas LOGa `message.persisted`: o handler não tem efeito
 *     durável algum, logo um crash após o commit perde a invocação para
 *     sempre.
 *
 * Uso (runner isolado):
 * node scripts/production/run-integration-isolated.mjs --run-id prod10-repro \
 *   --worker 24 -- pnpm exec tsx docs/producao-2026-09-13/evidencias/prod-10/repro-antes.ts
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
  throw new Error('[PROD-10 repro] DATABASE_URL sem marcador cvg_aaa_* — abortado');
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

type SecretaryMode = 'ok' | 'fail';

let secretaryMode: SecretaryMode = 'ok';
let secretaryDelayMs = 0;
let secretaryInvocations = 0;
let secretaryCompleted = 0;
const server: Server = createServer((request, response) => {
  if (request.url !== '/invoke') {
    response.writeHead(404).end();
    return;
  }
  secretaryInvocations += 1;
  const reply = () => {
    if (secretaryMode === 'fail') {
      response.writeHead(500, { 'content-type': 'text/plain' });
      response.end('secretary unavailable');
      return;
    }
    secretaryCompleted += 1;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      success: true,
      response: 'resposta-da-ia',
      classification: { category: 'general', priority: 'low', confidence: 0.9 },
    }));
  };
  if (secretaryDelayMs > 0) setTimeout(reply, secretaryDelayMs);
  else reply();
});

async function main(): Promise<void> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  const integrations = await import('../../../../packages/integrations/src/secretary-client.ts');
  integrations.initializeSecretaryClient({
    baseUrl: `http://127.0.0.1:${port}`,
    apiKey: 'prod10-repro',
    timeout: 10_000,
  });

  const gatewayRegistry = await import('../../../../modules/chat/src/application/ports/gateway-outbound-registry.ts');
  let gatewaySends = 0;
  gatewayRegistry.setGatewayOutboundPort({
    providerSupportsIdempotency: () => true,
    // eslint-disable-next-line @typescript-eslint/require-await
    sendOutbound: async () => {
      gatewaySends += 1;
      return { success: true, messageId: `gw-${gatewaySends}` };
    },
  });

  const chat = await import('../../../../modules/chat/src/application/use-cases/receive-inbound-message.use-case.ts');
  const tag = `prod10-repro-${randomUUID()}`;

  // A) Webhook aguarda a IA.
  secretaryDelayMs = 3_000;
  const aStarted = Date.now();
  const a = await chat.receiveInboundMessage({
    externalMessageId: `${tag}-A-msg`,
    externalConversationId: `${tag}-A-conv`,
    content: `conteudo-A-${tag}`,
    sender: '+5511900010101',
    senderType: 'contact',
    sentAt: new Date(),
  });
  const aElapsed = Date.now() - aStarted;
  const aOutbound = await count(
    "SELECT count(*)::int AS n FROM messages WHERE direction = 'outbound' AND content = 'resposta-da-ia'",
  );
  result.scenarios = {
    ...(result.scenarios as Record<string, unknown>),
    A_webhook_sincrono: {
      description: 'Secretary lenta (3000ms) no caminho do webhook',
      isOk: a.isOk(),
      elapsedMs: aElapsed,
      secretaryDelayMs,
      gatewaySends,
      outboundReplies: aOutbound,
      defect: a.isOk() && aElapsed >= 3_000 && gatewaySends === 1,
    },
  };

  // B) Duplicata retorna antes da IA: 1ª tentativa falha; o reenvio do MESMO
  //    messageId não tenta a invocação de novo.
  secretaryDelayMs = 0;
  secretaryMode = 'fail';
  const bFirstInvocations = secretaryInvocations;
  const bFirst = await chat.receiveInboundMessage({
    externalMessageId: `${tag}-B-msg`,
    externalConversationId: `${tag}-B-conv`,
    content: `conteudo-B-${tag}`,
    sender: '+5511900010202',
    senderType: 'contact',
    sentAt: new Date(),
  });
  const bFirstCalls = secretaryInvocations - bFirstInvocations;

  secretaryMode = 'ok';
  const bDuplicateInvocations = secretaryInvocations;
  const bDuplicate = await chat.receiveInboundMessage({
    externalMessageId: `${tag}-B-msg`,
    externalConversationId: `${tag}-B-conv`,
    content: `conteudo-B-${tag}`,
    sender: '+5511900010202',
    senderType: 'contact',
    sentAt: new Date(),
  });
  const bDuplicateCalls = secretaryInvocations - bDuplicateInvocations;
  const bMessages = await count('SELECT count(*)::int AS n FROM messages WHERE external_message_id = $1', [`${tag}-B-msg`]);
  result.scenarios = {
    ...(result.scenarios as Record<string, unknown>),
    B_duplicata_nao_recupera_invocacao: {
      description: '1ª chamada falha na IA; reenvio do mesmo messageId com IA disponível',
      firstIsOk: bFirst.isOk(),
      firstSecretaryCalls: bFirstCalls,
      duplicateIsOk: bDuplicate.isOk(),
      duplicateSecretaryCalls: bDuplicateCalls,
      persistedMessages: bMessages,
      outboundRepliesForB: await count(
        "SELECT count(*)::int AS n FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.external_conversation_id = $1 AND m.direction = 'outbound'",
        [`${tag}-B-conv`],
      ),
      defect: bFirst.isOk() && bDuplicate.isOk() && bDuplicateCalls === 0 && bMessages === 1,
    },
  };

  // C) O handler `message.persisted` do worker apenas loga (nenhum efeito
  //    durável): um crash após o commit do inbound perde a invocação.
  const handlers = await import('../../../../apps/message-worker/src/handlers.ts');
  const workerHandlers = handlers.createHandlers({ info: () => undefined, warn: () => undefined, error: () => undefined });
  const [bMessageRow] = (
    await pool.query<{ id: string; conversation_id: string }>(
      'SELECT id, conversation_id FROM messages WHERE external_message_id = $1',
      [`${tag}-B-msg`],
    )
  ).rows;
  const persistedEvent = {
    event_id: `${tag}-C-event`,
    event_type: 'message.persisted',
    event_version: 1,
    aggregate_type: 'Message',
    aggregate_id: bMessageRow!.id,
    occurred_at: new Date().toISOString(),
    payload: {
      messageId: bMessageRow!.id,
      conversationId: bMessageRow!.conversation_id,
      direction: 'inbound',
      content: `conteudo-B-${tag}`,
      status: 'pending',
      createdAt: new Date().toISOString(),
    },
    version: 1,
  };
  const cEffect = await workerHandlers['message.persisted']!(persistedEvent as never);
  result.scenarios = {
    ...(result.scenarios as Record<string, unknown>),
    C_worker_apenas_loga: {
      description: 'handler real do worker para o evento durável do inbound',
      handlerReturn: cEffect,
      invocationStateRows: await count('SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = $1', ['secretary_invocations']),
      defect: cEffect === null,
    },
  };

  const scenarios = result.scenarios as Record<string, { defect: boolean }>;
  const allDefects = Object.values(scenarios).every((scenario) => scenario.defect);
  result.verdict = allDefects ? 'DEFECT_REPRODUCED' : 'NO_DEFECT_OBSERVED';

  writeFileSync(join(HERE, 'repro-antes.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  server.close();
  process.exit(0);
}

main().catch((error) => {
  console.error('[PROD-10 repro] falha:', error);
  server.close();
  process.exit(1);
});
