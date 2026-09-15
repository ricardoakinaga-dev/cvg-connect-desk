/**
 * PROD-08 — eliminar conversas órfãs/duplicadas no primeiro inbound (C03/G03).
 *
 * Prova real em PostgreSQL isolado do harness AAA (run `prod08`, worker 16,
 * `cvg_aaa_prod08_w16`), usando os EXECUTORES de produção do módulo chat —
 * nunca o banco do host:
 *
 *   AC1 — duas primeiras mensagens duplicadas concorrentes (mesmo
 *         externalMessageId), COM e SEM externalConversationId, produzem uma
 *         conversa lógica, uma mensagem e as intenções outbox esperadas; a
 *         transação perdedora NÃO comita conversa/contato/histórico/outbox
 *         órfãos (rollback completo, evento do vencedor preservado).
 *   AC2 — mensagem+estado+contato/vínculo+histórico+outbox participam do
 *         MESMO executor transacional: falha injetada em CADA ponto de
 *         escrita (trigger real) faz rollback total; hint realtime só existe
 *         depois do commit.
 *   AC3 — paginação keyset preserva ordem total com `updatedAt` empatado e
 *         inserts concorrentes (sem pular/duplicar); escopo por setor é
 *         deny-by-default e só `globalAdmin` explícito dispensa memberships.
 *   AC4 — dry-run identifica conversa órfã legada (sem NENHUMA mensagem) com
 *         critério documentado; reconciliação só muta com aprovação
 *         explícita, é idempotente e nunca apaga mensagens.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RunContext } from '../../../../../e2e/support/aaa/run-context.ts';

interface PgQueryResult<R> {
  rows: R[];
  rowCount: number | null;
}

interface PgClientLike {
  connect(): Promise<unknown>;
  query<R = Record<string, unknown>>(text: string, values?: unknown[]): Promise<PgQueryResult<R>>;
  end(): Promise<void>;
}

type PgPoolLike = PgClientLike;

interface PgRuntime {
  Client: new (config: { connectionString: string }) => PgClientLike;
  Pool: new (config: { connectionString: string; max?: number }) => PgPoolLike;
}

interface Harness {
  teardownIsolatedEnv: (
    ctx: RunContext,
    options?: { stopServices?: boolean; dropDatabase?: boolean },
  ) => Record<string, unknown>;
}

interface DatabasePoolLike {
  end(): Promise<void>;
}

interface PersistInboundInputLike {
  externalMessageId: string;
  externalConversationId?: string;
  content: string;
  sender: string;
  senderType?: 'contact' | 'system' | 'unknown';
  sentAt?: Date;
  contactPhone?: string;
  contactName?: string;
}

interface PersistInboundResultLike {
  message: { id: string; conversationId: string };
  conversation: { id: string; unreadCount: number; isActive: boolean };
  isNewConversation: boolean;
  isDuplicate: boolean;
  committedEvents: Array<{ event_id: string }>;
}

interface OrphanReportLike {
  criterion: string;
  totalCandidates: number;
  truncated: boolean;
  candidates: Array<{
    id: string;
    externalConversationId: string | null;
    isActive: boolean;
    hasContact: boolean;
    hasCreatedIntent: boolean;
    hasStatusHistory: boolean;
  }>;
}

interface ReconcileResultLike {
  applied: boolean;
  reason: string;
  report: OrphanReportLike;
  archivedIds: string[];
}

interface ConversationRepositoryLike {
  findPage: (
    filters: Record<string, unknown>,
    limit: number,
    cursor?: unknown,
  ) => Promise<{ items: Array<{ id: string; sectorId: string | null }>; nextKeyset: unknown }>;
  markInboundUnread: (id: string, executor?: unknown) => Promise<unknown>;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../../..');
const PROGRAM_DIR = process.env.CVG_PROGRAM_DIR || join(REPO_ROOT, 'docs', 'producao-2026-09-13');
const EVIDENCE_SEGMENT = process.env.CVG_EVIDENCE_SEGMENT?.trim();
const EVIDENCE_DIR = join(
  PROGRAM_DIR,
  'evidencias',
  'prod-08',
  ...(EVIDENCE_SEGMENT ? [EVIDENCE_SEGMENT] : []),
);
const LOG_DIR = join(EVIDENCE_DIR, 'logs');
const RUNTIME_DIR = process.env.CVG_RUNTIME_DIR || join(EVIDENCE_DIR, 'runtime');
const MIGRATIONS_DIR = join(REPO_ROOT, 'packages', 'database', 'supabase', 'migrations');
const RUN_ID = process.env.AAA_RUN_ID || 'prod08';
const WORKER_INDEX = Number(process.env.AAA_WORKER_INDEX || '16');

process.env.CVG_PROGRAM_DIR = PROGRAM_DIR;
process.env.CVG_RUNTIME_DIR = RUNTIME_DIR;
process.env.AAA_RUN_ID = RUN_ID;
process.env.AAA_WORKER_INDEX = String(WORKER_INDEX);
process.env.NODE_ENV = 'test';
// DATABASE_URL só depois de provisionar o PG isolado: evita qualquer conexão
// com o banco do host no carregamento dos módulos.
delete process.env.DATABASE_URL;

vi.mock('@cvg/secretary-adapter', () => ({
  invokeSecretary: vi.fn().mockResolvedValue({ isErr: () => true, isOk: () => false }),
  triggerHandoff: vi.fn().mockResolvedValue(undefined),
}));

vi.setConfig({ testTimeout: 120_000, hookTimeout: 600_000 });

const evidence: Array<Record<string, unknown>> = [];
const hints: Array<{ event_id: string; event_type: string; payload?: { content?: string; messageId?: string } }> = [];

let ctx: RunContext;
let isolatedEnv: { databaseName: string; marker: { runId: string } };
let pg: PgRuntime;
let harness: Harness;
let pool: PgPoolLike;
let databaseModulePool: DatabasePoolLike | undefined;

// Módulos carregados depois do DATABASE_URL isolado (nenhum import de banco no topo).
let persistInboundAtomically: (input: PersistInboundInputLike) => Promise<PersistInboundResultLike>;
let receiveInboundMessage: (input: PersistInboundInputLike & { userId?: string }) => Promise<{ isOk(): boolean; isErr(): boolean; value?: { messageId: string; conversationId: string; isNewConversation: boolean } }>;
let findOrphanConversations: (options?: Record<string, unknown>) => Promise<OrphanReportLike>;
let reconcileOrphanConversations: (options?: Record<string, unknown>) => Promise<ReconcileResultLike>;
let conversationRepository: ConversationRepositoryLike;
let conversationCursorScope: (actorId: string | undefined, filters: Record<string, unknown>) => string;
let encodeConversationCursor: (keyset: Record<string, unknown>, scope: string) => string;
let decodeConversationCursor: (raw: string, scope: string) => unknown;
let setSharedRealtimeBus: (bus: unknown) => void;

const RECORDING_BUS = {
  instanceId: 'prod08-recording-bus',
  start: async () => undefined,
  stop: async () => undefined,
  publish: async (envelope: { event_id: string; event_type: string; payload?: { content?: string; messageId?: string } }) => {
    hints.push(envelope);
    return true;
  },
  onEnvelope: () => () => undefined,
  isConnected: () => true,
};

function databaseUrl(): string {
  return `postgresql://cvg_aaa@127.0.0.1:${ctx.ports.postgres}/${isolatedEnv.databaseName}`;
}

function writeEvidenceJson(name: string, value: unknown): void {
  writeFileSync(join(EVIDENCE_DIR, name), `${JSON.stringify(value, null, 2)}\n`);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function waitFor(check: () => boolean, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  return check();
}

function uniquePhone(): string {
  return `+5511${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
}

async function count(query: string, params: unknown[] = []): Promise<number> {
  const result = await pool.query<{ n: number }>(query, params);
  return Number(result.rows[0]?.n ?? 0);
}

const COUNTED_TABLES = ['contacts', 'conversations', 'conversation_status_history', 'messages', 'outbox_events'] as const;

async function tableCounts(): Promise<Record<string, number>> {
  const entries = await Promise.all(
    COUNTED_TABLES.map(async (table) => [table, await count(`SELECT count(*)::int AS n FROM ${table}`)] as const),
  );
  return Object.fromEntries(entries);
}

async function messageById(externalMessageId: string): Promise<{ id: string; conversationId: string } | null> {
  const result = await pool.query<{ id: string; conversation_id: string }>(
    'SELECT id, conversation_id FROM messages WHERE external_message_id = $1',
    [externalMessageId],
  );
  const row = result.rows[0];
  return row ? { id: row.id, conversationId: row.conversation_id } : null;
}

async function conversationsByExternalId(externalConversationId: string): Promise<Array<{ id: string; unread: number }>> {
  const result = await pool.query<{ id: string; unread_count: number }>(
    'SELECT id, unread_count::int AS unread_count FROM conversations WHERE external_conversation_id = $1',
    [externalConversationId],
  );
  return result.rows.map((row) => ({ id: row.id, unread: Number(row.unread_count) }));
}

async function orphanConversationsForPhone(phoneDigits: string): Promise<string[]> {
  const result = await pool.query<{ id: string }>(
    `SELECT c.id
       FROM conversations c
       JOIN contacts ct ON ct.id = c.contact_id
      WHERE ct.phone = $1
        AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id)`,
    [phoneDigits],
  );
  return result.rows.map((row) => row.id);
}

async function outboxRows(tag: string, eventType?: string): Promise<Array<{ event_id: string; event_type: string; aggregate_id: string; payload: string }>> {
  const typeFilter = eventType ? 'AND event_type = $2' : '';
  const params: unknown[] = [tag];
  if (eventType) params.push(eventType);
  const result = await pool.query<{ event_id: string; event_type: string; aggregate_id: string; payload: string }>(
    `SELECT event_id, event_type, aggregate_id, payload
       FROM outbox_events
      WHERE payload LIKE '%' || $1 || '%' ${typeFilter}
      ORDER BY created_at ASC`,
    params,
  );
  return result.rows;
}

async function outboxByAggregate(aggregateId: string, eventType: string): Promise<Array<{ event_id: string; payload: string }>> {
  const result = await pool.query<{ event_id: string; payload: string }>(
    'SELECT event_id, payload FROM outbox_events WHERE aggregate_id = $1 AND event_type = $2 ORDER BY created_at ASC',
    [aggregateId, eventType],
  );
  return result.rows;
}

async function expectInjectedFailure(promise: Promise<unknown>): Promise<void> {
  let caught: unknown = null;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught, 'a transação deveria falhar com a injeção de falha').not.toBeNull();
  const cause = (caught as { cause?: { message?: string } }).cause;
  const message = `${(caught as Error).message} ${cause?.message ?? ''}`;
  expect(message).toContain('prod08 injected failure');
}

function hintCountFor(content: string): number {
  return hints.filter((hint) => hint.payload?.content === content).length;
}

async function settleHints(): Promise<void> {
  let stable = 0;
  let last = hints.length;
  while (stable < 3) {
    await new Promise((resolve) => setTimeout(resolve, 40));
    if (hints.length === last) stable += 1;
    else {
      stable = 0;
      last = hints.length;
    }
  }
}

async function setupFaultInjection(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS prod08_fault_gate (
      point TEXT PRIMARY KEY,
      fail_remaining INTEGER NOT NULL
    );
    CREATE OR REPLACE FUNCTION prod08_fault_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE gate_point text;
            remaining integer;
    BEGIN
      IF TG_TABLE_NAME = 'outbox_events' THEN
        gate_point := 'outbox:' || NEW.event_type;
      ELSIF TG_TABLE_NAME = 'conversations' AND TG_OP = 'UPDATE' THEN
        gate_point := 'conversation_state';
      ELSE
        gate_point := TG_TABLE_NAME;
      END IF;
      SELECT fail_remaining INTO remaining FROM prod08_fault_gate WHERE point = gate_point;
      IF remaining IS NOT NULL AND remaining > 0 THEN
        UPDATE prod08_fault_gate SET fail_remaining = remaining - 1 WHERE point = gate_point;
        RAISE EXCEPTION 'prod08 injected failure at %', gate_point;
      END IF;
      RETURN NEW;
    END;
    $$;
    DROP TRIGGER IF EXISTS prod08_fault_contacts ON contacts;
    CREATE TRIGGER prod08_fault_contacts BEFORE INSERT ON contacts
      FOR EACH ROW EXECUTE FUNCTION prod08_fault_guard();
    DROP TRIGGER IF EXISTS prod08_fault_conversations_insert ON conversations;
    CREATE TRIGGER prod08_fault_conversations_insert BEFORE INSERT ON conversations
      FOR EACH ROW EXECUTE FUNCTION prod08_fault_guard();
    DROP TRIGGER IF EXISTS prod08_fault_conversations_update ON conversations;
    CREATE TRIGGER prod08_fault_conversations_update BEFORE UPDATE ON conversations
      FOR EACH ROW EXECUTE FUNCTION prod08_fault_guard();
    DROP TRIGGER IF EXISTS prod08_fault_history ON conversation_status_history;
    CREATE TRIGGER prod08_fault_history BEFORE INSERT ON conversation_status_history
      FOR EACH ROW EXECUTE FUNCTION prod08_fault_guard();
    DROP TRIGGER IF EXISTS prod08_fault_outbox ON outbox_events;
    CREATE TRIGGER prod08_fault_outbox BEFORE INSERT ON outbox_events
      FOR EACH ROW EXECUTE FUNCTION prod08_fault_guard();
    DROP TRIGGER IF EXISTS prod08_fault_messages ON messages;
    CREATE TRIGGER prod08_fault_messages BEFORE INSERT ON messages
      FOR EACH ROW EXECUTE FUNCTION prod08_fault_guard();
  `);
}

async function armFault(point: string): Promise<void> {
  await pool.query(
    `INSERT INTO prod08_fault_gate (point, fail_remaining) VALUES ($1, 1)
     ON CONFLICT (point) DO UPDATE SET fail_remaining = 1`,
    [point],
  );
}

async function disarmFaults(): Promise<void> {
  await pool.query('DELETE FROM prod08_fault_gate');
}

async function insertSector(name: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    'INSERT INTO sectors (name, code) VALUES ($1, $2) RETURNING id',
    [name.slice(0, 100), name.slice(0, 50)],
  );
  return result.rows[0]!.id;
}

async function insertUser(email: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    "INSERT INTO users (name, email, password_hash) VALUES ($1, $2, 'prod08-test-hash') RETURNING id",
    [`prod08 ${email}`, email],
  );
  return result.rows[0]!.id;
}

async function insertMembership(userId: string, sectorId: string): Promise<void> {
  await pool.query('INSERT INTO user_sectors (user_id, sector_id) VALUES ($1, $2)', [userId, sectorId]);
}

async function insertConversation(input: {
  externalConversationId?: string | null;
  sectorId?: string | null;
  contactId?: string | null;
  updatedAt?: Date;
  unread?: number;
  handler?: 'bot' | 'human';
  isActive?: boolean;
}): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO conversations
       (external_conversation_id, external_channel_id, status, status_v2, current_handler,
        is_active, unread_count, sector_id, contact_id, created_at, updated_at)
     VALUES ($1, 'whatsapp', 'open', 'novo', $2, $3, $4, $5, $6, $7, $7)
     RETURNING id`,
    [
      input.externalConversationId ?? null,
      input.handler ?? 'bot',
      input.isActive ?? true,
      input.unread ?? 0,
      input.sectorId ?? null,
      input.contactId ?? null,
      input.updatedAt ?? new Date(),
    ],
  );
  return result.rows[0]!.id;
}

async function insertMessage(conversationId: string, externalMessageId: string, content = 'fixture'): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO messages (conversation_id, direction, content, external_message_id, status, created_at)
     VALUES ($1, 'inbound', $2, $3, 'pending', NOW())
     RETURNING id`,
    [conversationId, content, externalMessageId],
  );
  return result.rows[0]!.id;
}

beforeAll(async () => {
  mkdirSync(LOG_DIR, { recursive: true });
  // Specifiers em variáveis (como prod-07): mantém o harness fora do
  // typecheck deste pacote — o único artefato verificado é a execução real.
  const runContextSpecifier = '../../../../../e2e/support/aaa/run-context.ts';
  const isolatedEnvSpecifier = '../../../../../e2e/support/aaa/isolated-env.ts';
  const runContextModule = (await import(/* @vite-ignore */ runContextSpecifier)) as {
    getRunContext: (workerIndex?: number) => RunContext;
  };
  const isolatedEnvModule = (await import(/* @vite-ignore */ isolatedEnvSpecifier)) as {
    provisionIsolatedEnv: (context: RunContext) => Promise<{ databaseName: string; marker: { runId: string } }>;
    teardownIsolatedEnv: Harness['teardownIsolatedEnv'];
  };
  const pgSpecifier = 'pg';
  const pgModule = (await import(/* @vite-ignore */ pgSpecifier)) as { default?: PgRuntime };
  pg = (pgModule.default ?? (pgModule as unknown as PgRuntime)) as PgRuntime;
  harness = { teardownIsolatedEnv: isolatedEnvModule.teardownIsolatedEnv };

  ctx = runContextModule.getRunContext(WORKER_INDEX);
  isolatedEnv = await isolatedEnvModule.provisionIsolatedEnv(ctx);
  if (isolatedEnv.marker.runId !== ctx.runId) {
    throw new Error(`marcador do run divergente: ${isolatedEnv.marker.runId} != ${ctx.runId}`);
  }
  process.env.DATABASE_URL = databaseUrl();

  pool = new pg.Pool({ connectionString: databaseUrl(), max: 8 });

  const { drizzle } = await import('drizzle-orm/node-postgres');
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  await migrate(drizzle(pool as never) as never, { migrationsFolder: MIGRATIONS_DIR });
  await setupFaultInjection();

  const inboundSpecifier = '../../../../../modules/chat/src/infrastructure/repositories/inbound-atomic.repository.ts';
  const useCaseSpecifier = '../../../../../modules/chat/src/application/use-cases/receive-inbound-message.use-case.ts';
  const conversationSpecifier = '../../../../../modules/chat/src/infrastructure/repositories/conversation.repository.ts';
  const eventsSpecifier = '../../../../../packages/events/src/index.ts';

  const inboundModule = await import(/* @vite-ignore */ inboundSpecifier);
  persistInboundAtomically = inboundModule.persistInboundAtomically as typeof persistInboundAtomically;
  findOrphanConversations = inboundModule.findOrphanConversations as typeof findOrphanConversations;
  reconcileOrphanConversations = inboundModule.reconcileOrphanConversations as typeof reconcileOrphanConversations;

  const useCaseModule = await import(/* @vite-ignore */ useCaseSpecifier);
  receiveInboundMessage = useCaseModule.receiveInboundMessage as typeof receiveInboundMessage;

  const conversationModule = await import(/* @vite-ignore */ conversationSpecifier);
  conversationRepository = conversationModule.conversationRepository as unknown as ConversationRepositoryLike;
  conversationCursorScope = conversationModule.conversationCursorScope as typeof conversationCursorScope;
  encodeConversationCursor = conversationModule.encodeConversationCursor as unknown as typeof encodeConversationCursor;
  decodeConversationCursor = conversationModule.decodeConversationCursor as typeof decodeConversationCursor;

  const eventsModule = await import(/* @vite-ignore */ eventsSpecifier);
  setSharedRealtimeBus = eventsModule.setSharedRealtimeBus as typeof setSharedRealtimeBus;
  setSharedRealtimeBus(RECORDING_BUS);

  const databaseSpecifier = '../../../../../packages/database/src/index.ts';
  const databaseModule = (await import(/* @vite-ignore */ databaseSpecifier)) as { getPool: () => DatabasePoolLike };
  databaseModulePool = databaseModule.getPool();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await disarmFaults();
});

afterAll(async () => {
  writeEvidenceJson('prod-08-evidence.json', {
    generatedAt: new Date().toISOString(),
    runId: RUN_ID,
    workerIndex: WORKER_INDEX,
    database: isolatedEnv?.databaseName,
    postgresPort: ctx?.ports.postgres,
    cases: evidence,
  });
  setSharedRealtimeBus?.(null);
  if (databaseModulePool) await databaseModulePool.end().catch(() => undefined);
  if (pool) await pool.end().catch(() => undefined);
  if (ctx && harness) {
    harness.teardownIsolatedEnv(ctx, { stopServices: true, dropDatabase: true });
  }
});

describe('PROD-08 — órfãos/duplicatas no primeiro inbound (PostgreSQL real)', () => {
  describe('AC1 — corrida de duplicatas', () => {
    it('AC1a — COM externalConversationId: uma conversa, uma mensagem, intenções 1× e perdedor sem órfãos', async () => {
      const tag = `prod08-ac1a-${randomUUID()}`;
      const externalConversationId = `${tag}-conv`;
      const externalMessageId = `${tag}-msg`;
      const phone = uniquePhone();
      const phoneDigits = phone.replace(/\D/g, '');
      const content = `conteudo-ac1a-${tag}`;
      const input: PersistInboundInputLike = {
        externalMessageId,
        externalConversationId,
        content,
        sender: phone,
        senderType: 'contact',
        contactPhone: phone,
        contactName: 'AC1a',
        sentAt: new Date(),
      };

      const [first, second] = await Promise.all([persistInboundAtomically(input), persistInboundAtomically(input)]);

      expect(first.message.id).toBe(second.message.id);
      expect(first.conversation.id).toBe(second.conversation.id);
      // O lock serializa; qual chamada vence é indiferente — exatamente UMA é
      // a nova e a outra é a duplicata idempotente.
      expect([first.isDuplicate, second.isDuplicate].filter(Boolean)).toHaveLength(1);
      const winner = first.isDuplicate ? second : first;
      expect(winner.isNewConversation).toBe(true);

      const conversations = await conversationsByExternalId(externalConversationId);
      expect(conversations).toHaveLength(1);
      expect(conversations[0]!.id).toBe(first.conversation.id);
      expect(conversations[0]!.unread).toBe(1);
      expect(await messageById(externalMessageId)).toMatchObject({ id: first.message.id });
      expect(await count('SELECT count(*)::int AS n FROM messages WHERE external_message_id = $1', [externalMessageId])).toBe(1);

      const created = await outboxByAggregate(first.conversation.id, 'conversation.created');
      const persisted = await outboxByAggregate(first.message.id, 'message.persisted');
      expect(created).toHaveLength(1);
      expect(persisted).toHaveLength(1);
      expect(JSON.parse(persisted[0]!.payload).messageId).toBe(first.message.id);
      expect(await orphanConversationsForPhone(phoneDigits)).toHaveLength(0);

      await waitFor(() => hintCountFor(content) === 1);
      expect(hintCountFor(content)).toBe(1);

      evidence.push({
        case: 'AC1a-corrida-com-externalConversationId',
        externalConversationId,
        externalMessageId,
        messageId: first.message.id,
        conversationId: first.conversation.id,
        winner: first.isDuplicate ? 'second' : 'first',
        duplicateFlags: [first.isDuplicate, second.isDuplicate],
        conversations: conversations.length,
        createdIntents: created.length,
        persistedIntents: persisted.length,
        orphans: 0,
      });
    });

    it('AC1b — SEM externalConversationId: uma conversa para o contato, zero conversa órfã', async () => {
      const tag = `prod08-ac1b-${randomUUID()}`;
      const externalMessageId = `${tag}-msg`;
      const phone = uniquePhone();
      const phoneDigits = phone.replace(/\D/g, '');
      const content = `conteudo-ac1b-${tag}`;
      const input: PersistInboundInputLike = {
        externalMessageId,
        content,
        sender: phone,
        senderType: 'contact',
        contactPhone: phone,
        contactName: 'AC1b',
        sentAt: new Date(),
      };

      const [first, second] = await Promise.all([persistInboundAtomically(input), persistInboundAtomically(input)]);

      expect(first.message.id).toBe(second.message.id);
      expect(first.conversation.id).toBe(second.conversation.id);
      expect(await count('SELECT count(*)::int AS n FROM messages WHERE external_message_id = $1', [externalMessageId])).toBe(1);

      const contactRow = await pool.query<{ id: string }>('SELECT id FROM contacts WHERE phone = $1', [phoneDigits]);
      expect(contactRow.rows).toHaveLength(1);
      const conversationsForContact = await count(
        'SELECT count(*)::int AS n FROM conversations WHERE contact_id = $1',
        [contactRow.rows[0]!.id],
      );
      expect(conversationsForContact).toBe(1);
      expect(await orphanConversationsForPhone(phoneDigits)).toHaveLength(0);
      expect(await outboxByAggregate(first.conversation.id, 'conversation.created')).toHaveLength(1);
      expect(await outboxByAggregate(first.message.id, 'message.persisted')).toHaveLength(1);

      await waitFor(() => hintCountFor(content) === 1);
      expect(hintCountFor(content)).toBe(1);

      evidence.push({
        case: 'AC1b-corrida-sem-externalConversationId',
        externalMessageId,
        messageId: first.message.id,
        conversationId: first.conversation.id,
        conversationsForContact,
        orphans: 0,
      });
    });

    it('AC1c — 6 rodadas concorrentes por variante mantêm as invariantes', async () => {
      const rounds: Array<Record<string, unknown>> = [];
      for (let round = 0; round < 6; round += 1) {
        const tag = `prod08-ac1c-${round}-${randomUUID()}`;
        const phone = uniquePhone();
        const phoneDigits = phone.replace(/\D/g, '');
        const withExternal = round % 2 === 0;
        const input: PersistInboundInputLike = {
          externalMessageId: `${tag}-msg`,
          externalConversationId: withExternal ? `${tag}-conv` : undefined,
          content: `conteudo-ac1c-${tag}`,
          sender: phone,
          senderType: 'contact',
          contactPhone: phone,
          contactName: 'AC1c',
          sentAt: new Date(),
        };
        const results = await Promise.all([persistInboundAtomically(input), persistInboundAtomically(input)]);
        expect(new Set(results.map((r) => r.message.id)).size).toBe(1);
        expect(new Set(results.map((r) => r.conversation.id)).size).toBe(1);
        expect(await count('SELECT count(*)::int AS n FROM messages WHERE external_message_id = $1', [input.externalMessageId])).toBe(1);
        expect(await outboxByAggregate(results[0]!.conversation.id, 'conversation.created')).toHaveLength(1);
        expect(await outboxByAggregate(results[0]!.message.id, 'message.persisted')).toHaveLength(1);
        expect(await orphanConversationsForPhone(phoneDigits)).toHaveLength(0);
        rounds.push({ round, withExternal, messageId: results[0]!.message.id });
      }
      evidence.push({ case: 'AC1c-rodadas', rounds });
    });

    it('AC1e — primeiras mensagens DIFERENTES na mesma conversa externa: lock evita 2ª conversa/colisão', async () => {
      const tag = `prod08-ac1e-${randomUUID()}`;
      const externalConversationId = `${tag}-conv`;
      const phone = uniquePhone();
      const phoneDigits = phone.replace(/\D/g, '');
      const base = {
        externalConversationId,
        sender: phone,
        senderType: 'contact' as const,
        contactPhone: phone,
        contactName: 'AC1e',
        sentAt: new Date(),
      };

      const [first, second] = await Promise.all([
        persistInboundAtomically({ ...base, externalMessageId: `${tag}-msg-a`, content: `conteudo-a-${tag}` }),
        persistInboundAtomically({ ...base, externalMessageId: `${tag}-msg-b`, content: `conteudo-b-${tag}` }),
      ]);

      expect(first.conversation.id).toBe(second.conversation.id);
      expect(new Set([first.message.id, second.message.id]).size).toBe(2);
      const conversations = await conversationsByExternalId(externalConversationId);
      expect(conversations).toHaveLength(1);
      expect(conversations[0]!.unread).toBe(2);
      expect(await outboxByAggregate(first.conversation.id, 'conversation.created')).toHaveLength(1);
      expect(
        await count('SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1', [first.conversation.id]),
      ).toBe(2);
      expect(await orphanConversationsForPhone(phoneDigits)).toHaveLength(0);
      expect(
        await count(
          "SELECT count(*)::int AS n FROM outbox_events WHERE event_type = 'message.persisted' AND aggregate_id = ANY($1::text[])",
          [[first.message.id, second.message.id]],
        ),
      ).toBe(2);

      evidence.push({
        case: 'AC1e-mensagens-diferentes-mesma-conversa',
        conversationId: first.conversation.id,
        messages: [first.message.id, second.message.id],
        conversations: 1,
      });
    });

    it('AC1d — use-case real: primeiras mensagens concorrentes retornam a mesma conversa lógica', async () => {
      const tag = `prod08-ac1d-${randomUUID()}`;
      const phone = uniquePhone();
      const phoneDigits = phone.replace(/\D/g, '');
      const input = {
        externalMessageId: `${tag}-msg`,
        content: `conteudo-ac1d-${tag}`,
        sender: phone,
        senderType: 'contact' as const,
        contactPhone: phone,
        contactName: 'AC1d',
        sentAt: new Date(),
      };

      const [first, second] = await Promise.all([receiveInboundMessage(input), receiveInboundMessage(input)]);
      expect(first.isOk()).toBe(true);
      expect(second.isOk()).toBe(true);
      expect(first.value!.messageId).toBe(second.value!.messageId);
      expect(first.value!.conversationId).toBe(second.value!.conversationId);
      expect(
        [first.value!.isNewConversation, second.value!.isNewConversation].filter(Boolean),
      ).toHaveLength(1);
      expect(await count('SELECT count(*)::int AS n FROM messages WHERE external_message_id = $1', [input.externalMessageId])).toBe(1);
      expect(await orphanConversationsForPhone(phoneDigits)).toHaveLength(0);

      evidence.push({
        case: 'AC1d-use-case',
        messageId: first.value!.messageId,
        conversationId: first.value!.conversationId,
        newConversationFlags: [first.value!.isNewConversation, second.value!.isNewConversation],
      });
    });
  });

  describe('AC2 — atomicidade por ponto de escrita e hints pós-commit', () => {
    const FAULT_POINTS = [
      'contacts',
      'conversations',
      'conversation_status_history',
      'outbox:conversation.created',
      'messages',
      'outbox:message.persisted',
      'conversation_state',
    ] as const;

    for (const point of FAULT_POINTS) {
      it(`AC2 — falha em "${point}": rollback total, sem hint, retry consistente`, async () => {
        const tag = `prod08-ac2-${randomUUID()}`;
        const externalConversationId = `${tag}-conv`;
        const externalMessageId = `${tag}-msg`;
        const content = `conteudo-ac2-${tag}`;
        const phone = uniquePhone();
        const phoneDigits = phone.replace(/\D/g, '');
        const input: PersistInboundInputLike = {
          externalMessageId,
          externalConversationId,
          content,
          sender: phone,
          senderType: 'contact',
          contactPhone: phone,
          contactName: 'AC2',
          sentAt: new Date(),
        };

        await settleHints();
        const before = await tableCounts();
        const hintsBefore = hintCountFor(content);

        await armFault(point);
        await expectInjectedFailure(persistInboundAtomically(input));

        const after = await tableCounts();
        expect(after).toEqual(before);
        expect(await messageById(externalMessageId)).toBeNull();
        expect(await conversationsByExternalId(externalConversationId)).toHaveLength(0);
        expect(await outboxRows(tag)).toHaveLength(0);
        expect(await count('SELECT count(*)::int AS n FROM contacts WHERE phone = $1', [phoneDigits])).toBe(0);
        await new Promise((resolve) => setTimeout(resolve, 120));
        expect(hintCountFor(content)).toBe(hintsBefore);

        await disarmFaults();
        const retried = await persistInboundAtomically(input);
        expect(retried.isDuplicate).toBe(false);
        expect(retried.message.id).toBeTruthy();
        expect(await messageById(externalMessageId)).toMatchObject({ id: retried.message.id });
        expect(await conversationsByExternalId(externalConversationId)).toHaveLength(1);
        expect((await conversationsByExternalId(externalConversationId))[0]!.unread).toBe(1);
        expect(await outboxByAggregate(retried.conversation.id, 'conversation.created')).toHaveLength(1);
        expect(await outboxByAggregate(retried.message.id, 'message.persisted')).toHaveLength(1);
        expect(await count('SELECT count(*)::int AS n FROM conversation_status_history WHERE conversation_id = $1', [retried.conversation.id])).toBe(1);
        expect(await count('SELECT count(*)::int AS n FROM contacts WHERE phone = $1', [phoneDigits])).toBe(1);

        evidence.push({ case: `AC2-${point}`, rollbackDelta: after, retryMessageId: retried.message.id });
      });
    }

    it('AC2 — vínculo contato↔conversa existente participa da transação (falha desfaz tudo)', async () => {
      const tag = `prod08-ac2-attach-${randomUUID()}`;
      const externalConversationId = `${tag}-conv`;
      const externalMessageId = `${tag}-msg`;
      const conversationId = await insertConversation({ externalConversationId });
      const phone = uniquePhone();
      const phoneDigits = phone.replace(/\D/g, '');
      const input: PersistInboundInputLike = {
        externalMessageId,
        externalConversationId,
        content: `conteudo-ac2-attach-${tag}`,
        sender: phone,
        senderType: 'contact',
        contactPhone: phone,
        contactName: 'AC2 attach',
        sentAt: new Date(),
      };

      await armFault('conversation_state');
      await expectInjectedFailure(persistInboundAtomically(input));

      const untouched = await pool.query<{ contact_id: string | null }>(
        'SELECT contact_id FROM conversations WHERE id = $1',
        [conversationId],
      );
      expect(untouched.rows[0]!.contact_id).toBeNull();
      expect(await count('SELECT count(*)::int AS n FROM contacts WHERE phone = $1', [phoneDigits])).toBe(0);
      expect(await messageById(externalMessageId)).toBeNull();
      expect(await outboxByAggregate(conversationId, 'message.persisted')).toHaveLength(0);

      await disarmFaults();
      const retried = await persistInboundAtomically(input);
      expect(retried.isDuplicate).toBe(false);
      const linked = await pool.query<{ contact_id: string | null; unread_count: number }>(
        'SELECT contact_id, unread_count::int AS unread_count FROM conversations WHERE id = $1',
        [conversationId],
      );
      expect(linked.rows[0]!.contact_id).not.toBeNull();
      expect(linked.rows[0]!.unread_count).toBe(1);
      expect(
        await count('SELECT count(*)::int AS n FROM contacts WHERE phone = $1', [phoneDigits]),
      ).toBe(1);
      expect(await outboxByAggregate(retried.message.id, 'message.persisted')).toHaveLength(1);

      evidence.push({ case: 'AC2-attach-contact', conversationId, messageId: retried.message.id, linked: true });
    });

    it('AC2 — hint somente depois do commit; durante a transação aberta nada vaza', async () => {
      const tag = `prod08-ac2-hint-${randomUUID()}`;
      const externalConversationId = `${tag}-conv`;
      const externalMessageId = `${tag}-msg`;
      const content = `conteudo-ac2-hint-${tag}`;
      const input: PersistInboundInputLike = {
        externalMessageId,
        externalConversationId,
        content,
        sender: '+5511900000999',
        senderType: 'contact',
        sentAt: new Date(),
      };

      const held = deferred<void>();
      const release = deferred<void>();
      const original = conversationRepository.markInboundUnread.bind(conversationRepository);
      let firstCall = true;
      vi.spyOn(conversationRepository, 'markInboundUnread').mockImplementation(async (id: string, executor?: unknown) => {
        const result = await original(id, executor);
        if (firstCall) {
          firstCall = false;
          held.resolve();
          await release.promise;
        }
        return result;
      });

      await settleHints();
      const hintsBefore = hintCountFor(content);
      const pending = persistInboundAtomically(input);
      await held.promise;

      // Transação ainda aberta: terceiro (outra conexão) não enxerga escrita
      // aberta e NENHUM hint saiu.
      expect(await messageById(externalMessageId)).toBeNull();
      expect(await outboxRows(tag)).toHaveLength(0);
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(hintCountFor(content)).toBe(hintsBefore);

      release.resolve();
      const committed = await pending;
      expect(committed.isDuplicate).toBe(false);
      expect(await waitFor(() => hintCountFor(content) === 1)).toBe(true);

      const persisted = await outboxRows(tag, 'message.persisted');
      expect(persisted).toHaveLength(1);
      const hint = hints.find((entry) => entry.payload?.content === content);
      expect(hint?.event_id).toBe(persisted[0]!.event_id);

      evidence.push({
        case: 'AC2-hint-pos-commit',
        messageId: committed.message.id,
        hintEventId: hint?.event_id,
        persistedEventId: persisted[0]!.event_id,
      });
    });
  });

  describe('AC3 — keyset com timestamps empatados, inserts concorrentes e escopo', () => {
    async function pageThrough(sectorId: string, limit: number): Promise<string[]> {
      const seen: string[] = [];
      let cursor: unknown = null;
      for (let guard = 0; guard < 50; guard += 1) {
        const page = await conversationRepository.findPage({ sectorId }, limit, cursor);
        for (const item of page.items) seen.push(item.id);
        if (!page.nextKeyset) break;
        cursor = page.nextKeyset;
      }
      return seen;
    }

    it('AC3a — ordem total determinística com updatedAt empatado (sem pular/duplicar)', async () => {
      const tag = `prod08-ac3a-${randomUUID()}`;
      const sectorId = await insertSector(tag);
      const stamp = new Date('2026-09-13T12:00:00.000Z');
      const fixtures: Array<{ id: string; unread: number; handler: 'bot' | 'human' }> = [];
      for (let group = 0; group < 3; group += 1) {
        for (let index = 0; index < 3; index += 1) {
          const unread = group >= 1 ? 1 : 0;
          const handler = group === 2 ? 'human' : 'bot';
          fixtures.push({
            id: await insertConversation({
              externalConversationId: `${tag}-${group}-${index}`,
              sectorId,
              updatedAt: stamp,
              unread,
              handler,
            }),
            unread,
            handler,
          });
        }
      }

      const seen = await pageThrough(sectorId, 2);
      expect(seen).toHaveLength(fixtures.length);
      expect(new Set(seen).size).toBe(fixtures.length);

      const expected = [...fixtures]
        .sort((a, b) => {
          if (a.unread !== b.unread) return b.unread - a.unread;
          const handlerRank = (value: 'bot' | 'human') => (value === 'human' ? 1 : 0);
          if (handlerRank(a.handler) !== handlerRank(b.handler)) return handlerRank(b.handler) - handlerRank(a.handler);
          return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
        })
        .map((row) => row.id);
      expect(seen).toEqual(expected);

      evidence.push({ case: 'AC3a-ordem-total', sectorId, rows: fixtures.length, pageSize: 2, ordered: true });
    });

    it('AC3b — inserts concorrentes durante a paginação não pulam/duplicam linhas existentes', async () => {
      const tag = `prod08-ac3b-${randomUUID()}`;
      const sectorId = await insertSector(tag);
      const stamp = new Date('2026-09-13T12:30:00.000Z');
      const originalIds: string[] = [];
      for (let index = 0; index < 6; index += 1) {
        originalIds.push(
          await insertConversation({ externalConversationId: `${tag}-orig-${index}`, sectorId, updatedAt: stamp }),
        );
      }

      const firstPage = await conversationRepository.findPage({ sectorId }, 2);
      expect(firstPage.items).toHaveLength(2);
      expect(firstPage.nextKeyset).not.toBeNull();

      // Inserts concorrentes com o MESMO timestamp empatado ENQUANTO as
      // páginas seguintes são montadas. A chave de ordenação inclui o id
      // (desempate total), então a paginação não pula/duplica os originais.
      const seen: string[] = firstPage.items.map((item) => item.id);
      const traversal = (async () => {
        let cursor: unknown = firstPage.nextKeyset;
        for (let guard = 0; guard < 50 && cursor; guard += 1) {
          const page = await conversationRepository.findPage({ sectorId }, 2, cursor);
          for (const item of page.items) seen.push(item.id);
          cursor = page.nextKeyset;
        }
      })();
      const insertedIds = await Promise.all([
        insertConversation({ externalConversationId: `${tag}-new-a`, sectorId, updatedAt: stamp }),
        insertConversation({ externalConversationId: `${tag}-new-b`, sectorId, updatedAt: stamp }),
      ]);
      await traversal;

      expect(new Set(seen).size).toBe(seen.length);
      for (const id of originalIds) {
        expect(seen).toContain(id);
      }
      for (const id of insertedIds) {
        expect(seen.filter((value) => value === id).length).toBeLessThanOrEqual(1);
      }

      evidence.push({
        case: 'AC3b-inserts-concorrentes',
        sectorId,
        originals: originalIds.length,
        inserted: insertedIds.length,
        seen: seen.length,
        duplicates: seen.length - new Set(seen).size,
      });
    });

    it('AC3c — escopo por setor: membership limita, ausência nega, globalAdmin explícito libera', async () => {
      const tag = `prod08-ac3c-${randomUUID()}`;
      const sectorA = await insertSector(`${tag}-a`);
      const sectorB = await insertSector(`${tag}-b`);
      const member = await insertUser(`prod08-${tag}-member@example.com`);
      const outsider = await insertUser(`prod08-${tag}-outsider@example.com`);
      await insertMembership(member, sectorA);

      const convA1 = await insertConversation({ externalConversationId: `${tag}-a1`, sectorId: sectorA });
      const convA2 = await insertConversation({ externalConversationId: `${tag}-a2`, sectorId: sectorA });
      const convB1 = await insertConversation({ externalConversationId: `${tag}-b1`, sectorId: sectorB });

      const memberPage = await conversationRepository.findPage({ userId: member }, 50);
      expect(memberPage.items.map((item) => item.id).sort()).toEqual([convA1, convA2].sort());
      expect(memberPage.items.every((item) => item.sectorId === sectorA)).toBe(true);

      const outsiderPage = await conversationRepository.findPage({ userId: outsider }, 50);
      expect(outsiderPage.items).toHaveLength(0);

      const adminPage = await conversationRepository.findPage({ userId: outsider, globalAdmin: true }, 100);
      const adminIds = adminPage.items.map((item) => item.id);
      for (const id of [convA1, convA2, convB1]) {
        expect(adminIds).toContain(id);
      }

      const actorScope = conversationCursorScope(member, { userId: member, sectorId: sectorA });
      const otherScope = conversationCursorScope(outsider, { userId: outsider, globalAdmin: true });
      expect(actorScope).not.toBe(otherScope);
      const encoded = encodeConversationCursor(
        { unread: 0, handler: 0, updatedAt: '2026-09-13T12:00:00.000000', id: convA1 },
        actorScope,
      );
      expect(decodeConversationCursor(encoded, actorScope)).not.toBeNull();
      expect(decodeConversationCursor(encoded, otherScope)).toBeNull();
      expect(decodeConversationCursor('not-a-cursor', actorScope)).toBeNull();

      evidence.push({
        case: 'AC3c-escopo-setor',
        memberItems: memberPage.items.length,
        outsiderItems: outsiderPage.items.length,
        adminContainsAll: [convA1, convA2, convB1].every((id) => adminIds.includes(id)),
        cursorScopeMismatchRejected: true,
      });
    });
  });

  describe('AC4 — órfãos legados: dry-run e reconciliação com aprovação', () => {
    it('AC4a — dry-run identifica conversa sem NENHUMA mensagem e não muta nada', async () => {
      const tag = `prod08-ac4a-${randomUUID()}`;
      const orphanId = await insertConversation({ externalConversationId: `${tag}-orphan` });
      const withMessageId = await insertConversation({ externalConversationId: `${tag}-healthy` });
      await insertMessage(withMessageId, `${tag}-msg`, 'mensagem viva');
      const contactlessWithMessageId = await insertConversation({ externalConversationId: `${tag}-contactless` });
      await insertMessage(contactlessWithMessageId, `${tag}-msg-2`, 'sem contato, com mensagem');
      const nullExternalOrphanId = await insertConversation({ externalConversationId: null });

      const before = await pool.query<{ id: string; is_active: boolean; updated_at: Date }>(
        'SELECT id, is_active, updated_at FROM conversations WHERE id = $1',
        [orphanId],
      );
      const report = await findOrphanConversations({ limit: 1000 });
      const byId = new Map(report.candidates.map((candidate) => [candidate.id, candidate]));
      expect(report.criterion).toBe('conversation_without_messages');
      expect(byId.has(orphanId)).toBe(true);
      expect(byId.has(nullExternalOrphanId)).toBe(true);
      expect(byId.has(withMessageId)).toBe(false);
      expect(byId.has(contactlessWithMessageId)).toBe(false);
      expect(byId.get(orphanId)?.hasStatusHistory).toBe(false);
      expect(byId.get(orphanId)?.isActive).toBe(true);

      const after = await pool.query<{ id: string; is_active: boolean; updated_at: Date }>(
        'SELECT id, is_active, updated_at FROM conversations WHERE id = $1',
        [orphanId],
      );
      expect(after.rows[0]!.is_active).toBe(before.rows[0]!.is_active);
      expect(new Date(after.rows[0]!.updated_at).getTime()).toBe(new Date(before.rows[0]!.updated_at).getTime());

      evidence.push({
        case: 'AC4a-dry-run',
        criterion: report.criterion,
        candidates: report.totalCandidates,
        orphanDetected: true,
        healthyNotCandidate: true,
        nullExternalIdDetected: true,
        mutated: false,
      });
    });

    it('AC4b — reconciliação exige aprovação, arquiva sem apagar mensagens e é idempotente', async () => {
      const tag = `prod08-ac4b-${randomUUID()}`;
      const orphanId = await insertConversation({ externalConversationId: `${tag}-orphan` });
      const healthyId = await insertConversation({ externalConversationId: `${tag}-healthy` });
      const messageId = await insertMessage(healthyId, `${tag}-msg`, 'mensagem que não pode sumir');
      const messagesBefore = await count('SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1', [healthyId]);

      const denied = await reconcileOrphanConversations({ externalIdPrefix: tag });
      expect(denied.applied).toBe(false);
      expect(denied.reason).toBe('approval_required');
      expect(denied.archivedIds).toHaveLength(0);
      const stillActive = await pool.query<{ is_active: boolean }>('SELECT is_active FROM conversations WHERE id = $1', [orphanId]);
      expect(stillActive.rows[0]!.is_active).toBe(true);

      const applied = await reconcileOrphanConversations({ externalIdPrefix: tag, approve: true, actor: undefined });
      expect(applied.applied).toBe(true);
      expect(applied.reason).toBe('archived');
      expect(applied.archivedIds).toEqual([orphanId]);

      const archived = await pool.query<{ is_active: boolean; status: string; status_v2: string; closed_at: Date | null }>(
        'SELECT is_active, status::text AS status, status_v2::text AS status_v2, closed_at FROM conversations WHERE id = $1',
        [orphanId],
      );
      expect(archived.rows[0]).toMatchObject({ is_active: false, status: 'archived', status_v2: 'arquivado' });
      expect(archived.rows[0]!.closed_at).not.toBeNull();
      expect(
        await count('SELECT count(*)::int AS n FROM conversation_status_history WHERE conversation_id = $1', [orphanId]),
      ).toBeGreaterThanOrEqual(1);

      // Nenhuma mensagem apagada; saudável intocada.
      expect(await count('SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1', [healthyId])).toBe(messagesBefore);
      expect(await messageById(`${tag}-msg`)).toMatchObject({ id: messageId });
      const healthy = await pool.query<{ is_active: boolean }>('SELECT is_active FROM conversations WHERE id = $1', [healthyId]);
      expect(healthy.rows[0]!.is_active).toBe(true);

      const second = await reconcileOrphanConversations({ externalIdPrefix: tag, approve: true });
      expect(second.applied).toBe(true);
      expect(second.reason).toBe('no_candidates');
      expect(second.archivedIds).toHaveLength(0);

      evidence.push({
        case: 'AC4b-reconciliacao',
        approvalRequired: denied.reason,
        archivedIds: applied.archivedIds,
        status: archived.rows[0]!.status,
        messagesPreserved: messagesBefore,
        idempotentSecondRun: second.reason,
      });
    });
  });
});
