import './integration-mocks';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { gatewayService } from '@cvg/gateway-adapter';
import { messageRepository } from '@cvg/chat';
import { buildDeskApiApp } from '../app.ts';

/**
 * AAA-12 — idempotência transacional do envio outbound (C04 + C03 D-C03-1).
 *
 * Exige o PostgreSQL real do run `aaa-20260912-a12` (127.0.0.1:56432, banco
 * `cvg_aaa_aaa_20260912_a12`, marcador `aaa-20260912-a12`); URL fora do
 * padrão aborta em beforeAll — sem fallback 5432. O Gateway é o mock da
 * composição (`integration-mocks`), controlável por teste; mensagem, mapping e
 * intenção de outbox ficam no PostgreSQL real.
 *
 * Negativos discriminantes:
 *  - retry sequencial da mesma chave devolve o MESMO resultado sem linhas novas;
 *  - N requisições HTTP concorrentes (socket real) ⇒ exatamente 1 mensagem,
 *    1 mapping e 1 intenção de outbox, 1 chamada ao provider;
 *  - payload divergente com a mesma chave ⇒ 409 sem side effects;
 *  - TTL expirado NÃO reenvia: intenção vira falha terminal e a resposta marca
 *    `expired: true`;
 *  - resultado ambíguo do provider ⇒ `unknown_reconciling`, sem retry cego e
 *    fora da lista de pendências do gateway;
 *  - falha na intenção de outbox derruba a transação inteira (sem órfãos).
 */

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const DB_MARKER = 'aaa-20260912-a12';
const password = 'ChatRoutePass!42';
const passwordHash = '$2a$10$UX/LcD/6NKhheDIZmbHyN.a6Hc8SW6ytZ/LCCZW3un3h5vJ9n/1h6';
const roleName = 'Receptionist';

type SendResult = {
  messageId: string;
  conversationId: string;
  status: string;
  outcome?: string;
  deduplicated: boolean;
  expired?: boolean;
};

describe('AAA-12 outbound transactional idempotency', () => {
  const email = `aaa12.outbound.${Date.now()}@example.com`;
  const emailB = `aaa12.outbound.b.${Date.now()}@example.com`;
  const conversationA = randomUUID();
  const conversationB = randomUUID();
  const userId = randomUUID();
  const userBId = randomUUID();
  let sectorId = '';
  let roleId = '';
  let app: Awaited<ReturnType<typeof buildDeskApiApp>>;
  let baseUrl = '';
  let token = '';
  let tokenB = '';

  beforeAll(async () => {
    if (!/cvg_aaa_aaa_20260912_a12/.test(DATABASE_URL) || !DATABASE_URL.includes('127.0.0.1:56432')) {
      throw new Error(`AAA-12 exige DATABASE_URL do run a12 em 127.0.0.1:56432; recebido: ${DATABASE_URL}`);
    }
    process.env.RATE_LIMIT_MAX = process.env.RATE_LIMIT_MAX || '10000';
    process.env.RATE_LIMIT_WINDOW = process.env.RATE_LIMIT_WINDOW || '1 minute';
    // Nenhum Redis neste run: o barramento é Noop e o outbox durável é o PG.
    delete process.env.REDIS_URL;

    const marker = await db.execute(sql`SELECT run_id FROM aaa_environment_marker`);
    const rows = (marker as unknown as { rows: Array<{ run_id: string }> }).rows ?? [];
    if (!rows.some((row) => row.run_id === DB_MARKER)) {
      throw new Error(`AAA-12 exige o marcador ${DB_MARKER} no banco isolado`);
    }

    app = await buildDeskApiApp();
    await app.ready();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('AAA-12: sem porta efêmera para HTTP real');
    baseUrl = `http://127.0.0.1:${address.port}`;

    // Papel compartilhado entre suítes (permissões são mapeadas por NOME).
    // Criação idempotente e NUNCA removida: apagar um papel compartilhado em
    // paralelo quebra o teardown de outra suíte (FK user_roles).
    const [existingRole] = await db
      .select()
      .from(schema.roles)
      .where(eq(schema.roles.name, roleName));
    if (existingRole) {
      roleId = existingRole.id;
    } else {
      roleId = randomUUID();
      await db
        .insert(schema.roles)
        .values({ id: roleId, name: roleName, description: 'Role for AAA-12' })
        .onConflictDoNothing({ target: schema.roles.name });
      const [createdRoleRow] = await db
        .select()
        .from(schema.roles)
        .where(eq(schema.roles.name, roleName));
      roleId = createdRoleRow.id;
    }

    await db.insert(schema.users).values([
      { id: userId, name: 'AAA-12 User', email, passwordHash, isActive: true },
      { id: userBId, name: 'AAA-12 User B', email: emailB, passwordHash, isActive: true },
    ]);
    await db.insert(schema.userRoles).values([
      { userId, roleId },
      { userId: userBId, roleId },
    ]);

    const suffix = String(Date.now()).slice(-6);
    const [sector] = await db
      .insert(schema.sectors)
      .values({ name: `aaa12 ${suffix}`, code: `aaa12${suffix}` })
      .returning();
    sectorId = sector.id;
    await db.insert(schema.userSectors).values([
      { userId, sectorId, accessLevel: 'write' },
      { userId: userBId, sectorId, accessLevel: 'write' },
    ]);

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password },
    });
    expect(login.statusCode).toBe(200);
    token = (login.json() as { token: string }).token;

    const loginB = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: emailB, password },
    });
    expect(loginB.statusCode).toBe(200);
    tokenB = (loginB.json() as { token: string }).token;
  });

  beforeEach(async () => {
    await cleanup();
    await db.insert(schema.conversations).values([
      { id: conversationA, status: 'open', statusV2: 'novo', currentHandler: 'bot', isActive: true, sectorId },
      { id: conversationB, status: 'open', statusV2: 'novo', currentHandler: 'bot', isActive: true, sectorId },
    ]);
    vi.mocked(gatewayService.sendOutbound).mockReset();
    vi.mocked(gatewayService.sendOutbound).mockImplementation(async () => ({
      success: true,
      messageId: `gw-${randomUUID()}`,
    }));
  });

  async function cleanup(): Promise<void> {
    const conversations = [conversationA, conversationB];
    const msgs = await db
      .select({ id: schema.messages.id })
      .from(schema.messages)
      .where(inArray(schema.messages.conversationId, conversations));
    if (msgs.length > 0) {
      const ids = msgs.map((m) => m.id);
      await db.delete(schema.outboundDeliveries).where(inArray(schema.outboundDeliveries.internalMessageId, ids));
      await db.delete(schema.outboxEvents).where(inArray(schema.outboxEvents.aggregateId, ids));
    }
    await db.delete(schema.messages).where(inArray(schema.messages.conversationId, conversations));
    // Tombstones sobrevivem à exclusão (trigger) — limpos explicitamente aqui.
    await db
      .delete(schema.outboundIdempotencyTombstones)
      .where(inArray(schema.outboundIdempotencyTombstones.scopeConversationId, conversations));
    await db.delete(schema.conversationStatusHistory).where(inArray(schema.conversationStatusHistory.conversationId, conversations));
    await db.delete(schema.conversations).where(inArray(schema.conversations.id, conversations));
  }

  afterAll(async () => {
    await cleanup();
    for (const id of [userId, userBId]) {
      await db.delete(schema.auditLogs).where(eq(schema.auditLogs.userId, id));
      await db.delete(schema.sessions).where(eq(schema.sessions.userId, id));
      await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, id));
      await db.delete(schema.userSectors).where(eq(schema.userSectors.userId, id));
      await db.delete(schema.users).where(eq(schema.users.id, id));
    }
    if (sectorId) await db.delete(schema.sectors).where(eq(schema.sectors.id, sectorId));
    await app.close();
  });

  function sendHttp(
    conversationId: string,
    payload: Record<string, unknown>,
    idempotencyKey?: string,
    authToken: string = token,
  ): Promise<Response> {
    return fetch(`${baseUrl}/messages`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${authToken}`,
        'content-type': 'application/json',
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      },
      body: JSON.stringify({
        conversationId,
        recipient: '+5511999999000',
        ...payload,
      }),
    });
  }

  async function send(
    conversationId: string,
    payload: Record<string, unknown>,
    idempotencyKey?: string,
    authToken: string = token,
  ): Promise<{ statusCode: number; body: SendResult & { error?: string; message?: string } }> {
    const response = await sendHttp(conversationId, payload, idempotencyKey, authToken);
    return { statusCode: response.status, body: (await response.json()) as SendResult & { error?: string; message?: string } };
  }

  /** Contagem real por conversa (detecta órfãos que o mapping não referencia). */
  async function countsFor(conversationId: string) {
    const rows = (await db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM messages
          WHERE conversation_id = ${conversationId} AND direction = 'outbound') AS messages,
        (SELECT COUNT(*)::int FROM outbound_deliveries d
          WHERE d.internal_message_id IN (
            SELECT id FROM messages WHERE conversation_id = ${conversationId} AND direction = 'outbound'
          )) AS deliveries,
        (SELECT COUNT(*)::int FROM outbox_events e
          WHERE e.aggregate_type = 'Message' AND e.aggregate_id IN (
            SELECT id::text FROM messages WHERE conversation_id = ${conversationId} AND direction = 'outbound'
          )) AS events
    `)) as unknown as { rows: Array<{ messages: number; deliveries: number; events: number }> };
    return rows.rows[0];
  }

  it('retry sequencial da mesma chave devolve o mesmo resultado sem linhas novas', async () => {
    const key = `seq-${randomUUID()}`;
    const first = await send(conversationA, { content: 'Original' }, key);
    expect(first.statusCode).toBe(201);
    expect(first.body.deduplicated).toBe(false);

    const second = await send(conversationA, { content: 'Original' }, key);
    expect(second.statusCode).toBe(200);
    expect(second.body.messageId).toBe(first.body.messageId);
    expect(second.body.deduplicated).toBe(true);

    const counts = await countsFor(conversationA);
    expect(counts).toEqual({ messages: 1, deliveries: 1, events: 1 });
    expect(vi.mocked(gatewayService.sendOutbound).mock.calls.length).toBe(1);
    expect(first.body.outcome).toBe('accepted');
    expect(second.body.outcome).toBe('accepted');
    console.log('[AAA-12][seq] counts=', JSON.stringify(counts), 'outcomes=', first.body.outcome, second.body.outcome);

    // Receipt de entrega posterior ⇒ a mesma chave passa a responder `sent`.
    await db.execute(sql`
      UPDATE messages SET status = 'delivered', delivered_at = NOW() WHERE id = ${first.body.messageId}
    `);
    const afterDelivery = await send(conversationA, { content: 'Original' }, key);
    expect(afterDelivery.statusCode).toBe(200);
    expect(afterDelivery.body.deduplicated).toBe(true);
    expect(afterDelivery.body.outcome).toBe('sent');
    expect(vi.mocked(gatewayService.sendOutbound).mock.calls.length).toBe(1);
  });

  it('N requisições concorrentes da mesma chave (HTTP real) ⇒ 1 mensagem/1 outbox/1 envio', async () => {
    const key = `race-${randomUUID()}`;
    const payload = { content: 'Concorrência', recipient: '+5511999999000' };

    const responses = await Promise.all(
      Array.from({ length: 12 }, () => sendHttp(conversationA, payload, key)),
    );
    const parsed = await Promise.all(
      responses.map(async (response) => ({ statusCode: response.status, body: (await response.json()) as SendResult })),
    );

    // A prova dura vem do banco: nenhum órfão e uma única intenção durável.
    const counts = await countsFor(conversationA);
    console.log('[AAA-12][race] counts=', JSON.stringify(counts), 'gatewayCalls=', vi.mocked(gatewayService.sendOutbound).mock.calls.length);
    expect(counts).toEqual({ messages: 1, deliveries: 1, events: 1 });
    expect(vi.mocked(gatewayService.sendOutbound).mock.calls.length).toBe(1);

    const created = parsed.filter((r) => r.statusCode === 201);
    const deduplicated = parsed.filter((r) => r.statusCode === 200);
    expect(created).toHaveLength(1);
    expect(deduplicated).toHaveLength(11);
    const messageIds = new Set(parsed.map((r) => r.body.messageId));
    expect(messageIds.size).toBe(1);
    for (const response of deduplicated) {
      expect(response.body.deduplicated).toBe(true);
      expect(['accepted', 'pending']).toContain(response.body.outcome);
    }
  });

  it('payload divergente com a mesma chave ⇒ 409 sem side effects', async () => {
    const key = `conflict-${randomUUID()}`;
    const first = await send(conversationA, { content: 'Original' }, key);
    expect(first.statusCode).toBe(201);

    const second = await send(conversationA, { content: 'Divergente' }, key);
    expect(second.statusCode).toBe(409);
    expect(second.body.error).toBe('IDEMPOTENCY_KEY_CONFLICT');

    const counts = await countsFor(conversationA);
    expect(counts).toEqual({ messages: 1, deliveries: 1, events: 1 });
    expect(vi.mocked(gatewayService.sendOutbound).mock.calls.length).toBe(1);

    const [message] = await db
      .select({ content: schema.messages.content })
      .from(schema.messages)
      .where(eq(schema.messages.id, first.body.messageId));
    expect(message.content).toBe('Original');
  });

  it('linha legada sem fingerprint ⇒ 409 explícito (sem duplicar no rollout)', async () => {
    const key = `legacy-${randomUUID()}`;
    const first = await send(conversationA, { content: 'Legado' }, key);
    expect(first.statusCode).toBe(201);

    // Simula linha gravada pelo código anterior à 0021 (sem fingerprint).
    await db.execute(sql`
      UPDATE outbound_deliveries
         SET scope_actor_id = 'legacy', payload_fingerprint = NULL
       WHERE client_key = ${key}
    `);

    const retry = await send(conversationA, { content: 'Legado' }, key);
    expect(retry.statusCode).toBe(409);
    expect(retry.body.error).toBe('IDEMPOTENCY_KEY_CONFLICT');
    const counts = await countsFor(conversationA);
    expect(counts).toEqual({ messages: 1, deliveries: 1, events: 1 });
  });

  it('linha do writer ANTIGO pós-migration (crua, sem escopo) ⇒ 409 sem segundo envio', async () => {
    const key = `old-writer-${randomUUID()}`;
    const legacyMessage = await messageRepository.create({
      conversationId: conversationA,
      direction: 'outbound',
      content: 'Enviado pelo writer antigo',
      recipient: '+5511999999000',
      status: 'pending',
    });
    // Formato EXATO do código anterior rodando durante o rolling deploy:
    // idempotency_key = chave crua; escopo/client_key/fingerprint ausentes.
    await db.insert(schema.outboundDeliveries).values({
      internalMessageId: legacyMessage.id,
      idempotencyKey: key,
      provider: 'evolution',
      status: 'pending',
    });
    const [stored] = await db
      .select({
        idempotencyKey: schema.outboundDeliveries.idempotencyKey,
        clientKey: schema.outboundDeliveries.clientKey,
        scopeConversationId: schema.outboundDeliveries.scopeConversationId,
      })
      .from(schema.outboundDeliveries)
      .where(eq(schema.outboundDeliveries.internalMessageId, legacyMessage.id));
    expect(stored.idempotencyKey).toBe(key);
    expect(stored.clientKey).toBeNull();
    expect(stored.scopeConversationId).toBeNull();

    // O retry do código novo NÃO pode criar segunda mensagem/envio.
    const attempt = await send(conversationA, { content: 'Enviado pelo writer antigo' }, key);
    expect(attempt.statusCode).toBe(409);
    expect(attempt.body.error).toBe('IDEMPOTENCY_KEY_CONFLICT');

    const counts = await countsFor(conversationA);
    console.log(
      '[AAA-12][old-writer] status=409 gatewayCalls=',
      vi.mocked(gatewayService.sendOutbound).mock.calls.length,
      'counts=',
      JSON.stringify(counts),
    );
    expect(counts).toEqual({ messages: 1, deliveries: 1, events: 0 });
    expect(vi.mocked(gatewayService.sendOutbound).mock.calls.length).toBe(0);
  });

  it('writer ANTIGO commitando DURANTE a criação ⇒ segunda checagem aborta (rollback, 409)', async () => {
    const key = `old-writer-race-${randomUUID()}`;
    const events = await import('@cvg/events');
    const original = events.outboxIntentWriter.persist;
    let injected = false;
    const spy = vi
      .spyOn(events.outboxIntentWriter, 'persist')
      .mockImplementationOnce(async (...args: Parameters<typeof original>) => {
        await original(...args);
        // Writer antigo commita a linha crua FORA da transação, enquanto o
        // caminho novo já inseriu mensagem/mapping mas ainda não commitou.
        const legacyMessage = await messageRepository.create({
          conversationId: conversationA,
          direction: 'outbound',
          content: 'legado concorrente',
          recipient: '+5511999999000',
          status: 'pending',
        });
        await db.insert(schema.outboundDeliveries).values({
          internalMessageId: legacyMessage.id,
          idempotencyKey: key,
          provider: 'evolution',
          status: 'pending',
        });
        injected = true;
      });

    try {
      const response = await send(conversationA, { content: 'Corrida de rollout' }, key);
      expect(injected).toBe(true);
      expect(response.statusCode).toBe(409);
      expect(response.body.error).toBe('IDEMPOTENCY_KEY_CONFLICT');

      // Somente a linha do writer antigo sobrou: o rollback descartou
      // mensagem/mapping/outbox do caminho novo e o provider não foi chamado.
      const rows = await db
        .select({
          idempotencyKey: schema.outboundDeliveries.idempotencyKey,
          clientKey: schema.outboundDeliveries.clientKey,
        })
        .from(schema.outboundDeliveries)
        .where(eq(schema.outboundDeliveries.idempotencyKey, key));
      expect(rows).toHaveLength(1);
      expect(rows[0].clientKey).toBeNull();
      expect(rows[0].idempotencyKey).toBe(key);

      const counts = await countsFor(conversationA);
      console.log(
        '[AAA-12][old-writer-race] status=409 gatewayCalls=',
        vi.mocked(gatewayService.sendOutbound).mock.calls.length,
        'counts=',
        JSON.stringify(counts),
      );
      expect(counts).toEqual({ messages: 1, deliveries: 1, events: 0 });
      expect(vi.mocked(gatewayService.sendOutbound).mock.calls.length).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('duplicata em andamento devolve pending sem segundo envio', async () => {
    const key = `inflight-${randomUUID()}`;
    let release!: (value: { success: boolean; messageId?: string }) => void;
    const gate = new Promise<{ success: boolean; messageId?: string }>((resolve) => {
      release = resolve;
    });
    vi.mocked(gatewayService.sendOutbound).mockImplementationOnce(() => gate);

    const firstPromise = send(conversationA, { content: 'Em voo' }, key);
    await waitFor(async () => {
      const rows = await db.execute(sql`
        SELECT status FROM outbound_deliveries
         WHERE client_key = ${key} AND scope_conversation_id = ${conversationA}
      `);
      return ((rows as unknown as { rows: unknown[] }).rows ?? []).length === 1;
    }, 5000);

    const duplicate = await send(conversationA, { content: 'Em voo' }, key);
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.body.deduplicated).toBe(true);
    expect(duplicate.body.outcome).toBe('pending');
    expect(vi.mocked(gatewayService.sendOutbound).mock.calls.length).toBe(1);

    release({ success: true, messageId: `gw-${randomUUID()}` });
    const first = await firstPromise;
    expect(first.statusCode).toBe(201);
    expect(first.body.outcome).toBe('accepted');
  });

  it('resultado ambíguo do provider ⇒ unknown_reconciling, sem retry cego', async () => {
    const key = `unknown-${randomUUID()}`;
    vi.mocked(gatewayService.sendOutbound).mockImplementation(async () => ({
      success: false,
      error: 'gateway timeout após envio',
      failureKind: 'unknown',
    } as never));

    const first = await send(conversationA, { content: 'Ambíguo' }, key);
    expect(first.statusCode).toBe(201);
    expect(first.body.outcome).toBe('unknown_reconciling');

    const [delivery] = await db
      .select({ status: schema.outboundDeliveries.status })
      .from(schema.outboundDeliveries)
      .where(eq(schema.outboundDeliveries.clientKey, key));
    expect(delivery.status).toBe('unknown_reconciling');

    const [message] = await db
      .select({ status: schema.messages.status })
      .from(schema.messages)
      .where(eq(schema.messages.id, first.body.messageId));
    expect(message.status).toBe('pending');

    const retry = await send(conversationA, { content: 'Ambíguo' }, key);
    expect(retry.statusCode).toBe(200);
    expect(retry.body.deduplicated).toBe(true);
    expect(retry.body.outcome).toBe('unknown_reconciling');
    expect(vi.mocked(gatewayService.sendOutbound).mock.calls.length).toBe(1);

    // Não pode ser reenviado cegamente pela lista de pendências do gateway.
    const pending = await messageRepository.findPendingOutbound(50);
    expect(pending.map((m) => m.id)).not.toContain(first.body.messageId);
  });

  it('provider SEM idempotência ⇒ intenção nasce unknown_reconciling e retry não reenvia', async () => {
    const key = `no-idem-${randomUUID()}`;
    const port = gatewayService as unknown as { providerSupportsIdempotency?: () => boolean };
    port.providerSupportsIdempotency = vi.fn(() => false);
    try {
      let release!: (value: { success: boolean; messageId?: string; error?: string; failureKind?: string }) => void;
      const gate = new Promise<{ success: boolean; messageId?: string; error?: string; failureKind?: string }>((resolve) => {
        release = resolve;
      });
      vi.mocked(gatewayService.sendOutbound).mockImplementationOnce(() => gate as never);

      const firstPromise = send(conversationA, { content: 'Sem idempotência' }, key);
      await waitFor(async () => {
        const rows = await db.execute(sql`
          SELECT status FROM outbound_deliveries
           WHERE client_key = ${key} AND scope_conversation_id = ${conversationA}
        `);
        return ((rows as unknown as { rows: unknown[] }).rows ?? []).length === 1;
      }, 5000);

      // Estado inicial sem idempotência do provider: a janela de crash entre o
      // commit e a resposta externa já nasce em reconciliação (nunca em pending).
      const [delivery] = await db
        .select()
        .from(schema.outboundDeliveries)
        .where(eq(schema.outboundDeliveries.clientKey, key));
      expect(delivery.status).toBe('unknown_reconciling');
      const pending = await messageRepository.findPendingOutbound(50);
      expect(pending.map((m) => m.id)).not.toContain(delivery.internalMessageId);

      // Retry durante o voo: devolve o estado da intenção, sem segundo envio.
      const inFlightRetry = await send(conversationA, { content: 'Sem idempotência' }, key);
      expect(inFlightRetry.statusCode).toBe(200);
      expect(inFlightRetry.body.deduplicated).toBe(true);
      expect(inFlightRetry.body.outcome).toBe('unknown_reconciling');
      expect(vi.mocked(gatewayService.sendOutbound).mock.calls.length).toBe(1);

      release({ success: false, error: 'timeout', failureKind: 'unknown' });
      const first = await firstPromise;
      expect(first.statusCode).toBe(201);
      expect(first.body.outcome).toBe('unknown_reconciling');

      const retry = await send(conversationA, { content: 'Sem idempotência' }, key);
      expect(retry.statusCode).toBe(200);
      expect(retry.body.outcome).toBe('unknown_reconciling');
      expect(vi.mocked(gatewayService.sendOutbound).mock.calls.length).toBe(1);
      console.log('[AAA-12][no-idem] status=', delivery.status, 'retryOutcome=', retry.body.outcome, 'gatewayCalls=1');
    } finally {
      delete port.providerSupportsIdempotency;
    }
  });

  it('rejeição definitiva do provider ⇒ failed; retry da chave não reenvia', async () => {
    const key = `definitive-${randomUUID()}`;
    vi.mocked(gatewayService.sendOutbound).mockImplementation(async () => ({
      success: false,
      error: 'invalid recipient',
      failureKind: 'definitive',
    } as never));

    const first = await send(conversationA, { content: 'Definitivo' }, key);
    expect(first.statusCode).toBe(201);
    expect(first.body.outcome).toBe('failed');

    const [message] = await db
      .select({ status: schema.messages.status })
      .from(schema.messages)
      .where(eq(schema.messages.id, first.body.messageId));
    expect(message.status).toBe('failed');

    const retry = await send(conversationA, { content: 'Definitivo' }, key);
    expect(retry.statusCode).toBe(200);
    expect(retry.body.deduplicated).toBe(true);
    expect(retry.body.outcome).toBe('failed');
    expect(vi.mocked(gatewayService.sendOutbound).mock.calls.length).toBe(1);
  });

  it('TTL expirado não permite reenvio silencioso (falha terminal, expired=true)', async () => {
    const key = `ttl-${randomUUID()}`;
    const first = await send(conversationA, { content: 'TTL' }, key);
    expect(first.statusCode).toBe(201);

    // Simula crash pós-persistência: intenção não-terminal e TTL vencido.
    await db.execute(sql`
      UPDATE outbound_deliveries
         SET status = 'pending', expires_at = NOW() - INTERVAL '1 hour'
       WHERE client_key = ${key} AND scope_conversation_id = ${conversationA}
    `);
    await db.execute(sql`UPDATE messages SET status = 'pending' WHERE id = ${first.body.messageId}`);

    const second = await send(conversationA, { content: 'TTL' }, key);
    expect(second.statusCode).toBe(200);
    expect(second.body.deduplicated).toBe(true);
    expect(second.body.outcome).toBe('failed');
    expect(second.body.expired).toBe(true);
    expect(vi.mocked(gatewayService.sendOutbound).mock.calls.length).toBe(1);

    const counts = await countsFor(conversationA);
    console.log('[AAA-12][ttl] expired=', second.body.expired, 'outcome=', second.body.outcome, 'counts=', JSON.stringify(counts));
    expect(counts).toEqual({ messages: 1, deliveries: 1, events: 1 });
  });

  it('exclusão da mensagem preserva o tombstone da chave (sem reenvio silencioso)', async () => {
    const key = `tombstone-${randomUUID()}`;
    const first = await send(conversationA, { content: 'Tombstone' }, key);
    expect(first.statusCode).toBe(201);
    expect(vi.mocked(gatewayService.sendOutbound).mock.calls.length).toBe(1);

    // Exclusão da mensagem: o cascade remove o mapping e o trigger arquiva a chave.
    await db.execute(sql`DELETE FROM messages WHERE id = ${first.body.messageId}`);
    await db.delete(schema.outboxEvents).where(eq(schema.outboxEvents.aggregateId, first.body.messageId));

    const tombstones = await db
      .select()
      .from(schema.outboundIdempotencyTombstones)
      .where(eq(schema.outboundIdempotencyTombstones.clientKey, key));
    expect(tombstones).toHaveLength(1);
    expect(tombstones[0].payloadFingerprint).toBeTruthy();
    expect(tombstones[0].scopeConversationId).toBe(conversationA);

    // A chave usada não pode ser reaproveitada para um novo envio.
    const retry = await send(conversationA, { content: 'Tombstone' }, key);
    expect(retry.statusCode).toBe(409);
    expect(retry.body.error).toBe('IDEMPOTENCY_KEY_CONFLICT');
    expect(vi.mocked(gatewayService.sendOutbound).mock.calls.length).toBe(1);

    const counts = await countsFor(conversationA);
    console.log('[AAA-12][tombstone] tombstones=1 retryStatus=409 counts=', JSON.stringify(counts));
    expect(counts.messages).toBe(0);
    expect(counts.deliveries).toBe(0);
  });

  it('insert legado com ON CONFLICT (idempotency_key) segue válido no schema migrado', async () => {
    // O índice global da 0014 permanece ÚNICO (compatibilidade de rolling deploy).
    const index = await db.execute(sql`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_outbound_deliveries_key'
    `);
    const indexRows = (index as unknown as { rows: Array<{ indexdef: string }> }).rows;
    expect(indexRows).toHaveLength(1);
    expect(indexRows[0].indexdef).toContain('UNIQUE');

    const legacyKey = `legacy-compat-${randomUUID()}`;
    const message = await messageRepository.create({
      conversationId: conversationA,
      direction: 'outbound',
      content: 'compat',
      recipient: '+5511999999000',
      status: 'pending',
    });
    const insert = () =>
      db.execute(sql`
        INSERT INTO outbound_deliveries (internal_message_id, idempotency_key, provider, status)
        VALUES (${message.id}, ${legacyKey}, 'evolution', 'pending')
        ON CONFLICT (idempotency_key) DO NOTHING
      `);
    await insert();
    await insert();
    const stored = await db.execute(sql`
      SELECT COUNT(*)::int AS c FROM outbound_deliveries WHERE idempotency_key = ${legacyKey}
    `);
    expect((stored as unknown as { rows: Array<{ c: number }> }).rows[0].c).toBe(1);
    console.log('[AAA-12][legacy-insert] ON CONFLICT (idempotency_key) OK; índice global UNIQUE');
  });

  it('falha na intenção de outbox derruba mensagem e mapping (sem órfãos)', async () => {
    const events = await import('@cvg/events');
    const spy = vi.spyOn(events.outboxIntentWriter, 'persist').mockRejectedValueOnce(new Error('outbox indisponível'));
    const key = `fault-${randomUUID()}`;

    const failed = await send(conversationA, { content: 'Fault' }, key);
    expect(failed.statusCode).toBe(500);
    spy.mockRestore();

    const counts = await countsFor(conversationA);
    expect(counts).toEqual({ messages: 0, deliveries: 0, events: 0 });
    expect(vi.mocked(gatewayService.sendOutbound).mock.calls.length).toBe(0);

    const retry = await send(conversationA, { content: 'Fault' }, key);
    expect(retry.statusCode).toBe(201);
    expect(await countsFor(conversationA)).toEqual({ messages: 1, deliveries: 1, events: 1 });
  });

  it('escopo é ator+conversa: mesma chave literal em escopos distintos não colide', async () => {
    const key = `scope-${randomUUID()}`;
    const byA = await send(conversationA, { content: 'Conversa A' }, key);
    const byB = await send(conversationA, { content: 'Ator B' }, key, tokenB);
    const otherConversation = await send(conversationB, { content: 'Conversa B' }, key);

    expect(byA.statusCode).toBe(201);
    expect(byB.statusCode).toBe(201);
    expect(otherConversation.statusCode).toBe(201);
    expect(new Set([byA.body.messageId, byB.body.messageId, otherConversation.body.messageId]).size).toBe(3);

    const countsA = await countsFor(conversationA);
    const countsB = await countsFor(conversationB);
    console.log('[AAA-12][scope] convA=', JSON.stringify(countsA), 'convB=', JSON.stringify(countsB));
    expect(countsA).toEqual({ messages: 2, deliveries: 2, events: 2 });
    expect(countsB).toEqual({ messages: 1, deliveries: 1, events: 1 });
  });

  it('sem chave, cada request continua sendo uma nova intenção', async () => {
    const first = await send(conversationA, { content: 'Sem chave 1' });
    const second = await send(conversationA, { content: 'Sem chave 2' });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.body.messageId).not.toBe(first.body.messageId);
  });

  async function waitFor(check: () => Promise<boolean>, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('AAA-12: condição não satisfeita no prazo');
  }
});
