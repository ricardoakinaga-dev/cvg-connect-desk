import './integration-mocks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { publishToOutbox, type EventEnvelope } from '@cvg/events';
import type { FastifyInstance } from 'fastify';
import { buildDeskApiApp } from '../app.ts';

/**
 * AAA-05 — integração realtime ↔ desk-api (PostgreSQL a5 + Redis 56684 + sockets reais).
 *
 * Prova a fronteira de composição:
 * - `/auth/me` real (C01) é a fonte de revalidação de sessão do realtime;
 * - publicação API→realtime passa pelo outbox + `/events` autenticado por
 *   credencial de serviço (`REALTIME_INTERNAL_SECRET`), nunca por token de usuário;
 * - o serviço realtime real (importado de apps/realtime-service) entrega somente
 *   a destinatários autorizados e encerra a conexão em <= 5 s após revogação.
 *
 * O cliente WS usa o WebSocket global do Node 24 (socket real) para não
 * depender de `ws` no workspace do desk-api.
 */

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const REDIS_URL = process.env.REDIS_URL ?? '';
const DB_MARKER = 'aaa-20260912-a5';
const SERVICE_SECRET = 'aaa05-realtime-internal-secret';
const password = 'ChatRoutePass!42';
const passwordHash = '$2a$10$UX/LcD/6NKhheDIZmbHyN.a6Hc8SW6ytZ/LCCZW3un3h5vJ9n/1h6';
const runId = `aaa05-${Date.now()}`;

interface TestSocket {
  socket: WebSocket;
  messages: Array<Record<string, any>>;
  closeCode?: number;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function waitForTcpPort(port: number, timeoutMs = 20000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const open = await new Promise<boolean>((resolve) => {
      const socket = net.connect(port, '127.0.0.1');
      const finish = (value: boolean) => {
        socket.removeAllListeners();
        socket.destroy();
        resolve(value);
      };
      socket.once('connect', () => finish(true));
      socket.once('error', () => finish(false));
      socket.setTimeout(500, () => finish(false));
    });
    if (open) return;
    await wait(100);
  }
  throw new Error(`realtime-service não abriu a porta ${port}`);
}

async function waitFor(predicate: () => boolean, timeoutMs = 8000, label = 'condition'): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for ${label}`);
    }
    await wait(20);
  }
}

async function connectWs(url: string): Promise<TestSocket> {
  const socket = new WebSocket(url);
  const client: TestSocket = { socket, messages: [] };

  socket.addEventListener('message', (event: MessageEvent) => {
    try {
      client.messages.push(typeof event.data === 'string' ? JSON.parse(event.data) : { raw: String(event.data) });
    } catch {
      client.messages.push({ raw: String(event.data) });
    }
  });
  socket.addEventListener('close', (event: CloseEvent) => {
    client.closeCode = event.code;
  });

  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error('websocket error')), { once: true });
  });
  return client;
}

async function connectAndAuth(url: string, token: string): Promise<TestSocket> {
  const client = await connectWs(url);
  await waitFor(() => client.messages.some((m) => m.event === 'auth.required'), 8000, 'auth.required');
  client.socket.send(JSON.stringify({ type: 'auth', token }));
  await waitFor(() => client.messages.some((m) => m.event === 'auth.success'), 8000, 'auth.success');
  return client;
}

async function closeSocket(client: TestSocket | undefined): Promise<void> {
  if (!client || client.socket.readyState === WebSocket.CLOSED) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 1000);
    client.socket.addEventListener('close', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    client.socket.close();
  });
}

async function subscribe(client: TestSocket, channel: string): Promise<'subscribed' | 'error'> {
  const before = client.messages.length;
  client.socket.send(JSON.stringify({ type: 'subscribe', channel }));
  await waitFor(
    () => client.messages.slice(before).some((m) => m.event === 'subscribed' || (m.event === 'error' && m.data?.type === 'subscribe.error')),
    8000,
    `subscribe ${channel}`,
  );
  const entry = client.messages.slice(before).find((m) => m.event === 'subscribed' || m.event === 'error');
  return entry?.event === 'subscribed' ? 'subscribed' : 'error';
}

/** Somente eventos publicados por este arquivo (marcador no correlation_id). */
function owned(message: { data?: { correlationId?: unknown } }): boolean {
  return typeof message?.data?.correlationId === 'string' && message.data.correlationId.startsWith(runId);
}

function contentMessages(client: TestSocket): Array<Record<string, any>> {
  return client.messages.filter(
    (m) => owned(m) && m.event === 'message.persisted' && JSON.stringify(m.data?.payload) !== '{}',
  );
}

function globalSignals(client: TestSocket): Array<Record<string, any>> {
  return client.messages.filter(
    (m) => owned(m) && m.event === 'message.persisted' && JSON.stringify(m.data?.payload) === '{}',
  );
}

describe('AAA-05 — realtime publication/auth boundary (real PG a5 + real outbox + sockets)', () => {
  let app: FastifyInstance;
  let appUrl = '';
  let realtimeChild: ChildProcess | undefined;
  let realtimePort = 0;
  let sectorA = '';
  let sectorB = '';
  let conversationA = '';
  let conversationB = '';
  let actorA: { id: string; token: string };
  let actorB: { id: string; token: string };
  let actorRevoke: { id: string; token: string };
  const createdUserIds: string[] = [];
  const createdSectorIds: string[] = [];
  const createdConversationIds: string[] = [];
  const createdEventIds: string[] = [];
  const openSockets: TestSocket[] = [];
  const previousRateLimitMax = process.env.RATE_LIMIT_MAX;

  async function ensureRole(name: string): Promise<string> {
    const [existing] = await db.select().from(schema.roles).where(eq(schema.roles.name, name)).limit(1);
    if (existing) return existing.id;
    const [created] = await db.insert(schema.roles).values({ name }).returning();
    return created.id;
  }

  async function createActor(
    label: string,
    memberships: Array<{ sectorId: string; accessLevel: 'read' | 'write' }> = [],
  ): Promise<{ id: string; token: string }> {
    const id = randomUUID();
    const email = `${runId}.${label}@example.com`;
    await db.insert(schema.users).values({
      id,
      name: `AAA05 ${label}`,
      email,
      passwordHash,
      isActive: true,
    });
    createdUserIds.push(id);
    const roleId = await ensureRole('Receptionist');
    await db.insert(schema.userRoles).values({ userId: id, roleId });
    for (const membership of memberships) {
      await db.insert(schema.userSectors).values({ userId: id, sectorId: membership.sectorId, accessLevel: membership.accessLevel });
    }

    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
    if (login.statusCode !== 200) {
      throw new Error(`login falhou para ${label}: ${login.statusCode} ${login.body}`);
    }
    return { id, token: (login.json() as { token: string }).token };
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
      correlation_id: `${runId}-${eventId}`,
      version: 1,
    };
  }

  function track(client: TestSocket): TestSocket {
    openSockets.push(client);
    return client;
  }

  beforeAll(async () => {
    if (!/cvg_aaa_[a-z0-9_]*a5/.test(DATABASE_URL) || !DATABASE_URL.includes('127.0.0.1:56432')) {
      throw new Error(`AAA-05 exige DATABASE_URL do run a5 em 127.0.0.1:56432; recebido: ${DATABASE_URL}`);
    }
    if (!REDIS_URL.includes('127.0.0.1:56684')) {
      throw new Error(`AAA-05 exige Redis dedicado em 127.0.0.1:56684; recebido: ${REDIS_URL}`);
    }
    const marker = await db.execute(sql`SELECT run_id FROM aaa_environment_marker WHERE run_id = ${DB_MARKER}`);
    const markerRows = (marker as unknown as { rows: Array<{ run_id: string }> }).rows ?? [];
    if (markerRows.length === 0) {
      throw new Error(`Marcador ${DB_MARKER} ausente no banco a5.`);
    }

    // Credencial de serviço dedicada (C02 D-C02-8); token de usuário não serve.
    delete process.env.INTERNAL_EVENTS_SECRET;
    delete process.env.EVENTS_API_KEY;
    process.env.REALTIME_INTERNAL_SECRET = SERVICE_SECRET;
    process.env.USE_DATABASE_OUTBOX = 'false';
    process.env.REALTIME_POLL_INTERVAL_MS = '150';
    process.env.REALTIME_AUTH_REVALIDATE_MS = '500';
    process.env.REDIS_URL = REDIS_URL;
    process.env.RATE_LIMIT_MAX = '100000';

    app = await buildDeskApiApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('desk-api não expôs porta TCP real');
    }
    appUrl = `http://127.0.0.1:${address.port}`;
    process.env.DESK_API_URL = appUrl;

    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const [sectorARow] = await db.insert(schema.sectors).values({ name: `AAA05 int A ${suffix}`, code: `a05ia${suffix}`.slice(0, 50) }).returning();
    const [sectorBRow] = await db.insert(schema.sectors).values({ name: `AAA05 int B ${suffix}`, code: `a05ib${suffix}`.slice(0, 50) }).returning();
    sectorA = sectorARow.id;
    sectorB = sectorBRow.id;
    createdSectorIds.push(sectorA, sectorB);

    const [conversationARow] = await db.insert(schema.conversations).values({
      status: 'open', statusV2: 'novo', currentHandler: 'bot', isActive: true, sectorId: sectorA,
    }).returning();
    const [conversationBRow] = await db.insert(schema.conversations).values({
      status: 'open', statusV2: 'novo', currentHandler: 'bot', isActive: true, sectorId: sectorB,
    }).returning();
    conversationA = conversationARow.id;
    conversationB = conversationBRow.id;
    createdConversationIds.push(conversationA, conversationB);

    actorA = await createActor('authz-a', [{ sectorId: sectorA, accessLevel: 'read' }]);
    actorB = await createActor('authz-b', [{ sectorId: sectorB, accessLevel: 'read' }]);
    actorRevoke = await createActor('revoke', [{ sectorId: sectorA, accessLevel: 'read' }]);
  }, 60000);

  afterAll(async () => {
    for (const client of openSockets.splice(0)) {
      await closeSocket(client);
    }
    realtimeChild?.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      if (!realtimeChild || realtimeChild.exitCode !== null) {
        resolve();
        return;
      }
      const timer = setTimeout(resolve, 3000);
      realtimeChild.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    if (app) {
      await app.close();
    }

    if (createdUserIds.length > 0) {
      await db.delete(schema.sessions).where(inArray(schema.sessions.userId, createdUserIds)).catch(() => {});
      await db.delete(schema.userSectors).where(inArray(schema.userSectors.userId, createdUserIds)).catch(() => {});
      await db.delete(schema.userRoles).where(inArray(schema.userRoles.userId, createdUserIds)).catch(() => {});
      await db.delete(schema.users).where(inArray(schema.users.id, createdUserIds)).catch(() => {});
    }
    if (createdConversationIds.length > 0) {
      await db.delete(schema.conversations).where(inArray(schema.conversations.id, createdConversationIds)).catch(() => {});
    }
    if (createdSectorIds.length > 0) {
      await db.delete(schema.sectors).where(inArray(schema.sectors.id, createdSectorIds)).catch(() => {});
    }
    if (createdEventIds.length > 0) {
      await db.delete(schema.outboxConsumerAcks).where(inArray(schema.outboxConsumerAcks.eventId, createdEventIds)).catch(() => {});
      await db.delete(schema.outboxEvents).where(inArray(schema.outboxEvents.eventId, createdEventIds)).catch(() => {});
    }

    delete process.env.REALTIME_INTERNAL_SECRET;
    delete process.env.USE_DATABASE_OUTBOX;
    delete process.env.REALTIME_POLL_INTERVAL_MS;
    delete process.env.REALTIME_AUTH_REVALIDATE_MS;
    delete process.env.REDIS_URL;
    delete process.env.DESK_API_URL;
    if (previousRateLimitMax === undefined) delete process.env.RATE_LIMIT_MAX;
    else process.env.RATE_LIMIT_MAX = previousRateLimitMax;
  }, 30000);

  it('/auth/me real: sessão viva responde com roles; revogada responde 401 Invalid token', async () => {
    const alive = await app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${actorRevoke.token}` } });
    expect(alive.statusCode).toBe(200);
    expect((alive.json() as { user: { id: string; roles: string[] } }).user.roles).toContain('Receptionist');

    await db
      .update(schema.sessions)
      .set({ revokedAt: new Date(), revokedReason: 'aaa05-integration' })
      .where(eq(schema.sessions.userId, actorRevoke.id));

    const revoked = await app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${actorRevoke.token}` } });
    expect(revoked.statusCode).toBe(401);
    expect(revoked.json()).toMatchObject({ error: 'UNAUTHORIZED', message: 'Invalid token' });
  });

  it('/events (publicação API→realtime) exige credencial de serviço, nunca token de usuário', async () => {
    const missing = await app.inject({ method: 'GET', url: '/events?limit=1' });
    expect(missing.statusCode).toBe(401);

    const bearerOnly = await app.inject({
      method: 'GET',
      url: '/events?limit=1',
      headers: { authorization: `Bearer ${actorA.token}` },
    });
    expect(bearerOnly.statusCode).toBe(401);

    const wrongKey = await app.inject({
      method: 'GET',
      url: '/events?limit=1',
      headers: { 'x-internal-service-key': 'wrong-secret' },
    });
    expect(wrongKey.statusCode).toBe(401);

    const userTokenAsKey = await app.inject({
      method: 'GET',
      url: '/events?limit=1',
      headers: { 'x-internal-service-key': actorA.token },
    });
    expect(userTokenAsKey.statusCode).toBe(401);

    const serviceKey = await app.inject({
      method: 'GET',
      url: '/events?limit=1',
      headers: { 'x-internal-service-key': SERVICE_SECRET },
    });
    expect(serviceKey.statusCode).toBe(200);
    const body = serviceKey.json() as { events: unknown[]; leases: unknown[]; ackEndpoint: string; serverTime: string };
    expect(Array.isArray(body.events)).toBe(true);
    expect(Array.isArray(body.leases)).toBe(true);
    expect(body.ackEndpoint).toBe('/events/:eventId/ack');
    expect(typeof body.serverTime).toBe('string');
  });

  it('e2e: outbox → /events (credencial de serviço) → WS autorizado; isolamento e revogação <= 5 s', async () => {
    realtimePort = await getFreePort();
    const realtimeCwd = fileURLToPath(new URL('../../../realtime-service', import.meta.url));
    if (!existsSync(realtimeCwd)) {
      throw new Error(`diretório do realtime-service não encontrado: ${realtimeCwd}`);
    }
    realtimeChild = spawn('pnpm', ['exec', 'tsx', 'src/index.ts'], {
      cwd: realtimeCwd,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        REALTIME_PORT: String(realtimePort),
        DESK_API_URL: appUrl,
        USE_DATABASE_OUTBOX: 'false',
        REALTIME_POLL_INTERVAL_MS: '150',
        REALTIME_AUTH_REVALIDATE_MS: '500',
        REALTIME_AUTHZ_CACHE_MS: '500',
        REALTIME_INTERNAL_SECRET: SERVICE_SECRET,
        REDIS_URL,
        DATABASE_URL,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    realtimeChild.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      if (text.includes('"level":"error"') || text.includes('"level":50')) {
        process.stderr.write(`[realtime-child] ${text}`);
      }
    });
    await waitForTcpPort(realtimePort);
    await wait(200);
    const nodePort = realtimePort;

    const clientA = track(await connectAndAuth(`ws://127.0.0.1:${nodePort}`, actorA.token));
    expect(await subscribe(clientA, `conversation:${conversationA}`)).toBe('subscribed');
    expect(await subscribe(clientA, `conversation:${conversationB}`)).toBe('error');

    const clientB = track(await connectAndAuth(`ws://127.0.0.1:${nodePort}`, actorB.token));
    expect(await subscribe(clientB, `conversation:${conversationB}`)).toBe('subscribed');
    expect(await subscribe(clientB, `conversation:${conversationA}`)).toBe('error');

    const eventA = `evt-${runId}-a-${Date.now()}`;
    createdEventIds.push(eventA);
    await publishToOutbox(messageEnvelope(eventA, conversationA, 'INTEGRACAO-SETOR-A'));

    await waitFor(() => contentMessages(clientA).some((m) => m.data?.payload?.content === 'INTEGRACAO-SETOR-A'), 10000, 'conteúdo A via outbox');
    await waitFor(() => globalSignals(clientA).length > 0 && globalSignals(clientB).length > 0, 10000, 'sinais globais');
    await wait(700);
    expect(contentMessages(clientB).some((m) => m.data?.payload?.content === 'INTEGRACAO-SETOR-A')).toBe(false);
    expect(contentMessages(clientA)).toHaveLength(1);
    expect(JSON.stringify(globalSignals(clientA)[0])).not.toContain('INTEGRACAO-SETOR-A');

    // O consumidor http-poll do realtime confirmou o evento (ACK com fencing).
    let acked = false;
    const ackStartedAt = Date.now();
    while (!acked && Date.now() - ackStartedAt < 5000) {
      const acks = await db
        .select()
        .from(schema.outboxConsumerAcks)
        .where(eq(schema.outboxConsumerAcks.eventId, eventA));
      acked = acks.some((ack) => ack.consumerId === 'http-poll' && ack.processedAt !== null);
      if (!acked) await wait(50);
    }
    expect(acked).toBe(true);

    // Revogação de sessão: /auth/me real nega e a conexão fecha em <= 5 s.
    const revokedAt = Date.now();
    await db
      .update(schema.sessions)
      .set({ revokedAt: new Date(), revokedReason: 'aaa05-e2e' })
      .where(eq(schema.sessions.userId, actorA.id));

    await waitFor(() => clientA.closeCode !== undefined, 8000, 'close after session revocation');
    expect(clientA.closeCode).toBe(4002);
    expect(Date.now() - revokedAt).toBeLessThanOrEqual(5000);
  }, 30000);
});
