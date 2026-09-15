/**
 * PROD-18 — APIs operacionais transacionais e trilha de auditoria (AC1–AC4).
 *
 * Roda com PostgreSQL + Redis REAIS do harness AAA isolado (marcador
 * `cvg_aaa_*`; nunca o banco do host), app de produção (`buildDeskApiApp`),
 * HTTP pelo `app.inject` (mesmo pipeline de rotas/schema/serialização) e
 * falhas injetadas por TRIGGERS reais no PostgreSQL.
 *
 *   AC1 — nota/tarefa/alerta/transferência/estado/atribuição/handoff são
 *         TRANSACIONAIS: entidade + histórico + auditoria + outbox no mesmo
 *         `tx`; falha em qualquer escrita faz rollback completo; hints só
 *         depois do commit.
 *   AC2 — toda ação sensível grava audit log (ator da sessão, recurso,
 *         antes/depois sem PII, correlação) e a consulta filtra por
 *         ator/recurso/período; matriz completa verificada ao final.
 *   AC3 — autorização por ação+recurso (fonte efetiva), 401/403/404 estáveis,
 *         CAS/transições com 409 e ações repetidas idempotentes.
 *   AC4 — DTOs de filtros/paginação estáveis; concorrência (transferências,
 *         status de tarefa e estado de conversa) converge sem estado
 *         contraditório.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { eq, and } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 600_000 });

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..', '..');
const PROGRAM_DIR = process.env.CVG_PROGRAM_DIR || join(REPO_ROOT, 'docs', 'producao-2026-09-13');
const EVIDENCE_SEGMENT = process.env.CVG_EVIDENCE_SEGMENT?.trim();
const EVIDENCE_DIR = join(
  PROGRAM_DIR,
  'evidencias',
  'prod-18',
  ...(EVIDENCE_SEGMENT ? [EVIDENCE_SEGMENT] : []),
);
const LOG_DIR = join(EVIDENCE_DIR, 'logs');

const RUN_ID = process.env.AAA_RUN_ID || 'prod18';
const WORKER_INDEX = Number(process.env.AAA_WORKER_INDEX || 42);
const password = 'ChatRoutePass!42';
const passwordHash = '$2a$10$UX/LcD/6NKhheDIZmbHyN.a6Hc8SW6ytZ/LCCZW3un3h5vJ9n/1h6';
const suffix = String(Date.now()).slice(-6);

interface RunContext {
  runId: string;
  databaseName: string;
  databaseUrl: string;
  redisUrl: string;
  ports: { postgres: number; redis: number };
}

interface Harness {
  provisionIsolatedEnv: (context: RunContext) => Promise<{ databaseName: string; marker: { runId: string } }>;
  teardownIsolatedEnv: (
    context: RunContext,
    options?: { stopServices?: boolean; dropDatabase?: boolean },
  ) => Record<string, unknown>;
}

interface Actor {
  id: string;
  email: string;
  token: string;
  roles: string[];
}

interface SensitiveAction {
  id: string;
  route: string;
  actor: string;
  httpStatus: number;
  auditAction: string;
  entityType: string;
  entityId: string;
  correlationId: string;
  auditRows: number;
  outboxEventType?: string;
  outboxRows?: number;
}

let ctx: RunContext;
let harness: Pick<Harness, 'teardownIsolatedEnv'>;
let app: FastifyInstance;
type DatabaseModule = typeof import('@cvg/database');
let db: DatabaseModule['db'];
let schema: DatabaseModule['schema'];
let pool: ReturnType<DatabaseModule['getPool']>;

const sensitiveActions: SensitiveAction[] = [];
const createdUserIds: string[] = [];
const createdSectorIds: string[] = [];
const createdConversationIds: string[] = [];

let sectorA = '';
let sectorB = '';
let sectorC = '';

let admin: Actor;
let vetA: Actor;
let vetB: Actor;
let dualAB: Actor;
let assigneeA: Actor;
let noPerm: Actor;

/** ---- infra helpers ---- */

async function count(query: string, params: unknown[] = []): Promise<number> {
  const result = await pool.query<{ n: string }>(query, params);
  return Number(result.rows[0]?.n ?? 0);
}

const FAIL_FUNCTIONS: Array<{ target: string; name: string }> = [];

async function installFailTrigger(target: string, name: string, condition: string): Promise<void> {
  await pool.query(`
    CREATE OR REPLACE FUNCTION ${name}() RETURNS trigger AS $$
    BEGIN
      IF ${condition} THEN
        RAISE EXCEPTION 'prod18-injected failure on ${target}';
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql;
  `);
  await pool.query(`CREATE TRIGGER ${name} BEFORE INSERT ON ${target} FOR EACH ROW EXECUTE FUNCTION ${name}()`);
  FAIL_FUNCTIONS.push({ target, name });
}

async function dropFailTrigger(target: string, name: string): Promise<void> {
  await pool.query(`DROP TRIGGER IF EXISTS ${name} ON ${target}`);
  await pool.query(`DROP FUNCTION IF EXISTS ${name}()`);
  const index = FAIL_FUNCTIONS.findIndex((entry) => entry.name === name);
  if (index >= 0) FAIL_FUNCTIONS.splice(index, 1);
}

async function dropAllFailTriggers(): Promise<void> {
  for (const entry of [...FAIL_FUNCTIONS]) {
    await dropFailTrigger(entry.target, entry.name).catch(() => undefined);
  }
}

function auth(actor: Actor): Record<string, string> {
  return { authorization: `Bearer ${actor.token}` };
}

function withCorrelation(actor: Actor, correlationId: string): Record<string, string> {
  return { ...auth(actor), 'x-correlation-id': correlationId };
}

async function recordSensitive(entry: {
  id: string;
  route: string;
  actor: Actor;
  httpStatus: number;
  auditAction: string;
  entityType: string;
  entityId: string;
  correlationId: string;
  outboxEventType?: string;
}): Promise<void> {
  const auditRows = await count(
    `SELECT count(*)::int AS n FROM audit_logs
     WHERE action = $1 AND entity_type = $2 AND entity_id = $3 AND user_id = $4 AND correlation_id = $5`,
    [entry.auditAction, entry.entityType, entry.entityId, entry.actor.id, entry.correlationId],
  );
  let outboxRows: number | undefined;
  if (entry.outboxEventType) {
    outboxRows = await count(
      `SELECT count(*)::int AS n FROM outbox_events
       WHERE event_type = $1 AND correlation_id = $2`,
      [entry.outboxEventType, entry.correlationId],
    );
  }
  sensitiveActions.push({
    id: entry.id,
    route: entry.route,
    actor: entry.actor.roles.join(',') || 'custom',
    httpStatus: entry.httpStatus,
    auditAction: entry.auditAction,
    entityType: entry.entityType,
    entityId: entry.entityId,
    correlationId: entry.correlationId,
    auditRows,
    outboxEventType: entry.outboxEventType,
    outboxRows,
  });
}

async function ensureRole(name: string): Promise<string> {
  const [existing] = await db.select().from(schema.roles).where(eq(schema.roles.name, name)).limit(1);
  if (existing) return existing.id;
  const [created] = await db.insert(schema.roles).values({ name }).returning();
  return created.id;
}

async function ensurePermission(name: string): Promise<string> {
  const [existing] = await db.select().from(schema.permissions).where(eq(schema.permissions.name, name)).limit(1);
  if (existing) return existing.id;
  const [created] = await db.insert(schema.permissions).values({ name }).returning();
  return created.id;
}

async function grantRolePermissions(roleId: string, names: string[]): Promise<void> {
  for (const name of names) {
    const permissionId = await ensurePermission(name);
    await db.insert(schema.rolePermissions).values({ roleId, permissionId }).onConflictDoNothing();
  }
}

async function revokeRolePermission(roleId: string, name: string): Promise<void> {
  const permissionId = await ensurePermission(name);
  await db.delete(schema.rolePermissions).where(and(
    eq(schema.rolePermissions.roleId, roleId),
    eq(schema.rolePermissions.permissionId, permissionId),
  ));
}

async function createActor(
  label: string,
  roleNames: string[],
  memberships: Array<{ sectorId: string; accessLevel: 'read' | 'write' | 'admin' }> = [],
): Promise<Actor> {
  const id = randomUUID();
  const email = `prod18.${suffix}.${label}@example.com`;
  await db.insert(schema.users).values({ id, name: `PROD18 ${label}`, email, passwordHash, isActive: true });
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

async function createConversation(
  sectorId: string | null,
  contactSuffix: string,
  status: (typeof schema.conversations.$inferInsert)['statusV2'] = 'novo',
  handler: (typeof schema.conversations.$inferInsert)['currentHandler'] = 'bot',
): Promise<{ conversationId: string; contactId: string }> {
  const [contact] = await db.insert(schema.contacts).values({
    name: `PROD18 contato ${contactSuffix}`,
    phone: `+55119${String(Date.now()).slice(-8)}${contactSuffix.slice(-1)}`,
  }).returning();
  const [conversation] = await db.insert(schema.conversations).values({
    contactId: contact.id,
    status: 'open',
    statusV2: status,
    currentHandler: handler,
    isActive: true,
    sectorId: sectorId ?? undefined,
  }).returning();
  createdConversationIds.push(conversation.id);
  return { conversationId: conversation.id, contactId: contact.id };
}

async function createTaskFixture(conversationId: string, title: string): Promise<string> {
  const [task] = await db.insert(schema.tasks).values({
    conversationId,
    title: `PROD18 ${title} ${suffix}`,
    status: 'pending',
    priority: 'medium',
    createdBy: vetA.id,
  }).returning();
  return task.id;
}

async function createAlertFixture(conversationId: string): Promise<string> {
  const [alert] = await db.insert(schema.alerts).values({
    conversationId,
    type: 'system',
    title: `PROD18 alerta ${suffix}`,
    severity: 'info',
    status: 'active',
  }).returning();
  return alert.id;
}

async function contactSectorStatus(contactId: string, sectorId: string): Promise<string | null> {
  const result = await pool.query<{ status: string }>(
    'SELECT status FROM contact_sectors WHERE contact_id = $1 AND sector_id = $2',
    [contactId, sectorId],
  );
  return result.rows[0]?.status ?? null;
}

async function conversationRow(conversationId: string) {
  const [conversation] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, conversationId));
  return conversation;
}

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

  process.env.DATABASE_URL = ctx.databaseUrl;
  // O módulo captura DATABASE_URL ao registrar o pool; importe-o somente
  // depois que o harness provisionar o banco isolado deste run.
  const databaseModule = await import('@cvg/database');
  db = databaseModule.db;
  schema = databaseModule.schema;
  pool = databaseModule.getPool();

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
  process.env.USE_DATABASE_OUTBOX = 'false';

  const appModule = (await import(pathToFileURL(join(REPO_ROOT, 'apps/desk-api/src/app.ts')).href)) as {
    buildDeskApiApp: () => Promise<FastifyInstance>;
  };
  app = await appModule.buildDeskApiApp();
  await app.ready();

  const [a] = await db.insert(schema.sectors).values({
    name: `PROD18 A ${suffix}`, code: `p18a${suffix}`.slice(0, 50), isActive: true,
  }).returning();
  const [b] = await db.insert(schema.sectors).values({
    name: `PROD18 B ${suffix}`, code: `p18b${suffix}`.slice(0, 50), isActive: true,
  }).returning();
  const [c] = await db.insert(schema.sectors).values({
    name: `PROD18 C ${suffix}`, code: `p18c${suffix}`.slice(0, 50), isActive: true,
  }).returning();
  sectorA = a.id;
  sectorB = b.id;
  sectorC = c.id;
  createdSectorIds.push(sectorA, sectorB, sectorC);

  admin = await createActor('admin', ['Admin']);
  vetA = await createActor('vet-a', ['Veterinarian'], [{ sectorId: sectorA, accessLevel: 'write' }]);
  vetB = await createActor('vet-b', ['Veterinarian'], [{ sectorId: sectorB, accessLevel: 'write' }]);
  dualAB = await createActor('dual-ab', ['Receptionist'], [
    { sectorId: sectorA, accessLevel: 'write' },
    { sectorId: sectorB, accessLevel: 'write' },
  ]);
  assigneeA = await createActor('assignee-a', ['Veterinarian'], [{ sectorId: sectorA, accessLevel: 'read' }]);
  noPerm = await createActor('no-perm', [`Prod18NoPerm ${suffix}`], [{ sectorId: sectorA, accessLevel: 'write' }]);
});

afterAll(async () => {
  await dropAllFailTriggers().catch(() => undefined);
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(
    join(EVIDENCE_DIR, 'evidence-matrix.json'),
    `${JSON.stringify(
      {
        runId: RUN_ID,
        workerIndex: WORKER_INDEX,
        database: ctx?.databaseName ?? null,
        generatedAt: new Date().toISOString(),
        sensitiveActions,
        missingAudit: sensitiveActions.filter((entry) => entry.auditRows < 1).map((entry) => entry.id),
        missingOutbox: sensitiveActions
          .filter((entry) => entry.outboxEventType && (entry.outboxRows ?? 0) < 1)
          .map((entry) => entry.id),
      },
      null,
      2,
    )}\n`,
  );
  if (app) await app.close().catch(() => undefined);
  // Encerra o pool ANTES de derrubar os serviços: sem clientes abertos, o
  // drop do banco isolado não gera erro de conexão pendente.
  await pool.end().catch(() => undefined);
  if (ctx) {
    try {
      harness.teardownIsolatedEnv(ctx, { stopServices: true, dropDatabase: true });
    } catch (error) {
      console.error('[prod-18] teardown falhou:', error);
    }
  }
});

describe('PROD-18/AC1 — operações transacionais (entidade+histórico+auditoria+outbox)', () => {
  it('nota: falha na auditoria faz rollback total; sucesso grava as quatro escritas', async () => {
    const { conversationId } = await createConversation(sectorA, 'nota-rollback');
    const correlationId = `prod18-note-${randomUUID()}`;

    await installFailTrigger('audit_logs', 'prod18_fail_note_audit', "NEW.action = 'note.created'");
    try {
      const failed = await app.inject({
        method: 'POST',
        url: '/notes',
        headers: withCorrelation(vetA, correlationId),
        payload: { conversationId, content: 'nota que deve sumir' },
      });
      expect(failed.statusCode).toBe(500);
    } finally {
      await dropFailTrigger('audit_logs', 'prod18_fail_note_audit');
    }

    expect(await count('SELECT count(*)::int AS n FROM internal_notes WHERE conversation_id = $1', [conversationId])).toBe(0);
    expect(await count("SELECT count(*)::int AS n FROM outbox_events WHERE event_type = 'note.created' AND correlation_id = $1", [correlationId])).toBe(0);
    expect(await count("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'note.created' AND correlation_id = $1", [correlationId])).toBe(0);

    const created = await app.inject({
      method: 'POST',
      url: '/notes',
      headers: withCorrelation(vetA, correlationId),
      payload: { conversationId, content: 'nota atômica' },
    });
    expect(created.statusCode).toBe(201);
    const noteId = (created.json() as { id: string }).id;

    expect(await count('SELECT count(*)::int AS n FROM internal_notes WHERE id = $1', [noteId])).toBe(1);
    await recordSensitive({
      id: 'AC1.note.create',
      route: 'POST /notes',
      actor: vetA,
      httpStatus: 201,
      auditAction: 'note.created',
      entityType: 'note',
      entityId: noteId,
      correlationId,
      outboxEventType: 'note.created',
    });
  });

  it('tarefa: falha no outbox faz rollback de status+histórico+auditoria; sucesso grava tudo', async () => {
    const { conversationId } = await createConversation(sectorA, 'task-rollback');
    const created = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers: auth(vetA),
      payload: { conversationId, title: `PROD18 task rollback ${suffix}` },
    });
    expect(created.statusCode).toBe(201);
    const taskId = (created.json() as { id: string }).id;
    expect(await count("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'task.created' AND entity_id = $1", [taskId])).toBe(1);
    expect(await count("SELECT count(*)::int AS n FROM outbox_events WHERE event_type = 'task.created' AND aggregate_id = $1", [taskId])).toBe(1);

    const correlationId = `prod18-task-${randomUUID()}`;
    await installFailTrigger('outbox_events', 'prod18_fail_task_outbox', "NEW.event_type = 'task.status.changed'");
    try {
      const failed = await app.inject({
        method: 'PATCH',
        url: `/tasks/${taskId}/status`,
        headers: withCorrelation(vetA, correlationId),
        payload: { status: 'in_progress', expectedStatus: 'pending' },
      });
      expect(failed.statusCode).toBe(500);
    } finally {
      await dropFailTrigger('outbox_events', 'prod18_fail_task_outbox');
    }

    expect((await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)))[0]?.status).toBe('pending');
    expect(await count('SELECT count(*)::int AS n FROM task_status_history WHERE task_id = $1', [taskId])).toBe(1);
    expect(await count("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'task.status.changed' AND entity_id = $1", [taskId])).toBe(0);
    expect(await count("SELECT count(*)::int AS n FROM outbox_events WHERE event_type = 'task.status.changed' AND aggregate_id = $1", [taskId])).toBe(0);

    const updated = await app.inject({
      method: 'PATCH',
      url: `/tasks/${taskId}/status`,
      headers: withCorrelation(vetA, correlationId),
      payload: { status: 'in_progress', expectedStatus: 'pending', reason: 'triagem' },
    });
    expect(updated.statusCode).toBe(200);
    expect((updated.json() as { status: string; deduplicated: boolean }).deduplicated).toBe(false);
    expect((await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)))[0]?.status).toBe('in_progress');
    expect(await count('SELECT count(*)::int AS n FROM task_status_history WHERE task_id = $1', [taskId])).toBe(2);

    const audit = await pool.query<{ old_value: string; new_value: string }>(
      "SELECT old_value, new_value FROM audit_logs WHERE action = 'task.status.changed' AND entity_id = $1",
      [taskId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(JSON.parse(audit.rows[0]!.old_value)).toEqual({ status: 'pending' });
    expect(JSON.parse(audit.rows[0]!.new_value)).toEqual({ status: 'in_progress' });

    await recordSensitive({
      id: 'AC1.task.status',
      route: 'PATCH /tasks/:id/status',
      actor: vetA,
      httpStatus: 200,
      auditAction: 'task.status.changed',
      entityType: 'task',
      entityId: taskId,
      correlationId,
      outboxEventType: 'task.status.changed',
    });
  });

  it('alerta: create/ack/resolve transacionais, rollback por auditoria e ack repetido idempotente', async () => {
    const { conversationId } = await createConversation(sectorA, 'alert-rollback');
    const created = await app.inject({
      method: 'POST',
      url: '/alerts',
      headers: auth(vetA),
      payload: { conversationId, type: 'system', title: `PROD18 alerta atômico ${suffix}` },
    });
    expect(created.statusCode).toBe(201);
    const alertId = (created.json() as { id: string }).id;
    expect(await count("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'alert.created' AND entity_id = $1", [alertId])).toBe(1);
    expect(await count("SELECT count(*)::int AS n FROM outbox_events WHERE event_type = 'alert.created' AND aggregate_id = $1", [alertId])).toBe(1);

    const correlationId = `prod18-alert-ack-${randomUUID()}`;
    await installFailTrigger('audit_logs', 'prod18_fail_alert_audit', "NEW.action = 'alert.acknowledged'");
    try {
      const failed = await app.inject({
        method: 'POST',
        url: `/alerts/${alertId}/acknowledge`,
        headers: withCorrelation(vetA, correlationId),
        payload: {},
      });
      expect(failed.statusCode).toBe(500);
    } finally {
      await dropFailTrigger('audit_logs', 'prod18_fail_alert_audit');
    }

    expect((await db.select().from(schema.alerts).where(eq(schema.alerts.id, alertId)))[0]?.status).toBe('active');
    expect(await count('SELECT count(*)::int AS n FROM alert_events WHERE alert_id = $1', [alertId])).toBe(1);
    expect(await count("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'alert.acknowledged' AND entity_id = $1", [alertId])).toBe(0);
    expect(await count("SELECT count(*)::int AS n FROM outbox_events WHERE event_type = 'alert.acknowledged' AND aggregate_id = $1", [alertId])).toBe(0);

    const acknowledged = await app.inject({
      method: 'POST',
      url: `/alerts/${alertId}/acknowledge`,
      headers: withCorrelation(vetA, correlationId),
      payload: {},
    });
    expect(acknowledged.statusCode).toBe(200);
    expect(await count('SELECT count(*)::int AS n FROM alert_events WHERE alert_id = $1', [alertId])).toBe(2);
    await recordSensitive({
      id: 'AC1.alert.acknowledge',
      route: 'POST /alerts/:id/acknowledge',
      actor: vetA,
      httpStatus: 200,
      auditAction: 'alert.acknowledged',
      entityType: 'alert',
      entityId: alertId,
      correlationId,
      outboxEventType: 'alert.acknowledged',
    });

    const repeated = await app.inject({
      method: 'POST',
      url: `/alerts/${alertId}/acknowledge`,
      headers: auth(vetA),
      payload: {},
    });
    expect(repeated.statusCode).toBe(200);
    expect((repeated.json() as { deduplicated: boolean }).deduplicated).toBe(true);
    expect(await count('SELECT count(*)::int AS n FROM alert_events WHERE alert_id = $1', [alertId])).toBe(2);
    expect(await count("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'alert.acknowledged' AND entity_id = $1", [alertId])).toBe(1);

    const resolveCorrelation = `prod18-alert-resolve-${randomUUID()}`;
    const resolved = await app.inject({
      method: 'POST',
      url: `/alerts/${alertId}/resolve`,
      headers: withCorrelation(vetA, resolveCorrelation),
      payload: {},
    });
    expect(resolved.statusCode).toBe(200);
    await recordSensitive({
      id: 'AC1.alert.resolve',
      route: 'POST /alerts/:id/resolve',
      actor: vetA,
      httpStatus: 200,
      auditAction: 'alert.resolved',
      entityType: 'alert',
      entityId: alertId,
      correlationId: resolveCorrelation,
      outboxEventType: 'alert.resolved',
    });

    const ackResolved = await app.inject({
      method: 'POST',
      url: `/alerts/${alertId}/acknowledge`,
      headers: auth(vetA),
      payload: {},
    });
    expect(ackResolved.statusCode).toBe(409);
    expect((ackResolved.json() as { error: string }).error).toBe('ALERT_STATE_CONFLICT');
  });

  it('transferência: falha no vínculo faz rollback completo; sucesso aplica tudo numa transação', async () => {
    const { conversationId, contactId } = await createConversation(sectorA, 'transfer-rollback');
    await db.insert(schema.contactSectors).values({ contactId, sectorId: sectorA, status: 'active' });

    const payload = {
      contactId,
      conversationId,
      fromSectorId: sectorA,
      toSectorId: sectorB,
      autoAccept: true,
      reason: 'PROD18 rollback',
    };

    await installFailTrigger('contact_sectors', 'prod18_fail_contact_sector', 'true');
    try {
      const failed = await app.inject({
        method: 'POST',
        url: '/transfers',
        headers: auth(dualAB),
        payload,
      });
      expect(failed.statusCode).toBe(500);
    } finally {
      await dropFailTrigger('contact_sectors', 'prod18_fail_contact_sector');
    }

    expect(await count('SELECT count(*)::int AS n FROM contact_transfers WHERE conversation_id = $1', [conversationId])).toBe(0);
    expect((await conversationRow(conversationId))?.sectorId).toBe(sectorA);
    expect(await contactSectorStatus(contactId, sectorA)).toBe('active');
    expect(await count("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'contact_transfer.accepted' AND entity_id::text IN (SELECT id::text FROM contact_transfers WHERE conversation_id = $1)", [conversationId])).toBe(0);

    const correlationId = `prod18-transfer-${randomUUID()}`;
    const created = await app.inject({
      method: 'POST',
      url: '/transfers',
      headers: withCorrelation(dualAB, correlationId),
      payload,
    });
    expect(created.statusCode).toBe(201);
    const transfer = created.json() as { id: string; status: string };
    expect(transfer.status).toBe('accepted');

    expect((await conversationRow(conversationId))?.sectorId).toBe(sectorB);
    expect(await contactSectorStatus(contactId, sectorA)).toBe('transferred');
    expect(await contactSectorStatus(contactId, sectorB)).toBe('active');

    await recordSensitive({
      id: 'AC1.transfer.create-auto-accept',
      route: 'POST /transfers',
      actor: dualAB,
      httpStatus: 201,
      auditAction: 'contact_transfer.accepted',
      entityType: 'contact_transfer',
      entityId: transfer.id,
      correlationId,
      outboxEventType: 'transfer.accepted',
    });
  });

  it('conversa: estado/atribuição/handoff atômicos com rollback e idempotência', async () => {
    const { conversationId } = await createConversation(sectorA, 'chat-state');

    const stateCorrelation = `prod18-state-${randomUUID()}`;
    const stateChanged = await app.inject({
      method: 'PATCH',
      url: `/conversations/${conversationId}/state`,
      headers: withCorrelation(vetA, stateCorrelation),
      payload: { statusV2: 'em_atendimento', expectedStatusV2: 'novo', reason: 'atendimento iniciado' },
    });
    expect(stateChanged.statusCode).toBe(200);
    expect(await count('SELECT count(*)::int AS n FROM conversation_status_history WHERE conversation_id = $1', [conversationId])).toBe(1);
    await recordSensitive({
      id: 'AC1.conversation.state',
      route: 'PATCH /conversations/:id/state',
      actor: vetA,
      httpStatus: 200,
      auditAction: 'conversation.status.changed',
      entityType: 'conversation',
      entityId: conversationId,
      correlationId: stateCorrelation,
      outboxEventType: 'conversation.status.changed',
    });

    const assignCorrelation = `prod18-assign-${randomUUID()}`;
    await installFailTrigger('audit_logs', 'prod18_fail_assign_audit', "NEW.action = 'conversation.assigned'");
    try {
      const failed = await app.inject({
        method: 'POST',
        url: `/conversations/${conversationId}/assign`,
        headers: withCorrelation(vetA, assignCorrelation),
        payload: { assigneeId: assigneeA.id },
      });
      expect(failed.statusCode).toBe(500);
    } finally {
      await dropFailTrigger('audit_logs', 'prod18_fail_assign_audit');
    }
    expect((await conversationRow(conversationId))?.assignedUserId).toBeNull();
    expect(await count('SELECT count(*)::int AS n FROM conversation_assignments WHERE conversation_id = $1', [conversationId])).toBe(0);
    expect(await count("SELECT count(*)::int AS n FROM outbox_events WHERE event_type = 'conversation.assigned' AND aggregate_id = $1", [conversationId])).toBe(0);

    const assigned = await app.inject({
      method: 'POST',
      url: `/conversations/${conversationId}/assign`,
      headers: withCorrelation(vetA, assignCorrelation),
      payload: { assigneeId: assigneeA.id, expectedAssignedUserId: null },
    });
    expect(assigned.statusCode).toBe(200);
    expect((await conversationRow(conversationId))?.assignedUserId).toBe(assigneeA.id);
    expect(await count('SELECT count(*)::int AS n FROM conversation_assignments WHERE conversation_id = $1', [conversationId])).toBe(1);
    await recordSensitive({
      id: 'AC1.conversation.assign',
      route: 'POST /conversations/:id/assign',
      actor: vetA,
      httpStatus: 200,
      auditAction: 'conversation.assigned',
      entityType: 'conversation',
      entityId: conversationId,
      correlationId: assignCorrelation,
      outboxEventType: 'conversation.assigned',
    });

    const handoffCorrelation = `prod18-handoff-${randomUUID()}`;
    await installFailTrigger('audit_logs', 'prod18_fail_handoff_audit', "NEW.action = 'conversation.handoff'");
    try {
      const failed = await app.inject({
        method: 'POST',
        url: `/conversations/${conversationId}/handoff`,
        headers: withCorrelation(vetA, handoffCorrelation),
        payload: { newHandler: 'human', expectedHandler: 'bot' },
      });
      expect(failed.statusCode).toBe(500);
    } finally {
      await dropFailTrigger('audit_logs', 'prod18_fail_handoff_audit');
    }
    expect((await conversationRow(conversationId))?.currentHandler).toBe('bot');
    expect(await count("SELECT count(*)::int AS n FROM outbox_events WHERE event_type IN ('handoff.requested','handoff.completed') AND aggregate_id = $1", [conversationId])).toBe(0);

    const handedOff = await app.inject({
      method: 'POST',
      url: `/conversations/${conversationId}/handoff`,
      headers: withCorrelation(vetA, handoffCorrelation),
      payload: { newHandler: 'human', expectedHandler: 'bot', reason: 'caso clínico' },
    });
    expect(handedOff.statusCode).toBe(200);
    expect((await conversationRow(conversationId))?.currentHandler).toBe('human');
    expect(await count("SELECT count(*)::int AS n FROM outbox_events WHERE event_type = 'handoff.requested' AND correlation_id = $1", [handoffCorrelation])).toBe(1);
    expect(await count("SELECT count(*)::int AS n FROM outbox_events WHERE event_type = 'handoff.completed' AND correlation_id = $1", [handoffCorrelation])).toBe(1);
    await recordSensitive({
      id: 'AC1.conversation.handoff',
      route: 'POST /conversations/:id/handoff',
      actor: vetA,
      httpStatus: 200,
      auditAction: 'conversation.handoff',
      entityType: 'conversation',
      entityId: conversationId,
      correlationId: handoffCorrelation,
      outboxEventType: 'handoff.completed',
    });

    const repeated = await app.inject({
      method: 'POST',
      url: `/conversations/${conversationId}/handoff`,
      headers: auth(vetA),
      payload: { newHandler: 'human' },
    });
    expect(repeated.statusCode).toBe(200);
    expect((repeated.json() as { deduplicated: boolean }).deduplicated).toBe(true);
    expect(await count("SELECT count(*)::int AS n FROM outbox_events WHERE aggregate_id = $1 AND event_type LIKE 'handoff.%'", [conversationId])).toBe(2);
  });
});

describe('PROD-18/AC2 — trilha de auditoria real e consulta', () => {
  it('consulta filtra por ator, recurso, período e correlação; período inválido → 400', async () => {
    const { conversationId } = await createConversation(sectorA, 'audit-query');
    const correlationId = `prod18-audit-${randomUUID()}`;
    const created = await app.inject({
      method: 'POST',
      url: '/notes',
      headers: withCorrelation(vetA, correlationId),
      payload: { conversationId, content: 'nota para consulta de auditoria' },
    });
    expect(created.statusCode).toBe(201);
    const noteId = (created.json() as { id: string }).id;

    const byActor = await app.inject({
      method: 'GET',
      url: `/audit/logs?userId=${vetA.id}&action=note.created&limit=10`,
      headers: auth(admin),
    });
    expect(byActor.statusCode).toBe(200);
    const actorRows = byActor.json() as Array<{ userId: string; action: string }>;
    expect(actorRows.length).toBeGreaterThan(0);
    expect(actorRows.every((row) => row.userId === vetA.id && row.action === 'note.created')).toBe(true);

    const byResource = await app.inject({
      method: 'GET',
      url: `/audit/logs?entityType=note&entityId=${noteId}`,
      headers: auth(admin),
    });
    expect(byResource.statusCode).toBe(200);
    expect((byResource.json() as Array<{ entityId: string }>).every((row) => row.entityId === noteId)).toBe(true);

    const byCorrelation = await app.inject({
      method: 'GET',
      url: `/audit/logs?correlationId=${correlationId}`,
      headers: auth(admin),
    });
    expect(byCorrelation.statusCode).toBe(200);
    const correlationRows = byCorrelation.json() as Array<{ correlationId: string }>;
    expect(correlationRows).toHaveLength(1);
    expect(correlationRows[0]!.correlationId).toBe(correlationId);

    const start = new Date(Date.now() - 60_000).toISOString();
    const end = new Date(Date.now() + 60_000).toISOString();
    const byPeriod = await app.inject({
      method: 'GET',
      url: `/audit/logs?correlationId=${correlationId}&startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}`,
      headers: auth(admin),
    });
    expect(byPeriod.statusCode).toBe(200);
    expect((byPeriod.json() as unknown[]).length).toBe(1);

    const invalidDate = await app.inject({
      method: 'GET',
      url: '/audit/logs?startDate=not-a-date',
      headers: auth(admin),
    });
    expect(invalidDate.statusCode).toBe(400);
    expect((invalidDate.json() as { error: string }).error).toBe('INVALID_START_DATE');

    const forbidden = await app.inject({
      method: 'GET',
      url: '/audit/logs',
      headers: auth(vetA),
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it('matriz: toda ação sensível registrada tem auditoria do ator da sessão e (quando aplicável) outbox', () => {
    expect(sensitiveActions.length).toBeGreaterThanOrEqual(7);
    expect(sensitiveActions.filter((entry) => entry.auditRows < 1)).toEqual([]);
    expect(
      sensitiveActions
        .filter((entry) => entry.outboxEventType && (entry.outboxRows ?? 0) < 1)
        .map((entry) => entry.id),
    ).toEqual([]);
    expect(new Set(sensitiveActions.map((entry) => entry.id)).size).toBe(sensitiveActions.length);
  });

  it('ações administrativas sensíveis gravam auditoria com ator da sessão e correlação', async () => {
    const createCorrelation = `prod18-admin-create-${randomUUID()}`;
    const email = `prod18.admin.${suffix}.${Date.now()}@example.com`;
    const created = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: withCorrelation(admin, createCorrelation),
      payload: { name: 'PROD18 Admin User', email, password: 'AdminPass!42' },
    });
    expect(created.statusCode).toBe(201);
    const createdUserId = (created.json() as { id: string }).id;
    await recordSensitive({
      id: 'AC2.admin.user.create',
      route: 'POST /admin/users',
      actor: admin,
      httpStatus: 201,
      auditAction: 'admin.user.created',
      entityType: 'user',
      entityId: createdUserId,
      correlationId: createCorrelation,
    });

    const forbiddenRead = await app.inject({ method: 'GET', url: '/admin/users', headers: auth(vetA) });
    expect(forbiddenRead.statusCode).toBe(403);

    const updateCorrelation = `prod18-admin-update-${randomUUID()}`;
    const updated = await app.inject({
      method: 'PUT',
      url: `/admin/users/${createdUserId}`,
      headers: withCorrelation(admin, updateCorrelation),
      payload: { name: 'PROD18 Admin User Renomeado' },
    });
    expect(updated.statusCode).toBe(200);
    await recordSensitive({
      id: 'AC2.admin.user.update',
      route: 'PUT /admin/users/:id',
      actor: admin,
      httpStatus: 200,
      auditAction: 'admin.user.updated',
      entityType: 'user',
      entityId: createdUserId,
      correlationId: updateCorrelation,
    });

    const deleteCorrelation = `prod18-admin-delete-${randomUUID()}`;
    const deleted = await app.inject({
      method: 'DELETE',
      url: `/admin/users/${createdUserId}`,
      headers: withCorrelation(admin, deleteCorrelation),
    });
    expect(deleted.statusCode).toBe(204);
    await recordSensitive({
      id: 'AC2.admin.user.delete',
      route: 'DELETE /admin/users/:id',
      actor: admin,
      httpStatus: 204,
      auditAction: 'admin.user.deleted',
      entityType: 'user',
      entityId: createdUserId,
      correlationId: deleteCorrelation,
    });

    const roleCorrelation = `prod18-admin-role-${randomUUID()}`;
    const roleCreated = await app.inject({
      method: 'POST',
      url: '/admin/roles',
      headers: withCorrelation(admin, roleCorrelation),
      payload: { name: `Prod18Role ${suffix}` },
    });
    expect(roleCreated.statusCode).toBe(201);
    await recordSensitive({
      id: 'AC2.admin.role.create',
      route: 'POST /admin/roles',
      actor: admin,
      httpStatus: 201,
      auditAction: 'admin.role.created',
      entityType: 'role',
      entityId: (roleCreated.json() as { id: string }).id,
      correlationId: roleCorrelation,
    });
  });

  it('revogação da fonte efetiva: remover notes:write nega a ação na requisição seguinte', async () => {
    const { conversationId } = await createConversation(sectorA, 'revogacao');
    const roleName = `Prod18Op ${suffix}`;
    const roleId = await ensureRole(roleName);
    await grantRolePermissions(roleId, ['chat:read', 'chat:write', 'notes:read', 'notes:write']);
    const opActor = await createActor('op-role', [roleName], [{ sectorId: sectorA, accessLevel: 'write' }]);

    const before = await app.inject({
      method: 'POST',
      url: '/notes',
      headers: auth(opActor),
      payload: { conversationId, content: 'antes da revogação' },
    });
    expect(before.statusCode).toBe(201);

    await revokeRolePermission(roleId, 'notes:write');
    const revoked = await app.inject({
      method: 'POST',
      url: '/notes',
      headers: auth(opActor),
      payload: { conversationId, content: 'após a revogação' },
    });
    expect(revoked.statusCode).toBe(403);
    expect(await count('SELECT count(*)::int AS n FROM internal_notes WHERE conversation_id = $1', [conversationId])).toBe(1);

    await grantRolePermissions(roleId, ['notes:write']);
    const restored = await app.inject({
      method: 'POST',
      url: '/notes',
      headers: auth(opActor),
      payload: { conversationId, content: 'permissão restaurada' },
    });
    expect(restored.statusCode).toBe(201);
  });

  it('autores não são falsificáveis: authorId/acknowledgedBy/changedBy divergentes → 400 sem efeito', async () => {
    const { conversationId } = await createConversation(sectorA, 'spoof');

    const noteSpoof = await app.inject({
      method: 'POST',
      url: '/notes',
      headers: auth(vetA),
      payload: { conversationId, content: 'spoof', authorId: vetB.id },
    });
    expect(noteSpoof.statusCode).toBe(400);
    expect(await count('SELECT count(*)::int AS n FROM internal_notes WHERE conversation_id = $1', [conversationId])).toBe(0);

    const taskId = await createTaskFixture(conversationId, 'spoof changedBy');
    const taskSpoof = await app.inject({
      method: 'PATCH',
      url: `/tasks/${taskId}/status`,
      headers: auth(vetA),
      payload: { status: 'in_progress', changedBy: vetB.id },
    });
    expect(taskSpoof.statusCode).toBe(400);

    const alertId = await createAlertFixture(conversationId);
    const alertSpoof = await app.inject({
      method: 'POST',
      url: `/alerts/${alertId}/acknowledge`,
      headers: auth(vetA),
      payload: { acknowledgedBy: vetB.id },
    });
    expect(alertSpoof.statusCode).toBe(400);
    expect((await db.select().from(schema.alerts).where(eq(schema.alerts.id, alertId)))[0]?.status).toBe('active');
  });
});

describe('PROD-18/AC3 — autorização por ação+recurso, CAS e idempotência', () => {
  it('401 sem sessão; 403 sem permissão de ação; 404 sem vínculo (sem vazar recurso)', async () => {
    const { conversationId } = await createConversation(sectorA, 'authz');
    const taskId = await createTaskFixture(conversationId, 'authz');

    const noSession = await Promise.all([
      app.inject({ method: 'PATCH', url: `/conversations/${conversationId}/state`, payload: { statusV2: 'em_atendimento' } }),
      app.inject({ method: 'POST', url: `/conversations/${conversationId}/assign`, payload: { assigneeId: assigneeA.id } }),
      app.inject({ method: 'POST', url: `/conversations/${conversationId}/handoff`, payload: { newHandler: 'human' } }),
      app.inject({ method: 'POST', url: '/notes', payload: { conversationId, content: 'x' } }),
      app.inject({ method: 'PATCH', url: `/tasks/${taskId}/status`, payload: { status: 'in_progress' } }),
      app.inject({ method: 'POST', url: '/transfers', payload: { contactId: randomUUID(), toSectorId: sectorB } }),
      app.inject({ method: 'GET', url: '/audit/logs' }),
    ]);
    expect(noSession.map((response) => response.statusCode)).toEqual([401, 401, 401, 401, 401, 401, 401]);

    const forbidden = await Promise.all([
      app.inject({ method: 'PATCH', url: `/conversations/${conversationId}/state`, headers: auth(noPerm), payload: { statusV2: 'em_atendimento' } }),
      app.inject({ method: 'POST', url: '/notes', headers: auth(noPerm), payload: { conversationId, content: 'x' } }),
      app.inject({ method: 'PATCH', url: `/tasks/${taskId}/status`, headers: auth(noPerm), payload: { status: 'in_progress' } }),
      app.inject({ method: 'POST', url: '/transfers', headers: auth(noPerm), payload: { contactId: randomUUID(), toSectorId: sectorB } }),
    ]);
    expect(forbidden.map((response) => response.statusCode)).toEqual([403, 403, 403, 403]);
    expect((await conversationRow(conversationId))?.statusV2).toBe('novo');
    expect(await count("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'conversation.status.changed' AND entity_id = $1", [conversationId])).toBe(0);

    const crossSector = await Promise.all([
      app.inject({ method: 'PATCH', url: `/conversations/${conversationId}/state`, headers: auth(vetB), payload: { statusV2: 'em_atendimento' } }),
      app.inject({ method: 'POST', url: '/notes', headers: auth(vetB), payload: { conversationId, content: 'cross' } }),
      app.inject({ method: 'GET', url: `/conversations/${conversationId}/messages`, headers: auth(vetB) }),
    ]);
    expect(crossSector.map((response) => response.statusCode)).toEqual([404, 404, 404]);
  });

  it('estado: transição inválida, CAS defasado, atribuição fora do setor e handoff conflitante → 409/400', async () => {
    const { conversationId } = await createConversation(sectorA, 'cas-negatives', 'finalizado');

    const invalid = await app.inject({
      method: 'PATCH',
      url: `/conversations/${conversationId}/state`,
      headers: auth(vetA),
      payload: { statusV2: 'novo', expectedStatusV2: 'finalizado' },
    });
    expect(invalid.statusCode).toBe(409);
    expect((invalid.json() as { error: string }).error).toBe('INVALID_STATUS_TRANSITION');

    const stale = await app.inject({
      method: 'PATCH',
      url: `/conversations/${conversationId}/state`,
      headers: auth(vetA),
      payload: { statusV2: 'em_atendimento', expectedStatusV2: 'novo' },
    });
    expect(stale.statusCode).toBe(409);
    expect((stale.json() as { error: string }).error).toBe('CONVERSATION_STATUS_CONFLICT');

    const badAssignee = await app.inject({
      method: 'POST',
      url: `/conversations/${conversationId}/assign`,
      headers: auth(vetA),
      payload: { assigneeId: vetB.id },
    });
    expect(badAssignee.statusCode).toBe(400);
    expect((badAssignee.json() as { error: string }).error).toBe('INVALID_ASSIGNEE');

    const conflictHandoff = await app.inject({
      method: 'POST',
      url: `/conversations/${conversationId}/handoff`,
      headers: auth(vetA),
      payload: { newHandler: 'human', expectedHandler: 'human' },
    });
    expect(conflictHandoff.statusCode).toBe(409);
    expect((conflictHandoff.json() as { error: string }).error).toBe('CONVERSATION_HANDOFF_CONFLICT');
  });

  it('tarefa: transição inválida → 409 e repetição do mesmo status é idempotente sem duplicar efeitos', async () => {
    const { conversationId } = await createConversation(sectorA, 'task-cas');
    const taskId = await createTaskFixture(conversationId, 'task-cas');

    const toCompleted = await app.inject({
      method: 'PATCH',
      url: `/tasks/${taskId}/status`,
      headers: auth(vetA),
      payload: { status: 'completed', expectedStatus: 'pending' },
    });
    expect(toCompleted.statusCode).toBe(200);

    const invalid = await app.inject({
      method: 'PATCH',
      url: `/tasks/${taskId}/status`,
      headers: auth(vetA),
      payload: { status: 'pending', expectedStatus: 'completed' },
    });
    expect(invalid.statusCode).toBe(409);
    expect((invalid.json() as { error: string }).error).toBe('INVALID_TASK_STATUS_TRANSITION');

    const repeated = await app.inject({
      method: 'PATCH',
      url: `/tasks/${taskId}/status`,
      headers: auth(vetA),
      payload: { status: 'completed' },
    });
    expect(repeated.statusCode).toBe(200);
    expect((repeated.json() as { deduplicated: boolean }).deduplicated).toBe(true);
    expect(await count('SELECT count(*)::int AS n FROM task_status_history WHERE task_id = $1', [taskId])).toBe(1);
    expect(await count("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'task.status.changed' AND entity_id = $1", [taskId])).toBe(1);
    expect(await count("SELECT count(*)::int AS n FROM outbox_events WHERE event_type = 'task.status.changed' AND aggregate_id = $1", [taskId])).toBe(1);
  });
});

describe('PROD-18/AC4 — concorrência e DTOs de filtros/paginação', () => {
  it('duas mudanças simultâneas de estado da mesma conversa: uma vence, a outra 409, sem histórico duplicado', async () => {
    const { conversationId } = await createConversation(sectorA, 'state-race');

    const [first, second] = await Promise.all([
      app.inject({
        method: 'PATCH',
        url: `/conversations/${conversationId}/state`,
        headers: auth(vetA),
        payload: { statusV2: 'em_atendimento', expectedStatusV2: 'novo' },
      }),
      app.inject({
        method: 'PATCH',
        url: `/conversations/${conversationId}/state`,
        headers: auth(vetA),
        payload: { statusV2: 'pendente', expectedStatusV2: 'novo' },
      }),
    ]);

    const statuses = [first.statusCode, second.statusCode].sort();
    expect(statuses).toEqual([200, 409]);
    const finalConversation = await conversationRow(conversationId);
    expect(['em_atendimento', 'pendente']).toContain(finalConversation?.statusV2);
    expect(await count('SELECT count(*)::int AS n FROM conversation_status_history WHERE conversation_id = $1', [conversationId])).toBe(1);
    expect(await count("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'conversation.status.changed' AND entity_id = $1", [conversationId])).toBe(1);
    expect(await count("SELECT count(*)::int AS n FROM outbox_events WHERE event_type = 'conversation.status.changed' AND aggregate_id = $1", [conversationId])).toBe(1);
  });

  it('duas mudanças simultâneas de status da mesma tarefa: uma vence, a outra 409, sem efeito duplicado', async () => {
    const { conversationId } = await createConversation(sectorA, 'task-race');
    const taskId = await createTaskFixture(conversationId, 'task-race');

    const [first, second] = await Promise.all([
      app.inject({
        method: 'PATCH',
        url: `/tasks/${taskId}/status`,
        headers: auth(vetA),
        payload: { status: 'in_progress', expectedStatus: 'pending' },
      }),
      app.inject({
        method: 'PATCH',
        url: `/tasks/${taskId}/status`,
        headers: auth(vetA),
        payload: { status: 'cancelled', expectedStatus: 'pending' },
      }),
    ]);

    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 409]);
    const finalTask = (await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)))[0];
    expect(['in_progress', 'cancelled']).toContain(finalTask?.status);
    expect(await count('SELECT count(*)::int AS n FROM task_status_history WHERE task_id = $1', [taskId])).toBe(1);
    expect(await count("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'task.status.changed' AND entity_id = $1", [taskId])).toBe(1);
    expect(await count("SELECT count(*)::int AS n FROM outbox_events WHERE event_type = 'task.status.changed' AND aggregate_id = $1", [taskId])).toBe(1);
  });

  it('duas transferências simultâneas do mesmo contato para setores distintos convergem (uma 201, uma 409)', async () => {
    const { conversationId, contactId } = await createConversation(sectorA, 'transfer-race');
    await db.insert(schema.contactSectors).values({ contactId, sectorId: sectorA, status: 'active' });

    const base = { contactId, conversationId, fromSectorId: sectorA, autoAccept: true };
    const [toB, toC] = await Promise.all([
      app.inject({ method: 'POST', url: '/transfers', headers: auth(dualAB), payload: { ...base, toSectorId: sectorB } }),
      app.inject({ method: 'POST', url: '/transfers', headers: auth(admin), payload: { ...base, toSectorId: sectorC } }),
    ]);

    expect([toB.statusCode, toC.statusCode].sort()).toEqual([201, 409]);
    const finalConversation = await conversationRow(conversationId);
    expect([sectorB, sectorC]).toContain(finalConversation?.sectorId);
    const acceptedCount = await count('SELECT count(*)::int AS n FROM contact_transfers WHERE conversation_id = $1 AND status = $2', [conversationId, 'accepted']);
    expect(acceptedCount).toBe(1);
    const activeLinks = await count("SELECT count(*)::int AS n FROM contact_sectors WHERE contact_id = $1 AND status = 'active'", [contactId]);
    expect(activeLinks).toBe(1);
    const activeSector = (await pool.query<{ sector_id: string }>(
      "SELECT sector_id FROM contact_sectors WHERE contact_id = $1 AND status = 'active'",
      [contactId],
    )).rows[0]?.sector_id;
    expect(activeSector).toBe(finalConversation?.sectorId);
    expect(await count("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'contact_transfer.accepted' AND entity_id::text IN (SELECT id::text FROM contact_transfers WHERE conversation_id = $1)", [conversationId])).toBe(1);
  });

  it('aceite concorrente da mesma transferência pendente não duplica efeito', async () => {
    const { conversationId, contactId } = await createConversation(sectorA, 'transfer-accept-race');
    await db.insert(schema.contactSectors).values({ contactId, sectorId: sectorA, status: 'active' });

    const created = await app.inject({
      method: 'POST',
      url: '/transfers',
      headers: auth(dualAB),
      payload: { contactId, conversationId, fromSectorId: sectorA, toSectorId: sectorB, autoAccept: false },
    });
    expect(created.statusCode).toBe(201);
    const transferId = (created.json() as { id: string }).id;

    const [first, second] = await Promise.all([
      app.inject({ method: 'POST', url: `/transfers/${transferId}/accept`, headers: auth(dualAB) }),
      app.inject({ method: 'POST', url: `/transfers/${transferId}/accept`, headers: auth(admin) }),
    ]);

    const accepted = [first.statusCode, second.statusCode].filter((status) => status === 200).length;
    expect(accepted).toBeGreaterThanOrEqual(1);
    expect([first.statusCode, second.statusCode].every((status) => status === 200 || status === 409)).toBe(true);
    const finalTransfer = (await db.select().from(schema.contactTransfers).where(eq(schema.contactTransfers.id, transferId)))[0];
    expect(finalTransfer?.status).toBe('accepted');
    expect(await count("SELECT count(*)::int AS n FROM audit_logs WHERE action = 'contact_transfer.accepted' AND entity_id = $1", [transferId])).toBe(1);
    expect(await count("SELECT count(*)::int AS n FROM outbox_events WHERE event_type = 'transfer.accepted' AND aggregate_id = $1", [transferId])).toBe(1);
    expect((await conversationRow(conversationId))?.sectorId).toBe(sectorB);
    expect(await count("SELECT count(*)::int AS n FROM contact_sectors WHERE contact_id = $1 AND status = 'active'", [contactId])).toBe(1);
  });

  it('DTOs de listagem: limite/offset estáveis e ordem total por createdAt desc, id desc', async () => {
    const { conversationId } = await createConversation(sectorA, 'pagination');
    for (const content of ['p1', 'p2', 'p3']) {
      const response = await app.inject({
        method: 'POST',
        url: '/notes',
        headers: auth(vetA),
        payload: { conversationId, content },
      });
      expect(response.statusCode).toBe(201);
    }

    const firstPage = await app.inject({
      method: 'GET',
      url: `/notes?conversationId=${conversationId}&limit=2&offset=0`,
      headers: auth(vetA),
    });
    const secondPage = await app.inject({
      method: 'GET',
      url: `/notes?conversationId=${conversationId}&limit=2&offset=2`,
      headers: auth(vetA),
    });
    expect(firstPage.statusCode).toBe(200);
    expect(secondPage.statusCode).toBe(200);
    const pageOne = firstPage.json() as Array<{ id: string; createdAt: string }>;
    const pageTwo = secondPage.json() as Array<{ id: string; createdAt: string }>;
    expect(pageOne).toHaveLength(2);
    expect(pageTwo).toHaveLength(1);

    const repeat = await app.inject({
      method: 'GET',
      url: `/notes?conversationId=${conversationId}&limit=2&offset=0`,
      headers: auth(vetA),
    });
    expect((repeat.json() as Array<{ id: string }>).map((note) => note.id)).toEqual(pageOne.map((note) => note.id));

    const full = [...pageOne, ...pageTwo];
    for (let index = 1; index < full.length; index += 1) {
      const previous = full[index - 1]!;
      const current = full[index]!;
      const previousKey = `${previous.createdAt}|${previous.id}`;
      const currentKey = `${current.createdAt}|${current.id}`;
      expect(previousKey >= currentKey).toBe(true);
    }

    const overLimit = await app.inject({
      method: 'GET',
      url: `/notes?conversationId=${conversationId}&limit=5000`,
      headers: auth(vetA),
    });
    expect(overLimit.statusCode).toBe(400);

    const auditPage = await app.inject({
      method: 'GET',
      url: `/audit/logs?limit=5&offset=0`,
      headers: auth(admin),
    });
    expect(auditPage.statusCode).toBe(200);
    const auditRepeat = await app.inject({
      method: 'GET',
      url: `/audit/logs?limit=5&offset=0`,
      headers: auth(admin),
    });
    expect((auditRepeat.json() as Array<{ id: string }>).map((row) => row.id))
      .toEqual((auditPage.json() as Array<{ id: string }>).map((row) => row.id));
  });
});
