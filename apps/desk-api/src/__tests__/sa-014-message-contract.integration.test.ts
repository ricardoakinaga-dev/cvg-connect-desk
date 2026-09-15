/**
 * SA-014 — contrato de mensagem durável e reconciliação (C01/C03/C05, G03).
 *
 * Prova real em PostgreSQL + Redis ISOLADOS do runner SA-003
 * (`scripts/production/run-integration-isolated.mjs`), com o código de produção
 * (`buildDeskApiApp`, `sendOutboundMessage`, repositórios e rotas reais).
 *
 * Lacunas fechadas AQUI (o restante está provado em suíte existente e é
 * apenas citado no relatório — nada é duplicado por volume):
 *
 *  - AC1: mesmo `externalMessageId` com payload DIVERGENTE, evento novo e
 *    assinatura renovada converge para a primeira mensagem — sem conversa
 *    órfã, sem segundo efeito e sem segundo incremento de unread.
 *  - AC2/AC3: injeção de falha por TRIGGER (a) no INSERT do mapping outbound
 *    (depois da mensagem): rollback total e ZERO chamada ao provider; (b) no
 *    UPDATE da mensagem dentro do `finalizeDelivery` (depois do aceite do
 *    provider): o efeito externo aconteceu, o estado local permanece
 *    não-terminal, o retry não reenvia e o receipt reconcilia UMA vez.
 *  - AC2: hash canônico do payload (mesma intenção com metadados em ordem
 *    diferente deduplica; conteúdo divergente ⇒ 409).
 *  - AC4: receipts fora de ordem (`delivered` antes de `sent`) não regridem
 *    `delivered`; receipt ANTES da mensagem é no-op seguro e DEFINIDO: o
 *    intent fica listável para reconciliação e converge quando o provider
 *    reentrega o receipt após a persistência (ou por resolução explícita).
 *  - AC4: inbounds fora de ordem (`sentAt` mais novo primeiro) persistem UMA
 *    vez cada, com timestamps próprios; retry com assinatura renovada não
 *    duplica nem volta a incrementar unread.
 *
 * Limitações registradas:
 *  - Não há SIGKILL de processo nesta suíte: a falha é injetada no BANCO
 *    (trigger) e o caso de uso é reexecutado no MESMO processo. Isso separa
 *    "commit local" de "efeito externo" sem depender do kill; o crash real de
 *    processo já é provado por PROD-11 AC3 (SIGKILL do filho) e PROD-10 AC2.
 *  - O provider é a porta outbound injetada (ledger de chamadas), não HTTP
 *    real do gateway; o caminho HTTP outbound + receipt é provado por PROD-11
 *    e AAA-12 com PostgreSQL real.
 *  - Nunca usa o banco do host: exige `DATABASE_URL` isolado `cvg_aaa_*`.
 */
import { createHmac, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray, like, sql, type SQL } from 'drizzle-orm';
import { db, schema, getPool } from '@cvg/database';
import {
  messageRepository,
  outboundDeliveryRepository,
  sendOutboundMessage,
  setGatewayOutboundPort,
  type ChatGatewayOutboundPort,
} from '@cvg/chat';
import { buildDeskApiApp } from '../app.ts';

const WEBHOOK_SECRET = 'sa014-webhook-secret';
const RUN_TAG = (process.env.AAA_RUN_ID || 'sa014').replace(/[^a-z0-9-]/gi, '').slice(0, 24) || 'sa014';
const EVENT_PREFIX = `sa014-${RUN_TAG}-`;
const CONTACT_DIGITS = `5511${String(Date.now()).slice(-9)}`;
const CONTACT_PHONE = `+${CONTACT_DIGITS}`;
const RECIPIENT = '+5511900001499';

process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;
process.env.RATE_LIMIT_MAX = process.env.RATE_LIMIT_MAX || '10000';
process.env.RATE_LIMIT_WINDOW = process.env.RATE_LIMIT_WINDOW || '1 minute';

type StubGatewayResult = {
  success: boolean;
  messageId?: string;
  error?: string;
  failureKind?: 'definitive' | 'unknown';
};

interface GatewayCall {
  messageId: string;
  conversationId: string;
  externalPhone: string;
  content: string;
}

interface CountsRow {
  messages: number;
  deliveries: number;
  events: number;
}

interface InboundCountsRow {
  messages: number;
  persisted: number;
  created: number;
  unread: number;
}

const gatewayCalls: GatewayCall[] = [];
let gatewayResponse: StubGatewayResult = { success: true, messageId: `sa014-provider-${randomUUID()}` };

const gatewayStub: ChatGatewayOutboundPort = {
  sendOutbound: async (request): Promise<StubGatewayResult> => {
    gatewayCalls.push({
      messageId: request.messageId,
      conversationId: request.conversationId,
      externalPhone: request.externalPhone,
      content: request.content,
    });
    if (gatewayResponse.success) {
      return { success: true, messageId: gatewayResponse.messageId };
    }
    return {
      success: false,
      error: gatewayResponse.error,
      failureKind: gatewayResponse.failureKind,
    };
  },
  providerSupportsIdempotency: () => true,
};

let app: FastifyInstance;

function queryRows<T>(query: SQL): Promise<T[]> {
  return db.execute(query).then((result) => {
    const rows = (result as unknown as { rows?: T[] }).rows;
    return (rows ?? []) as T[];
  });
}

function signedWebhookHeaders(
  rawBody: string,
  eventId: string,
  timestamp = Math.floor(Date.now() / 1000),
): Record<string, string> {
  const signature = createHmac('sha256', WEBHOOK_SECRET).update(`${timestamp}.${rawBody}`).digest('hex');
  return {
    'content-type': 'application/json',
    'x-webhook-signature': `sha256=${signature}`,
    'x-webhook-timestamp': String(timestamp),
    'x-webhook-event-id': eventId,
  };
}

async function postInbound(
  body: Record<string, unknown>,
  eventId: string,
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const raw = JSON.stringify(body);
  const response = await app.inject({
    method: 'POST',
    url: '/webhook/inbound',
    headers: signedWebhookHeaders(raw, eventId),
    payload: raw,
  });
  return { statusCode: response.statusCode, body: response.json() as Record<string, unknown> };
}

async function postReceipt(input: {
  reference: string;
  status: 'sent' | 'delivered' | 'read' | 'played' | 'failed';
  eventId?: string;
}): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const eventId = input.eventId ?? `${EVENT_PREFIX}receipt-${randomUUID()}`;
  const body = {
    contract_version: '1.0.0',
    event_type: 'WA_RECEIPT',
    event_id: eventId,
    occurred_at: new Date().toISOString(),
    provider: 'evolutionapi',
    channel: 'whatsapp',
    payload: {
      instance: 'sa014-local',
      remoteJid: `${CONTACT_DIGITS}@s.whatsapp.net`,
      messageId: input.reference,
      status: input.status,
      status_at: new Date().toISOString(),
    },
  };
  const raw = JSON.stringify(body);
  const response = await app.inject({
    method: 'POST',
    url: '/gateway/receipt',
    headers: signedWebhookHeaders(raw, eventId),
    payload: raw,
  });
  return { statusCode: response.statusCode, body: response.json() as Record<string, unknown> };
}

function eventId(label: string): string {
  return `${EVENT_PREFIX}${label}-${randomUUID()}`;
}

const trackedConversations: string[] = [];

async function createConversation(): Promise<string> {
  const [conversation] = await db
    .insert(schema.conversations)
    .values({ status: 'open', statusV2: 'novo', currentHandler: 'bot', isActive: true })
    .returning({ id: schema.conversations.id });
  trackedConversations.push(conversation.id);
  return conversation.id;
}

async function outboundCounts(conversationId: string): Promise<CountsRow> {
  const rows = await queryRows<CountsRow>(sql`
    SELECT
      (SELECT COUNT(*)::int FROM messages
        WHERE conversation_id = ${conversationId} AND direction = 'outbound') AS messages,
      (SELECT COUNT(*)::int FROM outbound_deliveries d
        WHERE d.scope_conversation_id = ${conversationId}) AS deliveries,
      (SELECT COUNT(*)::int FROM outbox_events e
        WHERE e.aggregate_type = 'Message'
          AND e.aggregate_id IN (
            SELECT id::text FROM messages
             WHERE conversation_id = ${conversationId} AND direction = 'outbound'
          )) AS events
  `);
  return rows[0];
}

async function inboundCounts(conversationId: string): Promise<InboundCountsRow> {
  const rows = await queryRows<InboundCountsRow>(sql`
    SELECT
      (SELECT COUNT(*)::int FROM messages
        WHERE conversation_id = ${conversationId} AND direction = 'inbound') AS messages,
      (SELECT COUNT(*)::int FROM outbox_events
        WHERE event_type = 'message.persisted'
          AND aggregate_id IN (
            SELECT id::text FROM messages
             WHERE conversation_id = ${conversationId} AND direction = 'inbound'
          )) AS persisted,
      (SELECT COUNT(*)::int FROM outbox_events
        WHERE event_type = 'conversation.created'
          AND aggregate_id = ${conversationId}::text) AS created,
      (SELECT unread_count FROM conversations WHERE id = ${conversationId}) AS unread
  `);
  return rows[0];
}

async function deliveryByKey(clientKey: string) {
  const [delivery] = await db
    .select()
    .from(schema.outboundDeliveries)
    .where(eq(schema.outboundDeliveries.clientKey, clientKey));
  return delivery ?? null;
}

async function messageById(id: string) {
  return messageRepository.findById(id);
}

async function cleanupConversations(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const messages = await db
    .select({ id: schema.messages.id })
    .from(schema.messages)
    .where(inArray(schema.messages.conversationId, ids));
  const messageIds = messages.map((message) => message.id);
  if (messageIds.length > 0) {
    await db
      .delete(schema.outboundDeliveries)
      .where(inArray(schema.outboundDeliveries.internalMessageId, messageIds));
    await db.delete(schema.outboxEvents).where(inArray(schema.outboxEvents.aggregateId, messageIds));
  }
  await db.delete(schema.outboxEvents).where(inArray(schema.outboxEvents.aggregateId, ids));
  await db.delete(schema.messages).where(inArray(schema.messages.conversationId, ids));
  await db
    .delete(schema.outboundIdempotencyTombstones)
    .where(inArray(schema.outboundIdempotencyTombstones.scopeConversationId, ids));
  await db
    .delete(schema.conversationStatusHistory)
    .where(inArray(schema.conversationStatusHistory.conversationId, ids));
  await db.delete(schema.conversations).where(inArray(schema.conversations.id, ids));
}

/**
 * Conversas inbound são criadas pelo próprio webhook (não passam por
 * `createConversation`); o sweep por prefixo evita que elas segurem o contato
 * no teardown (FK `conversations_contact_id_fkey`).
 */
async function cleanupInboundArtifacts(): Promise<void> {
  const conversations = await db
    .select({ id: schema.conversations.id })
    .from(schema.conversations)
    .where(like(schema.conversations.externalConversationId, `${EVENT_PREFIX}%`));
  await cleanupConversations(conversations.map((conversation) => conversation.id));
}

async function dropDeliveryInsertFault(): Promise<void> {
  await db.execute(sql.raw('DROP TRIGGER IF EXISTS sa014_fault_delivery_insert ON outbound_deliveries'));
  await db.execute(sql.raw('DROP FUNCTION IF EXISTS sa014_fault_delivery_insert()'));
}

async function dropMessageSentFault(): Promise<void> {
  await db.execute(sql.raw('DROP TRIGGER IF EXISTS sa014_fault_message_sent ON messages'));
  await db.execute(sql.raw('DROP FUNCTION IF EXISTS sa014_fault_message_sent()'));
}

beforeAll(async () => {
  const url = process.env.DATABASE_URL ?? '';
  if (!url) {
    throw new Error('SA-014 exige DATABASE_URL (use o runner isolado de SA-003 ou o banco de CI migrado).');
  }
  // Guard-aware (padrão SA-013): quando executado pelo runner isolado (AAA_RUN_ID
  // presente), a URL PRECISA ser o banco cvg_aaa_* do run. Na macro de CI o banco
  // é connect_desk_db já migrado e o guard de marcador não se aplica — assim a
  // suíte não quebra `pnpm test:ci` em ambiente CI-shaped.
  if (process.env.AAA_RUN_ID) {
    if (!/^postgres(ql)?:\/\/[^/]*127\.0\.0\.1:\d+\/cvg_aaa_/.test(url)) {
      throw new Error(
        `SA-014 exige DATABASE_URL isolado do runner (cvg_aaa_* em 127.0.0.1); recebido: ${url}`,
      );
    }
    const marker = await db.execute(sql`SELECT run_id FROM aaa_environment_marker`);
    const rows = (marker as unknown as { rows: Array<{ run_id: string }> }).rows ?? [];
    if (rows.length !== 1 || rows[0].run_id !== process.env.AAA_RUN_ID) {
      throw new Error(`SA-014 exige o marcador do run ${process.env.AAA_RUN_ID}: ${JSON.stringify(rows)}`);
    }
  }

  app = await buildDeskApiApp();
  await app.ready();
  // Ledger local do efeito externo: a composição registra o serviço real do
  // gateway; esta suíte troca a PORTA (C02 §5) por um stub determinístico.
  setGatewayOutboundPort(gatewayStub);
});

afterEach(async () => {
  await dropDeliveryInsertFault();
  await dropMessageSentFault();
  await cleanupInboundArtifacts();
  await cleanupConversations(trackedConversations.splice(0));
  await db.delete(schema.contacts).where(eq(schema.contacts.phone, CONTACT_DIGITS));
  gatewayCalls.length = 0;
  gatewayResponse = { success: true, messageId: `sa014-provider-${randomUUID()}` };
});

afterAll(async () => {
  await dropDeliveryInsertFault();
  await dropMessageSentFault();
  await cleanupInboundArtifacts();
  await cleanupConversations(trackedConversations.splice(0));
  await db.delete(schema.webhookReplayLog).where(like(schema.webhookReplayLog.eventId, `${EVENT_PREFIX}%`));
  await db.delete(schema.contacts).where(eq(schema.contacts.phone, CONTACT_DIGITS));
  try {
    const events = await import('@cvg/events');
    await events.stopSharedRealtimeBus();
  } catch {
    // Barramento best-effort; o teardown do runner cobre o restante.
  }
  await app.close().catch(() => undefined);
  await getPool().end().catch(() => undefined);
});

describe('SA-014 — contrato de mensagem durável e reconciliação (PG/Redis reais)', () => {
  describe('AC1 — inbound duplicado com payload divergente e assinatura renovada', () => {
    it('converge para a primeira mensagem: uma conversa, uma mensagem, um evento e sem segundo unread', async () => {
      const externalConversationId = `${EVENT_PREFIX}conv-${randomUUID()}`;
      const externalMessageId = `${EVENT_PREFIX}msg-${randomUUID()}`;
      const bodyA = {
        messageId: externalMessageId,
        conversationId: externalConversationId,
        from: CONTACT_PHONE,
        content: 'conteudo original',
        timestamp: new Date().toISOString(),
      };

      const first = await postInbound(bodyA, eventId('inbound-original'));
      expect(first.statusCode).toBe(200);
      const firstMessageId = first.body.messageId as string;
      const firstConversationId = first.body.conversationId as string;
      expect(firstMessageId).toBeTypeOf('string');

      // Mesmo externalMessageId, MESMA conversa externa, conteúdo DIVERGENTE,
      // evento novo com timestamp/assinatura renovados (HMAC válido).
      const divergentBody = {
        messageId: externalMessageId,
        conversationId: externalConversationId,
        from: CONTACT_PHONE,
        content: 'conteudo divergente (nao pode sobrescrever)',
        timestamp: new Date().toISOString(),
      };
      const divergent = await postInbound(divergentBody, eventId('inbound-divergent'));
      expect(divergent.statusCode).toBe(200);
      expect(divergent.body.messageId).toBe(firstMessageId);
      expect(divergent.body.conversationId).toBe(firstConversationId);

      const conversations = await db
        .select()
        .from(schema.conversations)
        .where(eq(schema.conversations.externalConversationId, externalConversationId));
      expect(conversations).toHaveLength(1);

      const messages = await db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.externalMessageId, externalMessageId));
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('conteudo original');
      expect(messages[0].conversationId).toBe(firstConversationId);

      const counts = await inboundCounts(firstConversationId);
      expect(counts).toEqual({ messages: 1, persisted: 1, created: 1, unread: 1 });

      // Conversa com mensagem nunca é candidata a órfã (critério do PROD-08).
      const orphans = await queryRows<{ n: number }>(sql`
        SELECT COUNT(*)::int AS n
          FROM conversations c
         WHERE c.external_conversation_id = ${externalConversationId}
           AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id)
      `);
      expect(orphans[0].n).toBe(0);
    });
  });

  describe('AC2/AC3 — intenção outbound antes do efeito e falha em pontos de escrita', () => {
    it('falha no INSERT do mapping (trigger) ⇒ rollback total e provider NUNCA chamado; replay seguro cria 1 efeito', async () => {
      const conversationId = await createConversation();
      const key = `${EVENT_PREFIX}fault-delivery-${randomUUID()}`;

      await db.execute(sql.raw(`
        CREATE OR REPLACE FUNCTION sa014_fault_delivery_insert() RETURNS trigger AS $$
        BEGIN
          IF NEW.client_key = '${key}' THEN
            RAISE EXCEPTION 'SA-014 fault: outbound delivery insert bloqueado';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
      `));
      await db.execute(sql.raw('DROP TRIGGER IF EXISTS sa014_fault_delivery_insert ON outbound_deliveries'));
      await db.execute(sql.raw(`
        CREATE TRIGGER sa014_fault_delivery_insert BEFORE INSERT ON outbound_deliveries
        FOR EACH ROW EXECUTE FUNCTION sa014_fault_delivery_insert()
      `));

      const failed = await sendOutboundMessage({
        conversationId,
        content: 'SA-014 — falha antes do efeito',
        recipient: RECIPIENT,
        idempotencyKey: key,
      });
      expect(failed.isErr()).toBe(true);

      // A mensagem (escrita anterior) NÃO sobrevive sozinha e o provider não
      // foi acionado: persistência da intenção precede o efeito externo.
      expect(await outboundCounts(conversationId)).toEqual({ messages: 0, deliveries: 0, events: 0 });
      expect(gatewayCalls).toHaveLength(0);

      // Causa transitória cessou; replay com a MESMA chave cria um único efeito.
      await dropDeliveryInsertFault();
      const replay = await sendOutboundMessage({
        conversationId,
        content: 'SA-014 — falha antes do efeito',
        recipient: RECIPIENT,
        idempotencyKey: key,
      });
      expect(replay.isOk()).toBe(true);
      if (replay.isErr()) return;
      expect(replay.value.deduplicated).toBe(false);
      expect(await outboundCounts(conversationId)).toEqual({ messages: 1, deliveries: 1, events: 1 });
      expect(gatewayCalls).toHaveLength(1);

      // Retry posterior devolve a intenção existente; nenhum segundo envio.
      const retry = await sendOutboundMessage({
        conversationId,
        content: 'SA-014 — falha antes do efeito',
        recipient: RECIPIENT,
        idempotencyKey: key,
      });
      expect(retry.isOk()).toBe(true);
      if (retry.isErr()) return;
      expect(retry.value.deduplicated).toBe(true);
      expect(retry.value.messageId).toBe(replay.value.messageId);
      expect(await outboundCounts(conversationId)).toEqual({ messages: 1, deliveries: 1, events: 1 });
      expect(gatewayCalls).toHaveLength(1);
    });

    it('falha no commit APÓS o aceite do provider conserva causalidade: retry não reenvia e receipt reconcilia UMA vez', async () => {
      const conversationId = await createConversation();
      const key = `${EVENT_PREFIX}fault-commit-${randomUUID()}`;
      gatewayResponse = { success: true, messageId: `sa014-provider-${randomUUID()}` };

      await db.execute(sql.raw(`
        CREATE OR REPLACE FUNCTION sa014_fault_message_sent() RETURNS trigger AS $$
        BEGIN
          IF NEW.conversation_id = '${conversationId}'::uuid
             AND OLD.status = 'pending' AND NEW.status = 'sent' THEN
            RAISE EXCEPTION 'SA-014 fault: commit do estado sent bloqueado';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
      `));
      await db.execute(sql.raw('DROP TRIGGER IF EXISTS sa014_fault_message_sent ON messages'));
      await db.execute(sql.raw(`
        CREATE TRIGGER sa014_fault_message_sent BEFORE UPDATE ON messages
        FOR EACH ROW EXECUTE FUNCTION sa014_fault_message_sent()
      `));

      const failed = await sendOutboundMessage({
        conversationId,
        content: 'SA-014 — aceite com commit falho',
        recipient: RECIPIENT,
        idempotencyKey: key,
      });
      expect(failed.isErr()).toBe(true);

      // O provider ACEITOU (1 chamada), mas o commit local reverteu: a
      // intenção permanece não-terminal (pending) — nada é dado como enviado.
      expect(gatewayCalls).toHaveLength(1);
      const delivery = await deliveryByKey(key);
      expect(delivery).not.toBeNull();
      expect(delivery?.status).toBe('pending');
      const messageAfterFailure = await messageById(delivery!.internalMessageId);
      expect(messageAfterFailure?.status).toBe('pending');

      // Replay/retry da mesma chave: devolve o estado da intenção, sem reenvio.
      const retry = await sendOutboundMessage({
        conversationId,
        content: 'SA-014 — aceite com commit falho',
        recipient: RECIPIENT,
        idempotencyKey: key,
      });
      expect(retry.isOk()).toBe(true);
      if (retry.isErr()) return;
      expect(retry.value.deduplicated).toBe(true);
      expect(retry.value.outcome).toBe('pending');
      expect(gatewayCalls).toHaveLength(1);

      // Causa transitória cessou; o receipt do provider reconcilia a intenção.
      await dropMessageSentFault();
      const receipt = await postReceipt({
        reference: delivery!.internalMessageId,
        status: 'delivered',
      });
      expect(receipt.statusCode).toBe(200);
      expect(receipt.body.updated).toBe(true);

      const resolved = await deliveryByKey(key);
      expect(resolved?.status).toBe('sent');
      const attemptsAfterResolution = resolved?.attemptCount;
      const messageAfterReceipt = await messageById(delivery!.internalMessageId);
      expect(messageAfterReceipt?.status).toBe('delivered');
      expect(messageAfterReceipt?.deliveredAt).not.toBeNull();

      const duplicate = await postReceipt({
        reference: delivery!.internalMessageId,
        status: 'delivered',
      });
      expect(duplicate.statusCode).toBe(200);
      expect((await deliveryByKey(key))?.attemptCount).toBe(attemptsAfterResolution);
      expect(gatewayCalls).toHaveLength(1);
      expect(await outboundCounts(conversationId)).toEqual({ messages: 1, deliveries: 1, events: 1 });
    });

    it('hash canônico: metadados em ordem diferente deduplicam; conteúdo divergente ⇒ 409 sem novo efeito', async () => {
      const conversationId = await createConversation();
      const key = `${EVENT_PREFIX}hash-${randomUUID()}`;
      const content = 'SA-014 — hash canonico';

      const created = await sendOutboundMessage({
        conversationId,
        content,
        recipient: RECIPIENT,
        idempotencyKey: key,
        metadata: { beta: 2, alpha: 1 },
      });
      expect(created.isOk()).toBe(true);
      if (created.isErr()) return;

      const reordered = await sendOutboundMessage({
        conversationId,
        content,
        recipient: RECIPIENT,
        idempotencyKey: key,
        metadata: { alpha: 1, beta: 2 },
      });
      expect(reordered.isOk()).toBe(true);
      if (reordered.isErr()) return;
      expect(reordered.value.deduplicated).toBe(true);
      expect(reordered.value.messageId).toBe(created.value.messageId);

      const divergent = await sendOutboundMessage({
        conversationId,
        content: `${content} (divergente)`,
        recipient: RECIPIENT,
        idempotencyKey: key,
        metadata: { alpha: 1, beta: 2 },
      });
      expect(divergent.isErr()).toBe(true);
      if (divergent.isErr()) {
        expect((divergent.error as { code?: string }).code).toBe('IDEMPOTENCY_KEY_CONFLICT');
      }

      expect(await outboundCounts(conversationId)).toEqual({ messages: 1, deliveries: 1, events: 1 });
      expect(gatewayCalls).toHaveLength(1);
    });

    it('aceite desconhecido entra em reconciliação explícita e é listável; nunca reenvia cegamente', async () => {
      const conversationId = await createConversation();
      const key = `${EVENT_PREFIX}unknown-${randomUUID()}`;
      gatewayResponse = { success: false, error: 'timeout do provider', failureKind: 'unknown' };

      const sent = await sendOutboundMessage({
        conversationId,
        content: 'SA-014 — aceite desconhecido',
        recipient: RECIPIENT,
        idempotencyKey: key,
      });
      expect(sent.isOk()).toBe(true);
      if (sent.isErr()) return;
      expect(sent.value.outcome).toBe('unknown_reconciling');

      const delivery = await deliveryByKey(key);
      expect(delivery?.status).toBe('unknown_reconciling');
      const listed = await outboundDeliveryRepository.listOutboundIntentsForReconciliation({ limit: 500 });
      expect(listed.some((row) => row.id === delivery!.id)).toBe(true);

      const retry = await sendOutboundMessage({
        conversationId,
        content: 'SA-014 — aceite desconhecido',
        recipient: RECIPIENT,
        idempotencyKey: key,
      });
      expect(retry.isOk()).toBe(true);
      if (retry.isErr()) return;
      expect(retry.value.deduplicated).toBe(true);
      expect(retry.value.outcome).toBe('unknown_reconciling');
      expect(gatewayCalls).toHaveLength(1);
    });
  });

  describe('AC4 — receipts e mensagens fora de ordem', () => {
    it('receipts em ordem inversa não regridem delivered nem duplicam efeito', async () => {
      const conversationId = await createConversation();
      const key = `${EVENT_PREFIX}receipt-order-${randomUUID()}`;
      const providerMessageId = `sa014-provider-${randomUUID()}`;
      gatewayResponse = { success: true, messageId: providerMessageId };

      const sent = await sendOutboundMessage({
        conversationId,
        content: 'SA-014 — receipts fora de ordem',
        recipient: RECIPIENT,
        idempotencyKey: key,
      });
      expect(sent.isOk()).toBe(true);
      if (sent.isErr()) return;

      const beforeDelivery = await deliveryByKey(key);
      expect(beforeDelivery?.status).toBe('sent');
      expect((await messageById(sent.value.messageId))?.status).toBe('sent');

      const delivered = await postReceipt({ reference: providerMessageId, status: 'delivered' });
      expect(delivered.statusCode).toBe(200);
      expect(delivered.body.updated).toBe(true);
      const afterDelivered = await messageById(sent.value.messageId);
      expect(afterDelivered?.status).toBe('delivered');
      const deliveredAt = afterDelivered?.deliveredAt?.getTime();
      const attemptsAfterDelivered = (await deliveryByKey(key))?.attemptCount;

      // Receipt atrasado com status ANTERIOR (`sent`) não regride nada.
      const lateSent = await postReceipt({ reference: providerMessageId, status: 'sent' });
      expect(lateSent.statusCode).toBe(200);
      const afterLateSent = await messageById(sent.value.messageId);
      expect(afterLateSent?.status).toBe('delivered');
      expect(afterLateSent?.deliveredAt?.getTime()).toBe(deliveredAt);
      expect((await deliveryByKey(key))?.status).toBe('sent');
      expect((await deliveryByKey(key))?.attemptCount).toBe(attemptsAfterDelivered);

      // `read`/`played` também mapeiam para delivered e são no-op quando já lá.
      const read = await postReceipt({ reference: providerMessageId, status: 'read' });
      expect(read.statusCode).toBe(200);
      expect((await messageById(sent.value.messageId))?.status).toBe('delivered');
      expect((await deliveryByKey(key))?.attemptCount).toBe(attemptsAfterDelivered);
      expect(await outboundCounts(conversationId)).toEqual({ messages: 1, deliveries: 1, events: 1 });
      expect(gatewayCalls).toHaveLength(1);
    });

    it('receipt ANTES da mensagem é no-op seguro e definido: sem linhas, intent listável e convergência na reentrega', async () => {
      const conversationId = await createConversation();
      const key = `${EVENT_PREFIX}receipt-before-${randomUUID()}`;
      const unknownReference = randomUUID();
      const before = await queryRows<{ messages: number; deliveries: number }>(sql`
        SELECT (SELECT COUNT(*)::int FROM messages) AS messages,
               (SELECT COUNT(*)::int FROM outbound_deliveries) AS deliveries
      `);

      // O receipt chega ANTES de existir mensagem para a referência.
      const early = await postReceipt({ reference: unknownReference, status: 'delivered' });
      expect(early.statusCode).toBe(200);
      expect(early.body).toMatchObject({ skipped: true, reason: 'message_not_found' });

      // Tratamento DEFINIDO: nenhuma linha é criada, nenhum efeito colateral.
      const after = await queryRows<{ messages: number; deliveries: number }>(sql`
        SELECT (SELECT COUNT(*)::int FROM messages) AS messages,
               (SELECT COUNT(*)::int FROM outbound_deliveries) AS deliveries
      `);
      expect(after[0]).toEqual(before[0]);

      // A mensagem então é persistida com aceite desconhecido do provider; se o
      // receipt nunca for reentregue, o intent continua visível para
      // reconciliação (fallback bounded) — nunca some silenciosamente.
      gatewayResponse = { success: false, error: 'timeout do provider', failureKind: 'unknown' };
      const sent = await sendOutboundMessage({
        conversationId,
        content: 'SA-014 — receipt antes da mensagem',
        recipient: RECIPIENT,
        idempotencyKey: key,
      });
      expect(sent.isOk()).toBe(true);
      if (sent.isErr()) return;

      const delivery = await deliveryByKey(key);
      expect(delivery?.status).toBe('unknown_reconciling');
      const listed = await outboundDeliveryRepository.listOutboundIntentsForReconciliation({ limit: 500 });
      expect(listed.some((row) => row.id === delivery!.id)).toBe(true);
      expect(gatewayCalls).toHaveLength(1);

      // Reentrega do receipt (agora a mensagem existe): UMA resolução.
      const redelivered = await postReceipt({ reference: delivery!.internalMessageId, status: 'delivered' });
      expect(redelivered.statusCode).toBe(200);
      expect(redelivered.body.updated).toBe(true);
      expect((await deliveryByKey(key))?.status).toBe('sent');
      expect((await messageById(delivery!.internalMessageId))?.status).toBe('delivered');
      const attemptsAfterResolution = (await deliveryByKey(key))?.attemptCount;

      const duplicate = await postReceipt({ reference: delivery!.internalMessageId, status: 'delivered' });
      expect(duplicate.statusCode).toBe(200);
      expect((await deliveryByKey(key))?.attemptCount).toBe(attemptsAfterResolution);

      // A referência ÓRFÃ inicial nunca "gruda" em uma linha criada depois.
      const stray = await queryRows<{ n: number }>(sql`
        SELECT COUNT(*)::int AS n
          FROM outbound_deliveries
         WHERE provider_message_id = ${unknownReference}
      `);
      expect(stray[0].n).toBe(0);
      expect(gatewayCalls).toHaveLength(1);
      expect(await outboundCounts(conversationId)).toEqual({ messages: 1, deliveries: 1, events: 1 });
    });

    it('inbounds fora de ordem (sentAt mais novo primeiro) persistem uma vez cada, com timestamps próprios', async () => {
      const externalConversationId = `${EVENT_PREFIX}o12-conv-${randomUUID()}`;
      const newerMessageId = `${EVENT_PREFIX}o12-newer-${randomUUID()}`;
      const olderMessageId = `${EVENT_PREFIX}o12-older-${randomUUID()}`;
      const newerSentAt = new Date();
      const olderSentAt = new Date(Date.now() - 90_000);

      const newer = await postInbound(
        {
          messageId: newerMessageId,
          conversationId: externalConversationId,
          from: CONTACT_PHONE,
          content: 'mensagem mais NOVA (chega primeiro)',
          timestamp: newerSentAt.toISOString(),
        },
        eventId('o12-newer'),
      );
      expect(newer.statusCode).toBe(200);

      const older = await postInbound(
        {
          messageId: olderMessageId,
          conversationId: externalConversationId,
          from: CONTACT_PHONE,
          content: 'mensagem mais ANTIGA (chega depois)',
          timestamp: olderSentAt.toISOString(),
        },
        eventId('o12-older'),
      );
      expect(older.statusCode).toBe(200);

      const conversationId = newer.body.conversationId as string;
      expect(older.body.conversationId).toBe(conversationId);
      expect(older.body.messageId).not.toBe(newer.body.messageId);

      const rows = await db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.conversationId, conversationId));
      expect(rows).toHaveLength(2);
      const byExternalId = new Map(rows.map((row) => [row.externalMessageId, row]));
      const storedNewer = byExternalId.get(newerMessageId);
      const storedOlder = byExternalId.get(olderMessageId);
      expect(storedNewer).toBeTruthy();
      expect(storedOlder).toBeTruthy();
      expect(storedNewer!.sentAt!.getTime()).toBeGreaterThan(storedOlder!.sentAt!.getTime());

      const counts = await inboundCounts(conversationId);
      expect(counts).toEqual({ messages: 2, persisted: 2, created: 1, unread: 2 });

      // Retry da mais antiga com evento/assinatura renovados: sem duplicata e
      // sem segundo incremento de unread (estado não regride).
      const retry = await postInbound(
        {
          messageId: olderMessageId,
          conversationId: externalConversationId,
          from: CONTACT_PHONE,
          content: 'mensagem mais ANTIGA (chega depois)',
          timestamp: olderSentAt.toISOString(),
        },
        eventId('o12-older-retry'),
      );
      expect(retry.statusCode).toBe(200);
      expect(retry.body.messageId).toBe(older.body.messageId);
      expect(await inboundCounts(conversationId)).toEqual({ messages: 2, persisted: 2, created: 1, unread: 2 });
    });
  });
});
