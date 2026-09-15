/**
 * AAA-07 — lease e ACK cercado por proprietário (C03 FROZEN v1.0.1).
 *
 * Fronteira julgada executada contra PostgreSQL REAL (sem mocks): claim
 * atômico concorrente, fencing de ACK/NACK, expiração/reclaim com geração,
 * recuperação de crash, independência entre consumidores, renewal e
 * retry/DLQ. A suíte aborta se `DATABASE_URL` não apontar para o banco
 * isolado do run (sem fallback para 5432) e se o marcador do run não existir.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { ConsumerAwareOutboxReader, CONSUMER_IDS, type ConsumerId } from '../outbox-reader';
import { PostgresOutboxLease } from '../outbox-lease';

const EXPECTED = {
  host: '127.0.0.1',
  port: 56432,
  database: 'cvg_aaa_aaa_20260912_a7',
  marker: 'aaa-20260912-a7',
} as const;

const EVENT_PREFIX = `aaa07-lease-${Date.now()}-`;
const BASE_TIME = new Date('2001-01-01T00:00:00.000Z');
const RUN_PREFIX = 'aaa07-lease-';

let seedCounter = 0;

function rowsOf<T>(result: unknown): T[] {
  const rows = (result as { rows?: unknown[] }).rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

async function scalar<T>(query: ReturnType<typeof sql>): Promise<T | undefined> {
  const rows = rowsOf<Record<string, T>>(await db.execute(query));
  return rows[0] ? (Object.values(rows[0])[0] as T) : undefined;
}

async function cleanupRunData(): Promise<void> {
  await db.delete(schema.deadLetterEvents).where(sql`${schema.deadLetterEvents.originalEventId} LIKE ${`${RUN_PREFIX}%`}`);
  await db.delete(schema.outboxConsumerAcks).where(sql`${schema.outboxConsumerAcks.eventId} LIKE ${`${RUN_PREFIX}%`}`);
  await db.delete(schema.outboxEvents).where(sql`${schema.outboxEvents.eventId} LIKE ${`${RUN_PREFIX}%`}`);
}

async function seedEvent(options: { occurredOffsetMinutes?: number } = {}): Promise<string> {
  seedCounter += 1;
  const eventId = `${EVENT_PREFIX}${seedCounter}`;
  const offsetMinutes = options.occurredOffsetMinutes ?? seedCounter;
  const occurredAt = new Date(BASE_TIME.getTime() + offsetMinutes * 60_000);
  await db.insert(schema.outboxEvents).values({
    eventId,
    eventType: 'message.persisted',
    eventVersion: 1,
    aggregateType: 'Message',
    aggregateId: `agg-${seedCounter}`,
    occurredAt,
    payload: JSON.stringify({ messageId: `msg-${seedCounter}` }),
    metadata: null,
    correlationId: null,
    causationId: null,
    version: 1,
    processedAt: null,
    retryCount: 0,
    lastError: null,
    createdAt: occurredAt,
  });
  return eventId;
}

function makeReader(consumerId: ConsumerId, options: { maxRetries?: number; lease?: PostgresOutboxLease } = {}) {
  return new ConsumerAwareOutboxReader({
    consumerId,
    batchSize: 100,
    maxRetries: options.maxRetries ?? 3,
    lease: options.lease,
  });
}

async function getAckRow(eventId: string, consumerId: string) {
  const [row] = await db
    .select()
    .from(schema.outboxConsumerAcks)
    .where(
      and(
        eq(schema.outboxConsumerAcks.eventId, eventId),
        eq(schema.outboxConsumerAcks.consumerId, consumerId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function expireLease(eventId: string, consumerId: string): Promise<void> {
  await db.execute(sql`
    UPDATE outbox_consumer_acks
    SET lease_until = now() - interval '1 second'
    WHERE event_id = ${eventId} AND consumer_id = ${consumerId}
  `);
}

async function getDeadLetter(eventId: string, consumerId: string) {
  const [row] = await db
    .select()
    .from(schema.deadLetterEvents)
    .where(
      and(
        eq(schema.deadLetterEvents.originalEventId, eventId),
        eq(schema.deadLetterEvents.consumerId, consumerId),
      ),
    )
    .limit(1);
  return row ?? null;
}

function eventIdsFrom(claimed: Array<{ event: { event_id: string } }>): string[] {
  return claimed.map((entry) => entry.event.event_id);
}

describe('AAA-07 — lease e ACK cercado por proprietário (PostgreSQL real)', () => {
  const workerConsumer = CONSUMER_IDS.WORKER;
  const realtimeConsumer = CONSUMER_IDS.REALTIME;

  beforeAll(async () => {
    const rawUrl = process.env.DATABASE_URL;
    if (!rawUrl) {
      throw new Error('[AAA-07] DATABASE_URL ausente: a suíte exige o banco isolado do run (sem fallback 5432/6379)');
    }
    const parsed = new URL(rawUrl);
    if (parsed.hostname !== EXPECTED.host || Number(parsed.port) !== EXPECTED.port) {
      throw new Error(`[AAA-07] DATABASE_URL deve apontar para ${EXPECTED.host}:${EXPECTED.port} (recebido ${parsed.hostname}:${parsed.port || 'default'})`);
    }
    const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    if (database !== EXPECTED.database) {
      throw new Error(`[AAA-07] DATABASE_URL deve apontar para ${EXPECTED.database} (recebido ${database})`);
    }

    const currentDatabase = await scalar<string>(sql`SELECT current_database() AS db`);
    if (currentDatabase !== EXPECTED.database) {
      throw new Error(`[AAA-07] conexão efetiva é ${currentDatabase}, esperado ${EXPECTED.database}`);
    }

    const marker = await scalar<string>(sql`
      SELECT run_id FROM aaa_environment_marker WHERE run_id = ${EXPECTED.marker}
    `);
    if (marker !== EXPECTED.marker) {
      throw new Error(`[AAA-07] marcador ${EXPECTED.marker} ausente no banco ${EXPECTED.database}; aborte sem reservar dados`);
    }

    for (const column of ['lease_owner', 'lease_until', 'generation']) {
      const found = await scalar<string>(sql`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'outbox_consumer_acks' AND column_name = ${column}
        LIMIT 1
      `);
      if (found !== column) {
        throw new Error(`[AAA-07] coluna ${column} ausente: migration 0019 não aplicada`);
      }
    }

    await cleanupRunData();
  });

  afterAll(async () => {
    await cleanupRunData();
  });

  it('A06 — claimPendingEvents reserva: claim concorrente do mesmo consumidor tem um único vencedor', async () => {
    const eventId = await seedEvent();
    const readerA = makeReader(workerConsumer);
    const readerB = makeReader(workerConsumer);

    const [claimedA, claimedB] = await Promise.all([
      readerA.claimPendingEvents({ leaseOwner: 'owner-a', leaseSeconds: 60 }),
      readerB.claimPendingEvents({ leaseOwner: 'owner-b', leaseSeconds: 60 }),
    ]);

    const mineA = eventIdsFrom(claimedA).filter((id) => id === eventId);
    const mineB = eventIdsFrom(claimedB).filter((id) => id === eventId);

    expect(mineA.length + mineB.length).toBe(1);
    expect(eventIdsFrom(claimedA).filter((id) => eventIdsFrom(claimedB).includes(id))).toEqual([]);

    const row = await getAckRow(eventId, workerConsumer);
    expect(row).not.toBeNull();
    expect(['owner-a', 'owner-b']).toContain(row!.leaseOwner);
    expect(row!.generation).toBe(1);
    expect(row!.processedAt).toBeNull();
  });

  it('claim concorrente (mesmo consumidor): partição sem sobreposição e geração 1', async () => {
    const eventIds = await Promise.all([1, 2, 3, 4, 5].map(() => seedEvent()));
    const readerA = makeReader(workerConsumer);
    const readerB = makeReader(workerConsumer);

    const [claimedA, claimedB] = await Promise.all([
      readerA.claim({ owner: 'worker-a', leaseSeconds: 60 }),
      readerB.claim({ owner: 'worker-b', leaseSeconds: 60 }),
    ]);

    const mineA = eventIdsFrom(claimedA).filter((id) => eventIds.includes(id));
    const mineB = eventIdsFrom(claimedB).filter((id) => eventIds.includes(id));
    const union = new Set([...mineA, ...mineB]);

    expect(union.size).toBe(eventIds.length);
    expect(mineA.filter((id) => mineB.includes(id))).toEqual([]);
    for (const id of union) {
      const row = await getAckRow(id, workerConsumer);
      expect(row!.generation).toBe(1);
    }
  });

  it('claim(limit) não materializa ack para evento que não reclamou (regressão da integração)', async () => {
    const consumer = 'aaa07-lease-nomat' as unknown as ConsumerId;
    // X tem ack retryable pré-existente e é o candidato mais antigo; A e B não
    // têm ack. Datas bem anteriores aos demais eventos da suíte isolam o
    // consumidor customizado (o claim varre o outbox inteiro).
    const xId = await seedEvent({ occurredOffsetMinutes: -1000 });
    const aId = await seedEvent({ occurredOffsetMinutes: -990 });
    const bId = await seedEvent({ occurredOffsetMinutes: -980 });

    await db.insert(schema.outboxConsumerAcks).values({
      eventId: xId,
      consumerId: consumer,
      processedAt: null,
      retryCount: 1,
      lastError: 'falha anterior',
      leaseOwner: null,
      leaseUntil: null,
      generation: 0,
    });

    const reader = makeReader(consumer);
    const claimed = await reader.claim({ owner: 'owner-regressao', leaseSeconds: 60, limit: 2 });
    const mine = eventIdsFrom(claimed).filter((id) => [xId, aId, bId].includes(id));

    // Só os eventos devolvidos podem existir: X (via ON CONFLICT, sem materializar
    // lixo) e A. B está fora do limit ⇒ nenhuma linha de ack pode ser criada.
    expect(mine).toEqual([xId, aId]);
    expect(await getAckRow(bId, consumer)).toBeNull();

    const xRow = await getAckRow(xId, consumer);
    expect(xRow).toMatchObject({ generation: 1, retryCount: 1, leaseOwner: 'owner-regressao' });
    expect(xRow!.processedAt).toBeNull();
    const aRow = await getAckRow(aId, consumer);
    expect(aRow).toMatchObject({ generation: 1, retryCount: 0, leaseOwner: 'owner-regressao' });

    const rows = await db
      .select({ eventId: schema.outboxConsumerAcks.eventId })
      .from(schema.outboxConsumerAcks)
      .where(eq(schema.outboxConsumerAcks.consumerId, consumer));
    expect(rows.map((row) => row.eventId).sort()).toEqual([xId, aId].sort());
  });

  it('claim concorrente não cria ack para candidato que o vencedor não reclamou', async () => {
    const consumer = 'aaa07-lease-nomat-race' as unknown as ConsumerId;
    const eventIds = await Promise.all([
      seedEvent({ occurredOffsetMinutes: -2000 }),
      seedEvent({ occurredOffsetMinutes: -1990 }),
    ]);
    const readerA = makeReader(consumer);
    const readerB = makeReader(consumer);

    const [claimedA, claimedB] = await Promise.all([
      readerA.claim({ owner: 'race-a', leaseSeconds: 60, limit: 1 }),
      readerB.claim({ owner: 'race-b', leaseSeconds: 60, limit: 1 }),
    ]);

    const returned = new Set([...eventIdsFrom(claimedA), ...eventIdsFrom(claimedB)]);
    const rows = await db
      .select({ eventId: schema.outboxConsumerAcks.eventId, processedAt: schema.outboxConsumerAcks.processedAt })
      .from(schema.outboxConsumerAcks)
      .where(eq(schema.outboxConsumerAcks.consumerId, consumer));

    // Toda linha com processed_at NULL pertence a um claim devolvido; candidatos
    // que o vencedor não reclamou não têm linha alguma.
    expect(rows.length).toBe(returned.size);
    for (const row of rows) {
      expect(returned.has(row.eventId)).toBe(true);
      expect(row.processedAt).toBeNull();
    }
    for (const id of eventIds) {
      expect(rows.some((row) => row.eventId === id)).toBe(returned.has(id));
    }
  });

  it('lease vigente não é reentregue ao mesmo consumidor; só expira e recupera com generation + 1', async () => {
    const eventId = await seedEvent();
    const readerA = makeReader(workerConsumer);
    const readerB = makeReader(workerConsumer);

    const claimedA = await readerA.claim({ owner: 'worker-a', leaseSeconds: 60 });
    const leaseA = claimedA.find((entry) => entry.event.event_id === eventId)?.lease;
    expect(leaseA).toBeDefined();
    expect(leaseA!.generation).toBe(1);

    const whileLeased = await readerB.claim({ owner: 'worker-b', leaseSeconds: 60 });
    expect(eventIdsFrom(whileLeased)).not.toContain(eventId);

    await expireLease(eventId, workerConsumer);

    const reclaimed = await readerB.claim({ owner: 'worker-b', leaseSeconds: 60 });
    const leaseB = reclaimed.find((entry) => entry.event.event_id === eventId)?.lease;
    expect(leaseB).toBeDefined();
    expect(leaseB!.generation).toBe(leaseA!.generation + 1);
    expect(leaseB!.owner).toBe('worker-b');
  });

  it('ACK atrasado é stale: não marca processado e não incrementa retry (fencing)', async () => {
    const eventId = await seedEvent();
    const readerA = makeReader(workerConsumer);
    const readerB = makeReader(workerConsumer);

    const leaseA = (await readerA.claim({ owner: 'worker-a', leaseSeconds: 60 })).find(
      (entry) => entry.event.event_id === eventId,
    )!.lease;

    await expireLease(eventId, workerConsumer);
    const leaseB = (await readerB.claim({ owner: 'worker-b', leaseSeconds: 60 })).find(
      (entry) => entry.event.event_id === eventId,
    )!.lease;
    expect(leaseB.generation).toBe(leaseA.generation + 1);

    const staleResult = await readerA.ack({ eventId, owner: leaseA.owner, generation: leaseA.generation });
    expect(staleResult).toBe('stale');

    const afterStale = await getAckRow(eventId, workerConsumer);
    expect(afterStale!.processedAt).toBeNull();
    expect(afterStale!.retryCount).toBe(0);
    expect(afterStale!.leaseOwner).toBe('worker-b');
    expect(afterStale!.generation).toBe(leaseB.generation);

    expect(await readerB.ack({ eventId, owner: leaseB.owner, generation: leaseB.generation })).toBe('acked');
    const afterAck = await getAckRow(eventId, workerConsumer);
    expect(afterAck!.processedAt).toBeInstanceOf(Date);
  });

  it('crash após claim: lease expira pelo relógio e outro owner recupera (at-least-once)', async () => {
    const eventId = await seedEvent();
    const readerA = makeReader(workerConsumer);
    const readerB = makeReader(workerConsumer);

    const leaseA = (await readerA.claim({ owner: 'crashed-worker', leaseSeconds: 1 })).find(
      (entry) => entry.event.event_id === eventId,
    )!.lease;

    await new Promise((resolve) => setTimeout(resolve, 1200));

    const recovered = await readerB.claim({ owner: 'recovering-worker', leaseSeconds: 60 });
    const leaseB = recovered.find((entry) => entry.event.event_id === eventId)?.lease;
    expect(leaseB).toBeDefined();
    expect(leaseB!.generation).toBe(leaseA.generation + 1);

    expect(await readerA.renew(leaseA, 60)).toBeNull();
    expect(await readerA.ack({ eventId, owner: leaseA.owner, generation: leaseA.generation })).toBe('stale');
    expect(await readerB.ack({ eventId, owner: leaseB!.owner, generation: leaseB!.generation })).toBe('acked');
  });

  it('dois workers do mesmo consumidor não compartilham lease; consumidores diferentes são independentes', async () => {
    const eventId = await seedEvent();
    const worker1 = makeReader(workerConsumer);
    const worker2 = makeReader(workerConsumer);
    const realtime = makeReader(realtimeConsumer);

    const leaseW1 = (await worker1.claim({ owner: 'worker-1', leaseSeconds: 60 })).find(
      (entry) => entry.event.event_id === eventId,
    )!.lease;
    const worker2Attempt = await worker2.claim({ owner: 'worker-2', leaseSeconds: 60 });
    expect(eventIdsFrom(worker2Attempt)).not.toContain(eventId);

    // Consumidor distinto mantém sua própria reserva do mesmo evento.
    const leaseRt = (await realtime.claim({ owner: 'realtime-1', leaseSeconds: 60 })).find(
      (entry) => entry.event.event_id === eventId,
    )!.lease;
    expect(leaseRt.generation).toBe(1);
    expect(leaseRt.consumerId).toBe(realtimeConsumer);

    const workerRow = await getAckRow(eventId, workerConsumer);
    const realtimeRow = await getAckRow(eventId, realtimeConsumer);
    expect(workerRow!.leaseOwner).toBe('worker-1');
    expect(realtimeRow!.leaseOwner).toBe('realtime-1');

    // NACK/ack de um consumidor não afeta o outro.
    expect(await realtime.ack({ eventId, owner: leaseRt.owner, generation: leaseRt.generation })).toBe('acked');
    expect(await worker1.nack({ eventId, owner: leaseW1.owner, generation: leaseW1.generation, error: 'boom' })).toBe('retry');

    const realtimeAfter = await getAckRow(eventId, realtimeConsumer);
    expect(realtimeAfter!.processedAt).toBeInstanceOf(Date);
    const workerAfter = await getAckRow(eventId, workerConsumer);
    expect(workerAfter!.retryCount).toBe(1);
    expect(workerAfter!.processedAt).toBeNull();
  });

  it('renewal condicionado a owner+geração (fencing) e reclaim invalidam token antigo', async () => {
    const eventId = await seedEvent();
    const readerA = makeReader(workerConsumer);
    const readerB = makeReader(workerConsumer);

    const leaseA = (await readerA.claim({ owner: 'worker-a', leaseSeconds: 30 })).find(
      (entry) => entry.event.event_id === eventId,
    )!.lease;

    const renewed = await readerA.renew(leaseA, 120);
    expect(renewed).not.toBeNull();
    expect(renewed!.generation).toBe(leaseA.generation);
    expect(renewed!.leaseUntil.getTime()).toBeGreaterThan(leaseA.leaseUntil.getTime());

    const whileRenewed = await readerB.claim({ owner: 'worker-b', leaseSeconds: 60 });
    expect(eventIdsFrom(whileRenewed)).not.toContain(eventId);

    expect(await readerA.renew({ ...leaseA, owner: 'intruder' }, 120)).toBeNull();
    expect(await readerA.renew({ ...leaseA, generation: leaseA.generation + 1 }, 120)).toBeNull();

    await expireLease(eventId, workerConsumer);
    const leaseB = (await readerB.claim({ owner: 'worker-b', leaseSeconds: 60 })).find(
      (entry) => entry.event.event_id === eventId,
    )!.lease;
    expect(leaseB.generation).toBe(leaseA.generation + 1);
    expect(await readerA.renew(leaseA, 120)).toBeNull();
  });

  it('retry limitado por consumidor: esgotado vai para DLQ e deixa de ser reclamável', async () => {
    const eventId = await seedEvent();
    const leasePort = new PostgresOutboxLease({ maxRetries: 2 });
    const readerA = makeReader(workerConsumer, { maxRetries: 2, lease: leasePort });
    const readerB = makeReader(workerConsumer, { maxRetries: 2, lease: leasePort });
    const readerC = makeReader(workerConsumer, { maxRetries: 2, lease: leasePort });

    const leaseA = (await readerA.claim({ owner: 'worker-a', leaseSeconds: 60 })).find(
      (entry) => entry.event.event_id === eventId,
    )!.lease;
    expect(await readerA.nack({ eventId, owner: leaseA.owner, generation: leaseA.generation, error: 'falha 1' })).toBe('retry');

    const afterFirstNack = await getAckRow(eventId, workerConsumer);
    expect(afterFirstNack!.retryCount).toBe(1);
    expect(afterFirstNack!.leaseOwner).toBeNull();

    // NACK libera o lease: reclaim imediato com geração nova.
    const leaseB = (await readerB.claim({ owner: 'worker-b', leaseSeconds: 60 })).find(
      (entry) => entry.event.event_id === eventId,
    )!.lease;
    expect(leaseB.generation).toBe(leaseA.generation + 1);
    expect(await readerB.nack({ eventId, owner: leaseB.owner, generation: leaseB.generation, error: 'falha 2' })).toBe(
      'dead-letter',
    );

    const dlq = await getDeadLetter(eventId, workerConsumer);
    expect(dlq).not.toBeNull();
    expect(dlq!.status).toBe('PENDING');
    expect(dlq!.attemptCount).toBe(2);
    expect(dlq!.errorCode).toBe('NACK_MAX_RETRIES');

    const afterDeadLetter = await readerC.claim({ owner: 'worker-c', leaseSeconds: 60 });
    expect(eventIdsFrom(afterDeadLetter)).not.toContain(eventId);

    // NACK de geração anterior é stale: não incrementa retry nem reabre o evento.
    expect(
      await readerA.nack({ eventId, owner: leaseA.owner, generation: leaseA.generation, error: 'atrasado' }),
    ).toBe('stale');
    const frozen = await getAckRow(eventId, workerConsumer);
    expect(frozen!.retryCount).toBe(2);
    expect(frozen!.lastError).toBe('falha 2');
  });

  it('since é aplicado no predicado do claim: evento descartado não é reservado (MEDIUM-03)', async () => {
    const eventIdOld = await seedEvent({ occurredOffsetMinutes: 0 });
    const eventIdMid = await seedEvent({ occurredOffsetMinutes: 60 });
    const eventIdNew = await seedEvent({ occurredOffsetMinutes: 120 });
    const reader = makeReader(workerConsumer);

    const [midRow] = await db
      .select({ occurredAt: schema.outboxEvents.occurredAt })
      .from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.eventId, eventIdMid));
    const since = new Date(midRow.occurredAt.getTime() + 30_000);

    const claimed = await reader.claim({ owner: 'worker-since', leaseSeconds: 60, since });
    const mine = eventIdsFrom(claimed);
    expect(mine).toContain(eventIdNew);
    expect(mine).not.toContain(eventIdOld);
    expect(mine).not.toContain(eventIdMid);

    expect(await getAckRow(eventIdOld, workerConsumer)).toBeNull();
    expect(await getAckRow(eventIdMid, workerConsumer)).toBeNull();
    expect(await getAckRow(eventIdNew, workerConsumer)).not.toBeNull();
  });

  it('ACK idempotente e not_found; consumidor diferente não enxerga o lease alheio', async () => {
    const eventId = await seedEvent();
    const reader = makeReader(workerConsumer);

    expect(await reader.ack({ eventId, owner: 'ghost', generation: 1 })).toBe('not_found');
    expect(await reader.acknowledgeCurrentLease(eventId)).toBe('not_found');

    const lease = (await reader.claim({ owner: 'worker-a', leaseSeconds: 60 })).find(
      (entry) => entry.event.event_id === eventId,
    )!.lease;
    expect(await reader.ack({ eventId, owner: lease.owner, generation: lease.generation })).toBe('acked');
    // Idempotente: repetir o mesmo token retorna acked sem efeito novo.
    expect(await reader.ack({ eventId, owner: lease.owner, generation: lease.generation })).toBe('acked');
    // Geração/owner errados após conclusão continuam stale.
    expect(await reader.ack({ eventId, owner: 'intruder', generation: lease.generation })).toBe('stale');
    expect(await reader.ack({ eventId, owner: lease.owner, generation: lease.generation + 1 })).toBe('stale');

    const otherConsumerReader = makeReader(realtimeConsumer);
    expect(await otherConsumerReader.ack({ eventId, owner: lease.owner, generation: lease.generation })).toBe(
      'not_found',
    );
  });

  it('claim valida entrada antes de reservar (leaseSeconds e since)', async () => {
    const eventId = await seedEvent();
    const reader = makeReader(workerConsumer);

    await expect(reader.claim({ owner: 'worker-x', leaseSeconds: 0 })).rejects.toThrow();
    await expect(reader.claim({ owner: 'worker-x', leaseSeconds: 60, since: new Date('invalid') })).rejects.toThrow();

    expect(await getAckRow(eventId, workerConsumer)).toBeNull();
  });
});
