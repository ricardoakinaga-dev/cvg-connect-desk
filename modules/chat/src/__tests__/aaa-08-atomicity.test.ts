/**
 * AAA-08 — persistir mensagem, estado e intenção de evento atomicamente (C03 FROZEN v1.0.1).
 *
 * Fronteira julgada executada contra PostgreSQL REAL e Redis REAL, sem mocks de
 * banco/barramento:
 *  - D-C03-1: mensagem + estado + intenção de evento na MESMA transação; falha
 *    entre escritas ⇒ rollback total; retry nunca acha mensagem sem evento.
 *  - D-C03-2: hint Redis só após commit; hint perdido não perde o evento durável.
 *  - A07: reprodução negativa (mensagem persistida sem evento) é discriminada
 *    pelo teste de rollback/retry abaixo.
 *
 * A suíte aborta se `DATABASE_URL` não apontar para o banco isolado do run
 * (sem fallback 5432) e se `REDIS_URL` não for o Redis dedicado (sem 6379).
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { eq, inArray, like, sql } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { ConsumerAwareOutboxReader, CONSUMER_IDS, NoopRealtimeBus, RedisRealtimeBus } from '@cvg/events';
import { receiveInboundMessage } from '../application/use-cases/receive-inbound-message.use-case';
import { messageRepository } from '../infrastructure/repositories/message.repository';
import { conversationRepository } from '../infrastructure/repositories/conversation.repository';

const EXPECTED = {
  host: '127.0.0.1',
  port: 56432,
  database: 'cvg_aaa_aaa_20260912_a8',
  marker: 'aaa-20260912-a8',
  redisHost: '127.0.0.1',
  redisPort: 56685,
} as const;

const CONNECTION_STRING = process.env.DATABASE_URL || '';
const PREFIX = `aaa08-atomic-${Date.now()}-`;

/** Conexão independente: só enxerga o que já commitou (prova de rollback). */
const observationPool = new Pool({ connectionString: CONNECTION_STRING });

let seed = 0;

function uniqueSuffix(): string {
  seed += 1;
  return `${PREFIX}${seed}-${Math.random().toString(36).slice(2, 8)}`;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return check();
}

async function observeMessage(externalMessageId: string): Promise<{ id: string; conversationId: string } | null> {
  const result = await observationPool.query(
    'SELECT id, conversation_id FROM messages WHERE external_message_id = $1',
    [externalMessageId],
  );
  const row = result.rows[0];
  return row ? { id: row.id as string, conversationId: row.conversation_id as string } : null;
}

async function observeConversationByExternalId(externalConversationId: string): Promise<{ id: string; unreadCount: number } | null> {
  const result = await observationPool.query(
    'SELECT id, unread_count FROM conversations WHERE external_conversation_id = $1',
    [externalConversationId],
  );
  const row = result.rows[0];
  return row ? { id: row.id as string, unreadCount: Number(row.unread_count) } : null;
}

async function observeStatusHistoryCount(conversationId: string): Promise<number> {
  const result = await observationPool.query(
    'SELECT count(*)::int AS count FROM conversation_status_history WHERE conversation_id = $1',
    [conversationId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function observeMessageEventsByContent(content: string): Promise<Array<{ eventId: string; payload: string }>> {
  const result = await observationPool.query(
    "SELECT event_id, payload FROM outbox_events WHERE event_type = 'message.persisted' AND payload LIKE $1",
    [`%${content}%`],
  );
  return result.rows.map((row: { event_id: string; payload: string }) => ({ eventId: row.event_id, payload: row.payload }));
}

async function observeMessageEventsByConversation(conversationId: string): Promise<Array<{ eventId: string; payload: string }>> {
  const result = await observationPool.query(
    "SELECT event_id, payload FROM outbox_events WHERE event_type = 'message.persisted' AND payload LIKE $1",
    [`%${conversationId}%`],
  );
  return result.rows.map((row: { event_id: string; payload: string }) => ({ eventId: row.event_id, payload: row.payload }));
}

async function cleanupPrefix(prefix: string, phoneDigits?: string): Promise<void> {
  const conversations = await db
    .select({ id: schema.conversations.id })
    .from(schema.conversations)
    .where(like(schema.conversations.externalConversationId, `${prefix}%`));
  const messages = await db
    .select({ id: schema.messages.id })
    .from(schema.messages)
    .where(like(schema.messages.externalMessageId, `${prefix}%`));
  const aggregateIds = [...conversations.map((c) => c.id), ...messages.map((m) => m.id)];

  const orphanEvents = await db
    .select({ eventId: schema.outboxEvents.eventId })
    .from(schema.outboxEvents)
    .where(like(schema.outboxEvents.aggregateId, `${prefix}%`));
  const eventIds = orphanEvents.map((e) => e.eventId);
  if (eventIds.length > 0) {
    await db.delete(schema.outboxConsumerAcks).where(inArray(schema.outboxConsumerAcks.eventId, eventIds));
    await db.delete(schema.outboxEvents).where(inArray(schema.outboxEvents.eventId, eventIds));
  }
  if (aggregateIds.length > 0) {
    const aggregateEvents = await db
      .select({ eventId: schema.outboxEvents.eventId })
      .from(schema.outboxEvents)
      .where(inArray(schema.outboxEvents.aggregateId, aggregateIds));
    const aggregateEventIds = aggregateEvents.map((e) => e.eventId);
    if (aggregateEventIds.length > 0) {
      await db.delete(schema.outboxConsumerAcks).where(inArray(schema.outboxConsumerAcks.eventId, aggregateEventIds));
      await db.delete(schema.outboxEvents).where(inArray(schema.outboxEvents.eventId, aggregateEventIds));
    }
  }
  if (conversations.length > 0) {
    const conversationIds = conversations.map((c) => c.id);
    await db.delete(schema.conversationStatusHistory).where(inArray(schema.conversationStatusHistory.conversationId, conversationIds));
  }
  await db.delete(schema.messages).where(like(schema.messages.externalMessageId, `${prefix}%`));
  if (conversations.length > 0) {
    await db.delete(schema.conversations).where(inArray(schema.conversations.id, conversations.map((c) => c.id)));
  }
  if (phoneDigits) {
    await db.delete(schema.contacts).where(eq(schema.contacts.externalId, `whatsapp:${phoneDigits}`));
  }
}

async function scalar<T>(query: ReturnType<typeof sql>): Promise<T | undefined> {
  const result = await db.execute(query as never);
  const rows = (result as { rows?: Array<Record<string, unknown>> }).rows ?? [];
  const first = rows[0];
  return first ? (Object.values(first)[0] as T) : undefined;
}

describe('AAA-08 — mensagem + estado + outbox atômicos (PostgreSQL/Redis reais)', () => {
  const createdPrefixes: Array<{ prefix: string; phoneDigits: string | undefined }> = [];

  beforeAll(async () => {
    if (!CONNECTION_STRING) {
      throw new Error('[AAA-08] DATABASE_URL ausente: a suíte exige o banco isolado a8 (sem fallback 5432)');
    }
    const parsed = new URL(CONNECTION_STRING);
    if (parsed.hostname !== EXPECTED.host || Number(parsed.port) !== EXPECTED.port) {
      throw new Error(`[AAA-08] DATABASE_URL deve apontar para ${EXPECTED.host}:${EXPECTED.port} (recebido ${parsed.hostname}:${parsed.port || 'default'})`);
    }
    const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    if (database !== EXPECTED.database) {
      throw new Error(`[AAA-08] DATABASE_URL deve apontar para ${EXPECTED.database} (recebido ${database})`);
    }

    const redisUrl = process.env.REDIS_URL || '';
    if (!redisUrl) {
      throw new Error('[AAA-08] REDIS_URL ausente: a suíte exige o Redis dedicado do run (sem fallback 6379)');
    }
    const parsedRedis = new URL(redisUrl);
    if (parsedRedis.hostname !== EXPECTED.redisHost || Number(parsedRedis.port) !== EXPECTED.redisPort) {
      throw new Error(`[AAA-08] REDIS_URL deve apontar para ${EXPECTED.redisHost}:${EXPECTED.redisPort} (recebido ${parsedRedis.hostname}:${parsedRedis.port || 'default'})`);
    }

    const currentDatabase = await scalar<string>(sql`SELECT current_database() AS db`);
    if (currentDatabase !== EXPECTED.database) {
      throw new Error(`[AAA-08] conexão efetiva é ${currentDatabase}, esperado ${EXPECTED.database}`);
    }

    const marker = await scalar<string>(
      sql`SELECT run_id FROM aaa_environment_marker WHERE run_id = ${EXPECTED.marker}`,
    );
    if (marker !== EXPECTED.marker) {
      throw new Error(`[AAA-08] marcador ${EXPECTED.marker} ausente no banco ${EXPECTED.database}; aborte sem reservar dados`);
    }

    for (const table of ['messages', 'conversations', 'outbox_events', 'outbox_consumer_acks']) {
      const found = await scalar<string>(
        sql`SELECT table_name FROM information_schema.tables WHERE table_name = ${table} LIMIT 1`,
      );
      if (found !== table) {
        throw new Error(`[AAA-08] tabela ${table} ausente: migrations não aplicadas no banco a8`);
      }
    }
  });

  afterEach(async () => {
    while (createdPrefixes.length > 0) {
      const prefix = createdPrefixes.pop()!;
      await cleanupPrefix(prefix.prefix, prefix.phoneDigits);
    }
    vi.restoreAllMocks();
    const seam = (await import('@cvg/events')) as { setSharedRealtimeBus?: (bus: unknown) => void };
    seam.setSharedRealtimeBus?.(null);
  });

  afterAll(async () => {
    await observationPool.end();
  });

  async function makeConversation(): Promise<{ conversationId: string; externalConversationId: string; sub: string }> {
    const sub = uniqueSuffix();
    const externalConversationId = `${sub}-conv`;
    const conversation = await conversationRepository.create({
      externalConversationId,
      externalChannelId: 'whatsapp',
      status: 'open',
      statusV2: 'novo',
      isActive: true,
    });
    createdPrefixes.push({ prefix: sub, phoneDigits: undefined });
    return { conversationId: conversation.id, externalConversationId, sub };
  }

  it('A07 — falha entre o insert da mensagem e a intenção: rollback total e retry sem mensagem órfã', async () => {
    const { conversationId, sub } = await makeConversation();
    const externalMessageId = `${sub}-msg-fault`;
    const content = `conteudo-a07-${sub}`;
    const input = {
      externalMessageId,
      externalConversationId: `${sub}-conv`,
      content,
      sender: '+551190008001',
      senderType: 'contact' as const,
      sentAt: new Date(),
    };

    const originalCreate = messageRepository.createIdempotent.bind(messageRepository);
    const spy = vi.spyOn(messageRepository, 'createIdempotent').mockImplementation(async (data, executor) => {
      await originalCreate(data, executor);
      throw new Error('AAA-08 injected fault between message insert and event intent');
    });

    const failed = await receiveInboundMessage(input);
    expect(failed.isErr()).toBe(true);

    // Nada pode ter sobrevivido: mensagem, estado e intenção são uma unidade.
    expect(await observeMessage(externalMessageId)).toBeNull();
    expect(await observeMessageEventsByContent(content)).toHaveLength(0);
    const conversationAfterFault = await observeConversationByExternalId(`${sub}-conv`);
    expect(conversationAfterFault?.unreadCount ?? 0).toBe(0);

    spy.mockRestore();

    // Retry após o crash: a mensagem nasce COM o seu evento; nunca antes.
    const retried = await receiveInboundMessage(input);
    expect(retried.isOk()).toBe(true);
    if (!retried.isOk()) return;

    const stored = await observeMessage(externalMessageId);
    expect(stored).not.toBeNull();
    const persistedEvents = await observeMessageEventsByContent(content);
    expect(persistedEvents).toHaveLength(1);
    const eventPayload = JSON.parse(persistedEvents[0].payload) as { messageId: string };
    expect(eventPayload.messageId).toBe(stored!.id);
    expect(persistedEvents[0].eventId).toMatch(/[0-9a-f-]{36}/);
    expect((await observeConversationByExternalId(`${sub}-conv`))?.unreadCount).toBe(1);

    // Retry adicional: mesmo messageId, mesmo evento, sem multiplicar efeitos.
    const again = await receiveInboundMessage(input);
    expect(again.isOk()).toBe(true);
    if (again.isOk()) expect(again.value.messageId).toBe(retried.value.messageId);
    expect(await observeMessageEventsByContent(content)).toHaveLength(1);
    expect((await observeConversationByExternalId(`${sub}-conv`))?.unreadCount).toBe(1);
    expect(conversationId).toBeTruthy();
  }, 20000);

  it('falha na própria intenção do outbox: a escrita do evento participa da transação', async () => {
    const { sub } = await makeConversation();
    const externalMessageId = `${sub}-msg-outbox-fault`;
    const content = `conteudo-outbox-fault-${sub}`;

    const seam = (await import('@cvg/events')) as {
      outboxIntentWriter?: { persist: (...args: unknown[]) => Promise<void> };
    };
    expect(seam.outboxIntentWriter).toBeDefined();
    const spy = vi
      .spyOn(seam.outboxIntentWriter!, 'persist')
      .mockImplementationOnce(async () => {
        throw new Error('AAA-08 injected fault inside outbox intent insert');
      });

    const failed = await receiveInboundMessage({
      externalMessageId,
      externalConversationId: `${sub}-conv`,
      content,
      sender: '+551190008007',
      senderType: 'contact' as const,
      sentAt: new Date(),
    });
    expect(failed.isErr()).toBe(true);

    expect(await observeMessage(externalMessageId)).toBeNull();
    expect(await observeMessageEventsByContent(content)).toHaveLength(0);
    expect((await observeConversationByExternalId(`${sub}-conv`))?.unreadCount).toBe(0);

    spy.mockRestore();

    const retried = await receiveInboundMessage({
      externalMessageId,
      externalConversationId: `${sub}-conv`,
      content,
      sender: '+551190008007',
      senderType: 'contact' as const,
      sentAt: new Date(),
    });
    expect(retried.isOk()).toBe(true);
    expect(await observeMessage(externalMessageId)).not.toBeNull();
    expect(await observeMessageEventsByContent(content)).toHaveLength(1);
  }, 20000);

  it('corrida no mesmo externalMessageId: um vencedor, sem mensagem/evento duplicado', async () => {
    const { sub } = await makeConversation();
    const externalMessageId = `${sub}-msg-race`;
    const content = `conteudo-race-${sub}`;
    const input = {
      externalMessageId,
      externalConversationId: `${sub}-conv`,
      content,
      sender: '+551190008008',
      senderType: 'contact' as const,
      sentAt: new Date(),
    };

    const [a, b] = await Promise.all([receiveInboundMessage(input), receiveInboundMessage(input)]);
    expect(a.isOk()).toBe(true);
    expect(b.isOk()).toBe(true);
    if (!a.isOk() || !b.isOk()) return;
    expect(a.value.messageId).toBe(b.value.messageId);

    const stored = await observeMessage(externalMessageId);
    expect(stored).not.toBeNull();
    expect(stored!.id).toBe(a.value.messageId);
    expect(await observeMessageEventsByContent(content)).toHaveLength(1);
    expect((await observeConversationByExternalId(`${sub}-conv`))?.unreadCount).toBe(1);
  }, 20000);

  it('falha após a intenção (antes do estado): intenção, conversa nova e contato voltam atrás, sem órfãos', async () => {
    const sub = uniqueSuffix();
    const externalMessageId = `${sub}-msg-state-fault`;
    const externalConversationId = `${sub}-conv-new`;
    const content = `conteudo-state-${sub}`;
    const phone = '+551190008002';
    const phoneDigits = phone.replace(/\D/g, '');
    createdPrefixes.push({ prefix: sub, phoneDigits });

    const originalMarkUnread = conversationRepository.markInboundUnread.bind(conversationRepository);
    let injected = false;
    const spy = vi.spyOn(conversationRepository, 'markInboundUnread').mockImplementation(async (id, executor) => {
      if (!injected) {
        injected = true;
        throw new Error('AAA-08 injected fault after event intent, before state change');
      }
      return originalMarkUnread(id, executor);
    });

    const failed = await receiveInboundMessage({
      externalMessageId,
      externalConversationId,
      content,
      sender: phone,
      senderType: 'contact' as const,
      contactPhone: phone,
      contactName: 'Contato AAA-08',
      sentAt: new Date(),
    });
    expect(failed.isErr()).toBe(true);

    expect(await observeMessage(externalMessageId)).toBeNull();
    expect(await observeConversationByExternalId(externalConversationId)).toBeNull();
    expect(await observeMessageEventsByContent(content)).toHaveLength(0);
    const orphanContacts = await observationPool.query('SELECT id FROM contacts WHERE external_id = $1', [`whatsapp:${phoneDigits}`]);
    expect(orphanContacts.rows).toHaveLength(0);
    const createdEvents = await observationPool.query(
      "SELECT event_id FROM outbox_events WHERE event_type = 'conversation.created' AND payload LIKE $1",
      [`%${externalConversationId}%`],
    );
    expect(createdEvents.rows).toHaveLength(0);

    spy.mockRestore();

    const retried = await receiveInboundMessage({
      externalMessageId,
      externalConversationId,
      content,
      sender: phone,
      senderType: 'contact' as const,
      contactPhone: phone,
      contactName: 'Contato AAA-08',
      sentAt: new Date(),
    });
    expect(retried.isOk()).toBe(true);
    if (!retried.isOk()) return;

    const conversation = await observeConversationByExternalId(externalConversationId);
    expect(conversation).not.toBeNull();
    expect(conversation?.unreadCount).toBe(1);
    expect(await observeStatusHistoryCount(conversation!.id)).toBe(1);
    expect(await observeMessage(externalMessageId)).not.toBeNull();
    const contacts = await observationPool.query('SELECT id FROM contacts WHERE external_id = $1', [`whatsapp:${phoneDigits}`]);
    expect(contacts.rows).toHaveLength(1);
    expect((await observationPool.query('SELECT contact_id FROM conversations WHERE id = $1', [conversation!.id])).rows[0]?.contact_id).toBe(contacts.rows[0].id);
    const persistedEvents = await observeMessageEventsByConversation(conversation!.id);
    expect(persistedEvents).toHaveLength(1);
    const createdAfterRetry = await observationPool.query(
      "SELECT event_id FROM outbox_events WHERE event_type = 'conversation.created' AND payload LIKE $1",
      [`%${externalConversationId}%`],
    );
    expect(createdAfterRetry.rows).toHaveLength(1);
  }, 20000);

  it('hint Redis só após commit: terceiro não enxerga escrita aberta e o hint chega depois', async () => {
    const { sub } = await makeConversation();
    const externalMessageId = `${sub}-msg-hint`;
    const content = `conteudo-hint-${sub}`;

    const observer = new RedisRealtimeBus({ url: process.env.REDIS_URL || '', instanceId: `aaa08-observer-${sub}` });
    await observer.start();
    const received: Array<{ event_id: string; event_type: string; payload: { content?: string } }> = [];
    observer.onEnvelope((envelope) => {
      received.push(envelope as never);
    });

    const originalMarkUnread = conversationRepository.markInboundUnread.bind(conversationRepository);
    const held = deferred<void>();
    const release = deferred<void>();
    let firstCall = true;
    vi.spyOn(conversationRepository, 'markInboundUnread').mockImplementation(async (id, executor) => {
      const result = await originalMarkUnread(id, executor);
      if (firstCall) {
        firstCall = false;
        held.resolve();
        await release.promise;
      }
      return result;
    });

    const pending = receiveInboundMessage({
      externalMessageId,
      externalConversationId: `${sub}-conv`,
      content,
      sender: '+551190008003',
      senderType: 'contact' as const,
      sentAt: new Date(),
    });

    await held.promise;

    // Transação ainda aberta: mensagem e intenção existem no executor, mas um
    // terceiro (observação por outra conexão) não as vê; nenhum hint saiu.
    expect(await observeMessage(externalMessageId)).toBeNull();
    expect(await observeMessageEventsByContent(content)).toHaveLength(0);
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(received.filter((e) => e.event_type === 'message.persisted' && e.payload?.content === content)).toHaveLength(0);

    release.resolve();
    const result = await pending;
    expect(result.isOk()).toBe(true);

    // Pós-commit: tudo visível; o hint chega com o MESMO event_id durável.
    const stored = await observeMessage(externalMessageId);
    expect(stored).not.toBeNull();
    const persistedEvents = await observeMessageEventsByContent(content);
    expect(persistedEvents).toHaveLength(1);

    const hinted = await waitFor(() =>
      received.some((e) => e.event_type === 'message.persisted' && e.payload?.content === content),
    );
    expect(hinted).toBe(true);
    const hint = received.find((e) => e.event_type === 'message.persisted' && e.payload?.content === content);
    expect(hint?.event_id).toBe(persistedEvents[0].eventId);

    await observer.stop();
  }, 20000);

  it('Redis indisponível: hint perdido não perde o evento; polling/claim entrega o durável', async () => {
    const seam = (await import('@cvg/events')) as { setSharedRealtimeBus?: (bus: unknown) => void };
    expect(typeof seam.setSharedRealtimeBus).toBe('function');
    seam.setSharedRealtimeBus!(new NoopRealtimeBus());

    const { sub } = await makeConversation();
    const externalMessageId = `${sub}-msg-losthint`;
    const content = `conteudo-losthint-${sub}`;

    const result = await receiveInboundMessage({
      externalMessageId,
      externalConversationId: `${sub}-conv`,
      content,
      sender: '+551190008004',
      senderType: 'contact' as const,
      sentAt: new Date(),
    });
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const stored = await observeMessage(externalMessageId);
    expect(stored).not.toBeNull();
    const persistedEvents = await observeMessageEventsByContent(content);
    expect(persistedEvents).toHaveLength(1);

    // Caminho durável: um consumidor conciencioso reclama o evento do outbox
    // mesmo sem nunca ter recebido hint do Redis.
    const reader = new ConsumerAwareOutboxReader({ consumerId: CONSUMER_IDS.REALTIME, batchSize: 200 });
    const claimed = await reader.claim({ owner: 'aaa08-lost-hint', leaseSeconds: 30, limit: 200 });
    const mine = claimed.find((entry) => entry.event.event_id === persistedEvents[0].eventId);
    expect(mine).toBeDefined();
    expect((mine!.event.payload as { messageId?: string }).messageId).toBe(stored!.id);

    const ack = await reader.ack({
      eventId: mine!.event.event_id,
      owner: 'aaa08-lost-hint',
      generation: mine!.lease.generation,
    });
    expect(ack).toBe('acked');
  }, 20000);

  it('identidade estável: replay do mesmo envelope não multiplica linha/efeito', async () => {
    const { sub } = await makeConversation();
    const externalMessageId = `${sub}-msg-identity`;
    const content = `conteudo-identity-${sub}`;
    const input = {
      externalMessageId,
      externalConversationId: `${sub}-conv`,
      content,
      sender: '+551190008005',
      senderType: 'contact' as const,
      sentAt: new Date(),
    };

    const first = await receiveInboundMessage(input);
    expect(first.isOk()).toBe(true);
    if (!first.isOk()) return;

    const persistedEvents = await observeMessageEventsByContent(content);
    expect(persistedEvents).toHaveLength(1);
    const eventId = persistedEvents[0].eventId;

    const row = await db
      .select()
      .from(schema.outboxEvents)
      .where(eq(schema.outboxEvents.eventId, eventId));
    expect(row).toHaveLength(1);

    const seam = (await import('@cvg/events')) as {
      outboxIntentWriter?: { persist: (executor: unknown, event: unknown) => Promise<void> };
    };
    expect(seam.outboxIntentWriter).toBeDefined();
    const envelope = {
      event_id: eventId,
      event_type: row[0].eventType,
      event_version: row[0].eventVersion,
      aggregate_type: row[0].aggregateType,
      aggregate_id: row[0].aggregateId,
      occurred_at: row[0].occurredAt.toISOString(),
      payload: JSON.parse(row[0].payload),
      metadata: row[0].metadata ? JSON.parse(row[0].metadata) : undefined,
      correlation_id: row[0].correlationId ?? undefined,
      causation_id: row[0].causationId ?? undefined,
      version: row[0].version,
    };

    await seam.outboxIntentWriter!.persist(db, envelope);
    await seam.outboxIntentWriter!.persist(db, envelope);

    expect(await observeMessageEventsByContent(content)).toHaveLength(1);

    const retried = await receiveInboundMessage(input);
    expect(retried.isOk()).toBe(true);
    if (retried.isOk()) expect(retried.value.messageId).toBe(first.value.messageId);
    expect(await observeMessageEventsByContent(content)).toHaveLength(1);
    expect((await observeConversationByExternalId(`${sub}-conv`))?.unreadCount).toBe(1);
  }, 20000);

  it('Secretary indisponível: mensagem, evento e recuperação humana preservados', async () => {
    const sub = uniqueSuffix();
    const externalMessageId = `${sub}-msg-secretary`;
    const externalConversationId = `${sub}-conv-secretary`;
    const content = `conteudo-secretary-${sub}`;
    createdPrefixes.push({ prefix: sub, phoneDigits: undefined });

    const result = await receiveInboundMessage({
      externalMessageId,
      externalConversationId,
      content,
      sender: '+551190008006',
      senderType: 'contact' as const,
      sentAt: new Date(),
    });
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    const conversation = await observeConversationByExternalId(externalConversationId);
    expect(conversation).not.toBeNull();
    expect(conversation?.unreadCount).toBe(1);
    expect(await observeMessage(externalMessageId)).not.toBeNull();
    expect(await observeMessageEventsByContent(content)).toHaveLength(1);

    // Sem cliente Secretary configurado, nenhum evento de invocação foi emitido
    // (a falha é não-crítica) e a conversa continua visível/atendível.
    const invocationEvents = await observationPool.query(
      "SELECT event_id FROM outbox_events WHERE event_type = 'secretary.invocation' AND payload LIKE $1",
      [`%${conversation!.id}%`],
    );
    expect(invocationEvents.rows).toHaveLength(0);

    const claimed = await conversationRepository.updateCurrentHandler(conversation!.id, 'human');
    expect(claimed?.currentHandler).toBe('human');
  }, 20000);
});
