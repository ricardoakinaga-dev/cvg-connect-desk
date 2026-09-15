/**
 * PROD-04 — Autorização por ação e recurso em HTTP/WS (AC1–AC4).
 *
 * Roda com PostgreSQL + Redis REAIS do harness AAA isolado
 * (`cvg_aaa_prod04_20260913_w10`, 127.0.0.1:57432/56780 — nunca o banco do
 * host). O provisionamento e o teardown são do próprio teste:
 *   provisionIsolatedEnv -> db:migrate real -> app real (`buildDeskApiApp`)
 *   -> negativos por rota -> socket real do realtime-service.
 * Teardown ao final: `{ stopServices: true, dropDatabase: true }`.
 *
 * AC1  GET /conversations exige chat:read em toda variante; escopo nunca
 *      interpreta ausência de setores como admin (globalAdmin explícito);
 *      repositório deny-by-default e TOCTOU (revogação entre checagem e query).
 * AC2  Kanban board/filters (chat:read) e move/assign (chat:write) com origem
 *      e destino autorizados; matriz de tutores/pacientes/contatos/tasks/
 *      alerts/notes/admin por ação + recurso.
 * AC3  Fonte efetiva (roles/memberships no banco) altera decisão; 403/404
 *      estáveis em admin, sem role, read-only, write, dois setores, recurso
 *      sem setor, revogação e IDs adulterados.
 * AC4  Subscription/entrega WS validam ação/recurso; revogação corta canal em
 *      <=5s no socket real, sem enfraquecer os gates HTTP.
 */
import '../integration-mocks';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import net from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { eq, and, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 600_000 });

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..', '..');
const PROGRAM_DIR = process.env.CVG_PROGRAM_DIR || join(REPO_ROOT, 'docs', 'producao-2026-09-13');
const RUNTIME_DIR = process.env.CVG_RUNTIME_DIR || join(PROGRAM_DIR, 'evidencias', 'prod-04', 'runtime');
const EVIDENCE_DIR = join(PROGRAM_DIR, 'evidencias', 'prod-04');
const LOG_DIR = join(EVIDENCE_DIR, 'logs');

process.env.CVG_PROGRAM_DIR = PROGRAM_DIR;
process.env.CVG_RUNTIME_DIR = RUNTIME_DIR;
process.env.AAA_RUN_ID = process.env.AAA_RUN_ID || 'prod04-20260913';
process.env.AAA_WORKER_INDEX = process.env.AAA_WORKER_INDEX || '10';

const RUN_ID = process.env.AAA_RUN_ID;
const WORKER_INDEX = Number(process.env.AAA_WORKER_INDEX);
const REALTIME_SECRET = `prod04-realtime-secret-${RUN_ID}`;
const SERVICE_KEY = process.env.GATEWAY_API_KEY || 'prod04-service-key';

type DatabaseModule = typeof import('@cvg/database');
type RepositoryModule = typeof import('../../../../../modules/chat/src/infrastructure/repositories/conversation.repository.ts');

/** Contrato mínimo do harness AAA — evita trazer `pg.ts` ao programa TS do app. */
interface RunContext {
  runId: string;
  databaseName: string;
  databaseUrl: string;
  redisUrl: string;
  ports: { postgres: number; redis: number };
}

interface Harness {
  provisionIsolatedEnv: (
    context: RunContext,
  ) => Promise<{ databaseName: string; marker: { runId: string } }>;
  teardownIsolatedEnv: (
    context: RunContext,
    options?: { stopServices?: boolean; dropDatabase?: boolean },
  ) => Record<string, unknown>;
}

let ctx: RunContext;
let harness: Pick<Harness, 'teardownIsolatedEnv'>;
let databaseModule: DatabaseModule | undefined;
let app: FastifyInstance;
let appUrl = '';
let db: DatabaseModule['db'];
let schema: DatabaseModule['schema'];
let repository: RepositoryModule['conversationRepository'];

const password = 'ChatRoutePass!42';
const passwordHash = '$2a$10$UX/LcD/6NKhheDIZmbHyN.a6Hc8SW6ytZ/LCCZW3un3h5vJ9n/1h6';
const suffix = String(Date.now()).slice(-6);

interface Actor {
  id: string;
  email: string;
  token: string;
  roles: string[];
}

interface MatrixProbe {
  id: string;
  method: string;
  url: string;
  actor: string;
  status: number;
  expected: number[];
}

const matrix: MatrixProbe[] = [];
const createdUserIds: string[] = [];
const createdSectorIds: string[] = [];
const createdConversationIds: string[] = [];
const createdContactIds: string[] = [];
const createdTaskIds: string[] = [];
const createdAlertIds: string[] = [];
const createdNoteIds: string[] = [];
const createdTutorIds: string[] = [];
const createdPatientIds: string[] = [];
const createdContactGroupIds: string[] = [];
const openSockets: TestSocket[] = [];

let sectorA = '';
let sectorB = '';
let convA = '';
let convA2 = '';
let convB = '';
let sectorlessOwned = '';
let sectorlessViewer = '';
let kanbanConvA = '';
let kanbanConvB = '';
let kanbanConvMove = '';
let contactA = '';
let contactB = '';
let contactFree = '';
let contactFreshA = '';
let taskA = '';
let taskB = '';
let alertA = '';
let alertB = '';
let noteA = '';
let noteB = '';
let tutorId = '';
let patientId = '';

let admin: Actor;
let readerA: Actor;
let writerA: Actor;
let writerAB: Actor;
let outsider: Actor;
let noRole: Actor;
let viewer: Actor;
let dualAB: Actor;
let manager: Actor;
let owner: Actor;
let dynActor: Actor;
let revokeListActor: Actor;
let toctouActor: Actor;
let wsMember: Actor;
let wsSession: Actor;

async function ensureRole(name: string): Promise<string> {
  const [existing] = await db.select().from(schema.roles).where(eq(schema.roles.name, name)).limit(1);
  if (existing) return existing.id;
  const [created] = await db.insert(schema.roles).values({ name }).returning();
  return created.id;
}

/** AC3 — edição da fonte efetiva no banco (permissions/role_permissions). */
async function ensurePermission(name: string): Promise<string> {
  const [existing] = await db
    .select()
    .from(schema.permissions)
    .where(eq(schema.permissions.name, name))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await db.insert(schema.permissions).values({ name }).returning();
  return created.id;
}

async function grantRolePermission(roleId: string, permissionName: string): Promise<void> {
  const permissionId = await ensurePermission(permissionName);
  await db
    .insert(schema.rolePermissions)
    .values({ roleId, permissionId })
    .onConflictDoNothing();
}

async function revokeRolePermission(roleId: string, permissionName: string): Promise<void> {
  const permissionId = await ensurePermission(permissionName);
  await db
    .delete(schema.rolePermissions)
    .where(and(
      eq(schema.rolePermissions.roleId, roleId),
      eq(schema.rolePermissions.permissionId, permissionId),
    ));
}

async function createActor(
  label: string,
  roleNames: string[],
  memberships: Array<{ sectorId: string; accessLevel: 'read' | 'write' | 'admin' }> = [],
): Promise<Actor> {  const id = randomUUID();
  const email = `${RUN_ID}.${suffix}.${label}@example.com`;
  await db.insert(schema.users).values({ id, name: `PROD04 ${label}`, email, passwordHash, isActive: true });
  createdUserIds.push(id);
  for (const roleName of roleNames) {
    await db.insert(schema.userRoles).values({ userId: id, roleId: await ensureRole(roleName) });
  }
  for (const membership of memberships) {
    await db.insert(schema.userSectors).values({
      userId: id,
      sectorId: membership.sectorId,
      accessLevel: membership.accessLevel,
    });
  }
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
  if (login.statusCode !== 200) {
    throw new Error(`login falhou para ${label}: ${login.statusCode} ${login.body}`);
  }
  const user = (login.json() as { user: { roles: string[] } }).user;
  return { id, email, token: (login.json() as { token: string }).token, roles: user.roles };
}

function auth(actor: Actor): Record<string, string> {
  return { authorization: `Bearer ${actor.token}` };
}

function trackProbe(id: string, method: string, url: string, actor: string, status: number, expected: number[]): void {
  matrix.push({ id, method, url, actor, status, expected });
}

function conversationIds(body: unknown): string[] {
  const parsed = body as { conversations?: Array<{ id: string }>; items?: Array<{ id: string }> };
  return (parsed.conversations ?? parsed.items ?? []).map((conversation) => conversation.id);
}

/** ---- WebSocket (global WebSocket do Node 24, socket real) ---- */

interface SocketMessage {
  event?: string;
  data?: { type?: string; payload?: unknown; [key: string]: unknown };
  [key: string]: unknown;
}

interface TestSocket {
  socket: WebSocket;
  messages: SocketMessage[];
  closeCode?: number;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function getFreePort(): Promise<number> {
  const probe = createServer();
  return await new Promise<number>((resolvePromise, reject) => {
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = (probe.address() as AddressInfo).port;
      probe.close((error) => (error ? reject(error) : resolvePromise(port)));
    });
  });
}

async function waitForTcpPort(port: number, timeoutMs = 30_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const open = await new Promise<boolean>((resolvePromise) => {
      const socket = net.connect(port, '127.0.0.1');
      const finish = (value: boolean) => {
        socket.removeAllListeners();
        socket.destroy();
        resolvePromise(value);
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
    await wait(25);
  }
}

async function connectAndAuth(url: string, token: string): Promise<TestSocket> {
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
  await new Promise<void>((resolvePromise, reject) => {
    socket.addEventListener('open', () => resolvePromise(), { once: true });
    socket.addEventListener('error', () => reject(new Error('websocket error')), { once: true });
  });
  await waitFor(() => client.messages.some((m) => m.event === 'auth.required'), 8000, 'auth.required');
  socket.send(JSON.stringify({ type: 'auth', token }));
  await waitFor(() => client.messages.some((m) => m.event === 'auth.success'), 8000, 'auth.success');
  openSockets.push(client);
  return client;
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

let realtimeChild: ChildProcess | undefined;

beforeAll(async () => {
  mkdirSync(LOG_DIR, { recursive: true });
  const runContextModule = (await import(
    pathToFileURL(join(REPO_ROOT, 'e2e/support/aaa/run-context.ts')).href
  )) as { getRunContext: (workerIndex?: number) => RunContext };
  const isolatedEnvModule = (await import(
    pathToFileURL(join(REPO_ROOT, 'e2e/support/aaa/isolated-env.ts')).href
  )) as Harness;
  harness = { teardownIsolatedEnv: isolatedEnvModule.teardownIsolatedEnv };

  ctx = runContextModule.getRunContext(WORKER_INDEX);
  const isolated = await isolatedEnvModule.provisionIsolatedEnv(ctx);
  if (isolated.marker.runId !== RUN_ID) {
    throw new Error(`marcador do run divergente: ${isolated.marker.runId}`);
  }

  const migrated = spawnSync('pnpm', ['--filter', '@cvg/database', 'run', 'db:migrate'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 300_000,
    env: { ...process.env, DATABASE_URL: ctx.databaseUrl },
  });
  writeFileSync(
    join(LOG_DIR, 'db-migrate.log'),
    `$ pnpm --filter @cvg/database run db:migrate\nexit=${migrated.status ?? 'null'}\n${migrated.stdout}\n${migrated.stderr}\n`,
  );
  if (migrated.status !== 0) {
    throw new Error(`db:migrate falhou (exit ${migrated.status}): ${migrated.stderr || migrated.stdout}`);
  }

  process.env.DATABASE_URL = ctx.databaseUrl;
  process.env.REDIS_URL = ctx.redisUrl;
  process.env.RATE_LIMIT_MAX = '100000';
  process.env.RATE_LIMIT_LOGIN_MAX = '100000';
  process.env.GATEWAY_API_KEY = SERVICE_KEY;
  process.env.REALTIME_INTERNAL_SECRET = REALTIME_SECRET;
  process.env.USE_DATABASE_OUTBOX = 'false';
  process.env.REALTIME_AUTH_REVALIDATE_MS = '500';
  process.env.REALTIME_AUTHZ_CACHE_MS = '500';

  const importedDatabaseModule = (await import(
    pathToFileURL(join(REPO_ROOT, 'packages/database/src/index.ts')).href
  )) as DatabaseModule;
  databaseModule = importedDatabaseModule;
  db = importedDatabaseModule.db;
  schema = importedDatabaseModule.schema;
  const repositoryModule = (await import(
    pathToFileURL(join(REPO_ROOT, 'modules/chat/src/infrastructure/repositories/conversation.repository.ts')).href
  )) as RepositoryModule;
  repository = repositoryModule.conversationRepository;

  const appModule = (await import(pathToFileURL(join(REPO_ROOT, 'apps/desk-api/src/app.ts')).href)) as {
    buildDeskApiApp: () => Promise<FastifyInstance>;
  };
  app = await appModule.buildDeskApiApp();
  await app.ready();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (!address || typeof address === 'string') {
    throw new Error('desk-api não expôs porta TCP real');
  }
  appUrl = `http://127.0.0.1:${address.port}`;
  process.env.DESK_API_URL = appUrl;

  const [a] = await db.insert(schema.sectors).values({
    name: `PROD04 A ${suffix}`, code: `p04a${suffix}`.slice(0, 50), isActive: true,
  }).returning();
  const [b] = await db.insert(schema.sectors).values({
    name: `PROD04 B ${suffix}`, code: `p04b${suffix}`.slice(0, 50), isActive: true,
  }).returning();
  sectorA = a.id;
  sectorB = b.id;
  createdSectorIds.push(sectorA, sectorB);

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

  async function createMessage(conversationId: string, content: string): Promise<void> {
    await db.insert(schema.messages).values({
      conversationId,
      direction: 'inbound',
      content,
      sender: '+5511900000000',
      status: 'delivered',
    });
  }

  admin = await createActor('admin', ['Admin']);
  readerA = await createActor('reader-a', ['Receptionist'], [{ sectorId: sectorA, accessLevel: 'read' }]);
  writerA = await createActor('writer-a', ['Receptionist'], [{ sectorId: sectorA, accessLevel: 'write' }]);
  writerAB = await createActor('writer-ab', ['Receptionist'], [
    { sectorId: sectorA, accessLevel: 'write' },
    { sectorId: sectorB, accessLevel: 'write' },
  ]);
  outsider = await createActor('outsider', ['Receptionist']);
  noRole = await createActor('no-role', [], [{ sectorId: sectorA, accessLevel: 'read' }]);
  viewer = await createActor('viewer', ['Viewer'], [{ sectorId: sectorA, accessLevel: 'read' }]);
  dualAB = await createActor('dual-ab', ['Receptionist'], [
    { sectorId: sectorA, accessLevel: 'read' },
    { sectorId: sectorB, accessLevel: 'write' },
  ]);
  manager = await createActor('manager', ['Manager'], [{ sectorId: sectorA, accessLevel: 'read' }]);
  owner = await createActor('owner', ['Receptionist']);
  dynActor = await createActor('dyn', [], [{ sectorId: sectorA, accessLevel: 'read' }]);
  revokeListActor = await createActor('revoke-list', ['Receptionist'], [{ sectorId: sectorA, accessLevel: 'read' }]);
  toctouActor = await createActor('toctou', ['Receptionist'], [{ sectorId: sectorA, accessLevel: 'read' }]);
  wsMember = await createActor('ws-member', ['Receptionist'], [{ sectorId: sectorA, accessLevel: 'read' }]);
  wsSession = await createActor('ws-session', ['Receptionist'], [{ sectorId: sectorA, accessLevel: 'read' }]);

  convA = await createConversation(sectorA);
  convA2 = await createConversation(sectorA);
  convB = await createConversation(sectorB);
  sectorlessOwned = await createConversation(null, owner.id);
  sectorlessViewer = await createConversation(null, viewer.id);
  kanbanConvA = await createConversation(sectorA);
  kanbanConvB = await createConversation(sectorB);
  kanbanConvMove = await createConversation(sectorA);
  await createMessage(convA, `CONTEUDO-A-${suffix}`);
  await createMessage(convB, `CONTEUDO-B-${suffix}`);
  await createMessage(sectorlessOwned, `CONTEUDO-SEM-SETOR-${suffix}`);

  const suffixContacts = String(Date.now()).slice(-6);
  const [contactRowA] = await db.insert(schema.contacts).values({ name: `P04 A ${suffixContacts}`, phone: `551191${suffixContacts}` }).returning();
  const [contactRowB] = await db.insert(schema.contacts).values({ name: `P04 B ${suffixContacts}`, phone: `551192${suffixContacts}` }).returning();
  const [contactRowFree] = await db.insert(schema.contacts).values({ name: `P04 Livre ${suffixContacts}`, phone: `551193${suffixContacts}` }).returning();
  const [contactRowFreshA] = await db.insert(schema.contacts).values({ name: `P04 Fresh A ${suffixContacts}`, phone: `551194${suffixContacts}` }).returning();
  contactA = contactRowA.id;
  contactB = contactRowB.id;
  contactFree = contactRowFree.id;
  contactFreshA = contactRowFreshA.id;
  createdContactIds.push(contactA, contactB, contactFree, contactFreshA);
  await db.insert(schema.contactSectors).values([
    { contactId: contactA, sectorId: sectorA },
    { contactId: contactB, sectorId: sectorB },
    { contactId: contactFreshA, sectorId: sectorA },
  ]);

  const [taskRowA] = await db.insert(schema.tasks).values({ conversationId: convA, title: `P04 task A ${suffix}`, createdBy: admin.id }).returning();
  const [taskRowB] = await db.insert(schema.tasks).values({ conversationId: convB, title: `P04 task B ${suffix}`, createdBy: admin.id }).returning();
  taskA = taskRowA.id;
  taskB = taskRowB.id;
  createdTaskIds.push(taskA, taskB);

  const [alertRowA] = await db.insert(schema.alerts).values({ conversationId: convA, type: 'system', title: `P04 alert A ${suffix}` }).returning();
  const [alertRowB] = await db.insert(schema.alerts).values({ conversationId: convB, type: 'system', title: `P04 alert B ${suffix}` }).returning();
  alertA = alertRowA.id;
  alertB = alertRowB.id;
  createdAlertIds.push(alertA, alertB);

  const [noteRowA] = await db.insert(schema.internalNotes).values({ conversationId: convA, authorId: admin.id, content: `P04 nota A ${suffix}` }).returning();
  const [noteRowB] = await db.insert(schema.internalNotes).values({ conversationId: convB, authorId: admin.id, content: `P04 nota B ${suffix}` }).returning();
  noteA = noteRowA.id;
  noteB = noteRowB.id;
  createdNoteIds.push(noteA, noteB);

  const [tutor] = await db.insert(schema.tutors).values({ name: `P04 tutor ${suffix}`, phone: `551195${suffixContacts}` }).returning();
  tutorId = tutor.id;
  createdTutorIds.push(tutorId);
  const [patient] = await db.insert(schema.patients).values({ name: `P04 paciente ${suffix}`, species: 'cao', tutorId }).returning();
  patientId = patient.id;
  createdPatientIds.push(patientId);
});

afterAll(async () => {
  for (const client of openSockets.splice(0)) {
    try {
      client.socket.close();
    } catch {
      // socket já encerrado
    }
  }
  realtimeChild?.kill('SIGTERM');
  await wait(300);

  if (db && schema) {
    try {
      for (const alertId of createdAlertIds) {
        await db.delete(schema.alertEvents).where(eq(schema.alertEvents.alertId, alertId));
        await db.delete(schema.alerts).where(eq(schema.alerts.id, alertId));
      }
      for (const noteId of createdNoteIds) {
        await db.delete(schema.internalNotes).where(eq(schema.internalNotes.id, noteId));
      }
      for (const taskId of createdTaskIds) {
        await db.delete(schema.taskStatusHistory).where(eq(schema.taskStatusHistory.taskId, taskId));
        await db.delete(schema.tasks).where(eq(schema.tasks.id, taskId));
      }
      if (createdConversationIds.length > 0) {
        await db.delete(schema.contactTransfers).where(inArray(schema.contactTransfers.conversationId, createdConversationIds));
        await db.delete(schema.messages).where(inArray(schema.messages.conversationId, createdConversationIds));
        await db.delete(schema.conversationStatusHistory).where(inArray(schema.conversationStatusHistory.conversationId, createdConversationIds));
        await db.delete(schema.internalNotes).where(inArray(schema.internalNotes.conversationId, createdConversationIds));
        await db.delete(schema.alerts).where(inArray(schema.alerts.conversationId, createdConversationIds));
        await db.delete(schema.tasks).where(inArray(schema.tasks.conversationId, createdConversationIds));
        await db.delete(schema.conversations).where(inArray(schema.conversations.id, createdConversationIds));
      }
      for (const contactId of createdContactIds) {
        await db.delete(schema.contactSectors).where(eq(schema.contactSectors.contactId, contactId));
      }
      if (createdContactIds.length > 0) {
        await db.delete(schema.contacts).where(inArray(schema.contacts.id, createdContactIds));
      }
      if (createdContactGroupIds.length > 0) {
        await db.delete(schema.contactGroupMembers).where(inArray(schema.contactGroupMembers.groupId, createdContactGroupIds));
        await db.delete(schema.contactGroups).where(inArray(schema.contactGroups.id, createdContactGroupIds));
      }
      if (createdPatientIds.length > 0) {
        await db.delete(schema.patients).where(inArray(schema.patients.id, createdPatientIds));
      }
      if (createdTutorIds.length > 0) {
        await db.delete(schema.tutors).where(inArray(schema.tutors.id, createdTutorIds));
      }
      if (createdUserIds.length > 0) {
        await db.delete(schema.auditLogs).where(inArray(schema.auditLogs.userId, createdUserIds)).catch(() => undefined);
        await db.delete(schema.sessions).where(inArray(schema.sessions.userId, createdUserIds)).catch(() => undefined);
        await db.delete(schema.userRoles).where(inArray(schema.userRoles.userId, createdUserIds)).catch(() => undefined);
        await db.delete(schema.userSectors).where(inArray(schema.userSectors.userId, createdUserIds)).catch(() => undefined);
        await db.delete(schema.users).where(inArray(schema.users.id, createdUserIds)).catch(() => undefined);
      }
      if (createdSectorIds.length > 0) {
        await db.delete(schema.sectors).where(inArray(schema.sectors.id, createdSectorIds));
      }
    } catch (error) {
      writeFileSync(join(LOG_DIR, 'cleanup-error.log'), `${String(error)}\n`);
    }
  }

  writeFileSync(join(EVIDENCE_DIR, 'matrix.json'), `${JSON.stringify({ runId: RUN_ID, database: ctx?.databaseName, probes: matrix }, null, 2)}\n`);

  if (app) {
    await app.close().catch(() => undefined);
  }
  if (databaseModule?.getPool) {
    await databaseModule.getPool().end().catch(() => undefined);
  }
  if (ctx && harness) {
    const teardown = harness.teardownIsolatedEnv(ctx, { stopServices: true, dropDatabase: true });
    writeFileSync(join(LOG_DIR, 'teardown.json'), `${JSON.stringify(teardown, null, 2)}\n`);
  }
});

describe('PROD-04 AC1 — GET /conversations por ação + escopo deny-by-default', () => {
  it('AC1.1 sem role/permissão não há conteúdo (403) em qualquer variante', async () => {
    const noRoleList = await app.inject({ method: 'GET', url: '/conversations', headers: auth(noRole) });
    trackProbe('AC1.1', 'GET', '/conversations', 'no-role', noRoleList.statusCode, [403]);
    expect(noRoleList.statusCode).toBe(403);
    expect(noRoleList.body).not.toContain(`CONTEUDO-A-${suffix}`);

    const noRoleSector = await app.inject({
      method: 'GET', url: `/conversations?sectorId=${sectorA}`, headers: auth(noRole),
    });
    trackProbe('AC1.1', 'GET', '/conversations?sectorId=A', 'no-role', noRoleSector.statusCode, [403]);
    expect(noRoleSector.statusCode).toBe(403);

    const unknownRole = await app.inject({ method: 'GET', url: '/conversations', headers: auth(viewer) });
    trackProbe('AC1.1', 'GET', '/conversations', 'viewer', unknownRole.statusCode, [403]);
    expect(unknownRole.statusCode).toBe(403);
    expect(unknownRole.body).not.toContain(`CONTEUDO-A-${suffix}`);
  });

  it('AC1.2 membro vê só o próprio setor; sem membership a lista é vazia (sem últimas mensagens)', async () => {
    const member = await app.inject({ method: 'GET', url: '/conversations', headers: auth(readerA) });
    trackProbe('AC1.2', 'GET', '/conversations', 'reader-a', member.statusCode, [200]);
    expect(member.statusCode).toBe(200);
    const ids = conversationIds(member.json());
    expect(ids).toContain(convA);
    expect(ids).toContain(convA2);
    expect(ids).not.toContain(convB);
    expect(member.body).toContain(`CONTEUDO-A-${suffix}`);
    expect(member.body).not.toContain(`CONTEUDO-B-${suffix}`);

    const outsiderList = await app.inject({ method: 'GET', url: '/conversations', headers: auth(outsider) });
    trackProbe('AC1.2', 'GET', '/conversations', 'outsider', outsiderList.statusCode, [200]);
    expect(outsiderList.statusCode).toBe(200);
    expect(conversationIds(outsiderList.json())).toHaveLength(0);
    expect(outsiderList.body).not.toContain(`CONTEUDO-A-${suffix}`);
  });

  it('AC1.3 admin global explícito vê todos; setor alheio explícito → 403', async () => {
    const adminList = await app.inject({ method: 'GET', url: '/conversations', headers: auth(admin) });
    trackProbe('AC1.3', 'GET', '/conversations', 'admin', adminList.statusCode, [200]);
    expect(adminList.statusCode).toBe(200);
    const adminIds = conversationIds(adminList.json());
    expect(adminIds).toContain(convA);
    expect(adminIds).toContain(convB);

    const ownSector = await app.inject({ method: 'GET', url: `/conversations?sectorId=${sectorA}`, headers: auth(readerA) });
    trackProbe('AC1.3', 'GET', '/conversations?sectorId=A', 'reader-a', ownSector.statusCode, [200]);
    expect(ownSector.statusCode).toBe(200);

    const foreignSector = await app.inject({ method: 'GET', url: `/conversations?sectorId=${sectorB}`, headers: auth(readerA) });
    trackProbe('AC1.3', 'GET', '/conversations?sectorId=B', 'reader-a', foreignSector.statusCode, [403]);
    expect(foreignSector.statusCode).toBe(403);
  });

  it('AC1.4 cursor continua a página; cursor adulterado → 400', async () => {
    const first = await app.inject({ method: 'GET', url: '/conversations?limit=1', headers: auth(writerAB) });
    trackProbe('AC1.4', 'GET', '/conversations?limit=1', 'writer-ab', first.statusCode, [200]);
    expect(first.statusCode).toBe(200);
    const nextCursor = (first.json() as { nextCursor: string | null }).nextCursor;
    expect(typeof nextCursor).toBe('string');

    const second = await app.inject({
      method: 'GET', url: `/conversations?limit=1&cursor=${encodeURIComponent(nextCursor as string)}`, headers: auth(writerAB),
    });
    trackProbe('AC1.4', 'GET', '/conversations?cursor=...', 'writer-ab', second.statusCode, [200]);
    expect(second.statusCode).toBe(200);

    const tampered = `${(nextCursor as string).slice(0, -4)}AAAA`;
    const invalid = await app.inject({
      method: 'GET', url: `/conversations?cursor=${encodeURIComponent(tampered)}`, headers: auth(writerAB),
    });
    trackProbe('AC1.4', 'GET', '/conversations?cursor=(adulterado)', 'writer-ab', invalid.statusCode, [400]);
    expect(invalid.statusCode).toBe(400);
  });

  it('AC1.5 TOCTOU: membership revogada entre checagem e query → repositório deny-by-default', async () => {
    const before = await repository.findPage({ userId: toctouActor.id }, 50);
    expect(before.items.map((item) => item.id)).toContain(convA);

    await db.delete(schema.userSectors).where(eq(schema.userSectors.userId, toctouActor.id));

    const after = await repository.findPage({ userId: toctouActor.id }, 50);
    expect(after.items).toHaveLength(0);

    const explicitAdmin = await repository.findPage({ userId: toctouActor.id, globalAdmin: true }, 50);
    expect(explicitAdmin.items.map((item) => item.id)).toContain(convA);

    const routeAfter = await app.inject({ method: 'GET', url: '/conversations', headers: auth(toctouActor) });
    trackProbe('AC1.5', 'GET', '/conversations', 'toctou (revogado)', routeAfter.statusCode, [200]);
    expect(routeAfter.statusCode).toBe(200);
    expect(conversationIds(routeAfter.json())).toHaveLength(0);
    expect(routeAfter.body).not.toContain(`CONTEUDO-A-${suffix}`);

    await db.insert(schema.userSectors).values({ userId: toctouActor.id, sectorId: sectorA, accessLevel: 'read' });
  });

  it('AC1.6 revogação de membership reflete na rota seguinte (sem cache)', async () => {
    const before = await app.inject({ method: 'GET', url: '/conversations', headers: auth(revokeListActor) });
    expect(conversationIds(before.json())).toContain(convA);

    await db.delete(schema.userSectors).where(eq(schema.userSectors.userId, revokeListActor.id));
    const after = await app.inject({ method: 'GET', url: '/conversations', headers: auth(revokeListActor) });
    expect(conversationIds(after.json())).toHaveLength(0);

    await db.insert(schema.userSectors).values({ userId: revokeListActor.id, sectorId: sectorA, accessLevel: 'read' });
  });

  it('AC1.7 F5: TOCTOU com sectorId explícito — membership revogada zera a lista do setor', async () => {
    const actor = await createActor('toctou-sector', ['Receptionist'], [
      { sectorId: sectorA, accessLevel: 'read' },
    ]);

    const before = await repository.findPage({ userId: actor.id, sectorId: sectorA }, 50);
    expect(before.items.map((item) => item.id)).toContain(convA);
    expect(before.items.map((item) => item.id)).not.toContain(convB);

    await db.delete(schema.userSectors).where(eq(schema.userSectors.userId, actor.id));

    // F5: mesmo com `sectorId`, o repositório relê memberships e aplica deny.
    const after = await repository.findPage({ userId: actor.id, sectorId: sectorA }, 50);
    expect(after.items).toHaveLength(0);

    // Papel global explícito continua dispensando o filtro (globalAdmin).
    const explicitAdmin = await repository.findPage(
      { userId: actor.id, sectorId: sectorA, globalAdmin: true },
      50,
    );
    expect(explicitAdmin.items.map((item) => item.id)).toContain(convA);

    // A rota (que decide antes da query) nega o setor sem membership.
    const routeAfter = await app.inject({
      method: 'GET', url: `/conversations?sectorId=${sectorA}`, headers: auth(actor),
    });
    trackProbe('AC1.7', 'GET', '/conversations?sectorId=A (membership revogada)', actor.email, routeAfter.statusCode, [403]);
    expect(routeAfter.statusCode).toBe(403);

    await db.insert(schema.userSectors).values({ userId: actor.id, sectorId: sectorA, accessLevel: 'read' });
  });
});

describe('PROD-04 AC2 — matriz de ação+recurso por endpoint', () => {
  it('AC2.1 rotas operacionais de leitura: sem permissão → 403; com papel → 200', async () => {
    const routes: Array<{ label: string; url: string }> = [
      { label: 'conversas', url: '/conversations' },
      { label: 'kanban board', url: '/kanban/board' },
      { label: 'kanban filtros', url: '/kanban/filters' },
      { label: 'tutores lista', url: '/tutors' },
      { label: 'tutores stats', url: '/tutors/stats/overview' },
      { label: 'tutores id', url: `/tutors/${tutorId}` },
      { label: 'pacientes lista', url: '/patients' },
      { label: 'pacientes stats', url: '/patients/stats/overview' },
      { label: 'pacientes id', url: `/patients/${patientId}` },
      { label: 'contatos lista', url: '/contacts' },
      { label: 'contatos stats', url: '/contacts/stats/overview' },
      { label: 'contato id', url: `/contacts/${contactA}` },
      { label: 'tasks lista', url: '/tasks' },
      { label: 'task id', url: `/tasks/${taskA}` },
      { label: 'alerts lista', url: '/alerts' },
      { label: 'alert id', url: `/alerts/${alertA}` },
      { label: 'notes por conversa', url: `/notes?conversationId=${convA}` },
      { label: 'note id', url: `/notes/${noteA}` },
    ];
    for (const route of routes) {
      for (const [actor, expected] of [[noRole, 403], [viewer, 403], [readerA, 200]] as const) {
        const response = await app.inject({ method: 'GET', url: route.url, headers: auth(actor) });
        trackProbe('AC2.1', 'GET', route.url, actor.email, response.statusCode, [expected]);
        expect(response.statusCode, `${route.label} como ${actor.email}`).toBe(expected);
      }
    }
  });

  it('AC2.2 rotas de escrita: sem permissão → 403 antes do efeito', async () => {
    const writes: Array<{ label: string; method: 'POST' | 'PUT' | 'PATCH'; url: string; payload: Record<string, unknown> }> = [
      { label: 'criar tutor', method: 'POST', url: '/tutors', payload: { name: 'P04 negado' } },
      { label: 'criar paciente', method: 'POST', url: '/patients', payload: { name: 'P04 negado' } },
      { label: 'criar contato', method: 'POST', url: '/contacts', payload: { name: 'P04 negado', phone: '5511999990000' } },
      { label: 'atualizar contato', method: 'PUT', url: `/contacts/${contactA}`, payload: { name: 'P04 negado' } },
      { label: 'criar task', method: 'POST', url: '/tasks', payload: { title: 'P04 negado', conversationId: convA } },
      { label: 'criar alert', method: 'POST', url: '/alerts', payload: { type: 'system', title: 'P04 negado' } },
      { label: 'criar nota', method: 'POST', url: '/notes', payload: { content: 'P04 negado', conversationId: convA } },
      { label: 'mover kanban', method: 'PATCH', url: `/kanban/card/${kanbanConvA}/move`, payload: { status: 'pendente' } },
    ];
    for (const write of writes) {
      for (const [actor, expected] of [[noRole, 403], [viewer, 403]] as const) {
        const response = await app.inject({
          method: write.method,
          url: write.url,
          headers: auth(actor),
          payload: write.payload,
        });
        trackProbe('AC2.2', write.method, write.url, actor.email, response.statusCode, [expected]);
        expect(response.statusCode, `${write.label} como ${actor.email}`).toBe(expected);
      }
    }
  });

  it('AC2.3 Kanban: board/filtros por setor e move com origem+destino autorizados', async () => {
    const board = await app.inject({ method: 'GET', url: '/kanban/board', headers: auth(readerA) });
    expect(board.statusCode).toBe(200);
    const boardBody = board.json() as { columns: Array<{ cards: Array<{ id: string }> }> };
    const readerCardIds = boardBody.columns.flatMap((column) => column.cards.map((card) => card.id));
    expect(readerCardIds).toContain(kanbanConvA);
    expect(readerCardIds).not.toContain(kanbanConvB);

    const adminBoard = await app.inject({ method: 'GET', url: '/kanban/board', headers: auth(admin) });
    const adminCardIds = (adminBoard.json() as typeof boardBody).columns.flatMap((column) => column.cards.map((card) => card.id));
    expect(adminCardIds).toContain(kanbanConvB);

    const filters = await app.inject({ method: 'GET', url: '/kanban/filters', headers: auth(readerA) });
    const filterSectors = (filters.json() as { sectors: Array<{ id: string }> }).sectors.map((sector) => sector.id);
    expect(filterSectors).toContain(sectorA);
    expect(filterSectors).not.toContain(sectorB);

    const readOnlyMove = await app.inject({
      method: 'PATCH', url: `/kanban/card/${kanbanConvA}/move`, headers: auth(readerA), payload: { status: 'pendente' },
    });
    trackProbe('AC2.3', 'PATCH', '/kanban/card/:id/move (leitura)', 'reader-a', readOnlyMove.statusCode, [403]);
    expect(readOnlyMove.statusCode).toBe(403);

    const crossMove = await app.inject({
      method: 'PATCH', url: `/kanban/card/${kanbanConvB}/move`, headers: auth(writerA), payload: { status: 'pendente' },
    });
    trackProbe('AC2.3', 'PATCH', '/kanban/card/:id/move (cross)', 'writer-a', crossMove.statusCode, [404]);
    expect(crossMove.statusCode).toBe(404);

    const ownMove = await app.inject({
      method: 'PATCH', url: `/kanban/card/${kanbanConvA}/move`, headers: auth(writerA), payload: { status: 'em_atendimento' },
    });
    trackProbe('AC2.3', 'PATCH', '/kanban/card/:id/move (próprio)', 'writer-a', ownMove.statusCode, [200]);
    expect(ownMove.statusCode).toBe(200);

    // Destino B sem membership → 404 (não revela o setor; deny-by-default);
    // a origem continua exigindo write.
    const foreignDestination = await app.inject({
      method: 'PATCH', url: `/kanban/card/${kanbanConvMove}/move`, headers: auth(writerA), payload: { status: 'novo', sectorId: sectorB },
    });
    trackProbe('AC2.3', 'PATCH', '/kanban/card/:id/move (destino alheio)', 'writer-a', foreignDestination.statusCode, [404]);
    expect(foreignDestination.statusCode).toBe(404);

    const dualDestination = await app.inject({
      method: 'PATCH', url: `/kanban/card/${kanbanConvMove}/move`, headers: auth(writerAB), payload: { status: 'novo', sectorId: sectorB },
    });
    trackProbe('AC2.3', 'PATCH', '/kanban/card/:id/move (destino autorizado)', 'writer-ab', dualDestination.statusCode, [200]);
    expect(dualDestination.statusCode).toBe(200);

    const adminMove = await app.inject({
      method: 'PATCH', url: `/kanban/card/${kanbanConvB}/move`, headers: auth(admin), payload: { status: 'pendente' },
    });
    expect(adminMove.statusCode).toBe(200);
  });

  it('AC2.4 Contatos: lista/detalhe/escrita/start-conversation por vínculo de setor', async () => {
    const list = await app.inject({ method: 'GET', url: '/contacts', headers: auth(readerA) });
    const listIds = (list.json() as Array<{ id: string }>).map((contact) => contact.id);
    expect(listIds).toContain(contactA);
    expect(listIds).toContain(contactFree);
    expect(listIds).not.toContain(contactB);

    const foreignDetail = await app.inject({ method: 'GET', url: `/contacts/${contactB}`, headers: auth(readerA) });
    trackProbe('AC2.4', 'GET', '/contacts/:id (alheio)', 'reader-a', foreignDetail.statusCode, [404]);
    expect(foreignDetail.statusCode).toBe(404);

    const ownUpdate = await app.inject({
      method: 'PUT', url: `/contacts/${contactA}`, headers: auth(writerA), payload: { name: 'P04 contato A atualizado' },
    });
    trackProbe('AC2.4', 'PUT', '/contacts/:id (write)', 'writer-a', ownUpdate.statusCode, [200]);
    expect(ownUpdate.statusCode).toBe(200);

    const readOnlyUpdate = await app.inject({
      method: 'PUT', url: `/contacts/${contactA}`, headers: auth(readerA), payload: { name: 'P04 sem nível' },
    });
    trackProbe('AC2.4', 'PUT', '/contacts/:id (sem nível)', 'reader-a', readOnlyUpdate.statusCode, [403]);
    expect(readOnlyUpdate.statusCode).toBe(403);

    const crossUpdate = await app.inject({
      method: 'PUT', url: `/contacts/${contactB}`, headers: auth(writerA), payload: { name: 'P04 cross' },
    });
    trackProbe('AC2.4', 'PUT', '/contacts/:id (cross)', 'writer-a', crossUpdate.statusCode, [404]);
    expect(crossUpdate.statusCode).toBe(404);

    // D-AUTHZ-01 documentada: contato sem vínculo continua no diretório
    // autenticado — mas agora exige a permissão de ação (chat:write).
    const freeUpdate = await app.inject({
      method: 'PUT', url: `/contacts/${contactFree}`, headers: auth(writerA), payload: { name: 'P04 livre' },
    });
    trackProbe('AC2.4', 'PUT', '/contacts/:id (sem vínculo D-AUTHZ-01)', 'writer-a', freeUpdate.statusCode, [200]);
    expect(freeUpdate.statusCode).toBe(200);

    const readOnlyStart = await app.inject({
      method: 'POST', url: `/contacts/${contactFreshA}/start-conversation`, headers: auth(readerA), payload: { sectorId: sectorA },
    });
    trackProbe('AC2.4', 'POST', '/contacts/:id/start-conversation (sem nível)', 'reader-a', readOnlyStart.statusCode, [403]);
    expect(readOnlyStart.statusCode).toBe(403);

    const noMembershipStart = await app.inject({
      method: 'POST', url: `/contacts/${contactFreshA}/start-conversation`, headers: auth(outsider), payload: { sectorId: sectorA },
    });
    trackProbe('AC2.4', 'POST', '/contacts/:id/start-conversation (sem membership)', 'outsider', noMembershipStart.statusCode, [404]);
    expect(noMembershipStart.statusCode).toBe(404);

    const writeStart = await app.inject({
      method: 'POST', url: `/contacts/${contactFreshA}/start-conversation`, headers: auth(writerA), payload: { sectorId: sectorA },
    });
    trackProbe('AC2.4', 'POST', '/contacts/:id/start-conversation (write)', 'writer-a', writeStart.statusCode, [201]);
    expect(writeStart.statusCode).toBe(201);
    const createdConversation = (writeStart.json() as { conversationId: string }).conversationId;
    createdConversationIds.push(createdConversation);
  });

  it('AC2.5 tasks/alerts/notes: próprias 200, cross-setor 404, listas filtradas', async () => {
    const ownTask = await app.inject({ method: 'GET', url: `/tasks/${taskA}`, headers: auth(readerA) });
    expect(ownTask.statusCode).toBe(200);
    const crossTask = await app.inject({ method: 'GET', url: `/tasks/${taskB}`, headers: auth(readerA) });
    trackProbe('AC2.5', 'GET', '/tasks/:id (cross)', 'reader-a', crossTask.statusCode, [404]);
    expect(crossTask.statusCode).toBe(404);
    const taskList = await app.inject({ method: 'GET', url: '/tasks', headers: auth(readerA) });
    const taskIds = (taskList.json() as Array<{ id: string }>).map((task) => task.id);
    expect(taskIds).toContain(taskA);
    expect(taskIds).not.toContain(taskB);
    const adminTaskList = await app.inject({ method: 'GET', url: '/tasks', headers: auth(admin) });
    expect((adminTaskList.json() as Array<{ id: string }>).map((task) => task.id)).toContain(taskB);

    const ownAlert = await app.inject({ method: 'GET', url: `/alerts/${alertA}`, headers: auth(readerA) });
    expect(ownAlert.statusCode).toBe(200);
    const crossAlert = await app.inject({ method: 'GET', url: `/alerts/${alertB}`, headers: auth(readerA) });
    trackProbe('AC2.5', 'GET', '/alerts/:id (cross)', 'reader-a', crossAlert.statusCode, [404]);
    expect(crossAlert.statusCode).toBe(404);
    const alertList = await app.inject({ method: 'GET', url: '/alerts', headers: auth(readerA) });
    const alertIds = (alertList.json() as Array<{ id: string }>).map((alert) => alert.id);
    expect(alertIds).toContain(alertA);
    expect(alertIds).not.toContain(alertB);

    const ownNote = await app.inject({ method: 'GET', url: `/notes?conversationId=${convA}`, headers: auth(readerA) });
    expect(ownNote.statusCode).toBe(200);
    expect(ownNote.body).toContain(`P04 nota A ${suffix}`);
    const crossNote = await app.inject({ method: 'GET', url: `/notes?conversationId=${convB}`, headers: auth(readerA) });
    trackProbe('AC2.5', 'GET', '/notes?conversationId (cross)', 'reader-a', crossNote.statusCode, [404]);
    expect(crossNote.statusCode).toBe(404);
    expect(crossNote.body).not.toContain(`P04 nota B ${suffix}`);
    const crossNoteId = await app.inject({ method: 'GET', url: `/notes/${noteB}`, headers: auth(readerA) });
    expect(crossNoteId.statusCode).toBe(404);
    expect(crossNoteId.body).not.toContain(`P04 nota B ${suffix}`);
  });

  it('AC2.6 admin: somente admin:read/admin:write; Manager lê e não escreve', async () => {
    const adminReads: Array<{ label: string; url: string }> = [
      { label: 'admin usuarios', url: '/admin/users' },
      { label: 'admin papeis', url: '/admin/roles' },
      { label: 'admin permissoes', url: '/admin/permissions' },
      { label: 'admin dlq', url: '/admin/dead-letters' },
    ];
    for (const route of adminReads) {
      for (const [actor, expected] of [[noRole, 403], [viewer, 403], [readerA, 403], [manager, 200], [admin, 200]] as const) {
        const response = await app.inject({ method: 'GET', url: route.url, headers: auth(actor) });
        trackProbe('AC2.6', 'GET', route.url, actor.email, response.statusCode, [expected]);
        expect(response.statusCode, `${route.label} como ${actor.email}`).toBe(expected);
      }
    }

    const managerWrite = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: auth(manager),
      payload: { name: 'P04 negado', email: `p04.negado.${suffix}@example.com`, password: 'SenhaForte!42' },
    });
    trackProbe('AC2.6', 'POST', '/admin/users (Manager)', 'manager', managerWrite.statusCode, [403]);
    expect(managerWrite.statusCode).toBe(403);
  });

  it('AC2.7 IDs adulterados/inexistentes → 404 sem vazamento', async () => {
    const random = randomUUID();
    const randomMessages = await app.inject({
      method: 'GET', url: `/conversations/${random}/messages`, headers: auth(readerA),
    });
    trackProbe('AC2.7', 'GET', '/conversations/:id/messages (inexistente)', 'reader-a', randomMessages.statusCode, [404]);
    expect(randomMessages.statusCode).toBe(404);

    const crossMessages = await app.inject({
      method: 'GET', url: `/conversations/${convB}/messages`, headers: auth(readerA),
    });
    trackProbe('AC2.7', 'GET', '/conversations/:id/messages (cross)', 'reader-a', crossMessages.statusCode, [404]);
    expect(crossMessages.statusCode).toBe(404);
    expect(crossMessages.body).not.toContain(`CONTEUDO-B-${suffix}`);

    const randomMove = await app.inject({
      method: 'PATCH', url: `/kanban/card/${random}/move`, headers: auth(writerA), payload: { status: 'novo' },
    });
    expect(randomMove.statusCode).toBe(404);

    const randomTask = await app.inject({ method: 'GET', url: `/tasks/${random}`, headers: auth(readerA) });
    expect(randomTask.statusCode).toBe(404);

    const randomAlert = await app.inject({ method: 'GET', url: `/alerts/${random}`, headers: auth(readerA) });
    expect(randomAlert.statusCode).toBe(404);

    const randomContact = await app.inject({ method: 'GET', url: `/contacts/${random}`, headers: auth(readerA) });
    expect(randomContact.statusCode).toBe(404);
  });

  it('AC2.8 listas/estatísticas residuais exigem a permissão de ação', async () => {
    const routes: Array<{ label: string; url: string }> = [
      { label: 'labels', url: '/labels' },
      { label: 'transfers', url: '/transfers' },
      { label: 'contact-groups', url: '/contact-groups' },
      { label: 'setores', url: '/sectors' },
      { label: 'setores stats', url: '/sectors/stats/overview' },
    ];
    for (const route of routes) {
      for (const [actor, expected] of [[noRole, 403], [viewer, 403], [readerA, 200]] as const) {
        const response = await app.inject({ method: 'GET', url: route.url, headers: auth(actor) });
        trackProbe('AC2.8', 'GET', route.url, actor.email, response.statusCode, [expected]);
        expect(response.statusCode, `${route.label} como ${actor.email}`).toBe(expected);
      }
    }
  });

  it('AC2.9 F3: add/remove membro de contact-group exige chat:write além do escopo de grupo', async () => {
    const roleId = await ensureRole(`P04 Group Writer ${suffix}`);
    const actor = await createActor('group-writer', [`P04 Group Writer ${suffix}`], [
      { sectorId: sectorA, accessLevel: 'write' },
    ]);
    const [group] = await db.insert(schema.contactGroups).values({
      name: `P04 Grupo ${suffix}`,
      groupType: 'sector',
      sectorId: sectorA,
    }).returning();
    createdContactGroupIds.push(group.id);

    // F3: sem `chat:write` no banco, a mutação de membro é negada (antes 201).
    const deniedAdd = await app.inject({
      method: 'POST',
      url: `/contact-groups/${group.id}/members`,
      headers: auth(actor),
      payload: { contactId: contactA },
    });
    trackProbe('AC2.9', 'POST', '/contact-groups/:id/members (sem chat:write)', actor.email, deniedAdd.statusCode, [403]);
    expect(deniedAdd.statusCode).toBe(403);

    // Conceder a ação canônica permite; a checagem de grupo/membership continua.
    await grantRolePermission(roleId, 'chat:write');
    const allowedAdd = await app.inject({
      method: 'POST',
      url: `/contact-groups/${group.id}/members`,
      headers: auth(actor),
      payload: { contactId: contactA },
    });
    trackProbe('AC2.9', 'POST', '/contact-groups/:id/members (com chat:write)', actor.email, allowedAdd.statusCode, [201]);
    expect(allowedAdd.statusCode).toBe(201);

    const allowedRemove = await app.inject({
      method: 'DELETE',
      url: `/contact-groups/${group.id}/members/${contactA}`,
      headers: auth(actor),
    });
    trackProbe('AC2.9', 'DELETE', '/contact-groups/:id/members/:contactId (com chat:write)', actor.email, allowedRemove.statusCode, [200]);
    expect(allowedRemove.statusCode).toBe(200);

    // Ator com a ação (mesmo papel no banco) mas sem membership no setor do
    // grupo permanece 404 — o gate de recurso não foi enfraquecido.
    const outsiderActor = await createActor('group-outsider', [`P04 Group Writer ${suffix}`]);
    const foreignAdd = await app.inject({
      method: 'POST',
      url: `/contact-groups/${group.id}/members`,
      headers: auth(outsiderActor),
      payload: { contactId: contactA },
    });
    trackProbe('AC2.9', 'POST', '/contact-groups/:id/members (sem membership)', outsiderActor.email, foreignAdd.statusCode, [404]);
    expect(foreignAdd.statusCode).toBe(404);

    // Revogar a ação volta a negar (fonte efetiva editável).
    await revokeRolePermission(roleId, 'chat:write');
    const revokedAdd = await app.inject({
      method: 'POST',
      url: `/contact-groups/${group.id}/members`,
      headers: auth(actor),
      payload: { contactId: contactA },
    });
    trackProbe('AC2.9', 'POST', '/contact-groups/:id/members (revogado)', actor.email, revokedAdd.statusCode, [403]);
    expect(revokedAdd.statusCode).toBe(403);
  });
});

describe('PROD-04 AC3 — uma fonte efetiva de permissões; 403/404 estáveis', () => {
  it('AC3.1 papel concedido/removido no banco altera a decisão na requisição seguinte', async () => {
    const before = await app.inject({ method: 'GET', url: '/conversations', headers: auth(dynActor) });
    trackProbe('AC3.1', 'GET', '/conversations (sem papel)', 'dyn', before.statusCode, [403]);
    expect(before.statusCode).toBe(403);

    const receptionistRoleId = await ensureRole('Receptionist');
    await db.insert(schema.userRoles).values({ userId: dynActor.id, roleId: receptionistRoleId });
    const granted = await app.inject({ method: 'GET', url: '/conversations', headers: auth(dynActor) });
    trackProbe('AC3.1', 'GET', '/conversations (papel concedido)', 'dyn', granted.statusCode, [200]);
    expect(granted.statusCode).toBe(200);
    expect(conversationIds(granted.json())).toContain(convA);

    await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, dynActor.id));
    const revoked = await app.inject({ method: 'GET', url: '/conversations', headers: auth(dynActor) });
    trackProbe('AC3.1', 'GET', '/conversations (papel removido)', 'dyn', revoked.statusCode, [403]);
    expect(revoked.statusCode).toBe(403);
  });

  it('AC3.2 dois setores com níveis distintos; recurso sem setor exige vínculo/admin', async () => {
    const dualList = await app.inject({ method: 'GET', url: '/conversations', headers: auth(dualAB) });
    const dualIds = conversationIds(dualList.json());
    expect(dualIds).toContain(convA);
    expect(dualIds).toContain(convB);

    const writeB = await app.inject({
      method: 'PATCH', url: `/kanban/card/${kanbanConvB}/move`, headers: auth(dualAB), payload: { status: 'pendente' },
    });
    trackProbe('AC3.2', 'PATCH', '/kanban/card/:id/move (B write)', 'dual-ab', writeB.statusCode, [200]);
    expect(writeB.statusCode).toBe(200);

    const readOnlyA = await app.inject({
      method: 'PATCH', url: `/kanban/card/${kanbanConvA}/move`, headers: auth(dualAB), payload: { status: 'pendente' },
    });
    trackProbe('AC3.2', 'PATCH', '/kanban/card/:id/move (A read)', 'dual-ab', readOnlyA.statusCode, [403]);
    expect(readOnlyA.statusCode).toBe(403);

    const ownerRead = await app.inject({
      method: 'GET', url: `/conversations/${sectorlessOwned}/messages`, headers: auth(owner),
    });
    trackProbe('AC3.2', 'GET', '/conversations/:id/messages (sem setor, dono)', 'owner', ownerRead.statusCode, [200]);
    expect(ownerRead.statusCode).toBe(200);

    const strangerRead = await app.inject({
      method: 'GET', url: `/conversations/${sectorlessOwned}/messages`, headers: auth(readerA),
    });
    trackProbe('AC3.2', 'GET', '/conversations/:id/messages (sem setor, terceiro)', 'reader-a', strangerRead.statusCode, [404]);
    expect(strangerRead.statusCode).toBe(404);

    const adminRead = await app.inject({
      method: 'GET', url: `/conversations/${sectorlessOwned}/messages`, headers: auth(admin),
    });
    expect(adminRead.statusCode).toBe(200);

    const assignedWithoutRole = await app.inject({
      method: 'GET', url: `/conversations/${sectorlessViewer}/messages`, headers: auth(viewer),
    });
    trackProbe('AC3.2', 'GET', '/conversations/:id/messages (dono sem permissão)', 'viewer', assignedWithoutRole.statusCode, [403]);
    expect(assignedWithoutRole.statusCode).toBe(403);
  });

  it('AC3.3 read-only de permissão (Manager) nega notes:write; sem role → 403; sem membership → 404', async () => {
    const managerRead = await app.inject({ method: 'GET', url: `/notes?conversationId=${convA}`, headers: auth(manager) });
    trackProbe('AC3.3', 'GET', '/notes?conversationId (Manager read)', 'manager', managerRead.statusCode, [200]);
    expect(managerRead.statusCode).toBe(200);

    const managerWrite = await app.inject({
      method: 'POST', url: '/notes', headers: auth(manager), payload: { content: 'P04 manager sem write', conversationId: convA },
    });
    trackProbe('AC3.3', 'POST', '/notes (Manager sem notes:write)', 'manager', managerWrite.statusCode, [403]);
    expect(managerWrite.statusCode).toBe(403);

    const noRoleRead = await app.inject({ method: 'GET', url: `/conversations/${convA}/messages`, headers: auth(noRole) });
    trackProbe('AC3.3', 'GET', '/conversations/:id/messages (sem role)', 'no-role', noRoleRead.statusCode, [403]);
    expect(noRoleRead.statusCode).toBe(403);

    const noMembershipRead = await app.inject({ method: 'GET', url: `/conversations/${convA}/messages`, headers: auth(outsider) });
    trackProbe('AC3.3', 'GET', '/conversations/:id/messages (sem membership)', 'outsider', noMembershipRead.statusCode, [404]);
    expect(noMembershipRead.statusCode).toBe(404);

    const readOnlyWrite = await app.inject({
      method: 'POST', url: '/messages', headers: auth(readerA), payload: { conversationId: convA, content: 'P04 sem write' },
    });
    trackProbe('AC3.3', 'POST', '/messages (read-only nível)', 'reader-a', readOnlyWrite.statusCode, [403]);
    expect(readOnlyWrite.statusCode).toBe(403);
  });

  it('AC3.4 admin global explícito e revogação por ID permanecem 403/404 estáveis', async () => {
    const adminCross = await app.inject({ method: 'GET', url: `/conversations/${convB}/messages`, headers: auth(admin) });
    trackProbe('AC3.4', 'GET', '/conversations/:id/messages (admin)', 'admin', adminCross.statusCode, [200]);
    expect(adminCross.statusCode).toBe(200);

    await db.delete(schema.userSectors).where(eq(schema.userSectors.userId, readerA.id));
    const revokedById = await app.inject({ method: 'GET', url: `/conversations/${convA}/messages`, headers: auth(readerA) });
    trackProbe('AC3.4', 'GET', '/conversations/:id/messages (membership revogada)', 'reader-a', revokedById.statusCode, [404]);
    expect(revokedById.statusCode).toBe(404);

    const revokedList = await app.inject({ method: 'GET', url: '/conversations', headers: auth(readerA) });
    expect(conversationIds(revokedList.json())).toHaveLength(0);

    await db.insert(schema.userSectors).values({ userId: readerA.id, sectorId: sectorA, accessLevel: 'read' });
    const restored = await app.inject({ method: 'GET', url: `/conversations/${convA}/messages`, headers: auth(readerA) });
    expect(restored.statusCode).toBe(200);
  });

  it('AC3.5 papel customizado: conceder/revogar role_permissions altera a decisão na hora', async () => {
    const customRoleId = await ensureRole(`P04 Custom Perm ${suffix}`);
    const actor = await createActor('custom-perm', [`P04 Custom Perm ${suffix}`], [
      { sectorId: sectorA, accessLevel: 'read' },
    ]);

    // Papel customizado sem permissão no banco = negado (não há catálogo estático).
    const before = await app.inject({ method: 'GET', url: '/conversations', headers: auth(actor) });
    trackProbe('AC3.5', 'GET', '/conversations (custom sem permissão)', actor.email, before.statusCode, [403]);
    expect(before.statusCode).toBe(403);
    expect(before.body).not.toContain(`CONTEUDO-A-${suffix}`);

    // Conceder chat:read no banco muda a decisão da MESMA sessão/rota.
    await grantRolePermission(customRoleId, 'chat:read');
    const granted = await app.inject({ method: 'GET', url: '/conversations', headers: auth(actor) });
    trackProbe('AC3.5', 'GET', '/conversations (custom com chat:read)', actor.email, granted.statusCode, [200]);
    expect(granted.statusCode).toBe(200);
    expect(conversationIds(granted.json())).toContain(convA);
    expect(granted.body).toContain(`CONTEUDO-A-${suffix}`);

    // Revogar no banco volta a negar sem cache de sessão.
    await revokeRolePermission(customRoleId, 'chat:read');
    const revoked = await app.inject({ method: 'GET', url: '/conversations', headers: auth(actor) });
    trackProbe('AC3.5', 'GET', '/conversations (custom revogado)', actor.email, revoked.statusCode, [403]);
    expect(revoked.statusCode).toBe(403);
    expect(revoked.body).not.toContain(`CONTEUDO-A-${suffix}`);
  });

  it('AC3.6 permissão de escrita no banco altera a decisão de ação (kanban move)', async () => {
    const customRoleId = await ensureRole(`P04 Custom Writer ${suffix}`);
    const actor = await createActor('custom-writer', [`P04 Custom Writer ${suffix}`], [
      { sectorId: sectorA, accessLevel: 'write' },
    ]);
    const [customConv] = await db.insert(schema.conversations).values({
      status: 'open',
      statusV2: 'novo',
      currentHandler: 'bot',
      isActive: true,
      sectorId: sectorA,
    }).returning();
    createdConversationIds.push(customConv.id);

    const denied = await app.inject({
      method: 'PATCH', url: `/kanban/card/${customConv.id}/move`, headers: auth(actor), payload: { status: 'pendente' },
    });
    trackProbe('AC3.6', 'PATCH', '/kanban/card/:id/move (custom sem chat:write)', actor.email, denied.statusCode, [403]);
    expect(denied.statusCode).toBe(403);

    await grantRolePermission(customRoleId, 'chat:write');
    const allowed = await app.inject({
      method: 'PATCH', url: `/kanban/card/${customConv.id}/move`, headers: auth(actor), payload: { status: 'pendente' },
    });
    trackProbe('AC3.6', 'PATCH', '/kanban/card/:id/move (custom com chat:write)', actor.email, allowed.statusCode, [200]);
    expect(allowed.statusCode).toBe(200);

    await revokeRolePermission(customRoleId, 'chat:write');
    const revoked = await app.inject({
      method: 'PATCH', url: `/kanban/card/${customConv.id}/move`, headers: auth(actor), payload: { status: 'novo' },
    });
    trackProbe('AC3.6', 'PATCH', '/kanban/card/:id/move (custom revogado)', actor.email, revoked.statusCode, [403]);
    expect(revoked.statusCode).toBe(403);
  });

  it('AC3.7 revogar permissão de papel built-in no banco também altera a decisão', async () => {
    const managerRoleId = await ensureRole('Manager');
    const before = await app.inject({ method: 'GET', url: '/conversations', headers: auth(manager) });
    trackProbe('AC3.7', 'GET', '/conversations (Manager antes)', manager.email, before.statusCode, [200]);
    expect(before.statusCode).toBe(200);

    await revokeRolePermission(managerRoleId, 'chat:read');
    try {
      const revoked = await app.inject({ method: 'GET', url: '/conversations', headers: auth(manager) });
      trackProbe('AC3.7', 'GET', '/conversations (Manager sem chat:read)', manager.email, revoked.statusCode, [403]);
      expect(revoked.statusCode).toBe(403);
    } finally {
      await grantRolePermission(managerRoleId, 'chat:read');
    }

    const restored = await app.inject({ method: 'GET', url: '/conversations', headers: auth(manager) });
    trackProbe('AC3.7', 'GET', '/conversations (Manager restaurado)', manager.email, restored.statusCode, [200]);
    expect(restored.statusCode).toBe(200);
  });

  it('AC3.8 migration 0025 provisiona built-ins com o catálogo estático vigente', async () => {
    const managerRoleId = await ensureRole('Manager');
    const receptionistRoleId = await ensureRole('Receptionist');
    const links = await db
      .select({ roleId: schema.rolePermissions.roleId, permissionId: schema.rolePermissions.permissionId })
      .from(schema.rolePermissions);
    const permissionsCatalog = await db.select().from(schema.permissions);
    const nameById = new Map(permissionsCatalog.map((permission) => [permission.id, permission.name]));
    const namesFor = (roleId: string) => new Set(
      links.filter((link) => link.roleId === roleId).map((link) => nameById.get(link.permissionId)),
    );

    const managerPermissions = namesFor(managerRoleId);
    expect(managerPermissions).toContain('chat:read');
    expect(managerPermissions).toContain('admin:read');
    expect(managerPermissions).not.toContain('admin:write');
    expect(managerPermissions).not.toContain('chat:delete');

    const receptionistPermissions = namesFor(receptionistRoleId);
    expect(receptionistPermissions).toContain('chat:read');
    expect(receptionistPermissions).toContain('dashboard:read');
    expect(receptionistPermissions).not.toContain('alerts:write');
    expect(receptionistPermissions).not.toContain('admin:read');
  });

  it('AC3.9 F2: papel customizado com chat:read no banco lista com e sem sectorId', async () => {
    const customRoleId = await ensureRole(`P04 Custom Sector ${suffix}`);
    const actor = await createActor('custom-sector', [`P04 Custom Sector ${suffix}`], [
      { sectorId: sectorA, accessLevel: 'read' },
    ]);
    await grantRolePermission(customRoleId, 'chat:read');

    // F2: a variante com `sectorId` chamava authorize() sem permissões e negava
    // um papel customizado com chat:read no banco; agora a fonte efetiva entra
    // em todas as chamadas.
    const withSector = await app.inject({
      method: 'GET', url: `/conversations?sectorId=${sectorA}`, headers: auth(actor),
    });
    trackProbe('AC3.9', 'GET', '/conversations?sectorId=A (custom chat:read)', actor.email, withSector.statusCode, [200]);
    expect(withSector.statusCode).toBe(200);
    expect(conversationIds(withSector.json())).toContain(convA);
    expect(conversationIds(withSector.json())).not.toContain(convB);

    const withoutSector = await app.inject({ method: 'GET', url: '/conversations', headers: auth(actor) });
    trackProbe('AC3.9', 'GET', '/conversations (custom chat:read)', actor.email, withoutSector.statusCode, [200]);
    expect(withoutSector.statusCode).toBe(200);
    expect(conversationIds(withoutSector.json())).toContain(convA);

    await revokeRolePermission(customRoleId, 'chat:read');
    const revokedWithSector = await app.inject({
      method: 'GET', url: `/conversations?sectorId=${sectorA}`, headers: auth(actor),
    });
    trackProbe('AC3.9', 'GET', '/conversations?sectorId=A (custom revogado)', actor.email, revokedWithSector.statusCode, [403]);
    expect(revokedWithSector.statusCode).toBe(403);

    const revokedWithoutSector = await app.inject({ method: 'GET', url: '/conversations', headers: auth(actor) });
    trackProbe('AC3.9', 'GET', '/conversations (custom revogado)', actor.email, revokedWithoutSector.statusCode, [403]);
    expect(revokedWithoutSector.statusCode).toBe(403);
  });

  it('AC3.10 F1: revogar TODAS as permissões do built-in Manager nega mesmo com conjunto vazio', async () => {
    const managerRoleId = await ensureRole('Manager');
    const managerPermissions = await db
      .select({ permissionId: schema.rolePermissions.permissionId })
      .from(schema.rolePermissions)
      .where(eq(schema.rolePermissions.roleId, managerRoleId));
    // A instalação está provisionada (0025/seed): há linhas para o Manager.
    expect(managerPermissions.length).toBeGreaterThan(0);

    try {
      await db.delete(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, managerRoleId));

      // F1: conjunto resolvido vazio + role_permissions com linhas no banco é
      // autoritativo — o catálogo estático NÃO pode reativar o Manager.
      const revoked = await app.inject({ method: 'GET', url: '/conversations', headers: auth(manager) });
      trackProbe('AC3.10', 'GET', '/conversations (Manager sem nenhuma permissão)', manager.email, revoked.statusCode, [403]);
      expect(revoked.statusCode).toBe(403);
      expect(revoked.body).not.toContain(`CONTEUDO-A-${suffix}`);

      const revokedWithSector = await app.inject({
        method: 'GET', url: `/conversations?sectorId=${sectorA}`, headers: auth(manager),
      });
      trackProbe('AC3.10', 'GET', '/conversations?sectorId=A (Manager sem nenhuma permissão)', manager.email, revokedWithSector.statusCode, [403]);
      expect(revokedWithSector.statusCode).toBe(403);
    } finally {
      if (managerPermissions.length > 0) {
        await db
          .insert(schema.rolePermissions)
          .values(managerPermissions.map((permission) => ({ roleId: managerRoleId, permissionId: permission.permissionId })))
          .onConflictDoNothing();
      }
    }

    const restored = await app.inject({ method: 'GET', url: '/conversations', headers: auth(manager) });
    trackProbe('AC3.10', 'GET', '/conversations (Manager restaurado)', manager.email, restored.statusCode, [200]);
    expect(restored.statusCode).toBe(200);
    expect(conversationIds(restored.json())).toContain(convA);
  });
});

describe('PROD-04 AC4 — WS real: ação/recurso na subscription e entrega; revogação ≤5s', () => {
  it('AC4.1 socket real autoriza canal próprio, nega alheio e corta conteúdo após revogação', async () => {
    const realtimePort = await getFreePort();
    const realtimeCwd = join(REPO_ROOT, 'apps', 'realtime-service');
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
        REALTIME_INTERNAL_SECRET: REALTIME_SECRET,
        REDIS_URL: ctx.redisUrl,
        DATABASE_URL: ctx.databaseUrl,
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

    const member = await connectAndAuth(`ws://127.0.0.1:${realtimePort}`, wsMember.token);
    expect(await subscribe(member, `conversation:${convA}`)).toBe('subscribed');
    expect(await subscribe(member, `conversation:${convB}`)).toBe('error');

    // Revogação de membership: o sweep revalida e retira o canal em <=5s.
    const revokedAt = Date.now();
    await db.delete(schema.userSectors).where(eq(schema.userSectors.userId, wsMember.id));
    await waitFor(
      () => member.messages.some((message) => message.event === 'subscription.revoked'),
      5000,
      'subscription.revoked após revogação de membership',
    );
    const revocationMs = Date.now() - revokedAt;
    expect(revocationMs).toBeLessThanOrEqual(5000);

    // Gates HTTP não foram enfraquecidos para alinhar com o WS.
    const httpAfterRevocation = await app.inject({
      method: 'GET', url: `/conversations/${convA}/messages`, headers: auth(wsMember),
    });
    trackProbe('AC4.1', 'GET', '/conversations/:id/messages (pós-revogação WS)', 'ws-member', httpAfterRevocation.statusCode, [404]);
    expect(httpAfterRevocation.statusCode).toBe(404);

    // Revogação de sessão: conexão encerra (4002) em <=5s.
    const sessionClient = await connectAndAuth(`ws://127.0.0.1:${realtimePort}`, wsSession.token);
    expect(await subscribe(sessionClient, `conversation:${convA}`)).toBe('subscribed');
    const sessionRevokedAt = Date.now();
    await db
      .update(schema.sessions)
      .set({ revokedAt: new Date(), revokedReason: 'prod04-integration' })
      .where(eq(schema.sessions.userId, wsSession.id));
    await waitFor(() => sessionClient.closeCode !== undefined, 5000, 'fechamento do socket após revogação de sessão');
    const sessionRevocationMs = Date.now() - sessionRevokedAt;
    expect(sessionRevocationMs).toBeLessThanOrEqual(5000);
    expect(sessionClient.closeCode).toBe(4002);

    const httpAfterSession = await app.inject({ method: 'GET', url: '/auth/me', headers: auth(wsSession) });
    trackProbe('AC4.1', 'GET', '/auth/me (sessão revogada)', 'ws-session', httpAfterSession.statusCode, [401]);
    expect(httpAfterSession.statusCode).toBe(401);

    writeFileSync(join(LOG_DIR, 'ac4-ws.json'), `${JSON.stringify({
      runId: RUN_ID,
      realtimePort,
      membershipRevocationMs: revocationMs,
      sessionRevocationMs,
      closeCode: sessionClient.closeCode,
    }, null, 2)}\n`);
  });
});
