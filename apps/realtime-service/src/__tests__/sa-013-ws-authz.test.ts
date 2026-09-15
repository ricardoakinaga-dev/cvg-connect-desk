import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { WebSocket } from 'ws';
import { db, schema } from '@cvg/database';
import { RedisRealtimeBus, type EventEnvelope } from '@cvg/events';
import { RealtimeServer } from '../index.ts';
import { createDatabaseAuthorizationPort } from '../authorization';

/**
 * SA-013 — autorização WS por destinatário com decisão REAL de recurso (C02, G02).
 *
 * Segue o padrão de `realtime-auth-behavioral.test.ts` (servidor `/auth/me` fake
 * para a sessão) e troca a decisão de recurso pela porta de produção
 * `createDatabaseAuthorizationPort` contra o PostgreSQL isolado do run; a
 * entrega de conteúdo usa Redis real (mesmo padrão de aaa-05/fanout). O que
 * esta suíte adiciona aos negativos já existentes em
 * `aaa-05-isolation.test.ts` (citado como cobertura prévia de subscribe sem
 * membership e revogação de membership):
 *  - subscribe a conversa de outro setor negado com decisão real e SEM entrega
 *    de evento subsequente (mesma resposta de canal inexistente — sem revelar
 *    existência);
 *  - revogação de PERMISSÃO (não de membership) no banco interrompe a entrega
 *    já autorizada em ≤5s e emite `subscription.revoked`.
 *
 * Executar apenas pelo runner isolado (SA-003):
 *   node scripts/production/run-integration-isolated.mjs --run-id <id> --worker <45-49> \
 *     --skip-seed -- pnpm --filter @cvg/realtime-service exec vitest run \
 *     src/__tests__/sa-013-ws-authz.test.ts
 */

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const REDIS_URL = process.env.REDIS_URL ?? '';
const passwordHash = '$2a$10$UX/LcD/6NKhheDIZmbHyN.a6Hc8SW6ytZ/LCCZW3un3h5vJ9n/1h6';
const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const RUN_MARKER = `sa013ws-${randomUUID().slice(0, 8)}`;

interface TestClient {
  ws: WebSocket;
  messages: Array<Record<string, any>>;
  closeCode?: number;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function owned(message: { data?: { correlationId?: unknown } }): boolean {
  return typeof message?.data?.correlationId === 'string' && message.data.correlationId.startsWith(RUN_MARKER);
}

function contentMessages(client: TestClient): Array<Record<string, any>> {
  return client.messages.filter(
    (message) => owned(message) && message.event === 'message.persisted' && JSON.stringify(message.data?.payload) !== '{}',
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

async function getFreePort(): Promise<number> {
  const probe = createServer();
  return await new Promise<number>((resolve, reject) => {
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address() as AddressInfo;
      probe.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function startAuthServer() {
  const tokenUsers = new Map<string, string>();

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    if (request.url === '/auth/me') {
      const authorization = request.headers.authorization || '';
      const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
      const userId = tokenUsers.get(token);
      if (!userId) {
        response.writeHead(401, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'UNAUTHORIZED' }));
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        user: { id: userId, email: `${userId}@example.com`, name: 'SA013 WS', roles: ['Realtime'] },
      }));
      return;
    }
    if (request.url?.startsWith('/events')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ events: [], serverTime: new Date().toISOString() }));
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'NOT_FOUND' }));
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    server,
    setToken(token: string, userId: string) {
      tokenUsers.set(token, userId);
    },
  };
}

async function connectClient(url: string): Promise<TestClient> {
  return await new Promise<TestClient>((resolve, reject) => {
    const messages: TestClient['messages'] = [];
    const client: TestClient = { ws: new WebSocket(url), messages };

    client.ws.on('message', (data: Buffer) => {
      try {
        messages.push(JSON.parse(data.toString()));
      } catch {
        messages.push({ raw: data.toString() });
      }
    });
    client.ws.on('close', (code) => {
      client.closeCode = code;
    });
    client.ws.on('open', () => resolve(client));
    client.ws.on('error', reject);
  });
}

async function waitForMessage(client: TestClient, predicate: (message: any) => boolean, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (!client.messages.some(predicate)) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for websocket message. Received: ${JSON.stringify(client.messages)}`);
    }
    await wait(25);
  }
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
  await waitForMessage(client, (message) => message.event === 'auth.required');
  client.ws.send(JSON.stringify({ type: 'auth', token }));
  await waitForMessage(client, (message) => message.event === 'auth.success');
  return client;
}

async function subscribe(client: TestClient, channel: string): Promise<'subscribed' | 'error'> {
  const before = client.messages.length;
  const settled = () =>
    client.messages
      .slice(before)
      .some((message) => message.event === 'subscribed' || (message.event === 'error' && message.data?.type === 'subscribe.error'));

  client.ws.send(JSON.stringify({ type: 'subscribe', channel }));
  const startedAt = Date.now();
  while (!settled()) {
    if (Date.now() - startedAt > 15000) {
      throw new Error(`Timed out waiting for subscribe ${channel}. Received: ${JSON.stringify(client.messages)}`);
    }
    await wait(25);
  }

  const entry = client.messages
    .slice(before)
    .find((message) => message.event === 'subscribed' || (message.event === 'error' && message.data?.type === 'subscribe.error'));
  return entry?.event === 'subscribed' ? 'subscribed' : 'error';
}

async function insertChatRole(label: string): Promise<string> {
  const [role] = await db.insert(schema.roles).values({ name: `sa013_ws_${label}_${suffix}` }).returning();
  const [permission] = await db
    .select()
    .from(schema.permissions)
    .where(eq(schema.permissions.name, 'chat:read'))
    .limit(1);
  if (!permission) {
    throw new Error('Permissão chat:read ausente no banco do run (migração 0025).');
  }
  await db.insert(schema.rolePermissions).values({ roleId: role.id, permissionId: permission.id });
  return role.id;
}

describe('SA-013 — WS: negativas de recurso com decisão real (G02)', () => {
  let authServer: Awaited<ReturnType<typeof startAuthServer>> | undefined;
  let realtimeServer: RealtimeServer | undefined;
  let publisher: RedisRealtimeBus | undefined;
  let realtimePort = 0;
  const openClients: TestClient[] = [];

  const userIds: string[] = [];
  const roleIds: string[] = [];
  const sectorIds: string[] = [];
  const conversationIds: string[] = [];

  let memberToken = '';
  let foreignToken = '';
  let memberRoleId = '';
  let sectorAId = '';
  let sectorBId = '';
  let convAId = '';
  let convBId = '';

  async function createActor(label: string, roleId: string, sectorId: string | null): Promise<{ id: string; token: string }> {
    const id = randomUUID();
    await db.insert(schema.users).values({
      id,
      name: `SA013 WS ${label}`,
      email: `sa013.ws.${label}.${suffix}@example.com`,
      passwordHash,
      isActive: true,
    });
    userIds.push(id);
    await db.insert(schema.userRoles).values({ userId: id, roleId });
    if (sectorId) {
      await db.insert(schema.userSectors).values({ userId: id, sectorId, accessLevel: 'read' });
    }
    const token = `sa013-ws-${label}-${suffix}`;
    return { id, token };
  }

  function track(client: TestClient): TestClient {
    openClients.push(client);
    return client;
  }

  async function publish(envelope: EventEnvelope): Promise<void> {
    const published = await publisher!.publish(envelope);
    expect(published).toBe(true);
  }

  beforeAll(async () => {
    if (!DATABASE_URL) {
      throw new Error('SA-013 WS exige DATABASE_URL (use o runner isolado de SA-003).');
    }
    if (!REDIS_URL) {
      throw new Error('SA-013 WS exige REDIS_URL real (use o runner isolado de SA-003); o default de host é recusado.');
    }
    if (process.env.AAA_RUN_ID) {
      const marker = await db.execute(sql`SELECT run_id FROM aaa_environment_marker`);
      const rows = (marker as unknown as { rows: Array<{ run_id: string }> }).rows ?? [];
      if (rows.length !== 1 || rows[0].run_id !== process.env.AAA_RUN_ID) {
        throw new Error(
          `SA-013 WS exige o marcador do run ${process.env.AAA_RUN_ID} no banco informado: ${JSON.stringify(rows)}`,
        );
      }
    }

    const [sectorA] = await db.insert(schema.sectors).values({ name: `SA013 WS A ${suffix}`, code: `sa013wsa${suffix}` }).returning();
    const [sectorB] = await db.insert(schema.sectors).values({ name: `SA013 WS B ${suffix}`, code: `sa013wsb${suffix}` }).returning();
    sectorAId = sectorA.id;
    sectorBId = sectorB.id;
    sectorIds.push(sectorAId, sectorBId);

    const memberRole = await insertChatRole('member');
    const foreignRole = await insertChatRole('foreign');
    memberRoleId = memberRole;
    roleIds.push(memberRole, foreignRole);

    const member = await createActor('member', memberRole, sectorAId);
    const foreign = await createActor('foreign', foreignRole, sectorBId);
    memberToken = member.token;
    foreignToken = foreign.token;

    const [convA] = await db.insert(schema.conversations).values({
      status: 'open', statusV2: 'novo', currentHandler: 'bot', isActive: true, sectorId: sectorAId,
    }).returning();
    const [convB] = await db.insert(schema.conversations).values({
      status: 'open', statusV2: 'novo', currentHandler: 'bot', isActive: true, sectorId: sectorBId,
    }).returning();
    convAId = convA.id;
    convBId = convB.id;
    conversationIds.push(convAId, convBId);

    authServer = await startAuthServer();
    authServer.setToken(memberToken, member.id);
    authServer.setToken(foreignToken, foreign.id);

    process.env.DESK_API_URL = authServer.baseUrl;
    process.env.USE_DATABASE_OUTBOX = 'false';
    process.env.REALTIME_POLL_INTERVAL_MS = '600000';
    process.env.REDIS_URL = REDIS_URL;
    process.env.NODE_ENV = 'test';

    realtimePort = await getFreePort();
    // Defaults de PRODUÇÃO (DEFAULT_REVALIDATE_MS=2000, DEFAULT_AUTHZ_CACHE_MS=2000):
    // a prova de revogação ≤5s precisa valer na configuração entregue, não só
    // numa configuração acelerada de teste.
    realtimeServer = new RealtimeServer(realtimePort, {
      authorizationPort: createDatabaseAuthorizationPort(),
    });
    realtimeServer.start();

    publisher = new RedisRealtimeBus({ url: REDIS_URL });
    await publisher.start();

    await wait(300);
  }, 60000);

  afterEach(async () => {
    for (const client of openClients.splice(0)) {
      await closeClient(client);
    }
  });

  afterAll(async () => {
    realtimeServer?.stop();
    await publisher?.stop().catch(() => {});
    if (authServer) {
      (authServer.server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
      await new Promise<void>((resolve) => authServer!.server.close(() => resolve()));
    }

    if (conversationIds.length > 0) {
      await db.delete(schema.conversations).where(inArray(schema.conversations.id, conversationIds));
    }
    if (userIds.length > 0) {
      await db.delete(schema.userSectors).where(inArray(schema.userSectors.userId, userIds));
      await db.delete(schema.userRoles).where(inArray(schema.userRoles.userId, userIds));
      await db.delete(schema.users).where(inArray(schema.users.id, userIds));
    }
    if (sectorIds.length > 0) {
      await db.delete(schema.sectors).where(inArray(schema.sectors.id, sectorIds));
    }
    if (roleIds.length > 0) {
      await db.delete(schema.rolePermissions).where(inArray(schema.rolePermissions.roleId, roleIds));
      await db.delete(schema.roles).where(inArray(schema.roles.id, roleIds));
    }

    delete process.env.DESK_API_URL;
    delete process.env.USE_DATABASE_OUTBOX;
    delete process.env.REALTIME_POLL_INTERVAL_MS;
    delete process.env.REDIS_URL;
  }, 30000);

  it('subscribe a conversa de outro setor é negado (decisão real) sem entregar evento; canal inexistente responde igual', async () => {
    const client = track(await connectAndAuth(realtimePort, foreignToken));

    expect(await subscribe(client, `conversation:${convAId}`)).toBe('error');
    expect(await subscribe(client, `conversation:${randomUUID()}`)).toBe('error');

    const errors = client.messages.filter(
      (message) => message.event === 'error' && message.data?.type === 'subscribe.error',
    );
    expect(errors).toHaveLength(2);
    // Mesma resposta genérica para existente-e-proibido e inexistente: não revela existência.
    expect(errors[0].data?.payload?.error).toBe('Channel not authorized');
    expect(errors[1].data?.payload?.error).toBe('Channel not authorized');
    expect(client.messages.some((message) => message.event === 'subscribed')).toBe(false);

    await publish(messageEnvelope('foreign-deny', convAId, 'SA013-WS-FOREIGN'));
    await wait(600);
    expect(contentMessages(client)).toHaveLength(0);

    // Contraprova: o próprio setor autoriza e entrega.
    expect(await subscribe(client, `conversation:${convBId}`)).toBe('subscribed');
    await publish(messageEnvelope('own-allow', convBId, 'SA013-WS-OWN'));
    await waitForMessage(
      client,
      (message) => owned(message) && message.data?.payload?.content === 'SA013-WS-OWN',
    );
  });

  it('revogação de permissão no banco interrompe entrega já autorizada em <= 5s (subscription.revoked)', async () => {
    const client = track(await connectAndAuth(realtimePort, memberToken));
    expect(await subscribe(client, `conversation:${convAId}`)).toBe('subscribed');

    await publish(messageEnvelope('permission-pre', convAId, 'SA013-WS-PRE-REVOKE'));
    await waitForMessage(
      client,
      (message) => owned(message) && message.data?.payload?.content === 'SA013-WS-PRE-REVOKE',
    );

    const revokedAt = Date.now();
    const deleted = await db
      .delete(schema.rolePermissions)
      .where(eq(schema.rolePermissions.roleId, memberRoleId))
      .returning();
    expect(deleted.length).toBeGreaterThan(0);

    await waitForMessage(
      client,
      (message) =>
        message.event === 'subscription.revoked'
        && message.data?.payload?.channel === `conversation:${convAId}`,
      10000,
    );
    expect(Date.now() - revokedAt).toBeLessThanOrEqual(5000);

    const delivered = contentMessages(client).length;
    await publish(messageEnvelope('permission-post', convAId, 'SA013-WS-POST-REVOKE'));
    await wait(700);
    expect(contentMessages(client)).toHaveLength(delivered);
    expect(client.ws.readyState).toBe(WebSocket.OPEN);
  });
});
