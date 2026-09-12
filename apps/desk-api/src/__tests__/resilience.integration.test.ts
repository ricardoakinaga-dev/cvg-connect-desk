import './integration-mocks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { ConsumerAwareOutboxReader, CONSUMER_IDS } from '@cvg/events';
import { buildDeskApiApp } from '../app.ts';

/**
 * Phase 12 — resiliência/caos (cenários automatizados, DB real).
 * Critério: nenhuma mensagem persistida desaparece silenciosamente;
 * toda falha resulta em retry, DLQ, degraded ou erro terminal explícito.
 */
describe('Resilience integration', () => {
  const secret = 'webhook-secret-resilience';
  let app: Awaited<ReturnType<typeof buildDeskApiApp>>;

  beforeAll(async () => {
    process.env.DESK_ENV = 'production';
    process.env.WEBHOOK_SECRET = secret;
    delete process.env.SECRETARY_URL;
    delete process.env.SECRETARY_API_KEY;
    app = await buildDeskApiApp();
    await app.ready();
  });

  afterAll(async () => {
    process.env.DESK_ENV = '';
    process.env.WEBHOOK_SECRET = '';
    process.env.NODE_ENV = 'test';
    await app.close();
  });

  function signedHeaders(body: Record<string, unknown>, eventId: string): Record<string, string> {
    const rawBody = JSON.stringify(body);
    const timestamp = String(Math.floor(Date.now() / 1000));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const crypto = require('crypto') as typeof import('crypto');
    const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
    return {
      'x-webhook-signature': `sha256=${signature}`,
      'x-webhook-timestamp': timestamp,
      'x-webhook-event-id': eventId,
      'content-type': 'application/json',
    };
  }

  it('inbound persiste mesmo com Secretary fora (fallback humano)', async () => {
    const msgId = `resilience.nosec.${Date.now()}`;
    const body = { messageId: msgId, from: '+5511999000099', content: 'Secretary fora' };

    const response = await app.inject({
      method: 'POST',
      url: '/webhook/inbound',
      headers: signedHeaders(body, `evt-${msgId}`),
      payload: body,
    });

    expect(response.statusCode).toBe(200);

    const [message] = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.externalMessageId, msgId));
    expect(message).toBeDefined();
    expect(message.direction).toBe('inbound');

    const [conversation] = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, message.conversationId));
    await db.delete(schema.messages).where(eq(schema.messages.conversationId, message.conversationId));
    if (conversation) {
      await db.delete(schema.conversationStatusHistory).where(eq(schema.conversationStatusHistory.conversationId, conversation.id));
      await db.delete(schema.conversations).where(eq(schema.conversations.id, conversation.id));
    }
    try {
      await db.execute(`DELETE FROM webhook_replay_log WHERE event_id = 'evt-${msgId}'`);
    } catch {
      // sem tabela em ambientes antigos — ignorar
    }
  });

  it('readiness degrada (não cai) com Secretary inalcançável', async () => {
    process.env.SECRETARY_URL = 'http://127.0.0.1:9';
    try {
      const response = await app.inject({ method: 'GET', url: '/readiness' });
      expect(response.statusCode).toBe(200);
      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        ready: boolean;
        degraded: boolean;
        checks: Record<string, { status: string }>;
      };
      // Atendimento humano continua: pronto, mas degradado no Secretary.
      expect(body.ready).toBe(true);
      expect(body.checks.secretary.status).toBe('degraded');
    } finally {
      delete process.env.SECRETARY_URL;
    }
  });

  it('evento não-acknowledged é redelivered (at-least-once após crash do worker)', async () => {
    const eventId = `resilience.redelivery.${Date.now()}`;
    const consumerId = CONSUMER_IDS.HTTP_POLL;

    await db.insert(schema.outboxEvents).values({
      eventId,
      eventType: 'message.persisted',
      aggregateType: 'Message',
      aggregateId: randomUUID(),
      occurredAt: new Date(),
      payload: JSON.stringify({ messageId: 'm-crash' }),
      version: 1,
    });

    try {
      const reader = new ConsumerAwareOutboxReader({ consumerId, batchSize: 50, maxRetries: 3 });

      // Worker lê e "morre" antes do ACK...
      const first = await reader.fetchPendingEvents();
      expect(first.map((e) => e.eventId)).toContain(eventId);

      // ...reinicia e recebe o mesmo evento de novo (sem perda, sem duplicação lógica após ACK).
      const second = await reader.fetchPendingEvents();
      expect(second.map((e) => e.eventId)).toContain(eventId);

      await reader.acknowledge(eventId);
      const third = await reader.fetchPendingEvents();
      expect(third.map((e) => e.eventId)).not.toContain(eventId);
    } finally {
      await db.delete(schema.outboxConsumerAcks).where(eq(schema.outboxConsumerAcks.eventId, eventId));
      await db.delete(schema.outboxEvents).where(eq(schema.outboxEvents.eventId, eventId));
    }
  });

  it('payload malformado no outbox não derruba o reader', async () => {
    const eventId = `resilience.malformed.${Date.now()}`;
    const reader = new ConsumerAwareOutboxReader({ consumerId: CONSUMER_IDS.WORKER, batchSize: 50, maxRetries: 3 });

    await db.insert(schema.outboxEvents).values({
      eventId,
      eventType: 'message.persisted',
      aggregateType: 'Message',
      aggregateId: randomUUID(),
      occurredAt: new Date(),
      payload: 'not-json{{{',
      version: 1,
    });

    try {
      const events = await reader.fetchPendingEvents();
      const found = events.find((e) => e.eventId === eventId);
      expect(found).toBeDefined();
      expect(found?.payload).toBe('not-json{{{');
    } finally {
      await db.delete(schema.outboxEvents).where(eq(schema.outboxEvents.eventId, eventId));
    }
  });

  it('falha com retry esgotado permanece visível para DLQ (não some)', async () => {
    const eventId = `resilience.exhaust.${Date.now()}`;
    const reader = new ConsumerAwareOutboxReader({ consumerId: CONSUMER_IDS.WORKER, batchSize: 50, maxRetries: 1 });

    await db.insert(schema.outboxEvents).values({
      eventId,
      eventType: 'message.persisted',
      aggregateType: 'Message',
      aggregateId: randomUUID(),
      occurredAt: new Date(),
      payload: JSON.stringify({}),
      version: 1,
    });

    try {
      await reader.acknowledgeWithError(eventId, 'simulated terminal failure');
      // Esgotou retries: sai do pending, mas o ACK com erro fica registrado (visível p/ DLQ).
      const pending = await reader.fetchPendingEvents();
      expect(pending.map((e) => e.eventId)).not.toContain(eventId);

      const ack = await reader.getConsumerAck(eventId);
      expect(ack).toMatchObject({ retryCount: 1 });
      expect(ack?.processedAt).toBeNull();
    } finally {
      await db.delete(schema.outboxConsumerAcks).where(eq(schema.outboxConsumerAcks.eventId, eventId));
      await db.delete(schema.outboxEvents).where(eq(schema.outboxEvents.eventId, eventId));
    }
  });
});
