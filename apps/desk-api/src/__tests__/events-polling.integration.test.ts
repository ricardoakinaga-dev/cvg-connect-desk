import './integration-mocks';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { buildDeskApiApp } from '../app.ts';

describe('Events polling integration', () => {
  const eventPrefix = `events.polling.${Date.now()}`;
  const consumerId = 'http-poll';
  const baseOccurredAt = new Date('2000-01-01T00:00:00.000Z');
  const eventIds = [
    `${eventPrefix}.1`,
    `${eventPrefix}.2`,
    `${eventPrefix}.3`,
  ];
  let app: Awaited<ReturnType<typeof buildDeskApiApp>>;
  const internalHeaders = { 'x-internal-service-key': 'events-polling-test-secret' };
  const previousInternalSecret = process.env.INTERNAL_EVENTS_SECRET;

  beforeAll(async () => {
    process.env.INTERNAL_EVENTS_SECRET = internalHeaders['x-internal-service-key'];
    app = await buildDeskApiApp();
    await app.ready();
  });

  beforeEach(async () => {
    await db.delete(schema.outboxConsumerAcks).where(
      and(
        eq(schema.outboxConsumerAcks.consumerId, consumerId),
        eq(schema.outboxConsumerAcks.eventId, eventIds[0])
      )
    );
    await db.delete(schema.outboxConsumerAcks).where(
      and(
        eq(schema.outboxConsumerAcks.consumerId, consumerId),
        eq(schema.outboxConsumerAcks.eventId, eventIds[1])
      )
    );
    await db.delete(schema.outboxConsumerAcks).where(
      and(
        eq(schema.outboxConsumerAcks.consumerId, consumerId),
        eq(schema.outboxConsumerAcks.eventId, eventIds[2])
      )
    );
    await db.delete(schema.outboxEvents).where(eq(schema.outboxEvents.eventId, eventIds[0]));
    await db.delete(schema.outboxEvents).where(eq(schema.outboxEvents.eventId, eventIds[1]));
    await db.delete(schema.outboxEvents).where(eq(schema.outboxEvents.eventId, eventIds[2]));

    await db.insert(schema.outboxEvents).values([
      {
        eventId: eventIds[0],
        eventType: 'conversation.created',
        aggregateType: 'Conversation',
        aggregateId: randomUUID(),
        occurredAt: new Date(baseOccurredAt.getTime()),
        payload: JSON.stringify({ conversationId: 'conv-1' }),
        metadata: JSON.stringify({ source: 'events-polling-test' }),
        version: 1,
        createdAt: new Date('2000-01-01T00:00:00.000Z'),
      },
      {
        eventId: eventIds[1],
        eventType: 'message.persisted',
        aggregateType: 'Message',
        aggregateId: randomUUID(),
        occurredAt: new Date(baseOccurredAt.getTime() + 60_000),
        payload: JSON.stringify({ messageId: 'msg-2' }),
        metadata: JSON.stringify({ source: 'events-polling-test' }),
        version: 1,
        createdAt: new Date('2000-01-01T00:00:01.000Z'),
      },
      {
        eventId: eventIds[2],
        eventType: 'task.created',
        aggregateType: 'Task',
        aggregateId: randomUUID(),
        occurredAt: new Date(baseOccurredAt.getTime() + 120_000),
        payload: JSON.stringify({ taskId: 'task-3' }),
        metadata: JSON.stringify({ source: 'events-polling-test' }),
        version: 1,
        createdAt: new Date('2000-01-01T00:00:02.000Z'),
      },
    ]);
  });

  afterAll(async () => {
    await db.delete(schema.outboxConsumerAcks).where(eq(schema.outboxConsumerAcks.consumerId, consumerId));
    await db.delete(schema.outboxEvents).where(eq(schema.outboxEvents.eventId, eventIds[0]));
    await db.delete(schema.outboxEvents).where(eq(schema.outboxEvents.eventId, eventIds[1]));
    await db.delete(schema.outboxEvents).where(eq(schema.outboxEvents.eventId, eventIds[2]));
    await app.close();
    if (previousInternalSecret === undefined) delete process.env.INTERNAL_EVENTS_SECRET;
    else process.env.INTERNAL_EVENTS_SECRET = previousInternalSecret;
  });

  it('recusa polling interno sem a chave compartilhada', async () => {
    const missingKey = await app.inject({ method: 'GET', url: '/events?limit=1' });
    expect(missingKey.statusCode).toBe(401);

    const invalidKey = await app.inject({
      method: 'POST',
      url: `/events/${eventIds[0]}/ack`,
      headers: { 'x-internal-service-key': 'wrong-secret' },
    });
    expect(invalidKey.statusCode).toBe(401);
  });

  it('GET aluga eventos sem ACK destrutivo; POST /events/:id/ack confirma', async () => {
    const firstResponse = await app.inject({
      method: 'GET',
      url: '/events?limit=2',
      headers: internalHeaders,
    });

    expect(firstResponse.statusCode).toBe(200);
    const firstBody = firstResponse.json() as {
      events: Array<{
        event_id: string;
        event_type: string;
        aggregate_type: string;
        payload: Record<string, unknown>;
        metadata?: Record<string, unknown>;
      }>;
      leaseSeconds: number;
      ackEndpoint: string;
      serverTime: string;
    };

    expect(firstBody.serverTime).toBeTypeOf('string');
    expect(firstBody.leaseSeconds).toBe(120);
    expect(firstBody.ackEndpoint).toBe('/events/:eventId/ack');
    expect(firstBody.events).toHaveLength(2);
    expect(firstBody.events[0]).toMatchObject({
      event_id: eventIds[0],
      event_type: 'conversation.created',
      aggregate_type: 'Conversation',
      metadata: { source: 'events-polling-test' },
    });
    expect(firstBody.events[1]).toMatchObject({
      event_id: eventIds[1],
      event_type: 'message.persisted',
      aggregate_type: 'Message',
      metadata: { source: 'events-polling-test' },
    });

    // GET não marca como processado: nenhum ack com processedAt ainda.
    const noAckYet = await db
      .select()
      .from(schema.outboxConsumerAcks)
      .where(
        and(
          eq(schema.outboxConsumerAcks.eventId, eventIds[0]),
          eq(schema.outboxConsumerAcks.consumerId, consumerId)
        )
      )
      .limit(1);

    expect(noAckYet.filter((a) => a.processedAt !== null)).toHaveLength(0);

    // ACK explícito do primeiro evento.
    const ackResponse = await app.inject({
      method: 'POST',
      url: `/events/${eventIds[0]}/ack`,
      headers: internalHeaders,
    });
    expect(ackResponse.statusCode).toBe(200);
    expect(ackResponse.json()).toMatchObject({ acknowledged: true, eventId: eventIds[0] });

    const firstAck = await db
      .select()
      .from(schema.outboxConsumerAcks)
      .where(
        and(
          eq(schema.outboxConsumerAcks.eventId, eventIds[0]),
          eq(schema.outboxConsumerAcks.consumerId, consumerId)
        )
      )
      .limit(1);

    expect(firstAck[0]).toMatchObject({
      processedAt: expect.any(Date),
      retryCount: 0,
    });

    const sinceResponse = await app.inject({
      method: 'GET',
      url: `/events?since=${encodeURIComponent(new Date(baseOccurredAt.getTime() + 90_000).toISOString())}&limit=10`,
      headers: internalHeaders,
    });

    expect(sinceResponse.statusCode).toBe(200);
    const sinceBody = sinceResponse.json() as {
      events: Array<{ event_id: string; metadata?: Record<string, unknown> }>;
      serverTime: string;
    };

    const ourEventsAfterSince = sinceBody.events.filter(
      (event) => event.metadata?.source === 'events-polling-test'
    );

    expect(ourEventsAfterSince).toHaveLength(1);
    expect(ourEventsAfterSince[0]).toMatchObject({
      event_id: eventIds[2],
      metadata: { source: 'events-polling-test' },
    });

    // ACK explícito dos restantes; só então todos aparecem como processados.
    for (const eventId of [eventIds[1], eventIds[2]]) {
      const ack = await app.inject({ method: 'POST', url: `/events/${eventId}/ack`, headers: internalHeaders });
      expect(ack.statusCode).toBe(200);
    }

    // Escopo nos eventos do teste: o outbox é compartilhado e o GET com lease
    // pode reivindicar pendentes de outros runs; a asserção verifica o que este
    // teste promete (os seus três eventos concluídos), sem depender de banco vazio.
    const ackedEvents = await db
      .select({
        eventId: schema.outboxConsumerAcks.eventId,
        processedAt: schema.outboxConsumerAcks.processedAt,
      })
      .from(schema.outboxConsumerAcks)
      .where(
        and(
          eq(schema.outboxConsumerAcks.consumerId, consumerId),
          inArray(schema.outboxConsumerAcks.eventId, eventIds),
        ),
      );

    expect(ackedEvents.map((event) => event.eventId)).toEqual(expect.arrayContaining(eventIds));
    expect(ackedEvents.every((event) => event.processedAt instanceof Date)).toBe(true);
  });
});
