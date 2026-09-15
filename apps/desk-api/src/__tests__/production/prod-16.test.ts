/**
 * PROD-16 — fechar escopo de privacidade e política por cópia (BK13/BE20/BE05/BE19/C08/D02).
 *
 * Prova real em PostgreSQL ISOLADO do harness AAA (run `prod16`, worker 25,
 * `cvg_aaa_prod16_w25`), com HTTP real via `app.inject` do app de produção
 * (`buildDeskApiApp`) e o módulo `@cvg/privacy` de produção. Nunca usa o banco
 * do host; o runner `scripts/production/run-integration-isolated.mjs` recusa
 * URL sem marcador isolado.
 *
 *   AC1 — consulta/retomada/cancelamento de operação revalidam ator+escopo
 *         ATUAIS (memberships/permissões efetivas D01): operação de outro
 *         setor responde 404 sem relatório/existência; requestId fica
 *         vinculado a ator+contato+modo+escopo e reuso divergente responde
 *         409 SEM relatório alheio; revogação no meio bloqueia a retomada.
 *   AC2 — exportação/eliminação por cópia/escopo consistente: artefatos de
 *         mídia via media-copy-port, redaction, residual scan e checkpoints no
 *         relatório; dry-run não muta; execução irreversível exige confirmação
 *         explícita e é auditada; recusas auditadas sem PII.
 *   AC3 — política por cópia inventariada (finalidade/retenção/ações) e
 *         aplicada de forma testável; D02 permanece OPEN: defaults dry-run e
 *         eliminação definitiva/backup declarados como residual/BLOCKED.
 *   AC4 — casos negativos reais HTTP+PG no runner isolado, com evidência
 *         estruturada em docs/producao-2026-09-13/evidencias/prod-16/.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RunContext } from '../../../../../e2e/support/aaa/run-context.ts';

vi.mock('@cvg/secretary-adapter', () => ({
  triggerHandoff: vi.fn().mockResolvedValue(undefined),
  invokeSecretary: vi.fn().mockResolvedValue({ isErr: () => true, isOk: () => false }),
}));
vi.mock('../../../../../modules/chat/src/application/events/chat-publisher.ts', () => ({
  publishMessagePersisted: vi.fn().mockResolvedValue(undefined),
  publishConversationCreated: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@cvg/gateway-adapter', () => ({
  registerGatewayRoutes: vi.fn().mockResolvedValue(undefined),
  gatewayService: {
    sendOutbound: vi.fn().mockResolvedValue({ success: true, messageId: 'prod16-gw-mock' }),
    healthCheck: vi.fn().mockResolvedValue(true),
    getInstanceStatus: vi.fn().mockResolvedValue(null),
  },
  mediaService: {
    sendText: vi.fn().mockResolvedValue({ success: true, messageId: 'mock-text' }),
    sendImage: vi.fn().mockResolvedValue({ success: true, messageId: 'mock-image' }),
    sendAudio: vi.fn().mockResolvedValue({ success: true, messageId: 'mock-audio' }),
    sendDocument: vi.fn().mockResolvedValue({ success: true, messageId: 'mock-document' }),
  },
}));

interface PgQueryResult<R> {
  rows: R[];
  rowCount: number | null;
}

interface PgClientLike {
  query<R = Record<string, unknown>>(text: string, values?: unknown[]): Promise<PgQueryResult<R>>;
  end(): Promise<void>;
}

interface PgRuntime {
  Pool: new (config: { connectionString: string; max?: number }) => PgClientLike;
}

interface Harness {
  teardownIsolatedEnv: (
    ctx: RunContext,
    options?: { stopServices?: boolean; dropDatabase?: boolean },
  ) => Record<string, unknown>;
}

interface Actor {
  id: string;
  email: string;
  token: string;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../../..');
const PROGRAM_DIR = process.env.CVG_PROGRAM_DIR || join(REPO_ROOT, 'docs', 'producao-2026-09-13');
const EVIDENCE_SEGMENT = process.env.CVG_EVIDENCE_SEGMENT?.trim();
const EVIDENCE_DIR = join(
  PROGRAM_DIR,
  'evidencias',
  'prod-16',
  ...(EVIDENCE_SEGMENT ? [EVIDENCE_SEGMENT] : []),
);
const MIGRATIONS_DIR = join(REPO_ROOT, 'packages', 'database', 'supabase', 'migrations');
const RUN_ID = process.env.AAA_RUN_ID || 'prod16';
const WORKER_INDEX = Number(process.env.AAA_WORKER_INDEX || '25');
const PASSWORD = 'Str0ngPass!42';
const PASSWORD_HASH = '$2a$10$QMxMJ8QfVxjH93DvTDs2m.OVuALoBBR6S9d58BwIPb8rcXHsUBJWC';

process.env.CVG_PROGRAM_DIR = PROGRAM_DIR;
process.env.CVG_RUNTIME_DIR = process.env.CVG_RUNTIME_DIR || join(EVIDENCE_DIR, 'runtime');
process.env.AAA_RUN_ID = RUN_ID;
process.env.AAA_WORKER_INDEX = String(WORKER_INDEX);
process.env.NODE_ENV = 'test';
process.env.DESK_ENV = 'test';
process.env.USE_DATABASE_OUTBOX = 'false';
process.env.REALTIME_POLL_INTERVAL_MS = '600000';
process.env.RATE_LIMIT_MAX = '100000';
// O DATABASE_URL só é definido após provisionar o PG isolado (nunca o host).
delete process.env.DATABASE_URL;

vi.setConfig({ testTimeout: 180_000, hookTimeout: 600_000 });

const evidence: Array<Record<string, unknown>> = [];

function writeEvidenceJson(name: string, value: unknown): void {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(join(EVIDENCE_DIR, name), `${JSON.stringify(value, null, 2)}\n`);
}

let ctx: RunContext;
let isolatedEnv: { databaseName: string; databaseUrl: string; marker: { runId: string } };
let pg: PgRuntime;
let harness: Harness;
let pool: PgClientLike;
let app: FastifyInstance | null = null;
let databaseModulePool: { end(): Promise<void> } | undefined;
let privacy: typeof import('../../../../../modules/privacy/src/index.ts');

const created = {
  users: [] as string[],
  sectors: [] as string[],
  contacts: [] as string[],
  conversations: [] as string[],
  messages: [] as string[],
  notes: [] as string[],
  outbox: [] as string[],
  dlq: [] as string[],
  media: [] as string[],
  audits: [] as string[],
};

let sectorA = '';
let sectorB = '';
let admin!: Actor;
let managerA!: Actor;
let operatorA!: Actor;
let operatorA2!: Actor;
let operatorB!: Actor;

interface ContactFixture {
  id: string;
  phone: string;
  name: string;
  email: string;
  externalId: string;
}

const fixtures = new Map<string, ContactFixture>();
const convByLabel = new Map<string, string>();
const presentObjects = new Set<string>();
const deletedObjects: string[] = [];

function identifiersOf(fixture: ContactFixture) {
  return {
    phone: fixture.phone,
    name: fixture.name,
    email: fixture.email,
    externalId: fixture.externalId,
  };
}

async function q<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
  const result = await pool.query<T>(text, values);
  return result.rows;
}

async function q1<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T | undefined> {
  return (await q<T>(text, values))[0];
}

async function createSector(label: string): Promise<string> {
  const suffix = randomUUID().slice(0, 8);
  const [row] = await q<{ id: string }>(
    'INSERT INTO sectors (name, code) VALUES ($1, $2) RETURNING id',
    [`PROD16 ${label} ${suffix}`, `prod16${label}${suffix}`],
  );
  created.sectors.push(row.id);
  return row.id;
}

async function ensureRole(name: string): Promise<string> {
  await q('INSERT INTO roles (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [name]);
  const row = await q1<{ id: string }>('SELECT id FROM roles WHERE name = $1', [name]);
  if (!row) throw new Error(`papel ausente: ${name}`);
  return row.id;
}

async function ensurePermission(name: string): Promise<string> {
  await q('INSERT INTO permissions (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [name]);
  const row = await q1<{ id: string }>('SELECT id FROM permissions WHERE name = $1', [name]);
  if (!row) throw new Error(`permissão ausente: ${name}`);
  return row.id;
}

async function grant(roleName: string, permissionNames: string[]): Promise<string> {
  const roleId = await ensureRole(roleName);
  for (const name of permissionNames) {
    const permissionId = await ensurePermission(name);
    await q(
      'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT (role_id, permission_id) DO NOTHING',
      [roleId, permissionId],
    );
  }
  return roleId;
}

async function createActor(
  label: string,
  role: string,
  memberships: Array<{ sectorId: string; accessLevel: 'read' | 'write' }> = [],
): Promise<Actor> {
  const id = randomUUID();
  const email = `prod16.${label}.${Date.now()}.${id.slice(0, 6)}@example.com`;
  await q(
    'INSERT INTO users (id, name, email, password_hash, is_active) VALUES ($1, $2, $3, $4, true)',
    [id, `PROD-16 ${label}`, email, PASSWORD_HASH],
  );
  created.users.push(id);
  const row = await q1<{ id: string }>('SELECT id FROM roles WHERE name = $1', [role]);
  if (!row) throw new Error(`papel ${role} ausente`);
  await q('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, row.id]);
  for (const membership of memberships) {
    await q(
      'INSERT INTO user_sectors (user_id, sector_id, access_level) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [id, membership.sectorId, membership.accessLevel],
    );
  }
  const response = await app!.inject({ method: 'POST', url: '/auth/login', payload: { email, password: PASSWORD } });
  if (response.statusCode !== 200) throw new Error(`login falhou para ${label}: ${response.statusCode} ${response.body}`);
  return { id, email, token: (response.json() as { token: string }).token };
}

async function createContact(label: string): Promise<ContactFixture> {
  const suffix = randomUUID().slice(0, 6);
  const fixture: ContactFixture = {
    id: randomUUID(),
    phone: `+55119016${suffix.replace(/\D/g, '0')}`,
    name: `Titular ${label} 16`,
    email: `prod16.${label}.${suffix}@example.com`,
    externalId: `EXT-PROD16-${label}-${suffix}`,
  };
  await q(
    'INSERT INTO contacts (id, phone, name, email, external_id) VALUES ($1, $2, $3, $4, $5)',
    [fixture.id, fixture.phone, fixture.name, fixture.email, fixture.externalId],
  );
  created.contacts.push(fixture.id);
  fixtures.set(label, fixture);
  return fixture;
}

async function createConversation(contactId: string, sectorId: string): Promise<string> {
  const [row] = await q<{ id: string }>(
    `INSERT INTO conversations (contact_id, status, status_v2, current_handler, is_active, sector_id)
     VALUES ($1, 'open', 'novo', 'bot', true, $2) RETURNING id`,
    [contactId, sectorId],
  );
  created.conversations.push(row.id);
  return row.id;
}

async function insertMessage(input: {
  conversationId: string;
  direction: 'inbound' | 'outbound';
  content: string;
  sender?: string;
  recipient?: string;
}): Promise<string> {
  const [row] = await q<{ id: string }>(
    `INSERT INTO messages (conversation_id, direction, content, sender, recipient, external_message_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      input.conversationId,
      input.direction,
      input.content,
      input.sender ?? null,
      input.recipient ?? null,
      `prod16-${randomUUID()}`,
    ],
  );
  created.messages.push(row.id);
  return row.id;
}

async function insertNote(conversationId: string, authorId: string, content: string): Promise<string> {
  const [row] = await q<{ id: string }>(
    `INSERT INTO internal_notes (conversation_id, author_id, content, reference_type, reference_id)
     VALUES ($1, $2, $3, 'conversation', $1) RETURNING id`,
    [conversationId, authorId, content],
  );
  created.notes.push(row.id);
  return row.id;
}

async function insertOutbox(aggregateId: string, payload: object): Promise<{ id: string; eventId: string }> {
  const eventId = `prod16-${randomUUID()}`;
  const [row] = await q<{ id: string }>(
    `INSERT INTO outbox_events (event_id, event_type, aggregate_type, aggregate_id, occurred_at, payload)
     VALUES ($1, 'message.persisted', 'message', $2, NOW(), $3) RETURNING id`,
    [eventId, aggregateId, JSON.stringify(payload)],
  );
  created.outbox.push(row.id);
  return { id: row.id, eventId };
}

async function insertDlq(originalEventId: string, payload: object, errorMessage: string): Promise<string> {
  const [row] = await q<{ id: string }>(
    `INSERT INTO dead_letter_events (original_event_id, consumer_id, event_type, payload, error_code, error_message)
     VALUES ($1, 'prod16-consumer', 'message.persisted', $2, 'SYNTHETIC', $3) RETURNING id`,
    [originalEventId, JSON.stringify(payload), errorMessage],
  );
  created.dlq.push(row.id);
  return row.id;
}

async function insertMedia(messageId: string, storageKey: string, filename: string): Promise<string> {
  const [row] = await q<{ id: string }>(
    `INSERT INTO media_assets (message_id, storage_driver, storage_bucket, storage_key, sha256, mime_type, size_bytes,
       filename, scan_status, storage_status, retention_until)
     VALUES ($1, 's3', 'prod16-bucket', $2, $3, 'application/pdf', 128, $4, 'CLEAN', 'STORED', NOW() + INTERVAL '30 days')
     RETURNING id`,
    [messageId, storageKey, 'a'.repeat(64), filename],
  );
  created.media.push(row.id);
  presentObjects.add(storageKey);
  return row.id;
}

async function insertAuditSeed(entityId: string, payload: object, actorId: string): Promise<string> {
  const [row] = await q<{ id: string }>(
    `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_value, new_value, metadata)
     VALUES ($1, 'message.outbound.sent', 'message', $2, $3, $4, $5) RETURNING id`,
    [
      actorId,
      entityId,
      JSON.stringify({ content: 'conteudo antigo', recipient: payload }),
      JSON.stringify(payload),
      JSON.stringify(payload),
    ],
  );
  created.audits.push(row.id);
  return row.id;
}

async function operationRows(requestId: string): Promise<Array<Record<string, unknown>>> {
  return q('SELECT * FROM privacy_operations WHERE request_id = $1', [requestId]);
}

async function refusalAudits(reasonCode: string): Promise<Array<Record<string, unknown>>> {
  const rows = await q<{ metadata: string | null }>(
    `SELECT metadata FROM audit_logs WHERE action LIKE 'lgpd.%' AND action LIKE '%refused%' ORDER BY created_at ASC`,
  );
  return rows.filter((row) => {
    if (!row.metadata) return false;
    try {
      return (JSON.parse(row.metadata) as { reasonCode?: string }).reasonCode === reasonCode;
    } catch {
      return false;
    }
  });
}

const auth = (actor: Actor) => ({ authorization: `Bearer ${actor.token}` });

function resetPrivacyEnv(): void {
  delete process.env.PRIVACY_OPERATION_MODE;
  delete process.env.PRIVACY_APPROVED_PSEUDONYMIZE_TYPES;
  delete process.env.PRIVACY_APPROVED_DELETE_TYPES;
  delete process.env.PRIVACY_ALLOW_IRREVERSIBLE_DELETE;
  delete process.env.PRIVACY_POLICY_VERSION;
}

function enablePseudoPolicy(): void {
  process.env.PRIVACY_OPERATION_MODE = 'execute';
  process.env.PRIVACY_APPROVED_PSEUDONYMIZE_TYPES = 'contact,tutor-link,conversation,message,note,outbox,dlq,media-asset,audit';
  process.env.PRIVACY_POLICY_VERSION = 'prod16-d02-test-v1';
  delete process.env.PRIVACY_APPROVED_DELETE_TYPES;
  delete process.env.PRIVACY_ALLOW_IRREVERSIBLE_DELETE;
}

function enableDeleteMediaPolicy(): void {
  enablePseudoPolicy();
  process.env.PRIVACY_APPROVED_DELETE_TYPES = 'media-asset';
  process.env.PRIVACY_ALLOW_IRREVERSIBLE_DELETE = 'true';
}

beforeAll(async () => {
  mkdirSync(EVIDENCE_DIR, { recursive: true });

  const runContextSpecifier = '../../../../../e2e/support/aaa/run-context.ts';
  const isolatedEnvSpecifier = '../../../../../e2e/support/aaa/isolated-env.ts';
  const pgSpecifier = 'pg';
  const runContextModule = (await import(/* @vite-ignore */ runContextSpecifier)) as {
    getRunContext: (workerIndex?: number) => RunContext;
  };
  const isolatedEnvModule = (await import(/* @vite-ignore */ isolatedEnvSpecifier)) as {
    provisionIsolatedEnv: (context: RunContext) => Promise<{ databaseName: string; marker: { runId: string }; databaseUrl: string }>;
    teardownIsolatedEnv: Harness['teardownIsolatedEnv'];
  };
  const pgModule = (await import(/* @vite-ignore */ pgSpecifier)) as unknown as { default?: PgRuntime } & PgRuntime;
  pg = (pgModule.default ?? pgModule) as PgRuntime;
  harness = { teardownIsolatedEnv: isolatedEnvModule.teardownIsolatedEnv };

  ctx = runContextModule.getRunContext(WORKER_INDEX);
  isolatedEnv = await isolatedEnvModule.provisionIsolatedEnv(ctx);
  process.env.DATABASE_URL = isolatedEnv.databaseUrl;
  pool = new pg.Pool({ connectionString: isolatedEnv.databaseUrl, max: 6 });

  const { drizzle } = await import('drizzle-orm/node-postgres');
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  await migrate(drizzle(pool as never) as never, { migrationsFolder: MIGRATIONS_DIR });

  // Permissões efetivas (D01/PROD-04): provisiona o catálogo no banco para
  // que a decisão venha da fonte autoritativa, não do papel estático.
  await grant('Admin', ['admin:read', 'admin:write']);
  await grant('Manager', ['admin:read']);
  await grant('PrivacyOperator', ['admin:read', 'admin:write']);

  const authModule = await import('@cvg/auth');
  authModule.resetPermissionProvisionCacheForTests();

  const appModule = (await import('../../app.ts')) as { buildDeskApiApp: () => Promise<FastifyInstance> };
  app = await appModule.buildDeskApiApp();
  await app.ready();

  const databaseModule = await import('../../../../../packages/database/src/index.ts');
  databaseModulePool = databaseModule.getPool() as unknown as { end(): Promise<void> };
  privacy = (await import('@cvg/privacy')) as typeof privacy;
  privacy.setPrivacyMediaStorage({
    delete: async (key: string) => {
      deletedObjects.push(key);
      presentObjects.delete(key);
    },
    exists: async (key: string) => presentObjects.has(key),
  });

  sectorA = await createSector('A');
  sectorB = await createSector('B');
  admin = await createActor('admin', 'Admin');
  managerA = await createActor('manager-a', 'Manager', [{ sectorId: sectorA, accessLevel: 'read' }]);
  operatorA = await createActor('operator-a', 'PrivacyOperator', [{ sectorId: sectorA, accessLevel: 'write' }]);
  operatorA2 = await createActor('operator-a2', 'PrivacyOperator', [{ sectorId: sectorA, accessLevel: 'write' }]);
  operatorB = await createActor('operator-b', 'PrivacyOperator', [{ sectorId: sectorB, accessLevel: 'write' }]);

  // shared — cópias nos DOIS setores (escopo por contato/conversa).
  const shared = await createContact('shared');
  const sharedA = await createConversation(shared.id, sectorA);
  const sharedB = await createConversation(shared.id, sectorB);
  convByLabel.set('shared-a', sharedA);
  convByLabel.set('shared-b', sharedB);
  const sharedMsgA = await insertMessage({
    conversationId: sharedA,
    direction: 'inbound',
    content: `mensagem de ${shared.name} com ${shared.phone}`,
    sender: shared.phone,
  });
  const sharedMsgB = await insertMessage({
    conversationId: sharedB,
    direction: 'inbound',
    content: `B SEGREDO de ${shared.name} com ${shared.phone}`,
    sender: shared.phone,
  });
  await insertNote(sharedA, operatorA.id, `nota interna sobre ${shared.name} ${shared.email}`);
  const sharedOutbox = await insertOutbox(sharedMsgA, { recipient: shared.phone, name: shared.name });
  await insertDlq(sharedOutbox.eventId, { recipient: shared.phone }, `falha para ${shared.email}`);
  await insertAuditSeed(sharedMsgA, { recipient: shared.phone, name: shared.name }, admin.id);
  await insertMedia(sharedMsgA, `media/${shared.id}/A/asset.pdf`, `laudo-${shared.name}.pdf`);
  await insertMedia(sharedMsgB, `media/${shared.id}/B/asset.pdf`, `midia-b-${shared.name}.pdf`);

  // b-only — somente setor B (negativas de escopo).
  const bOnly = await createContact('b-only');
  const bOnlyConv = await createConversation(bOnly.id, sectorB);
  convByLabel.set('b-only-conv', bOnlyConv);
  const bOnlyMsg = await insertMessage({
    conversationId: bOnlyConv,
    direction: 'inbound',
    content: `exclusivo do setor B ${bOnly.name} ${bOnly.phone}`,
    sender: bOnly.phone,
  });
  await insertMedia(bOnlyMsg, `media/${bOnly.id}/B/asset.pdf`, `midia-${bOnly.name}.pdf`);

  // exec — somente setor A, execução pseudonimizada completa (residual zero).
  const exec = await createContact('exec');
  const execConv = await createConversation(exec.id, sectorA);
  convByLabel.set('exec-conv', execConv);
  const execMsg = await insertMessage({
    conversationId: execConv,
    direction: 'inbound',
    content: `execucao ${exec.name} ${exec.phone}`,
    sender: exec.phone,
  });
  await insertNote(execConv, operatorA.id, `nota exec ${exec.name} ${exec.email}`);
  const execOutbox = await insertOutbox(execMsg, { recipient: exec.phone, name: exec.name });
  await insertDlq(execOutbox.eventId, { recipient: exec.phone }, `falha ${exec.email}`);
  await insertAuditSeed(execMsg, { recipient: exec.phone, name: exec.name }, admin.id);

  // fault — somente setor A, falha injetada + retomada por segunda identidade.
  const fault = await createContact('fault');
  const faultConv = await createConversation(fault.id, sectorA);
  convByLabel.set('fault-conv', faultConv);
  const faultMsg = await insertMessage({
    conversationId: faultConv,
    direction: 'inbound',
    content: `falha ${fault.name} ${fault.phone}`,
    sender: fault.phone,
  });
  await insertNote(faultConv, operatorA.id, `nota falha ${fault.name} ${fault.email}`);
  const faultOutbox = await insertOutbox(faultMsg, { recipient: fault.phone, name: fault.name });
  await insertDlq(faultOutbox.eventId, { recipient: fault.phone }, `falha ${fault.email}`);
  await insertAuditSeed(faultMsg, { recipient: fault.phone, name: fault.name }, admin.id);

  // cancel — somente setor A, cancelamento de operação falha.
  const cancel = await createContact('cancel');
  const cancelConv = await createConversation(cancel.id, sectorA);
  convByLabel.set('cancel-conv', cancelConv);
  await insertMessage({
    conversationId: cancelConv,
    direction: 'inbound',
    content: `cancel ${cancel.name} ${cancel.phone}`,
    sender: cancel.phone,
  });

  // scoped — somente A é executado; B permanece como resíduo declarado.
  const scoped = await createContact('scoped');
  const scopedA = await createConversation(scoped.id, sectorA);
  const scopedB = await createConversation(scoped.id, sectorB);
  convByLabel.set('scoped-a-conv', scopedA);
  convByLabel.set('scoped-b-conv', scopedB);
  await insertMessage({
    conversationId: scopedA,
    direction: 'inbound',
    content: `scoped A ${scoped.name} ${scoped.phone}`,
    sender: scoped.phone,
  });
  await insertMessage({
    conversationId: scopedB,
    direction: 'inbound',
    content: `scoped B SEGREDO ${scoped.name} ${scoped.phone}`,
    sender: scoped.phone,
  });

  // media — somente setor A, bytes com exclusão irreversível condicionada.
  const media = await createContact('media');
  const mediaConv = await createConversation(media.id, sectorA);
  convByLabel.set('media-conv', mediaConv);
  const mediaMsg = await insertMessage({
    conversationId: mediaConv,
    direction: 'outbound',
    content: `anexo de ${media.name}`,
    sender: 'Atendente',
    recipient: media.phone,
  });
  await insertMedia(mediaMsg, `media/${media.id}/M.pdf`, `exame-${media.name}.pdf`);
});

afterAll(async () => {
  writeEvidenceJson('prod-16-evidence.json', {
    generatedAt: new Date().toISOString(),
    runId: RUN_ID,
    workerIndex: WORKER_INDEX,
    database: isolatedEnv?.databaseName,
    postgresPort: ctx?.ports.postgres,
    runner: 'scripts/production/run-integration-isolated.mjs',
    boundary: 'PostgreSQL isolado + HTTP real (app.inject) + módulo @cvg/privacy de produção',
    users: {
      admin: admin?.id,
      managerA: managerA?.id,
      operatorA: operatorA?.id,
      operatorA2: operatorA2?.id,
      operatorB: operatorB?.id,
    },
    sectors: { sectorA, sectorB },
    cases: evidence,
  });
  if (app) await app.close().catch(() => undefined);
  if (databaseModulePool) await databaseModulePool.end().catch(() => undefined);
  if (pool) await pool.end().catch(() => undefined);
  if (ctx && harness) {
    harness.teardownIsolatedEnv(ctx, { stopServices: true, dropDatabase: true });
  }
  void created;
});

afterAll(() => {
  resetPrivacyEnv();
});

describe('PROD-16 — escopo de privacidade e política por cópia', () => {
  it('AC3 — inventário por cópia é a política testável (D02 OPEN, dry-run seguro)', async () => {
    resetPrivacyEnv();
    const shared = fixtures.get('shared')!;
    const response = await app!.inject({
      method: 'GET',
      url: `/privacy/contacts/${shared.id}/inventory`,
      headers: auth(admin),
    });
    expect(response.statusCode, response.body).toBe(200);
    const inventory = response.json() as {
      scope: { mode: string };
      policy: { version: string; mode: string; irreversibleDeleteAllowed: boolean };
      sections: Array<{
        copy: string;
        purpose: string;
        retention: string;
        exportable: boolean;
        pseudonymizable: boolean;
        deletable: boolean;
        backup: boolean;
        pendingDecision: string | null;
        observed?: boolean;
        items: Array<{ refs: Record<string, unknown> }>;
      }>;
      totals: { inScope: number; outOfScope: number };
    };

    const byCopy = new Map(inventory.sections.map((section) => [section.copy, section]));
    for (const copy of ['contact', 'tutor-link', 'conversation', 'message', 'note', 'outbox', 'dlq', 'media-asset', 'audit', 'backup']) {
      const section = byCopy.get(copy);
      expect(section, `seção ${copy} ausente`).toBeTruthy();
      expect(typeof section!.purpose).toBe('string');
      expect(typeof section!.retention).toBe('string');
      expect(typeof section!.exportable).toBe('boolean');
      expect(typeof section!.pseudonymizable).toBe('boolean');
      expect(typeof section!.deletable).toBe('boolean');
      expect(typeof section!.backup).toBe('boolean');
      expect(section!.pendingDecision).toBe('D02');
    }
    expect(byCopy.get('backup')!.observed).toBe(false);
    expect(byCopy.get('media-asset')!.items.length).toBeGreaterThanOrEqual(2);
    const mediaRefs = byCopy.get('media-asset')!.items[0].refs;
    expect(Object.prototype.hasOwnProperty.call(mediaRefs, 'retentionUntil')).toBe(true);
    expect(inventory.scope.mode).toBe('all');
    expect(inventory.policy.mode).toBe('dry-run');
    expect(inventory.policy.irreversibleDeleteAllowed).toBe(false);

    const serialized = JSON.stringify(inventory);
    expect(serialized).not.toContain(shared.phone);
    expect(serialized).not.toContain(shared.name);
    expect(serialized).not.toContain(shared.email);

    evidence.push({
      case: 'AC3-inventario-politica',
      copies: inventory.sections.length,
      mediaItems: byCopy.get('media-asset')!.items.length,
      backupObserved: byCopy.get('backup')!.observed,
      policyMode: inventory.policy.mode,
      irreversibleDeleteAllowed: inventory.policy.irreversibleDeleteAllowed,
      pendingDecision: byCopy.get('backup')!.pendingDecision,
    });
  });

  it('AC1 — requestId vinculado a ator+contato: reuso divergente responde 409 sem relatório alheio', async () => {
    resetPrivacyEnv();
    const shared = fixtures.get('shared')!;
    const exec = fixtures.get('exec')!;
    const bOnly = fixtures.get('b-only')!;
    const requestId = `prod16-bind-${randomUUID()}`;

    const first = await app!.inject({
      method: 'POST',
      url: `/privacy/contacts/${shared.id}/erasure`,
      headers: auth(operatorA),
      payload: { reason: 'prod16-bind', requestId },
    });
    expect(first.statusCode, first.body).toBe(200);
    const firstReport = first.json() as { operationId: string; contactId: string };

    const repeated = await app!.inject({
      method: 'POST',
      url: `/privacy/contacts/${shared.id}/erasure`,
      headers: auth(operatorA),
      payload: { reason: 'prod16-bind', requestId },
    });
    expect(repeated.statusCode, repeated.body).toBe(200);
    const repeatedReport = repeated.json() as { operationId: string; deduplicated?: boolean };
    expect(repeatedReport.deduplicated).toBe(true);
    expect(repeatedReport.operationId).toBe(firstReport.operationId);

    // Outro ator/contato com o MESMO requestId: conflito, sem relatório alheio.
    const foreignActor = await app!.inject({
      method: 'POST',
      url: `/privacy/contacts/${bOnly.id}/erasure`,
      headers: auth(operatorB),
      payload: { reason: 'prod16-bind', requestId },
    });
    expect(foreignActor.statusCode, foreignActor.body).toBe(409);
    expect((foreignActor.json() as { error: string }).error).toBe('REQUEST_ID_CONFLICT');
    expect(foreignActor.body).not.toContain(firstReport.operationId);
    expect(foreignActor.body).not.toContain(shared.id);
    expect(foreignActor.body).not.toContain(shared.phone);

    // Mesmo ator, outro contato: também é conflito.
    const foreignContact = await app!.inject({
      method: 'POST',
      url: `/privacy/contacts/${exec.id}/erasure`,
      headers: auth(operatorA),
      payload: { reason: 'prod16-bind', requestId },
    });
    expect(foreignContact.statusCode, foreignContact.body).toBe(409);
    expect(foreignContact.body).not.toContain(firstReport.operationId);

    const rows = await operationRows(requestId);
    expect(rows).toHaveLength(1);
    const refusals = await refusalAudits('request-id-conflict');
    expect(refusals.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(refusals)).not.toContain(shared.phone);

    evidence.push({
      case: 'AC1-requestid-binding',
      requestId,
      operationId: firstReport.operationId,
      dedupRepeated: repeatedReport.deduplicated === true,
      foreignActorStatus: foreignActor.statusCode,
      foreignActorError: (foreignActor.json() as { error: string }).error,
      foreignContactStatus: foreignContact.statusCode,
      rowsForRequestId: rows.length,
      refusalAudits: refusals.length,
    });
  });

  it('AC1 — operação de outro setor: GET/resume/cancel 404 sem vazamento + permissão efetiva', async () => {
    resetPrivacyEnv();
    const exec = fixtures.get('exec')!;
    const requestId = `prod16-scope-${randomUUID()}`;

    const createdOp = await app!.inject({
      method: 'POST',
      url: `/privacy/contacts/${exec.id}/erasure`,
      headers: auth(operatorA),
      payload: { reason: 'prod16-scope', requestId },
    });
    expect(createdOp.statusCode, createdOp.body).toBe(200);
    const operationId = (createdOp.json() as { operationId: string }).operationId;

    const readOk = await app!.inject({
      method: 'GET',
      url: `/privacy/operations/${operationId}`,
      headers: auth(managerA),
    });
    expect(readOk.statusCode, readOk.body).toBe(200);

    const readDenied = await app!.inject({
      method: 'GET',
      url: `/privacy/operations/${operationId}`,
      headers: auth(operatorB),
    });
    expect(readDenied.statusCode, readDenied.body).toBe(404);
    expect(readDenied.body).not.toContain(operationId);
    expect(readDenied.body).not.toContain(exec.phone);

    const resumeDenied = await app!.inject({
      method: 'POST',
      url: `/privacy/operations/${operationId}/resume`,
      headers: auth(operatorB),
      payload: { reason: 'prod16-scope' },
    });
    expect(resumeDenied.statusCode, resumeDenied.body).toBe(404);
    expect(resumeDenied.body).not.toContain(operationId);

    const cancelDenied = await app!.inject({
      method: 'POST',
      url: `/privacy/operations/${operationId}/cancel`,
      headers: auth(operatorB),
      payload: { reason: 'prod16-scope' },
    });
    expect(cancelDenied.statusCode, cancelDenied.body).toBe(404);
    expect(cancelDenied.body).not.toContain(operationId);

    // Permissão efetiva: Manager tem admin:read, não admin:write.
    const forbidden = await app!.inject({
      method: 'POST',
      url: `/privacy/contacts/${exec.id}/erasure`,
      headers: auth(managerA),
      payload: { reason: 'prod16-permission' },
    });
    expect(forbidden.statusCode).toBe(403);

    const refusals = await refusalAudits('operation-out-of-scope');
    expect(refusals.length).toBeGreaterThanOrEqual(3);

    evidence.push({
      case: 'AC1-operacao-outro-setor',
      operationId,
      readInScopeStatus: readOk.statusCode,
      readOutOfScopeStatus: readDenied.statusCode,
      resumeOutOfScopeStatus: resumeDenied.statusCode,
      cancelOutOfScopeStatus: cancelDenied.statusCode,
      managerEraseStatus: forbidden.statusCode,
      refusalAudits: refusals.length,
    });
  });

  it('AC1 — revogação de escopo entre início e retomada bloqueia; outra identidade retoma do checkpoint', async () => {
    const fault = fixtures.get('fault')!;
    const requestId = `prod16-resume-${randomUUID()}`;
    enablePseudoPolicy();

    let failed = false;
    try {
      await privacy.runContactErasure({
        contactId: fault.id,
        actor: { userId: operatorA.id, reason: 'prod16-resume' },
        scope: { all: false, sectorIds: [sectorA] },
        requestId,
        faultAfterStep: 'outbox',
      });
    } catch (error) {
      failed = true;
      expect(String(error)).toContain('FAILURE_INJECTED');
    }
    expect(failed).toBe(true);

    const [row] = await operationRows(requestId);
    expect(row).toBeTruthy();
    const operationId = String(row.id);
    expect(row.status).toBe('failed');
    const checkpoint = Number(row.checkpoint);
    expect(checkpoint).toBeGreaterThanOrEqual(3);

    const beforeBlocked = await q1<{ phone: string | null }>('SELECT phone FROM contacts WHERE id = $1', [fault.id]);
    expect(beforeBlocked?.phone).toBe(fault.phone);

    // Revogação real do membership do ator criador.
    await q('DELETE FROM user_sectors WHERE user_id = $1 AND sector_id = $2', [operatorA.id, sectorA]);

    const blocked = await app!.inject({
      method: 'POST',
      url: `/privacy/operations/${operationId}/resume`,
      headers: auth(operatorA),
      payload: { reason: 'prod16-resume' },
    });
    expect(blocked.statusCode, blocked.body).toBe(404);
    expect(blocked.body).not.toContain(operationId);

    // Nada foi continuado: contato permanece com PII original.
    const afterBlocked = await q1<{ phone: string | null }>('SELECT phone FROM contacts WHERE id = $1', [fault.id]);
    expect(afterBlocked?.phone).toBe(fault.phone);

    // Segunda identidade no MESMO escopo retoma a partir do checkpoint.
    const resumed = await app!.inject({
      method: 'POST',
      url: `/privacy/operations/${operationId}/resume`,
      headers: auth(operatorA2),
      payload: { reason: 'prod16-resume-by-second-identity' },
    });
    expect(resumed.statusCode, resumed.body).toBe(200);
    const report = resumed.json() as {
      status: string;
      resumedFrom?: number;
      resumedBy?: string;
      partial: boolean;
      fullErasureClaimed: boolean;
      checkpoint: number;
      steps: Array<{ copy: string }>;
    };
    expect(report.resumedFrom).toBe(checkpoint);
    expect(report.resumedBy).toBe(operatorA2.id);
    expect(report.checkpoint).toBe(10);
    expect(new Set(report.steps.map((step) => step.copy)).size).toBe(10);
    expect(report.partial).toBe(true);
    expect(report.fullErasureClaimed).toBe(false);

    const after = await q1<{ phone: string | null }>('SELECT phone FROM contacts WHERE id = $1', [fault.id]);
    expect(after?.phone).toContain('ANONYMIZED');

    // Revogado continua bloqueado mesmo após a conclusão por terceiro.
    const blockedAgain = await app!.inject({
      method: 'GET',
      url: `/privacy/operations/${operationId}`,
      headers: auth(operatorA),
    });
    expect(blockedAgain.statusCode).toBe(404);

    // Restaura o membership para os cenários seguintes (a revogação testada
    // foi o que bloqueou, não uma alteração permanente de fixture).
    await q(
      'INSERT INTO user_sectors (user_id, sector_id, access_level) VALUES ($1, $2, $3) ON CONFLICT (user_id, sector_id) DO NOTHING',
      [operatorA.id, sectorA, 'write'],
    );

    evidence.push({
      case: 'AC1-revogacao-retomada',
      operationId,
      checkpointBeforeResume: checkpoint,
      blockedStatus: blocked.statusCode,
      resumedStatus: resumed.statusCode,
      resumedBy: operatorA2.id,
      resumedFrom: report.resumedFrom,
      finalCheckpoint: report.checkpoint,
      finalStatus: report.status,
      partial: report.partial,
    });
  });

  it('AC1 — cancelamento no escopo é terminal e idempotente; retomada posterior é negada', async () => {
    const cancelFixture = fixtures.get('cancel')!;
    const requestId = `prod16-cancel-${randomUUID()}`;
    enablePseudoPolicy();

    await expect(privacy.runContactErasure({
      contactId: cancelFixture.id,
      actor: { userId: operatorA.id, reason: 'prod16-cancel' },
      scope: { all: false, sectorIds: [sectorA] },
      requestId,
      faultAfterStep: 'conversation',
    })).rejects.toThrow(/FAILURE_INJECTED/);

    const [row] = await operationRows(requestId);
    expect(row).toBeTruthy();
    const operationId = String(row.id);
    expect(row.status).toBe('failed');

    const cancelled = await app!.inject({
      method: 'POST',
      url: `/privacy/operations/${operationId}/cancel`,
      headers: auth(operatorA),
      payload: { reason: 'prod16-cancel' },
    });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    const cancelledReport = cancelled.json() as { cancelled?: boolean; status: string };
    expect(cancelledReport.cancelled).toBe(true);
    expect(cancelledReport.status).toBe('failed');

    const again = await app!.inject({
      method: 'POST',
      url: `/privacy/operations/${operationId}/cancel`,
      headers: auth(operatorA),
      payload: { reason: 'prod16-cancel' },
    });
    expect(again.statusCode, again.body).toBe(200);
    expect((again.json() as { cancelled?: boolean }).cancelled).toBe(true);

    const resume = await app!.inject({
      method: 'POST',
      url: `/privacy/operations/${operationId}/resume`,
      headers: auth(operatorA),
      payload: { reason: 'prod16-cancel' },
    });
    expect(resume.statusCode, resume.body).toBe(409);
    expect((resume.json() as { error: string }).error).toBe('OPERATION_NOT_RESUMABLE');

    evidence.push({
      case: 'AC1-cancelamento',
      operationId,
      cancelStatus: cancelled.statusCode,
      cancelIdempotent: true,
      resumeAfterCancelStatus: resume.statusCode,
      resumeAfterCancelError: (resume.json() as { error: string }).error,
    });
  });

  it('AC2 — exportação por escopo: global negado a ator setorial; `authorized` omite o outro setor', async () => {
    resetPrivacyEnv();
    const shared = fixtures.get('shared')!;
    const bOnly = fixtures.get('b-only')!;

    const fullDenied = await app!.inject({
      method: 'GET',
      url: `/privacy/contacts/${shared.id}/export?reason=prod16-export`,
      headers: auth(managerA),
    });
    expect(fullDenied.statusCode, fullDenied.body).toBe(403);
    expect((fullDenied.json() as { error: string }).error).toBe('FULL_EXPORT_DENIED');
    expect(fullDenied.body).not.toContain('B SEGREDO');

    const scoped = await app!.inject({
      method: 'GET',
      url: `/privacy/contacts/${shared.id}/export?reason=prod16-export&scope=authorized`,
      headers: auth(managerA),
    });
    expect(scoped.statusCode, scoped.body).toBe(200);
    const body = scoped.json() as {
      conversations: Array<{ id: string; sectorId: string }>;
      messages: Array<{ conversationId: string }>;
      notes: Array<{ conversationId: string }>;
      mediaAssets: Array<{ id: string; objectPresent: boolean | null; storageStatus: string }>;
      omitted: { conversations: number; messages: number; mediaAssets: number };
      scope: { mode: string; sectorIds: string[] };
      partial: boolean;
    };
    const allowedConversations = body.conversations;
    expect(allowedConversations).toHaveLength(1);
    const conversationIds = new Set(allowedConversations.map((conversation) => conversation.id));
    for (const message of body.messages) expect(conversationIds.has(message.conversationId)).toBe(true);
    for (const note of body.notes) expect(conversationIds.has(note.conversationId)).toBe(true);
    expect(body.omitted.conversations).toBe(1);
    expect(body.omitted.mediaAssets).toBeGreaterThanOrEqual(1);
    expect(body.scope.mode).toBe('sectors');
    expect(body.scope.sectorIds).toContain(sectorA);
    expect(body.scope.sectorIds).not.toContain(sectorB);
    expect(body.partial).toBe(true);
    expect(JSON.stringify(body)).not.toContain('B SEGREDO');
    for (const asset of body.mediaAssets) {
      expect(asset.objectPresent).toBe(true);
      expect(asset.storageStatus).toBe('STORED');
    }

    // Contato exclusivo do outro setor: 404 sem revelar existência.
    const denied = await app!.inject({
      method: 'GET',
      url: `/privacy/contacts/${bOnly.id}/export?reason=prod16-export&scope=authorized`,
      headers: auth(managerA),
    });
    expect(denied.statusCode, denied.body).toBe(404);
    expect(denied.body).not.toContain(bOnly.phone);

    const inventoryDenied = await app!.inject({
      method: 'GET',
      url: `/privacy/contacts/${bOnly.id}/inventory`,
      headers: auth(managerA),
    });
    expect(inventoryDenied.statusCode).toBe(404);

    // Admin global continua com export integral (compatibilidade).
    const full = await app!.inject({
      method: 'GET',
      url: `/privacy/contacts/${shared.id}/export?reason=prod16-export`,
      headers: auth(admin),
    });
    expect(full.statusCode, full.body).toBe(200);
    expect((full.json() as { conversations: unknown[] }).conversations).toHaveLength(2);

    evidence.push({
      case: 'AC2-export-escopo',
      fullDeniedStatus: fullDenied.statusCode,
      scopedStatus: scoped.statusCode,
      scopedConversations: allowedConversations.length,
      omittedConversations: body.omitted.conversations,
      scopedMediaAssets: body.mediaAssets.length,
      deniedContactStatus: denied.statusCode,
      inventoryDeniedStatus: inventoryDenied.statusCode,
      adminFullConversations: 2,
    });
  });

  it('AC2 — mídia fora do escopo não é alcançada; execução setorial preserva o outro setor', async () => {
    resetPrivacyEnv();
    const bOnly = fixtures.get('b-only')!;
    const scoped = fixtures.get('scoped')!;

    // Eliminação HTTP do contato exclusivo do setor B pelo ator do setor A.
    const denied = await app!.inject({
      method: 'POST',
      url: `/privacy/contacts/${bOnly.id}/erasure`,
      headers: auth(operatorA),
      payload: { reason: 'prod16-media-scope' },
    });
    expect(denied.statusCode, denied.body).toBe(404);
    expect(deletedObjects).toEqual([]);
    const bAsset = await q1<{ storage_status: string }>(
      'SELECT ma.storage_status FROM media_assets ma JOIN messages m ON m.id = ma.message_id WHERE m.conversation_id = $1',
      [convByLabel.get('b-only-conv')],
    );
    expect(bAsset?.storage_status).toBe('STORED');

    // Execução setorial no contato compartilhado: setor B permanece intacto.
    enablePseudoPolicy();
    const response = await app!.inject({
      method: 'POST',
      url: `/privacy/contacts/${scoped.id}/erasure`,
      headers: auth(operatorA),
      payload: { reason: 'prod16-media-scope', requestId: `prod16-scoped-${randomUUID()}` },
    });
    expect(response.statusCode, response.body).toBe(200);
    const report = response.json() as {
      partial: boolean;
      fullErasureClaimed: boolean;
      residualScan?: { hits: number; byCopy: Record<string, number> };
      steps: Array<{ copy: string; action: string }>;
    };
    expect(report.partial).toBe(true);
    expect(report.fullErasureClaimed).toBe(false);
    expect(report.residualScan?.hits).toBeGreaterThan(0);
    expect(report.residualScan?.byCopy.message ?? 0).toBeGreaterThanOrEqual(1);

    const scopedFixtures = fixtures.get('scoped')!;
    const bConversation = convByLabel.get('scoped-b-conv');
    const remaining = await q1<{ content: string | null }>(
      'SELECT content FROM messages WHERE conversation_id = $1 LIMIT 1',
      [bConversation],
    );
    expect(remaining?.content).toContain(scopedFixtures.phone);
    const scan = await privacy.scanResidualIdentifiers(scoped.id, identifiersOf(scopedFixtures));
    expect(scan.length).toBeGreaterThan(0);
    expect(scan.some((hit) => hit.copy === 'message')).toBe(true);

    evidence.push({
      case: 'AC2-escopo-midia-execucao',
      outOfScopeErasureStatus: denied.statusCode,
      deletedObjects: deletedObjects.length,
      scopedExecuteStatus: response.statusCode,
      residualHits: report.residualScan?.hits ?? 0,
      residualByCopy: report.residualScan?.byCopy ?? {},
      outOfScopeMessageStillHasPii: true,
      residualScanHits: scan.length,
    });
  });

  it('AC2 — irreversível exige confirmação explícita; dry-run não muta; auditoria registra confirmação', async () => {
    resetPrivacyEnv();
    enableDeleteMediaPolicy();
    const media = fixtures.get('media')!;
    const mediaKey = `media/${media.id}/M.pdf`;

    const requestId = `prod16-confirm-${randomUUID()}`;
    const refused = await app!.inject({
      method: 'POST',
      url: `/privacy/contacts/${media.id}/erasure`,
      headers: auth(operatorA),
      payload: { reason: 'prod16-confirm', requestId },
    });
    expect(refused.statusCode, refused.body).toBe(409);
    expect((refused.json() as { error: string }).error).toBe('IRREVERSIBLE_CONFIRMATION_REQUIRED');
    expect(deletedObjects).toEqual([]);
    expect(await operationRows(requestId)).toHaveLength(0);
    const assetSafe = await q1<{ storage_status: string }>('SELECT storage_status FROM media_assets WHERE storage_key = $1', [mediaKey]);
    expect(assetSafe?.storage_status).toBe('STORED');
    const refusals = await refusalAudits('irreversible-confirmation-required');
    expect(refusals.length).toBeGreaterThanOrEqual(1);

    // Dry-run com a mesma política continua sem mutação.
    const dryRequestId = `prod16-confirm-dry-${randomUUID()}`;
    const dry = await app!.inject({
      method: 'POST',
      url: `/privacy/contacts/${media.id}/erasure`,
      headers: auth(operatorA),
      payload: { reason: 'prod16-confirm', requestId: dryRequestId, dryRun: true },
    });
    expect(dry.statusCode, dry.body).toBe(200);
    const dryReport = dry.json() as { mode: string; mutatedCopies: number; residualScan?: { hits: number } };
    expect(dryReport.mode).toBe('dry-run');
    expect(dryReport.mutatedCopies).toBe(0);
    expect(deletedObjects).toEqual([]);
    expect(await operationRows(dryRequestId)).toHaveLength(1);

    // Confirmação explícita: executa e audita.
    const confirmed = await app!.inject({
      method: 'POST',
      url: `/privacy/contacts/${media.id}/erasure`,
      headers: auth(operatorA),
      payload: { reason: 'prod16-confirm', requestId, confirmIrreversible: true },
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(deletedObjects).toContain(mediaKey);
    const assetDeleted = await q1<{ storage_status: string }>('SELECT storage_status FROM media_assets WHERE storage_key = $1', [mediaKey]);
    expect(assetDeleted?.storage_status).toBe('DELETED');
    const confirmedReport = confirmed.json() as {
      mode: string;
      residuals: Array<{ copy: string }>;
      partial: boolean;
      fullErasureClaimed: boolean;
    };
    expect(confirmedReport.mode).toBe('execute');
    expect(confirmedReport.residuals.some((residual) => residual.copy === 'media-asset')).toBe(false);
    expect(confirmedReport.fullErasureClaimed).toBe(false);

    const audit = await q1<{ metadata: string | null }>(
      `SELECT metadata FROM audit_logs WHERE action = 'lgpd.pseudonymize' AND entity_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [media.id],
    );
    expect(audit?.metadata).toContain('"irreversibleConfirmed":true');

    evidence.push({
      case: 'AC2-confirmacao-irreversivel',
      refusedStatus: refused.statusCode,
      refusedError: (refused.json() as { error: string }).error,
      bytesBeforeConfirmation: 1,
      dryRunStatus: dry.statusCode,
      dryRunMode: dryReport.mode,
      confirmedStatus: confirmed.statusCode,
      deletedKeys: deletedObjects.filter((key) => key === mediaKey).length,
      storageStatus: assetDeleted?.storage_status,
      auditHasConfirmation: audit?.metadata?.includes('"irreversibleConfirmed":true') === true,
    });
  });

  it('AC2 — residual scan e checkpoints no relatório; sobrancelha zero no escopo eliminado', async () => {
    resetPrivacyEnv();
    const exec = fixtures.get('exec')!;
    const before = await privacy.scanResidualIdentifiers(exec.id, identifiersOf(exec));
    expect(before.length).toBeGreaterThan(0);

    enablePseudoPolicy();
    const requestId = `prod16-residual-${randomUUID()}`;
    const response = await app!.inject({
      method: 'POST',
      url: `/privacy/contacts/${exec.id}/erasure`,
      headers: auth(operatorA),
      payload: { reason: 'prod16-residual', requestId },
    });
    expect(response.statusCode, response.body).toBe(200);
    const report = response.json() as {
      mode: string;
      checkpoint: number;
      steps: Array<{ copy: string; action: string }>;
      residuals: Array<{ copy: string; reason: string }>;
      residualScan?: { hits: number; byCopy: Record<string, number> };
      partial: boolean;
      fullErasureClaimed: boolean;
    };
    expect(report.mode).toBe('execute');
    expect(report.checkpoint).toBe(10);
    expect(report.steps).toHaveLength(10);
    expect(report.steps.filter((step) => step.action === 'pseudonymized').length).toBeGreaterThanOrEqual(7);
    expect(report.residuals).toContainEqual({ copy: 'backup', reason: 'external-backup-not-rewritten' });
    expect(report.residualScan?.hits).toBe(0);
    expect(report.partial).toBe(true);
    expect(report.fullErasureClaimed).toBe(false);

    const after = await privacy.scanResidualIdentifiers(exec.id, identifiersOf(exec));
    expect(after).toEqual([]);

    evidence.push({
      case: 'AC2-residual-checkpoint',
      hitsBefore: before.length,
      executeStatus: response.statusCode,
      checkpoint: report.checkpoint,
      steps: report.steps.length,
      pseudonymizedCopies: report.steps.filter((step) => step.action === 'pseudonymized').length,
      residualHitsAfter: report.residualScan?.hits,
      residualScanAfter: after.length,
      backupResidual: report.residuals.some((residual) => residual.copy === 'backup'),
    });
  });
});
