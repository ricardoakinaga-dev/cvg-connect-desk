import { beforeAll, afterAll, afterEach, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { eq, inArray, sql } from 'drizzle-orm';
import { WebSocket } from 'ws';
import { db, schema } from '@cvg/database';
import * as authNamespace from '@cvg/auth';
import { RedisRealtimeBus, type EventEnvelope } from '@cvg/events';
import { RealtimeServer } from '../index.ts';
import { createDatabaseAuthorizationPort } from '../authorization';

/**
 * AAA-05 — isolamento de canais e destinatários realtime (C02 v1.0.1, achado A03).
 *
 * Fronteira julgada com infraestrutura real:
 * - PostgreSQL e Redis do RUN ISOLADO atual, derivados do ambiente
 *   (`DATABASE_URL`/`REDIS_URL` devem bater exatamente com
 *   `e2e/support/aaa/run-context.ts`; o banco segue o padrão `cvg_aaa_*` e o
 *   marcador `aaa_environment_marker` precisa pertencer ao mesmo run);
 * - sockets WebSocket reais contra 3-4 instâncias reais de RealtimeServer;
 * - autorização de subscription/entrega via porta de produção
 *   `createDatabaseAuthorizationPort` -> `authorizeConversationResource` /
 *   `authorizeSectorScope` de @cvg/auth (permission + membership no banco).
 *
 * O endpoint `/auth/me` local usa a MESMA avaliação congelada de C01
 * (`evaluateSession` de @cvg/auth) lendo `sessions`/`users`/`user_roles` do
 * banco do run; o teste de integração do desk-api exercita a rota HTTP real.
 */

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const REDIS_URL = process.env.REDIS_URL ?? '';

interface RunContextLike {
  runId: string;
  databaseName: string;
  databaseUrl: string;
  redisUrl: string;
  ports: { postgres: number; redis: number };
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
let runContext: RunContextLike | null = null;

/**
 * Marcador do run: o canal Redis é compartilhado entre arquivos na execução
 * paralela default; todo evento deste arquivo carrega este prefixo no
 * `correlation_id` (preservado no sinal sanitizado) e as asserções só contam
 * eventos do próprio run.
 */
const RUN_MARKER = `a05iso-${randomUUID().slice(0, 8)}`;

function owned(message: { data?: { correlationId?: unknown } }): boolean {
  return typeof message?.data?.correlationId === 'string' && message.data.correlationId.startsWith(RUN_MARKER);
}

const authModule = ((authNamespace as unknown as { default?: typeof authNamespace }).default ?? authNamespace);
const evaluateSession = (authModule as unknown as {
  evaluateSession: (
    session: {
      id: string;
      userId: string;
      expiresAt: Date | null;
      absoluteExpiresAt: Date | null;
      lastSeenAt: Date | null;
      createdAt: Date | null;
      revokedAt: Date | null;
    },
    user: { id: string; email: string; name: string; isActive: boolean } | null,
    now: Date,
    policy?: unknown,
    roles?: string[],
  ) => { ok: true; principal: { id: string; email: string; name: string; roles: string[] } } | { ok: false; message: string };
}).evaluateSession;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

async function getFreePort(): Promise<number> {
  const probe = createServer();
  return await new Promise<number>((resolve, reject) => {
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = (probe.address() as AddressInfo).port;
      probe.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

interface TestClient {
  ws: WebSocket;
  messages: Array<Record<string, any> & { __at: number }>;
  closeCode?: number;
}

interface SessionUser {
  userId: string;
  token: string;
}

const createdUserIds: string[] = [];
const createdSectorIds: string[] = [];
const createdConversationIds: string[] = [];

function waitFor(
  predicate: () => boolean,
  timeoutMs = 8000,
  label = 'condition',
): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`Timed out waiting for ${label}`));
      }
    }, 20);
  });
}

async function connectClient(url: string): Promise<TestClient> {
  return await new Promise<TestClient>((resolve, reject) => {
    const messages: TestClient['messages'] = [];
    const client: TestClient = { ws: new WebSocket(url), messages };
    client.ws.on('message', (data: Buffer) => {
      try {
        messages.push({ ...JSON.parse(data.toString()), __at: Date.now() });
      } catch {
        messages.push({ raw: data.toString(), __at: Date.now() });
      }
    });
    client.ws.on('close', (code) => {
      client.closeCode = code;
    });
    client.ws.on('open', () => resolve(client));
    client.ws.on('error', reject);
  });
}

async function closeClient(client: TestClient | undefined): Promise<void> {
  if (!client || client.ws.readyState === WebSocket.CLOSED) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      client.ws.terminate();
      resolve();
    }, 1000);
    client.ws.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
    client.ws.close();
  });
}

async function connectAndAuth(port: number, token: string): Promise<TestClient> {
  const client = await connectClient(`ws://127.0.0.1:${port}`);
  await waitFor(() => client.messages.some((m) => m.event === 'auth.required'), 8000, 'auth.required');
  client.ws.send(JSON.stringify({ type: 'auth', token }));
  await waitFor(() => client.messages.some((m) => m.event === 'auth.success'), 8000, 'auth.success');
  return client;
}

async function subscribe(client: TestClient, channel: string): Promise<'subscribed' | 'error'> {
  const before = client.messages.length;
  client.ws.send(JSON.stringify({ type: 'subscribe', channel }));
  await waitFor(
    () => client.messages.slice(before).some((m) => m.event === 'subscribed' || (m.event === 'error' && m.data?.type === 'subscribe.error')),
    8000,
    `subscribe ${channel}`,
  );
  const entry = client.messages.slice(before).find((m) => m.event === 'subscribed' || m.event === 'error');
  return entry?.event === 'subscribed' ? 'subscribed' : 'error';
}

function contentMessages(client: TestClient): Array<Record<string, any>> {
  // Sinal global sanitizado também usa o tipo message.persisted; conteúdo é
  // identificado pelo payload não vazio (D-C02-5) e pelo marcador do run.
  return client.messages.filter(
    (m) => owned(m) && m.event === 'message.persisted' && JSON.stringify(m.data?.payload) !== '{}',
  );
}

function globalMessages(client: TestClient): Array<Record<string, any>> {
  return client.messages.filter(
    (m) => owned(m) && m.event === 'message.persisted' && JSON.stringify(m.data?.payload) === '{}',
  );
}

const CONTENT_EVENT_TYPES = [
  'message.persisted',
  'conversation.created',
  'conversation.status.changed',
  'handoff.completed',
  'task.created',
  'task.updated',
  'task.status.changed',
  'alert.created',
  'alert.updated',
  'alert.acknowledged',
  'alert.resolved',
];

function contentEvents(
  client: TestClient,
  types: string[] = CONTENT_EVENT_TYPES,
): Array<Record<string, any>> {
  return client.messages.filter(
    (m) => owned(m) && types.includes(m.event) && JSON.stringify(m.data?.payload) !== '{}',
  );
}

function messageEnvelope(eventId: string, conversationId: string, content: string): EventEnvelope {
  return {
    event_id: eventId,
    event_type: 'message.persisted',
    aggregate_type: 'Message',
    aggregate_id: `msg-${eventId}`,
    occurred_at: new Date().toISOString(),
    payload: {
      id: `msg-${eventId}`,
      conversationId,
      direction: 'inbound',
      content,
      sender: '+5511999998888',
      status: 'delivered',
      createdAt: new Date().toISOString(),
    },
    correlation_id: `${RUN_MARKER}-${eventId}`,
    version: 1,
  };
}

function conversationCreatedEnvelope(eventId: string, conversationId: string, sectorId: string): EventEnvelope {
  return {
    event_id: eventId,
    event_type: 'conversation.created',
    aggregate_type: 'Conversation',
    aggregate_id: conversationId,
    occurred_at: new Date().toISOString(),
    payload: { id: conversationId, status: 'open', sectorId },
    correlation_id: `${RUN_MARKER}-${eventId}`,
    version: 1,
  };
}

function handoffEnvelope(eventId: string, conversationId: string, triggeredBy: string): EventEnvelope {
  return {
    event_id: eventId,
    event_type: 'handoff.completed',
    aggregate_type: 'Conversation',
    aggregate_id: conversationId,
    occurred_at: new Date().toISOString(),
    payload: { conversationId, previousHandler: 'bot', newHandler: 'human', reason: 'aaa05', triggeredBy },
    correlation_id: `${RUN_MARKER}-${eventId}`,
    version: 1,
  };
}

function taskEnvelope(eventId: string, taskId: string, conversationId: string, assignedTo: string): EventEnvelope {
  return {
    event_id: eventId,
    event_type: 'task.updated',
    aggregate_type: 'Task',
    aggregate_id: taskId,
    occurred_at: new Date().toISOString(),
    payload: { id: taskId, title: 'AAA05 task', status: 'open', priority: 'high', assignedTo, conversationId },
    correlation_id: `${RUN_MARKER}-${eventId}`,
    version: 1,
  };
}

function alertEnvelope(eventId: string, alertId: string, conversationId: string, triggeredBy: string): EventEnvelope {
  return {
    event_id: eventId,
    event_type: 'alert.created',
    aggregate_type: 'Alert',
    aggregate_id: alertId,
    occurred_at: new Date().toISOString(),
    payload: {
      id: alertId,
      type: 'sla',
      title: 'AAA05 alert',
      status: 'open',
      severity: 'high',
      conversationId,
      triggeredBy,
    },
    correlation_id: `${RUN_MARKER}-${eventId}`,
    version: 1,
  };
}

describe('AAA-05 — realtime channel/recipient isolation (real PG + real Redis + real sockets do run isolado)', () => {
  let authApi: ReturnType<typeof createServer>;
  let authBaseUrl = '';
  let nodes: RealtimeServer[] = [];
  let ports: number[] = [];
  let publisher: RedisRealtimeBus;
  const openClients: TestClient[] = [];

  async function ensureRole(name: string): Promise<string> {
    const [existing] = await db.select().from(schema.roles).where(eq(schema.roles.name, name)).limit(1);
    if (existing) return existing.id;
    const [created] = await db.insert(schema.roles).values({ name }).returning();
    return created.id;
  }

  async function createSector(label: string): Promise<string> {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const [sector] = await db.insert(schema.sectors).values({
      name: `AAA05 ${label} ${suffix}`,
      code: `a05${label.toLowerCase()}${suffix}`.slice(0, 50),
    }).returning();
    createdSectorIds.push(sector.id);
    return sector.id;
  }

  async function createConversation(sectorId: string | null, assignedUserId?: string): Promise<string> {
    const [conversation] = await db.insert(schema.conversations).values({
      status: 'open',
      statusV2: 'novo',
      currentHandler: 'bot',
      isActive: true,
      sectorId: sectorId ?? undefined,
      assignedUserId,
    }).returning();
    createdConversationIds.push(conversation.id);
    return conversation.id;
  }

  async function createActor(
    label: string,
    roleName: string | null,
    memberships: Array<{ sectorId: string; accessLevel: 'read' | 'write' }> = [],
  ): Promise<SessionUser> {
    const userId = randomUUID();
    await db.insert(schema.users).values({
      id: userId,
      name: `AAA05 ${label}`,
      email: `aaa05.${label}.${userId.slice(0, 8)}@example.com`,
      passwordHash: '$2a$10$UX/LcD/6NKhheDIZmbHyN.a6Hc8SW6ytZ/LCCZW3un3h5vJ9n/1h6',
      isActive: true,
    });
    createdUserIds.push(userId);

    if (roleName) {
      const resolvedRoleId = await ensureRole(roleName);
      await db.insert(schema.userRoles).values({ userId, roleId: resolvedRoleId });
    }
    for (const membership of memberships) {
      await db.insert(schema.userSectors).values({
        userId,
        sectorId: membership.sectorId,
        accessLevel: membership.accessLevel,
      });
    }

    const token = `${randomUUID()}.${randomBytes(24).toString('hex')}`;
    const tokenHash = sha256(token);
    const now = new Date();
    await db.insert(schema.sessions).values({
      userId,
      token: tokenHash,
      tokenHash,
      expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      absoluteExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      lastSeenAt: now,
      createdAt: now,
    });
    return { userId, token };
  }

  function track(client: TestClient): TestClient {
    openClients.push(client);
    return client;
  }

  async function publish(envelope: EventEnvelope): Promise<void> {
    const published = await publisher.publish(envelope);
    expect(published).toBe(true);
  }

  beforeAll(async () => {
    const runContextModule = (await import(
      pathToFileURL(join(REPO_ROOT, 'e2e/support/aaa/run-context.ts')).href
    )) as { getRunContext: (workerIndex?: number) => RunContextLike };
    runContext = runContextModule.getRunContext();

    if (DATABASE_URL !== runContext.databaseUrl) {
      throw new Error(
        `AAA-05 exige DATABASE_URL do run atual (${runContext.databaseUrl}); recebido: ${DATABASE_URL}`,
      );
    }
    if (!/^cvg_aaa_[a-z0-9_]+$/.test(runContext.databaseName)) {
      throw new Error(`Banco sem marcador isolado cvg_aaa_*: ${runContext.databaseName}`);
    }
    if (REDIS_URL !== runContext.redisUrl) {
      throw new Error(`AAA-05 exige REDIS_URL do run atual (${runContext.redisUrl}); recebido: ${REDIS_URL}`);
    }

    const marker = await db.execute(sql`SELECT run_id FROM aaa_environment_marker`);
    const markerRows = (marker as unknown as { rows: Array<{ run_id: string }> }).rows ?? [];
    if (markerRows.length !== 1 || markerRows[0].run_id !== runContext.runId) {
      throw new Error(
        `Marcador do run ${runContext.runId} ausente/divergente no banco ${runContext.databaseName}: ${JSON.stringify(markerRows)}`,
      );
    }

    await ensureRole('Receptionist');

    authApi = createServer((request: IncomingMessage, response: ServerResponse) => {
      void (async () => {
        try {
          if (request.method !== 'GET' || request.url !== '/auth/me') {
            response.writeHead(404, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ error: 'NOT_FOUND' }));
            return;
          }
          const authorization = request.headers.authorization || '';
          const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
          if (!token) {
            response.writeHead(401, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ error: 'UNAUTHORIZED', message: 'Missing token' }));
            return;
          }

          const tokenHash = sha256(token);
          const sessionResult = await db.execute(sql`
            SELECT id, user_id AS "userId",
              (extract(epoch from expires_at) * 1000)::double precision AS "expiresAtMs",
              (extract(epoch from absolute_expires_at) * 1000)::double precision AS "absoluteExpiresAtMs",
              (extract(epoch from last_seen_at) * 1000)::double precision AS "lastSeenAtMs",
              (extract(epoch from created_at) * 1000)::double precision AS "createdAtMs",
              (extract(epoch from revoked_at) * 1000)::double precision AS "revokedAtMs"
            FROM sessions
            WHERE token_hash = ${tokenHash} OR token = ${tokenHash}
            LIMIT 1
          `);
          const sessionRows = (sessionResult as unknown as { rows: Array<Record<string, unknown>> }).rows ?? [];
          const session = sessionRows[0];
          const toDateOrNull = (value: unknown) =>
            value === null || value === undefined ? null : new Date(Math.round(Number(value)));

          const [user] = session
            ? await db.select().from(schema.users).where(eq(schema.users.id, String(session.userId))).limit(1)
            : [];

          const roleRows = user
            ? await db
                .select({ name: schema.roles.name })
                .from(schema.userRoles)
                .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
                .where(eq(schema.userRoles.userId, user.id))
            : [];

          const evaluation = session
            ? evaluateSession(
                {
                  id: String(session.id),
                  userId: String(session.userId),
                  expiresAt: toDateOrNull(session.expiresAtMs),
                  absoluteExpiresAt: toDateOrNull(session.absoluteExpiresAtMs),
                  lastSeenAt: toDateOrNull(session.lastSeenAtMs),
                  createdAt: toDateOrNull(session.createdAtMs),
                  revokedAt: toDateOrNull(session.revokedAtMs),
                },
                user ? { id: user.id, email: user.email, name: user.name, isActive: user.isActive } : null,
                new Date(),
                undefined,
                roleRows.map((row) => row.name),
              )
            : { ok: false as const, message: 'Invalid token' };

          if (!evaluation.ok) {
            response.writeHead(401, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ error: 'UNAUTHORIZED', message: evaluation.message }));
            return;
          }

          // Consumidor de C01 atualiza last_seen somente após sucesso (mesma
          // semântica do middleware real).
          await db
            .update(schema.sessions)
            .set({ lastSeenAt: new Date() })
            .where(eq(schema.sessions.id, String(session.id)));

          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ user: evaluation.principal }));
        } catch (error) {
          response.writeHead(500, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ error: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : 'error' }));
        }
      })();
    });

    await new Promise<void>((resolve, reject) => {
      authApi.once('error', reject);
      authApi.listen(0, '127.0.0.1', () => resolve());
    });
    authBaseUrl = `http://127.0.0.1:${(authApi.address() as AddressInfo).port}`;

    process.env.DESK_API_URL = authBaseUrl;
    process.env.USE_DATABASE_OUTBOX = 'false';
    process.env.REALTIME_POLL_INTERVAL_MS = '600000';
    process.env.INTERNAL_EVENTS_SECRET = 'aaa05-internal-secret';
    process.env.REDIS_URL = REDIS_URL;
    process.env.NODE_ENV = 'test';

    publisher = new RedisRealtimeBus({ url: REDIS_URL });
    await publisher.start();

    nodes = [];
    ports = [];
    for (let i = 0; i < 3; i += 1) {
      const port = await getFreePort();
      ports.push(port);
      const node = new RealtimeServer(port);
      nodes.push(node);
      node.start();
    }
    const limitedPort = await getFreePort();
    ports.push(limitedPort);
    nodes.push(new RealtimeServer(limitedPort, { maxSubscriptions: 3, maxMessageBytes: 2048 }));
    nodes[3].start();

    await wait(500);
  }, 60000);

  afterEach(async () => {
    for (const client of openClients.splice(0)) {
      await closeClient(client);
    }
  });

  afterAll(async () => {
    for (const node of nodes) {
      node.stop();
    }
    await publisher?.stop().catch(() => {});
    if (authApi) {
      (authApi as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
      await new Promise<void>((resolve) => authApi.close(() => resolve()));
    }

    if (createdConversationIds.length > 0) {
      await db.delete(schema.conversations).where(inArray(schema.conversations.id, createdConversationIds));
    }
    if (createdUserIds.length > 0) {
      await db.delete(schema.sessions).where(inArray(schema.sessions.userId, createdUserIds));
      await db.delete(schema.userSectors).where(inArray(schema.userSectors.userId, createdUserIds));
      await db.delete(schema.userRoles).where(inArray(schema.userRoles.userId, createdUserIds));
      await db.delete(schema.users).where(inArray(schema.users.id, createdUserIds));
    }
    if (createdSectorIds.length > 0) {
      await db.delete(schema.sectors).where(inArray(schema.sectors.id, createdSectorIds));
    }

    delete process.env.DESK_API_URL;
    delete process.env.USE_DATABASE_OUTBOX;
    delete process.env.REALTIME_POLL_INTERVAL_MS;
    delete process.env.INTERNAL_EVENTS_SECRET;
    delete process.env.REDIS_URL;
  }, 30000);

  it('global transporta somente sinal sanitizado, sem conteúdo/telefone', async () => {
    const sectorA = await createSector('A');
    const conversationA = await createConversation(sectorA);
    const actorA = await createActor('global-a', 'Receptionist', [{ sectorId: sectorA, accessLevel: 'read' }]);

    const secret = 'SEGREDO-CONVERSA-A-GLOBAL';
    const client = track(await connectAndAuth(ports[0], actorA.token));
    expect(await subscribe(client, 'global')).toBe('subscribed');

    await publish(messageEnvelope(`evt-global-${Date.now()}`, conversationA, secret));

    await waitFor(() => globalMessages(client).length > 0, 8000, 'global sanitized signal');
    const globals = globalMessages(client);
    expect(globals).toHaveLength(1);
    expect(globals[0].data.payload).toEqual({});
    expect(globals[0].data.type).toBe('message.persisted');
    const serialized = JSON.stringify(globals[0]);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('+5511999998888');
    expect(serialized).not.toContain('content');
  });

  it('subscribe a setor/conversa sem membership recebe subscribe.error e não registra canal', async () => {
    const sectorA = await createSector('A');
    const sectorB = await createSector('B');
    const conversationA = await createConversation(sectorA);
    const conversationB = await createConversation(sectorB);
    const actorB = await createActor('sub-b', 'Receptionist', [{ sectorId: sectorB, accessLevel: 'read' }]);

    const client = track(await connectAndAuth(ports[1], actorB.token));

    expect(await subscribe(client, `sector:${sectorA}`)).toBe('error');
    expect(await subscribe(client, `conversation:${conversationA}`)).toBe('error');
    expect(client.messages.some((m) => m.event === 'subscribed' && m.data?.payload?.channel === `sector:${sectorA}`)).toBe(false);
    expect(client.messages.some((m) => m.event === 'subscribed' && m.data?.payload?.channel === `conversation:${conversationA}`)).toBe(false);

    expect(await subscribe(client, `sector:${sectorB}`)).toBe('subscribed');
    expect(await subscribe(client, `conversation:${conversationB}`)).toBe('subscribed');

    // Evento da conversa A não pode chegar ao ator do setor B.
    await publish(messageEnvelope(`evt-cross-${Date.now()}`, conversationA, 'CONTEUDO-SETOR-A'));
    await wait(600);
    expect(contentMessages(client)).toHaveLength(0);

    // Evento da conversa B chega com conteúdo.
    await publish(messageEnvelope(`evt-own-${Date.now()}`, conversationB, 'CONTEUDO-SETOR-B'));
    await waitFor(() => contentMessages(client).some((m) => m.data?.payload?.content === 'CONTEUDO-SETOR-B'), 8000, 'own sector content');
  });

  it('entrega por destinatário: A e B só recebem a própria conversa (nós distintos)', async () => {
    const sectorA = await createSector('A');
    const sectorB = await createSector('B');
    const conversationA = await createConversation(sectorA);
    const conversationB = await createConversation(sectorB);
    const actorA = await createActor('recip-a', 'Receptionist', [{ sectorId: sectorA, accessLevel: 'read' }]);
    const actorB = await createActor('recip-b', 'Receptionist', [{ sectorId: sectorB, accessLevel: 'read' }]);

    const clientA = track(await connectAndAuth(ports[0], actorA.token));
    const clientB = track(await connectAndAuth(ports[1], actorB.token));
    expect(await subscribe(clientA, `conversation:${conversationA}`)).toBe('subscribed');
    expect(await subscribe(clientB, `conversation:${conversationB}`)).toBe('subscribed');

    await publish(messageEnvelope(`evt-a-${Date.now()}`, conversationA, 'CONTEUDO-A'));
    await publish(messageEnvelope(`evt-b-${Date.now()}`, conversationB, 'CONTEUDO-B'));

    await waitFor(() => contentMessages(clientA).some((m) => m.data?.payload?.content === 'CONTEUDO-A'), 8000, 'A content');
    await waitFor(() => contentMessages(clientB).some((m) => m.data?.payload?.content === 'CONTEUDO-B'), 8000, 'B content');
    await wait(600);

    expect(contentMessages(clientA).some((m) => m.data?.payload?.content === 'CONTEUDO-B')).toBe(false);
    expect(contentMessages(clientB).some((m) => m.data?.payload?.content === 'CONTEUDO-A')).toBe(false);
    expect(contentMessages(clientA)).toHaveLength(1);
    expect(contentMessages(clientB)).toHaveLength(1);
  });

  it('admin explícito acessa conversa sem membership', async () => {
    const sectorA = await createSector('A');
    const conversationA = await createConversation(sectorA);
    const admin = await createActor('admin', 'Admin', []);

    const client = track(await connectAndAuth(ports[2], admin.token));
    expect(await subscribe(client, `conversation:${conversationA}`)).toBe('subscribed');

    await publish(messageEnvelope(`evt-admin-${Date.now()}`, conversationA, 'CONTEUDO-ADMIN'));
    await waitFor(() => contentMessages(client).some((m) => m.data?.payload?.content === 'CONTEUDO-ADMIN'), 8000, 'admin content');
  });

  it('conversa sem setor: somente admin ou vínculo explícito (D-C02-3); legado message:<id> é recusado', async () => {
    const owner = await createActor('sectorless-owner', 'Receptionist', []);
    const stranger = await createActor('sectorless-stranger', 'Receptionist', []);
    const conversation = await createConversation(null, owner.userId);

    const ownerClient = track(await connectAndAuth(ports[0], owner.token));
    expect(await subscribe(ownerClient, `conversation:${conversation}`)).toBe('subscribed');
    await publish(messageEnvelope(`evt-sectorless-${Date.now()}`, conversation, 'CONTEUDO-SEM-SETOR'));
    await waitFor(() => contentMessages(ownerClient).some((m) => m.data?.payload?.content === 'CONTEUDO-SEM-SETOR'), 8000, 'owner content');

    const strangerClient = track(await connectAndAuth(ports[1], stranger.token));
    expect(await subscribe(strangerClient, `conversation:${conversation}`)).toBe('error');
    expect(await subscribe(strangerClient, `message:${randomUUID()}`)).toBe('error');

    await publish(messageEnvelope(`evt-sectorless2-${Date.now()}`, conversation, 'NAO-DEVE-CHEGAR'));
    await wait(700);
    expect(contentMessages(strangerClient).some((m) => m.data?.payload?.content === 'NAO-DEVE-CHEGAR')).toBe(false);
  });

  it('membership sem role ou role sem chat:read não autoriza conteúdo (RBAC do HTTP)', async () => {
    const sectorA = await createSector('A');
    const conversationA = await createConversation(sectorA);
    const noRole = await createActor('no-role', null, [{ sectorId: sectorA, accessLevel: 'read' }]);
    const wrongRole = await createActor('wrong-role', 'Visitor', [{ sectorId: sectorA, accessLevel: 'read' }]);

    const noRoleClient = track(await connectAndAuth(ports[0], noRole.token));
    expect(await subscribe(noRoleClient, `conversation:${conversationA}`)).toBe('error');
    expect(await subscribe(noRoleClient, `sector:${sectorA}`)).toBe('error');

    const wrongRoleClient = track(await connectAndAuth(ports[1], wrongRole.token));
    expect(await subscribe(wrongRoleClient, `conversation:${conversationA}`)).toBe('error');

    await publish(messageEnvelope(`evt-no-role-${Date.now()}`, conversationA, 'NAO-DEVE-CHEGAR-SEM-ROLE'));
    await wait(700);
    expect(contentMessages(noRoleClient)).toHaveLength(0);
    expect(contentMessages(wrongRoleClient)).toHaveLength(0);

    // Contraprova: role com chat:read + membership recebe.
    const withRole = await createActor('with-role', 'Receptionist', [{ sectorId: sectorA, accessLevel: 'read' }]);
    const withRoleClient = track(await connectAndAuth(ports[2], withRole.token));
    expect(await subscribe(withRoleClient, `conversation:${conversationA}`)).toBe('subscribed');
    await publish(messageEnvelope(`evt-with-role-${Date.now()}`, conversationA, 'CONTEUDO-COM-ROLE'));
    await waitFor(() => contentMessages(withRoleClient).some((m) => m.data?.payload?.content === 'CONTEUDO-COM-ROLE'), 8000, 'role content');
  });

  it('porta de autorização distingue missing-permission de ausência de membership', async () => {
    const sectorA = await createSector('A');
    const conversationA = await createConversation(sectorA);
    const memberNoRole = await createActor('port-no-role', null, [{ sectorId: sectorA, accessLevel: 'read' }]);
    const memberWithRole = await createActor('port-with-role', 'Receptionist', [{ sectorId: sectorA, accessLevel: 'read' }]);
    const outsider = await createActor('port-outsider', 'Receptionist', []);

    const port = createDatabaseAuthorizationPort();
    const conversationTarget = {
      channel: `conversation:${conversationA}`,
      resource: { kind: 'conversation' as const, conversationId: conversationA },
    };
    const sectorChannel = { channel: `sector:${sectorA}`, kind: 'sector' as const, sectorId: sectorA };

    const noRoleDecision = await port.authorizeDelivery({ id: memberNoRole.userId, roles: [] }, conversationTarget);
    expect(noRoleDecision).toEqual({ allowed: false, reason: 'missing-permission' });

    const noRoleSector = await port.authorizeSubscription({ id: memberNoRole.userId, roles: [] }, sectorChannel);
    expect(noRoleSector).toEqual({ allowed: false, reason: 'missing-permission' });

    const withRoleDecision = await port.authorizeDelivery({ id: memberWithRole.userId, roles: ['Receptionist'] }, conversationTarget);
    expect(withRoleDecision.allowed).toBe(true);

    const noMembership = await port.authorizeDelivery({ id: outsider.userId, roles: ['Receptionist'] }, conversationTarget);
    expect(noMembership.allowed).toBe(false);
    expect(noMembership.reason).not.toBe('missing-permission');
  });

  it('evento de conteúdo com setor é entregue em sector:<id> somente a membros', async () => {
    const sectorA = await createSector('A');
    const sectorB = await createSector('B');
    const conversationA = await createConversation(sectorA);
    const actorA = await createActor('sector-target-a', 'Receptionist', [{ sectorId: sectorA, accessLevel: 'read' }]);
    const actorB = await createActor('sector-target-b', 'Receptionist', [{ sectorId: sectorB, accessLevel: 'read' }]);

    const clientA = track(await connectAndAuth(ports[0], actorA.token));
    const clientB = track(await connectAndAuth(ports[1], actorB.token));
    expect(await subscribe(clientA, `sector:${sectorA}`)).toBe('subscribed');
    expect(await subscribe(clientB, `sector:${sectorB}`)).toBe('subscribed');

    const eventId = `evt-sector-${Date.now()}`;
    await publish(conversationCreatedEnvelope(eventId, conversationA, sectorA));

    await waitFor(
      () => contentEvents(clientA, ['conversation.created']).length > 0,
      8000,
      'sector-targeted content',
    );
    await wait(700);
    expect(contentEvents(clientA, ['conversation.created'])).toHaveLength(1);
    expect(contentEvents(clientA, ['conversation.created'])[0].data?.aggregateId).toBe(conversationA);
    expect(contentEvents(clientB)).toHaveLength(0);
  });

  it('handoff/task/alert roteiam para conversa e responsável (user:<id>) sem vazar para estranhos', async () => {
    const sectorA = await createSector('A');
    const sectorB = await createSector('B');
    const conversationA = await createConversation(sectorA);
    const member = await createActor('routing-member', 'Receptionist', [{ sectorId: sectorA, accessLevel: 'read' }]);
    const recipient = await createActor('routing-recipient', 'Receptionist', []);
    const stranger = await createActor('routing-stranger', 'Receptionist', [{ sectorId: sectorB, accessLevel: 'read' }]);

    const memberClient = track(await connectAndAuth(ports[0], member.token));
    const recipientClient = track(await connectAndAuth(ports[1], recipient.token));
    const strangerClient = track(await connectAndAuth(ports[2], stranger.token));
    expect(await subscribe(memberClient, `conversation:${conversationA}`)).toBe('subscribed');

    const stamp = Date.now();
    await publish(handoffEnvelope(`evt-handoff-${stamp}`, conversationA, recipient.userId));
    await publish(taskEnvelope(`evt-task-${stamp}`, randomUUID(), conversationA, recipient.userId));
    await publish(alertEnvelope(`evt-alert-${stamp}`, randomUUID(), conversationA, recipient.userId));

    await waitFor(
      () => contentEvents(memberClient, ['handoff.completed', 'task.updated', 'alert.created']).length === 3,
      8000,
      'member routed content',
    );
    await waitFor(
      () => contentEvents(recipientClient, ['handoff.completed', 'task.updated', 'alert.created']).length === 3,
      8000,
      'recipient routed content',
    );
    await wait(700);

    expect(contentEvents(memberClient, ['handoff.completed', 'task.updated', 'alert.created'])).toHaveLength(3);
    expect(contentEvents(recipientClient, ['handoff.completed', 'task.updated', 'alert.created'])).toHaveLength(3);
    expect(contentEvents(strangerClient)).toHaveLength(0);
    expect(contentMessages(strangerClient)).toHaveLength(0);
  });

  it('revogação de sessão interrompe entrega e encerra conexão em <= 5 s', async () => {
    const sectorA = await createSector('A');
    const conversationA = await createConversation(sectorA);
    const actor = await createActor('revoke-session', 'Receptionist', [{ sectorId: sectorA, accessLevel: 'read' }]);

    const client = track(await connectAndAuth(ports[0], actor.token));
    expect(await subscribe(client, `conversation:${conversationA}`)).toBe('subscribed');

    const revokedAt = Date.now();
    await db
      .update(schema.sessions)
      .set({ revokedAt: new Date(), revokedReason: 'aaa05-test' })
      .where(eq(schema.sessions.userId, actor.userId));

    await waitFor(() => client.closeCode !== undefined, 8000, 'session close');
    const elapsed = Date.now() - revokedAt;

    expect(client.closeCode).toBe(4002);
    expect(elapsed).toBeLessThanOrEqual(5000);

    // Após o encerramento nenhum conteúdo novo é entregue.
    const before = contentMessages(client).length;
    await publish(messageEnvelope(`evt-after-revoke-${Date.now()}`, conversationA, 'CONTEUDO-POS-REVOGACAO'));
    await wait(700);
    expect(contentMessages(client)).toHaveLength(before);
  });

  it('revogação de membership remove o canal e interrompe entrega em <= 5 s', async () => {
    const sectorA = await createSector('A');
    const conversationA = await createConversation(sectorA);
    const actor = await createActor('revoke-member', 'Receptionist', [{ sectorId: sectorA, accessLevel: 'read' }]);

    const client = track(await connectAndAuth(ports[1], actor.token));
    expect(await subscribe(client, `conversation:${conversationA}`)).toBe('subscribed');
    expect(await subscribe(client, `sector:${sectorA}`)).toBe('subscribed');

    const revokedAt = Date.now();
    await db.delete(schema.userSectors).where(eq(schema.userSectors.userId, actor.userId));

    await waitFor(
      () => client.messages.some((m) => m.event === 'subscription.revoked' && m.data?.payload?.channel === `conversation:${conversationA}`),
      8000,
      'membership revocation',
    );
    const elapsed = Date.now() - revokedAt;
    expect(elapsed).toBeLessThanOrEqual(5000);

    const before = contentMessages(client).length;
    await publish(messageEnvelope(`evt-after-member-${Date.now()}`, conversationA, 'CONTEUDO-POS-MEMBERSHIP'));
    await wait(700);
    expect(contentMessages(client)).toHaveLength(before);
    expect(client.ws.readyState).toBe(WebSocket.OPEN);
  });

  it('reconexão exige nova autenticação e o socket antigo não recebe nada', async () => {
    const sectorA = await createSector('A');
    const conversationA = await createConversation(sectorA);
    const actor = await createActor('reconnect', 'Receptionist', [{ sectorId: sectorA, accessLevel: 'read' }]);

    const first = await connectAndAuth(ports[2], actor.token);
    expect(await subscribe(first, `conversation:${conversationA}`)).toBe('subscribed');
    const firstCount = contentMessages(first).length;
    await closeClient(first);

    const second = track(await connectAndAuth(ports[2], actor.token));
    expect(await subscribe(second, `conversation:${conversationA}`)).toBe('subscribed');

    await publish(messageEnvelope(`evt-reconnect-${Date.now()}`, conversationA, 'CONTEUDO-RECONEXAO'));
    await waitFor(() => contentMessages(second).some((m) => m.data?.payload?.content === 'CONTEUDO-RECONEXAO'), 8000, 'reconnect content');
    await wait(400);
    expect(contentMessages(first)).toHaveLength(firstCount);
  });

  it('limita inscrições por conexão e payload por mensagem', async () => {
    const sectorA = await createSector('A');
    const conversationA = await createConversation(sectorA);
    const actor = await createActor('limits', 'Receptionist', [{ sectorId: sectorA, accessLevel: 'read' }]);

    const limitedPort = ports[3];
    const client = track(await connectAndAuth(limitedPort, actor.token));

    // global + user:<id> já ocupam 2; a terceira é o limite; a quarta é recusada.
    expect(await subscribe(client, `conversation:${conversationA}`)).toBe('subscribed');
    expect(await subscribe(client, `sector:${sectorA}`)).toBe('error');
    const errors = client.messages.filter((m) => m.event === 'error' && m.data?.type === 'subscribe.error');
    expect(errors.some((m) => m.data?.payload?.error === 'Subscription limit reached')).toBe(true);

    // Payload acima do limite fecha a conexão sem entregar conteúdo.
    client.ws.send(JSON.stringify({ type: 'ping', padding: 'x'.repeat(4096) }));
    await waitFor(() => client.closeCode !== undefined, 8000, 'payload limit close');
    expect(client.closeCode).toBe(1009);
  });

  it('três réplicas: fanout via Redis sem vazamento e sem duplicidade', async () => {
    const sectorA = await createSector('A');
    const sectorB = await createSector('B');
    const conversationA = await createConversation(sectorA);
    const conversationB = await createConversation(sectorB);
    const actorA1 = await createActor('fan-a1', 'Receptionist', [{ sectorId: sectorA, accessLevel: 'read' }]);
    const actorA2 = await createActor('fan-a2', 'Receptionist', [{ sectorId: sectorA, accessLevel: 'read' }]);
    const actorB = await createActor('fan-b', 'Receptionist', [{ sectorId: sectorB, accessLevel: 'read' }]);

    const clientA1 = track(await connectAndAuth(ports[0], actorA1.token));
    const clientA2 = track(await connectAndAuth(ports[1], actorA2.token));
    const clientB = track(await connectAndAuth(ports[2], actorB.token));

    for (const client of [clientA1, clientA2]) {
      expect(await subscribe(client, `conversation:${conversationA}`)).toBe('subscribed');
    }
    expect(await subscribe(clientB, `conversation:${conversationB}`)).toBe('subscribed');

    await publish(messageEnvelope(`evt-fan-a-${Date.now()}`, conversationA, 'FANOUT-A'));
    await waitFor(() => contentMessages(clientA1).some((m) => m.data?.payload?.content === 'FANOUT-A'), 8000, 'replica A1 content');
    await waitFor(() => contentMessages(clientA2).some((m) => m.data?.payload?.content === 'FANOUT-A'), 8000, 'replica A2 content');
    await wait(800);

    // Exatamente uma entrega por cliente, em nós diferentes; B não recebe A.
    expect(contentMessages(clientA1).filter((m) => m.data?.payload?.content === 'FANOUT-A')).toHaveLength(1);
    expect(contentMessages(clientA2).filter((m) => m.data?.payload?.content === 'FANOUT-A')).toHaveLength(1);
    expect(contentMessages(clientB).some((m) => m.data?.payload?.content === 'FANOUT-A')).toBe(false);

    // O sinal global sanitizado chega a todos, sem conteúdo.
    await waitFor(() => globalMessages(clientA1).length > 0 && globalMessages(clientA2).length > 0 && globalMessages(clientB).length > 0, 8000, 'global signals');
    for (const client of [clientA1, clientA2, clientB]) {
      const signal = globalMessages(client)[0];
      expect(signal.data.payload).toEqual({});
      expect(JSON.stringify(signal)).not.toContain('FANOUT-A');
    }

    await publish(messageEnvelope(`evt-fan-b-${Date.now()}`, conversationB, 'FANOUT-B'));
    await waitFor(() => contentMessages(clientB).some((m) => m.data?.payload?.content === 'FANOUT-B'), 8000, 'replica B content');
    await wait(600);
    expect(contentMessages(clientA1).some((m) => m.data?.payload?.content === 'FANOUT-B')).toBe(false);
    expect(contentMessages(clientA2).some((m) => m.data?.payload?.content === 'FANOUT-B')).toBe(false);
    expect(contentMessages(clientB).filter((m) => m.data?.payload?.content === 'FANOUT-B')).toHaveLength(1);
  }, 30000);
});
