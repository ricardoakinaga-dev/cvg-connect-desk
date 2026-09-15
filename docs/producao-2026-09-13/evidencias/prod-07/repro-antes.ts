/**
 * PROD-07 — Reprodução dos defeitos ANTES do delta (candidato `754f9bad`).
 *
 * Executa o guard real de `packages/shared/src/webhook-guard.ts` com o store
 * padrão, sem tocar o banco do host:
 *   (a) `store.add` consome o eventId ANTES do handler; falha do negócio +
 *       retry idêntico → 409 (o evento some);
 *   (b) `PostgresWebhookReplayStore.add` engole erro transitório de banco e
 *       retorna `false` → retry legítimo tratado como duplicado;
 *   (c) dedup só usa eventId: o `signatureHash`/payload gravado nunca é lido.
 *
 * Uso (ANTES do delta):
 * pnpm exec tsx docs/producao-2026-09-13/evidencias/prod-07/repro-antes.ts
 *
 * NOTA DE EVIDÊNCIA: este script usa a API anterior (`store.add`). No candidato
 * corrigido ele não executa mais — a saída registrada em logs/repro-antes.log é
 * o artefato do estado anterior; a contraprova é a suíte prod-07.test.ts.
 */
import { createHash, createHmac } from 'node:crypto';

// Porta fechada de loopback: qualquer query falha por conexão recusada.
process.env.DATABASE_URL = process.env.PROD07_REPRO_DB_URL || 'postgresql://cvg_aaa@127.0.0.1:1/cvg_aaa_repro';
process.env.NODE_ENV = 'production';
process.env.DESK_ENV = 'production';
process.env.WEBHOOK_SECRET = 'repro-secret';
delete process.env.LEGACY_WEBHOOK_MODE;

interface ScenarioResult {
  scenario: string;
  observed: Record<string, unknown>;
}

const results: ScenarioResult[] = [];

function freshReply() {
  const reply = {
    statusCode: 200 as number | undefined,
    body: undefined as unknown,
    status(code: number) {
      reply.statusCode = code;
      return reply;
    },
    send(payload: unknown) {
      reply.body = payload;
      return reply;
    },
  };
  return reply;
}

function freshRequest(headers: Record<string, string>, rawBody: string) {
  return {
    headers,
    rawBody,
    body: JSON.parse(rawBody) as Record<string, unknown>,
    log: { warn: () => undefined, error: () => undefined, info: () => undefined },
  };
}

function sign(rawBody: string, timestamp: number, secret = process.env.WEBHOOK_SECRET as string) {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`;
}

function headersFor(rawBody: string, eventId: string): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000);
  return {
    'x-webhook-signature': sign(rawBody, timestamp),
    'x-webhook-timestamp': String(timestamp),
    'x-webhook-event-id': eventId,
  };
}

async function main(): Promise<void> {
  const { createWebhookGuard } = await import('../../../../packages/shared/src/webhook-guard.ts');
  const { InMemoryWebhookReplayStore, PostgresWebhookReplayStore, setDefaultWebhookReplayStore } = await import(
    '../../../../packages/shared/src/webhook-anti-replay.ts'
  );

// ---------------------------------------------------------------- cenário (a)
{
  setDefaultWebhookReplayStore(new InMemoryWebhookReplayStore());
  const guard = createWebhookGuard();
  const rawBody = JSON.stringify({ messageId: 'repro-a-msg', from: '+5511999990000', content: 'oi' });
  const eventId = 'repro-a-event';

  const first = freshReply();
  await guard(freshRequest(headersFor(rawBody, eventId), rawBody) as never, first as never);
  const businessFailedAfterFirstDelivery = true;

  const retry = freshReply();
  await guard(freshRequest(headersFor(rawBody, eventId), rawBody) as never, retry as never);

  results.push({
    scenario: 'a — falha do negócio após HMAC válido + retry idêntico',
    observed: {
      primeiraEntregaGuard: first.statusCode === undefined ? 'aceita (handler chamado)' : `status ${first.statusCode}`,
      negocioFalhouNaPrimeiraEntrega: businessFailedAfterFirstDelivery,
      retryMesmoEventoMesmoPayload: retry.statusCode === undefined ? 'aceito' : `status ${retry.statusCode}`,
      retryResposta: retry.body ?? null,
      defeito: retry.statusCode === 409 ? 'evento recuperável recebe 409 e é perdido' : 'sem defeito reproduzido',
    },
  });
}

// ---------------------------------------------------------------- cenário (c)
{
  setDefaultWebhookReplayStore(new InMemoryWebhookReplayStore());
  const guard = createWebhookGuard();
  const eventId = 'repro-c-event';
  const payloadA = JSON.stringify({ messageId: 'repro-c-msg-A', from: '+5511999990001', content: 'payload A' });
  const payloadB = JSON.stringify({ messageId: 'repro-c-msg-B', from: '+5511999990001', content: 'payload B' });

  const first = freshReply();
  await guard(freshRequest(headersFor(payloadA, eventId), payloadA) as never, first as never);

  const changedPayload = freshReply();
  await guard(freshRequest(headersFor(payloadB, eventId), payloadB) as never, changedPayload as never);

  const memory = new InMemoryWebhookReplayStore();
  const hashA = createHash('sha256').update('assinatura-A').digest('hex');
  const hashB = createHash('sha256').update('assinatura-B').digest('hex');
  const firstAdd = await memory.add(eventId, hashA);
  const secondAddDifferentHash = await memory.add(eventId, hashB);

  results.push({
    scenario: 'c — mesmo eventId com payload/assinatura diferentes',
    observed: {
      primeiroPayloadGuard: first.statusCode === undefined ? 'aceito (handler chamado)' : `status ${first.statusCode}`,
      payloadDiferenteMesmoEvento: changedPayload.statusCode === undefined ? 'aceito' : `status ${changedPayload.statusCode}`,
      storeAddHashDiferente: secondAddDifferentHash,
      storeAddPrimeiroHash: firstAdd,
      defeito:
        changedPayload.statusCode === 409
          ? 'payload diferente tratado como duplicado; hash gravado nunca é comparado'
          : 'sem defeito reproduzido',
    },
  });
}

// ---------------------------------------------------------------- cenário (b)
{
  setDefaultWebhookReplayStore(new InMemoryWebhookReplayStore());
  const store = new PostgresWebhookReplayStore();
  const startedAt = Date.now();
  let thrown: string | null = null;
  let added = false;
  try {
    added = await store.add('repro-b-event', createHash('sha256').update('hash').digest('hex'));
  } catch (error) {
    thrown = error instanceof Error ? error.message : String(error);
  }

  results.push({
    scenario: 'b — erro transitório de banco no store',
    observed: {
      addRetornou: added,
      excecaoEscapou: thrown,
      duracaoMs: Date.now() - startedAt,
      defeito: added === false && thrown === null ? 'erro transitório engolido e retorno false ("duplicado")' : 'sem defeito reproduzido',
    },
  });
}

  console.log(JSON.stringify({ candidate: '754f9bad', results }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
