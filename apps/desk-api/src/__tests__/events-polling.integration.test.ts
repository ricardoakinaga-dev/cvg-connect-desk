import './integration-mocks';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
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

  beforeAll(async () => {
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
  });

  it('returns pending outbox events ordered, filtered and acknowledged for http-poll consumer', async () => {
    const firstResponse = await app.inject({
      method: 'GET',
      url: '/events?limit=2',
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
      serverTime: string;
    };

    expect(firstBody.serverTime).toBeTypeOf('string');
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

    const ackedEvents = await db
      .select({
        eventId: schema.outboxConsumerAcks.eventId,
        processedAt: schema.outboxConsumerAcks.processedAt,
      })
      .from(schema.outboxConsumerAcks)
      .where(eq(schema.outboxConsumerAcks.consumerId, consumerId));

    expect(ackedEvents.map((event) => event.eventId)).toEqual(expect.arrayContaining(eventIds));
    expect(ackedEvents.every((event) => event.processedAt instanceof Date)).toBe(true);
  });
});
