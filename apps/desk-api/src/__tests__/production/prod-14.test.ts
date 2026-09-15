/**
 * PROD-14 — mídia inbound em quarentena + acesso privado (G04/C06, BE15/BE16/UI04).
 *
 * Prova real em PostgreSQL isolado (run `prod14`, worker 23, portas dedicadas),
 * com STORAGE real (moto S3-compatible, processo próprio do run) e SCANNER real
 * (clamd local em 127.0.0.1:53110, assinaturas EICAR). HTTP real via
 * `app.inject` do app de produção (`buildDeskApiApp`):
 *
 *   AC1 — webhook `/gateway/inbound` com mídia: mensagem persistida SEM URL
 *         crua; pipeline assíncrono busca com safeRemoteFetch, grava em
 *         quarentena privada, escaneia e só CLEAN+STORED publica
 *         `asset://<id>`; scanner ausente/INFECTED/timeout ficam indisponíveis;
 *         mensagem/negócio preservados com estado da mídia registrado.
 *   AC2 — leitura `GET /conversations/:id/media/:assetId` autenticada e
 *         autorizada pela conversa; asset privado sem URL pública; TTL de
 *         cache; 16MiB, magic bytes e SSRF negados; códigos claros para
 *         INFECTED/PENDING/SCAN_FAILED; nunca asset de outra conversa.
 *   AC3 — flag real `MEDIA_PIPELINE_ENABLED` (default seguro) e DTO sem URL
 *         crua (metadata de intake removida; asset não-pronto nunca público).
 *   AC4 — evidência desta execução com serviços reais; falhas de serviço
 *         ausente são BLOCKED, nunca PASS.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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

interface PgRuntime {
  Client: new (config: { connectionString: string }) => PgClientLike;
  Pool: new (config: { connectionString: string; max?: number }) => PgClientLike;
}

interface Harness {
  teardownIsolatedEnv: (
    ctx: RunContext,
    options?: { stopServices?: boolean; dropDatabase?: boolean },
  ) => Record<string, unknown>;
}

interface InboundMediaPipelineModule {
  waitForInboundMediaProcessing: (messageId?: string, timeoutMs?: number) => Promise<void>;
  enqueueInboundMediaProcessing: (input: {
    messageId: string;
    conversationId: string;
    sourceUrl: string;
    mediaType?: string;
    mimetype?: string;
    filename?: string;
  }) => Promise<{ state: string; assetId?: string }>;
  recoverPendingInboundMedia: (limit?: number, options?: {
    messageId?: string;
    owner?: string;
    leaseSeconds?: number;
    maxAttempts?: number;
    backoffBaseMs?: number;
    backoffMaxMs?: number;
  }) => Promise<number>;
  isInboundMediaPipelineEnabled: (env?: NodeJS.ProcessEnv) => boolean;
}

interface LegacyDryRunItem {
  kind: string;
  migrationKey: string;
  messageId: string | null;
  conversationId: string | null;
  assetId: string | null;
  mediaUrl: string | null;
  scanStatus: string | null;
  storageStatus: string | null;
}

interface LegacyDryRunReport {
  readOnly: boolean;
  generatedAt: string;
  counts: Record<string, number>;
  totalCandidates: number;
  items: LegacyDryRunItem[];
}

interface LegacyMigrationReport {
  generatedAt: string;
  dryRun: { counts: Record<string, number>; totalCandidates: number };
  published: Array<{ messageId: string; conversationId: string; assetId: string; storageKey: string | null }>;
  blocked: Array<{ messageId: string; assetId?: string; scanStatus?: string; reasonCode: string }>;
  pending: Array<{ messageId: string; reasonCode: string }>;
  unavailable: Array<{ messageId?: string; assetId?: string; reasonCode: string; reason: string }>;
  skipped: Array<{ messageId?: string; assetId?: string; reason: string }>;
  revalidated: number;
}

interface LegacyMediaMigrationModule {
  migrateLegacyInboundMedia: (options?: {
    limit?: number;
    revalidate?: boolean;
    revalidateLimit?: number;
  }) => Promise<LegacyMigrationReport>;
  revalidatePendingLegacyInboundMedia: (limit?: number, timeoutMs?: number) => Promise<number>;
}

interface MediaModule {
  processInboundMedia: (input: {
    messageId?: string;
    conversationId?: string;
    actorId?: string;
    mediaType?: string;
    mimetype?: string;
    filename?: string;
    url?: string;
    bytes?: Buffer;
    fetchRemote?: boolean;
  }) => Promise<{
    assetId: string;
    storageStatus: string;
    scanStatus: string;
    blocked?: boolean;
    reasonCode?: string;
    sha256?: string;
    storageKey?: string;
    mimetype?: string;
  }>;
  dryRunLegacyMediaMigration: (options?: { limit?: number }) => Promise<LegacyDryRunReport>;
  getMediaMaxBytes: () => number;
  setMediaStorage: (storage: unknown) => void;
  resetMediaStorage: () => void;
  S3MediaStorage: new (config: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
    client?: unknown;
  }) => {
    driver: string;
    exists(key: string): Promise<boolean>;
    get(key: string): Promise<Buffer>;
    put(input: { key: string; body: Buffer; contentType: string }): Promise<{ etag?: string }>;
  };
}

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../../..');
const PROGRAM_DIR = process.env.CVG_PROGRAM_DIR || join(REPO_ROOT, 'docs', 'producao-2026-09-13');
const EVIDENCE_SEGMENT = process.env.CVG_EVIDENCE_SEGMENT?.trim();
const EVIDENCE_DIR = join(
  PROGRAM_DIR,
  'evidencias',
  'prod-14',
  ...(EVIDENCE_SEGMENT ? [EVIDENCE_SEGMENT] : []),
);
const LOG_DIR = join(EVIDENCE_DIR, 'logs');
const MIGRATIONS_DIR = join(REPO_ROOT, 'packages', 'database', 'supabase', 'migrations');
const RUN_ID = process.env.AAA_RUN_ID || 'prod14';
const WORKER_INDEX = Number(process.env.AAA_WORKER_INDEX || '23');
const WEBHOOK_SECRET = 'prod14-webhook-secret';
const INTERNAL_SECRET = 'prod14-internal-secret';
const PASSWORD = 'Str0ngPass!42';
const PASSWORD_HASH = '$2a$10$QMxMJ8QfVxjH93DvTDs2m.OVuALoBBR6S9d58BwIPb8rcXHsUBJWC';
const CLAMAV_HOST = process.env.PROD14_CLAMAV_HOST || '127.0.0.1';
const CLAMAV_PORT = Number(process.env.PROD14_CLAMAV_PORT || '53110');
const MOTO_PYTHON = process.env.PROD14_MOTO_PYTHON || '/tmp/opencode/moto-venv/bin/python';

process.env.CVG_PROGRAM_DIR = PROGRAM_DIR;
process.env.CVG_RUNTIME_DIR = process.env.CVG_RUNTIME_DIR || join(EVIDENCE_DIR, 'runtime');
process.env.AAA_RUN_ID = RUN_ID;
process.env.AAA_WORKER_INDEX = String(WORKER_INDEX);
process.env.NODE_ENV = 'test';
process.env.DESK_ENV = 'test';
process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;
process.env.INTERNAL_EVENTS_SECRET = INTERNAL_SECRET;
process.env.USE_DATABASE_OUTBOX = 'false';
process.env.REALTIME_POLL_INTERVAL_MS = '600000';
// O DATABASE_URL só é definido após provisionar o PG isolado (nunca o host).
delete process.env.DATABASE_URL;

vi.setConfig({ testTimeout: 180_000, hookTimeout: 600_000 });

const EICAR = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('prod14-png-payload'),
]);
const BLACKHOLE_MS = 8000;

function dataUrl(mimetype: string, bytes: Buffer): string {
  return `data:${mimetype};base64,${bytes.toString('base64')}`;
}

const evidence: Array<Record<string, unknown>> = [];

function writeEvidenceJson(name: string, value: unknown): void {
  writeFileSync(join(EVIDENCE_DIR, name), `${JSON.stringify(value, null, 2)}\n`);
}

function getFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as net.AddressInfo;
      server.close(() => resolvePort(address.port));
    });
  });
}

async function waitForTcpPort(port: number, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const open = await new Promise<boolean>((resolveOpen) => {
      const socket = net.connect(port, '127.0.0.1');
      const finish = (value: boolean) => {
        socket.destroy();
        resolveOpen(value);
      };
      socket.once('connect', () => finish(true));
      socket.once('error', () => finish(false));
      socket.setTimeout(500, () => finish(false));
    });
    if (open) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`porta ${port} não abriu em ${timeoutMs}ms`);
}

function clamdPing(): Promise<boolean> {
  return new Promise((resolvePing) => {
    const socket = net.connect(CLAMAV_PORT, CLAMAV_HOST);
    let reply = '';
    const timer = setTimeout(() => {
      socket.destroy();
      resolvePing(false);
    }, 3000);
    socket.on('connect', () => socket.write('zPING\0'));
    socket.on('data', (chunk) => {
      reply += chunk.toString();
    });
    socket.on('end', () => {
      clearTimeout(timer);
      resolvePing(reply.includes('PONG'));
    });
    socket.on('error', () => {
      clearTimeout(timer);
      resolvePing(false);
    });
  });
}

async function startBlackhole(): Promise<{ port: number; close: () => Promise<void> }> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
  });
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    close: () =>
      new Promise<void>((done) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => done());
      }),
  };
}

let ctx: RunContext;
let isolatedEnv: { databaseName: string; marker: { runId: string } };
let pg: PgRuntime;
let harness: Harness;
let pool: PgClientLike;
let app: FastifyInstance | null = null;
let databaseModulePool: PgClientLike | undefined;
let moto: ChildProcess | null = null;
let motoPort = 0;
let s3Endpoint = '';
let s3Bucket = '';
let storage: InstanceType<MediaModule['S3MediaStorage']> | null = null;
let mediaModule: MediaModule | null = null;
let pipelineModule: InboundMediaPipelineModule | null = null;
let legacyModule: LegacyMediaMigrationModule | null = null;

interface LegacyFixtureSet {
  conversationId: string;
  cleanMessageId: string;
  eicarMessageId: string;
  pendingMessageId: string;
  brokenMessageId: string;
  brokenAssetId: string;
  externalAssetId: string;
}

let legacyFixture: LegacyFixtureSet | null = null;
let adminToken = '';
let receptionistToken = '';
let adminUserId = '';
let receptionistUserId = '';
const s3ClientRef: { current: unknown } = { current: null };

function databaseUrl(): string {
  return `postgresql://cvg_aaa@127.0.0.1:${ctx.ports.postgres}/${isolatedEnv.databaseName}`;
}

function signRawBody(rawBody: string, timestamp: number): string {
  return createHmac('sha256', WEBHOOK_SECRET).update(`${timestamp}.${rawBody}`).digest('hex');
}

function gatewayBody(input: {
  messageId: string;
  instance: string;
  remoteJid: string;
  text?: string;
  type?: string;
  media?: { url: string; mimetype: string; filename?: string };
}): string {
  return JSON.stringify({
    contract_version: '1.0.0',
    event_type: 'WA_INBOUND',
    event_id: `evt-${input.messageId}`,
    correlation_id: `corr-${input.messageId}`,
    occurred_at: new Date().toISOString(),
    tenant: 'cvg',
    provider: 'prod14-sandbox',
    channel: 'whatsapp',
    payload: {
      instance: input.instance,
      remoteJid: input.remoteJid,
      messageId: input.messageId,
      fromMe: false,
      pushName: 'Prod14 Contato',
      type: input.type ?? 'image',
      text: input.text ?? '',
      ...(input.media ? { media: input.media } : {}),
      timestamp: Math.floor(Date.now() / 1000),
    },
  });
}

async function postGatewayInbound(
  rawBody: string,
  eventId: string,
  timestamp = Math.floor(Date.now() / 1000),
) {
  if (!app) throw new Error('app não inicializado');
  return app.inject({
    method: 'POST',
    url: '/gateway/inbound',
    headers: {
      'content-type': 'application/json',
      'x-webhook-signature': `sha256=${signRawBody(rawBody, timestamp)}`,
      'x-webhook-timestamp': String(timestamp),
      'x-webhook-event-id': eventId,
    },
    payload: rawBody,
  });
}

interface MessageRow {
  id: string;
  conversation_id: string;
  media_url: string | null;
  media_type: string | null;
  media_mimetype: string | null;
  media_filename: string | null;
  metadata: string | null;
  content: string;
  media_intake_attempt_count: number;
  media_intake_next_attempt_at: string | null;
  media_intake_lease_owner: string | null;
  media_intake_lease_until: string | null;
  media_intake_last_error: string | null;
}

interface AssetRow {
  id: string;
  storage_key: string | null;
  storage_status: string;
  scan_status: string;
  mime_type: string | null;
  size_bytes: number | null;
  sha256: string | null;
}

async function getMessage(messageId: string): Promise<MessageRow> {
  const result = await pool.query<MessageRow>('SELECT * FROM messages WHERE id = $1', [messageId]);
  const row = result.rows[0];
  if (!row) throw new Error(`mensagem ${messageId} ausente`);
  return row;
}

async function getAssets(messageId: string): Promise<AssetRow[]> {
  const result = await pool.query<AssetRow>('SELECT * FROM media_assets WHERE message_id = $1', [messageId]);
  return result.rows;
}

function intakeOf(message: MessageRow): Record<string, unknown> {
  if (!message.metadata) return {};
  const parsed = JSON.parse(message.metadata) as Record<string, unknown>;
  return (parsed.mediaIntake as Record<string, unknown>) ?? {};
}

async function login(email: string): Promise<string> {
  if (!app) throw new Error('app não inicializado');
  const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: PASSWORD } });
  expect(response.statusCode, response.body).toBe(200);
  return (response.json() as { token: string }).token;
}

async function insertUser(email: string, name: string, role: string): Promise<string> {
  const id = randomUUID();
  await pool.query(
    'INSERT INTO users (id, name, email, password_hash, is_active) VALUES ($1, $2, $3, $4, true)',
    [id, name, email, PASSWORD_HASH],
  );
  const roleResult = await pool.query<{ id: string }>('SELECT id FROM roles WHERE name = $1 LIMIT 1', [role]);
  let roleId = roleResult.rows[0]?.id;
  if (!roleId) {
    const created = await pool.query<{ id: string }>('INSERT INTO roles (name) VALUES ($1) RETURNING id', [role]);
    roleId = created.rows[0].id;
  }
  await pool.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [id, roleId]);
  return id;
}

async function drain(messageId: string): Promise<void> {
  if (!pipelineModule) throw new Error('pipeline não importado');
  await pipelineModule.waitForInboundMediaProcessing(messageId, 30_000);
}

async function createLegacyConversation(): Promise<string> {
  const id = randomUUID();
  await pool.query('INSERT INTO conversations (id) VALUES ($1)', [id]);
  return id;
}

async function insertLegacyMessage(input: {
  conversationId: string;
  content: string;
  mediaUrl: string | null;
  mediaType?: string;
  mimetype?: string;
  filename?: string;
  metadata?: Record<string, unknown>;
}): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO messages (id, conversation_id, direction, content, status, media_url, media_type, media_mimetype, media_filename, metadata)
     VALUES ($1, $2, 'inbound', $3, 'delivered', $4, $5, $6, $7, $8)`,
    [
      id,
      input.conversationId,
      input.content,
      input.mediaUrl,
      input.mediaType ?? null,
      input.mimetype ?? null,
      input.filename ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
    ],
  );
  return id;
}

async function insertExternalAsset(input: { messageId: string; mimeType: string }): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO media_assets (id, message_id, storage_driver, mime_type, scan_status, storage_status)
     VALUES ($1, $2, 'external', $3, 'PENDING_SCAN', 'EXTERNAL')`,
    [id, input.messageId, input.mimeType],
  );
  return id;
}

/** Fotografia determinística das tabelas afetadas pelo dry-run (0 mutações). */
async function snapshotMessagesAndAssets(): Promise<string> {
  const messages = await pool.query('SELECT * FROM messages ORDER BY id');
  const assets = await pool.query('SELECT * FROM media_assets ORDER BY id');
  return JSON.stringify({ messages: messages.rows, assets: assets.rows });
}

beforeAll(async () => {
  mkdirSync(LOG_DIR, { recursive: true });

  const runContextSpecifier = '../../../../../e2e/support/aaa/run-context.ts';
  const isolatedEnvSpecifier = '../../../../../e2e/support/aaa/isolated-env.ts';
  const pgSpecifier = 'pg';
  const runContextModule = (await import(/* @vite-ignore */ runContextSpecifier)) as {
    getRunContext: (workerIndex?: number) => RunContext;
  };
  const isolatedEnvModule = (await import(/* @vite-ignore */ isolatedEnvSpecifier)) as {
    provisionIsolatedEnv: (context: RunContext) => Promise<{ databaseName: string; marker: { runId: string } }>;
    teardownIsolatedEnv: Harness['teardownIsolatedEnv'];
  };
  const pgModule = (await import(/* @vite-ignore */ pgSpecifier)) as unknown as { default?: PgRuntime } & PgRuntime;
  pg = (pgModule.default ?? pgModule) as PgRuntime;
  harness = { teardownIsolatedEnv: isolatedEnvModule.teardownIsolatedEnv };

  ctx = runContextModule.getRunContext(WORKER_INDEX);
  isolatedEnv = await isolatedEnvModule.provisionIsolatedEnv(ctx);
  process.env.DATABASE_URL = databaseUrl();

  pool = new pg.Pool({ connectionString: databaseUrl(), max: 6 });

  const { drizzle } = await import('drizzle-orm/node-postgres');
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  await migrate(drizzle(pool as never) as never, { migrationsFolder: MIGRATIONS_DIR });

  // Scanner real: clamd com assinaturas (EICAR). Ausência = BLOCKED explícito.
  if (!(await clamdPing())) {
    throw new Error(
      `BLOCKED (PROD-14): clamd real não respondeu zPING em ${CLAMAV_HOST}:${CLAMAV_PORT}. `
      + 'Provisione ClamAV local antes de executar; a prova de scanner real NÃO pode ser simulada.',
    );
  }

  // Storage real S3-compatible: moto server do PRÓPRIO run (porta livre).
  motoPort = await getFreePort();
  s3Endpoint = `http://127.0.0.1:${motoPort}`;
  s3Bucket = `cvg-media-prod14-${randomUUID().slice(0, 8)}`;
  const motoLog = join(LOG_DIR, 'moto-server.log');
  const motoOut = await import('node:fs').then((fs) => fs.openSync(motoLog, 'w'));
  moto = spawn(MOTO_PYTHON, ['-m', 'moto.server', '-p', String(motoPort), '-H', '127.0.0.1'], {
    stdio: ['ignore', motoOut, motoOut],
  });
  moto.on('error', (error) => {
    throw new Error(`BLOCKED (PROD-14): falha ao iniciar moto S3 real: ${error.message}`);
  });
  await waitForTcpPort(motoPort);

  const requireFromMedia = createRequire(import.meta.url);
  const s3Entry = requireFromMedia.resolve('@aws-sdk/client-s3', { paths: [join(REPO_ROOT, 'packages', 'media')] });
  const s3Sdk = (await import(pathToFileURL(s3Entry).href)) as {
    S3Client: new (config: Record<string, unknown>) => unknown;
    CreateBucketCommand: new (input: { Bucket: string }) => unknown;
    HeadObjectCommand: new (input: { Bucket: string; Key: string }) => unknown;
    DeleteObjectsCommand: new (input: { Bucket: string; Delete: { Objects: Array<{ Key: string }> } }) => unknown;
    ListObjectsV2Command: new (input: { Bucket: string; Prefix: string }) => unknown;
  };
  const s3Client = new s3Sdk.S3Client({
    endpoint: s3Endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: 'prod14key', secretAccessKey: 'prod14secret' },
  });
  s3ClientRef.current = s3Client;
  await (s3Client as { send(command: unknown): Promise<unknown> }).send(new s3Sdk.CreateBucketCommand({ Bucket: s3Bucket }));

  // Configuração de produção ANTES de importar o app (guard captura no registro).
  process.env.MEDIA_STORAGE_DRIVER = 's3';
  process.env.S3_ENDPOINT = s3Endpoint;
  process.env.S3_REGION = 'us-east-1';
  process.env.S3_BUCKET = s3Bucket;
  process.env.S3_ACCESS_KEY_ID = 'prod14key';
  process.env.S3_SECRET_ACCESS_KEY = 'prod14secret';
  process.env.S3_FORCE_PATH_STYLE = 'true';
  process.env.MALWARE_SCANNER = 'clamav';
  process.env.CLAMAV_HOST = CLAMAV_HOST;
  process.env.CLAMAV_PORT = String(CLAMAV_PORT);
  process.env.MEDIA_PIPELINE_ENABLED = 'true';
  process.env.MEDIA_MAX_BYTES = String(16 * 1024 * 1024);
  process.env.MEDIA_SIGNED_URL_TTL_SECONDS = '120';
  delete process.env.MEDIA_FETCH_REMOTE;

  mediaModule = (await import(/* @vite-ignore */ '../../../../../packages/media/src/index.ts')) as unknown as MediaModule;
  pipelineModule = (await import(
    /* @vite-ignore */ '../../../../../modules/chat/src/application/use-cases/inbound-media-pipeline.ts'
  )) as InboundMediaPipelineModule;
  legacyModule = (await import(
    /* @vite-ignore */ '../../../../../modules/chat/src/application/use-cases/legacy-media-migration.ts'
  )) as unknown as LegacyMediaMigrationModule;
  mediaModule.resetMediaStorage();
  storage = new mediaModule.S3MediaStorage({
    endpoint: s3Endpoint,
    region: 'us-east-1',
    bucket: s3Bucket,
    accessKeyId: 'prod14key',
    secretAccessKey: 'prod14secret',
    forcePathStyle: true,
    client: s3Client,
  });
  mediaModule.setMediaStorage(storage);

  const appModule = (await import('../../app.ts')) as {
    buildDeskApiApp: () => Promise<FastifyInstance>;
  };
  app = await appModule.buildDeskApiApp();
  await app.ready();

  const databaseModule = await import('../../../../../packages/database/src/index.ts');
  databaseModulePool = databaseModule.getPool() as unknown as PgClientLike;

  adminUserId = await insertUser('prod14-admin@cvg.test', 'PROD-14 Admin', 'Admin');
  receptionistUserId = await insertUser('prod14-recep@cvg.test', 'PROD-14 Recep', 'Receptionist');
  adminToken = await login('prod14-admin@cvg.test');
  receptionistToken = await login('prod14-recep@cvg.test');
});

afterAll(async () => {
  writeEvidenceJson('prod-14-evidence.json', {
    generatedAt: new Date().toISOString(),
    runId: RUN_ID,
    workerIndex: WORKER_INDEX,
    database: isolatedEnv?.databaseName,
    postgresPort: ctx?.ports.postgres,
    storage: { driver: 's3', endpoint: s3Endpoint, bucket: s3Bucket, backend: 'moto real (S3 protocol)' },
    scanner: { driver: 'clamav', host: CLAMAV_HOST, port: CLAMAV_PORT, real: true },
    users: { adminUserId, receptionistUserId },
    cases: evidence,
  });
  if (app) await app.close().catch(() => undefined);
  if (databaseModulePool) await databaseModulePool.end().catch(() => undefined);
  if (pool) await pool.end().catch(() => undefined);
  if (moto) {
    moto.kill('SIGTERM');
    moto = null;
  }
  if (ctx && harness) {
    harness.teardownIsolatedEnv(ctx, { stopServices: true, dropDatabase: true });
  }
});

describe('PROD-14 — mídia inbound: quarentena, scan real e leitura privada', () => {
  it('AC1 — webhook CLEAN: pipeline produtivo, quarentena→media/, asset:// e leitura autenticada', async () => {
    const suffix = randomUUID().slice(0, 8);
    const messageId = `prod14-clean-${suffix}`;
    const instance = `prod14-${suffix}`;
    const remoteJid = `5511999${suffix.replace(/\D/g, '0')}@s.whatsapp.net`;
    const body = gatewayBody({
      messageId,
      instance,
      remoteJid,
      text: 'foto do exame',
      type: 'image',
      media: { url: dataUrl('image/png', PNG_BYTES), mimetype: 'image/png', filename: 'exame.png' },
    });

    const response = await postGatewayInbound(body, `evt-clean-${suffix}`);
    expect(response.statusCode, response.body).toBe(200);
    const payload = response.json() as { messageId: string; conversationId: string };
    expect(payload.messageId).toBeTypeOf('string');
    expect(response.body).not.toContain('data:image');
    await drain(payload.messageId);

    const message = await getMessage(payload.messageId);
    const assets = await getAssets(payload.messageId);
    expect(assets).toHaveLength(1);
    const asset = assets[0];
    expect(asset.scan_status).toBe('CLEAN');
    expect(asset.storage_status).toBe('STORED');
    expect(asset.storage_key?.startsWith(`media/${payload.conversationId}/${payload.messageId}/`)).toBe(true);
    expect(asset.mime_type).toBe('image/png');
    expect(message.media_url).toBe(`asset://${asset.id}`);
    expect(message.metadata).not.toContain('sourceUrl');
    expect(intakeOf(message).state).toBe('CLEAN');

    if (!storage) throw new Error('storage ausente');
    expect(await storage.exists(asset.storage_key as string)).toBe(true);
    const quarantineKey = (asset.storage_key as string).replace(/^media\//, 'quarantine/');
    expect(await storage.exists(quarantineKey)).toBe(false);

    // Objeto é PRIVADO no S3 (sem credencial → 403).
    const anonymous = await fetch(`${s3Endpoint}/${s3Bucket}/${asset.storage_key}`);
    expect(anonymous.status).toBe(403);

    // Leitura HTTP autorizada entrega os bytes, com TTL privado.
    const read = await app!.inject({
      method: 'GET',
      url: `/conversations/${payload.conversationId}/media/${asset.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(read.statusCode, read.body).toBe(200);
    expect(read.headers['cache-control']).toContain('private');
    expect(read.headers['cache-control']).toContain('max-age=120');
    expect(Buffer.from(read.rawPayload).equals(PNG_BYTES)).toBe(true);
    expect(read.body).not.toContain('X-Amz-Signature');

    // DTO: referência interna, nunca URL crua; intake server-side removida.
    const messages = await app!.inject({
      method: 'GET',
      url: `/conversations/${payload.conversationId}/messages`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(messages.statusCode, messages.body).toBe(200);
    expect(messages.body).not.toContain('data:image/png;base64');
    expect(messages.body).not.toContain('sourceUrl');
    const list = (messages.json() as { messages: Array<Record<string, unknown>> }).messages;
    const dto = list.find((entry) => entry.id === payload.messageId);
    expect(dto?.mediaUrl).toBe(`asset://${asset.id}`);
    expect(dto?.mediaState).toBe('CLEAN');

    // Não autenticado e não autorizado nunca recebem bytes.
    const anonymousRead = await app!.inject({
      method: 'GET',
      url: `/conversations/${payload.conversationId}/media/${asset.id}`,
    });
    expect(anonymousRead.statusCode).toBe(401);
    const outsiderRead = await app!.inject({
      method: 'GET',
      url: `/conversations/${payload.conversationId}/media/${asset.id}`,
      headers: { authorization: `Bearer ${receptionistToken}` },
    });
    expect([403, 404]).toContain(outsiderRead.statusCode);
    expect(outsiderRead.body).not.toContain('prod14-png-payload');
    expect(outsiderRead.body).not.toContain('iVBOR');

    evidence.push({
      case: 'AC1-clean-e2e',
      messageId: payload.messageId,
      conversationId: payload.conversationId,
      assetId: asset.id,
      storageKey: asset.storage_key,
      scanStatus: asset.scan_status,
      storageStatus: asset.storage_status,
      mediaUrl: message.media_url,
      anonymousS3Status: anonymous.status,
      readStatus: read.statusCode,
      readCacheControl: read.headers['cache-control'],
      anonymousReadStatus: anonymousRead.statusCode,
      outsiderReadStatus: outsiderRead.statusCode,
    });
  });

  it('AC1 — SSRF: URL privada/link-local rejeitada; mensagem preservada sem asset público', async () => {
    const suffix = randomUUID().slice(0, 8);
    const messageId = `prod14-ssrf-${suffix}`;
    const body = gatewayBody({
      messageId,
      instance: `prod14-ssrf-${suffix}`,
      remoteJid: `5511888${suffix.replace(/\D/g, '0')}@s.whatsapp.net`,
      text: '',
      type: 'image',
      media: { url: 'http://169.254.169.254/latest/meta-data/', mimetype: 'image/jpeg', filename: 'x.jpg' },
    });

    const response = await postGatewayInbound(body, `evt-ssrf-${suffix}`);
    expect(response.statusCode, response.body).toBe(200);
    const payload = response.json() as { messageId: string; conversationId: string };
    await drain(payload.messageId);

    const message = await getMessage(payload.messageId);
    expect(message.content).toBe('');
    expect(message.media_url).toBeNull();
    const intake = intakeOf(message);
    expect(intake.state).toBe('REJECTED');
    expect(intake.reasonCode).toBe('unsafe_url');
    expect(await getAssets(payload.messageId)).toHaveLength(0);

    const messages = await app!.inject({
      method: 'GET',
      url: `/conversations/${payload.conversationId}/messages`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(messages.body).not.toContain('169.254.169.254');
    expect(messages.body).not.toContain('sourceUrl');

    evidence.push({
      case: 'AC1-ssrf-negado',
      messageId: payload.messageId,
      state: intake.state,
      reasonCode: intake.reasonCode,
      mediaUrl: message.media_url,
      assets: 0,
    });
  });

  it('AC1 — fetch remoto falho é registrado e retentável (FAILED com sourceUrl server-side)', async () => {
    const suffix = randomUUID().slice(0, 8);
    const messageId = `prod14-fetchfail-${suffix}`;
    const body = gatewayBody({
      messageId,
      instance: `prod14-fetchfail-${suffix}`,
      remoteJid: `5511777${suffix.replace(/\D/g, '0')}@s.whatsapp.net`,
      text: 'url publica inexistente',
      type: 'image',
      media: { url: 'https://media.prod14.invalid/foto.png', mimetype: 'image/png', filename: 'foto.png' },
    });

    const response = await postGatewayInbound(body, `evt-fetchfail-${suffix}`);
    expect(response.statusCode, response.body).toBe(200);
    const payload = response.json() as { messageId: string };
    await drain(payload.messageId);

    const message = await getMessage(payload.messageId);
    const intake = intakeOf(message);
    expect(intake.state).toBe('FAILED');
    expect(intake.reasonCode).toBe('fetch_failed');
    expect(message.media_url).toBeNull();
    expect(intake.sourceUrl).toBe('https://media.prod14.invalid/foto.png');

    const recovered = await pipelineModule!.recoverPendingInboundMedia(50);
    expect(recovered).toBeGreaterThanOrEqual(1);
    await drain(payload.messageId);

    evidence.push({
      case: 'AC1-fetch-falho-recuperavel',
      messageId: payload.messageId,
      state: intake.state,
      reasonCode: intake.reasonCode,
      recoveredCount: recovered,
    });
  });

  it('AC1 — EICAR real: INFECTED em quarentena, leitura 422, DTO sem URL', async () => {
    const suffix = randomUUID().slice(0, 8);
    const messageId = `prod14-eicar-${suffix}`;
    const body = gatewayBody({
      messageId,
      instance: `prod14-eicar-${suffix}`,
      remoteJid: `5511666${suffix.replace(/\D/g, '0')}@s.whatsapp.net`,
      text: 'documento suspeito',
      type: 'document',
      media: { url: dataUrl('text/plain', EICAR), mimetype: 'text/plain', filename: 'eicar.txt' },
    });

    const response = await postGatewayInbound(body, `evt-eicar-${suffix}`);
    expect(response.statusCode, response.body).toBe(200);
    const payload = response.json() as { messageId: string; conversationId: string };
    await drain(payload.messageId);

    const message = await getMessage(payload.messageId);
    const assets = await getAssets(payload.messageId);
    expect(assets).toHaveLength(1);
    const asset = assets[0];
    expect(asset.scan_status).toBe('INFECTED');
    expect(asset.storage_status).toBe('QUARANTINED');
    expect(asset.storage_key?.startsWith(`quarantine/${payload.conversationId}/${payload.messageId}/`)).toBe(true);
    expect(message.media_url).toBeNull();
    expect(intakeOf(message).state).toBe('INFECTED');

    if (!storage) throw new Error('storage ausente');
    expect(await storage.exists(asset.storage_key as string)).toBe(true);
    expect(await storage.exists((asset.storage_key as string).replace(/^quarantine\//, 'media/'))).toBe(false);

    const read = await app!.inject({
      method: 'GET',
      url: `/conversations/${payload.conversationId}/media/${asset.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(read.statusCode).toBe(422);
    expect((read.json() as { error: string }).error).toBe('MEDIA_ASSET_INFECTED');

    const messages = await app!.inject({
      method: 'GET',
      url: `/conversations/${payload.conversationId}/messages`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(messages.body).not.toContain('EICAR');
    expect(messages.body).not.toContain('sourceUrl');

    evidence.push({
      case: 'AC1-eicar-real',
      messageId: payload.messageId,
      assetId: asset.id,
      scanStatus: asset.scan_status,
      storageStatus: asset.storage_status,
      storageKey: asset.storage_key,
      readStatus: read.statusCode,
      readCode: (read.json() as { error: string }).error,
    });
  });

  it('AC1 — scanner ausente: fail-closed em quarentena e leitura 409 PENDING', async () => {
    const suffix = randomUUID().slice(0, 8);
    const messageId = `prod14-noscanner-${suffix}`;
    const body = gatewayBody({
      messageId,
      instance: `prod14-noscanner-${suffix}`,
      remoteJid: `5511555${suffix.replace(/\D/g, '0')}@s.whatsapp.net`,
      text: 'sem scanner',
      type: 'image',
      media: { url: dataUrl('image/png', PNG_BYTES), mimetype: 'image/png', filename: 'img.png' },
    });

    const previous = process.env.MALWARE_SCANNER;
    delete process.env.MALWARE_SCANNER;
    let payload: { messageId: string; conversationId: string };
    try {
      const response = await postGatewayInbound(body, `evt-noscanner-${suffix}`);
      expect(response.statusCode, response.body).toBe(200);
      payload = response.json() as { messageId: string; conversationId: string };
      await drain(payload.messageId);
    } finally {
      process.env.MALWARE_SCANNER = previous ?? 'clamav';
    }

    const assets = await getAssets(payload!.messageId);
    expect(assets).toHaveLength(1);
    expect(assets[0].scan_status).toBe('PENDING_SCAN');
    expect(assets[0].storage_status).toBe('QUARANTINED');
    const message = await getMessage(payload!.messageId);
    expect(message.media_url).toBeNull();

    const read = await app!.inject({
      method: 'GET',
      url: `/conversations/${payload!.conversationId}/media/${assets[0].id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(read.statusCode).toBe(409);
    expect((read.json() as { error: string }).error).toBe('MEDIA_ASSET_PENDING_SCAN');

    evidence.push({
      case: 'AC1-scanner-ausente-fail-closed',
      messageId: payload!.messageId,
      scanStatus: assets[0].scan_status,
      storageStatus: assets[0].storage_status,
      readStatus: read.statusCode,
      readCode: (read.json() as { error: string }).error,
    });
  });

  it('AC1 — timeout de scanner: webhook não bloqueia e leitura 503 SCAN_FAILED', async () => {
    const suffix = randomUUID().slice(0, 8);
    const messageId = `prod14-timeout-${suffix}`;
    const body = gatewayBody({
      messageId,
      instance: `prod14-timeout-${suffix}`,
      remoteJid: `5511444${suffix.replace(/\D/g, '0')}@s.whatsapp.net`,
      text: 'timeout do scanner',
      type: 'image',
      media: { url: dataUrl('image/png', PNG_BYTES), mimetype: 'image/png', filename: 'img.png' },
    });

    const blackhole = await startBlackhole();
    const previousPort = process.env.CLAMAV_PORT;
    const previousTimeout = process.env.MALWARE_SCAN_TIMEOUT_MS;
    process.env.CLAMAV_PORT = String(blackhole.port);
    process.env.MALWARE_SCAN_TIMEOUT_MS = String(BLACKHOLE_MS);

    let elapsedMs: number | undefined;
    let payload: { messageId: string; conversationId: string };
    try {
      const startedAt = Date.now();
      const response = await postGatewayInbound(body, `evt-timeout-${suffix}`);
      elapsedMs = Date.now() - startedAt;
      expect(response.statusCode, response.body).toBe(200);
      payload = response.json() as { messageId: string; conversationId: string };
      // AC1: o webhook respondeu ANTES do scan terminar (scan leva >= 8s).
      expect(elapsedMs).toBeLessThan(BLACKHOLE_MS / 2);
      await drain(payload.messageId);
    } finally {
      process.env.CLAMAV_PORT = previousPort ?? String(CLAMAV_PORT);
      if (previousTimeout === undefined) delete process.env.MALWARE_SCAN_TIMEOUT_MS;
      else process.env.MALWARE_SCAN_TIMEOUT_MS = previousTimeout;
      await blackhole.close();
    }

    const assets = await getAssets(payload!.messageId);
    expect(assets).toHaveLength(1);
    expect(assets[0].scan_status).toBe('SCAN_FAILED');
    expect(assets[0].storage_status).toBe('QUARANTINED');
    const message = await getMessage(payload!.messageId);
    expect(message.media_url).toBeNull();
    expect(intakeOf(message).state).toBe('SCAN_FAILED');

    const read = await app!.inject({
      method: 'GET',
      url: `/conversations/${payload!.conversationId}/media/${assets[0].id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(read.statusCode).toBe(503);
    expect((read.json() as { error: string }).error).toBe('MEDIA_ASSET_SCAN_FAILED');

    evidence.push({
      case: 'AC1-timeout-scanner',
      messageId: payload!.messageId,
      webhookElapsedMs: elapsedMs,
      scanTimeoutMs: BLACKHOLE_MS,
      scanStatus: assets[0].scan_status,
      readStatus: read.statusCode,
      readCode: (read.json() as { error: string }).error,
    });
  });

  it('BE-A04 — recovery durável retoma SCAN_FAILED, reclama uma vez e limita retries', async () => {
    const conversationId = await createLegacyConversation();
    const recoveryOptions = {
      leaseSeconds: 30,
      maxAttempts: 3,
      backoffBaseMs: 1,
      backoffMaxMs: 1,
    };
    const previousScanner = process.env.MALWARE_SCANNER;
    const previousPort = process.env.CLAMAV_PORT;
    const previousTimeout = process.env.MALWARE_SCAN_TIMEOUT_MS;
    const sourceUrl = dataUrl('image/png', PNG_BYTES);
    const pendingMessageId = await insertLegacyMessage({
      conversationId,
      content: 'recovery pós commit antes do enqueue',
      mediaUrl: null,
      mediaType: 'image',
      mimetype: 'image/png',
      filename: 'recovery.png',
      metadata: {
        mediaIntake: {
          state: 'PENDING_SCAN',
          mediaType: 'image',
          mimetype: 'image/png',
          filename: 'recovery.png',
          sourceUrl,
          updatedAt: new Date().toISOString(),
        },
      },
    });

    try {
      // Scanner ausente deixa bytes em quarantine e cria um retry durável.
      delete process.env.MALWARE_SCANNER;
      const firstClaims = await pipelineModule!.recoverPendingInboundMedia(1, {
        ...recoveryOptions,
        messageId: pendingMessageId,
        owner: 'prod14-recovery-a',
      });
      expect(firstClaims).toBe(1);
      await drain(pendingMessageId);

      const pendingAfterFailure = await getMessage(pendingMessageId);
      const pendingAsset = (await getAssets(pendingMessageId))[0];
      expect(pendingAfterFailure.media_url).toBeNull();
      expect(intakeOf(pendingAfterFailure).state).toBe('PENDING_SCAN');
      expect(pendingAsset.scan_status).toBe('PENDING_SCAN');
      expect(pendingAsset.storage_status).toBe('QUARANTINED');
      expect(pendingAfterFailure.media_intake_attempt_count).toBe(1);
      expect(pendingAfterFailure.media_intake_lease_owner).toBeNull();
      expect(pendingAfterFailure.media_intake_next_attempt_at).not.toBeNull();

      // O próximo poll não espera o timer do backoff: a mensagem já está apta.
      await pool.query(
        'UPDATE messages SET media_intake_next_attempt_at = NOW(), media_intake_lease_until = NULL WHERE id = $1',
        [pendingMessageId],
      );
      process.env.MALWARE_SCANNER = 'clamav';
      process.env.CLAMAV_PORT = String(CLAMAV_PORT);
      const secondClaims = await pipelineModule!.recoverPendingInboundMedia(1, {
        ...recoveryOptions,
        messageId: pendingMessageId,
        owner: 'prod14-recovery-after-restart',
      });
      expect(secondClaims).toBe(1);
      await drain(pendingMessageId);

      const recoveredMessage = await getMessage(pendingMessageId);
      const recoveredAssets = await getAssets(pendingMessageId);
      expect(recoveredAssets).toHaveLength(1);
      const recoveryAsset = recoveredAssets[0];
      expect(recoveryAsset.scan_status).toBe('CLEAN');
      expect(recoveryAsset.storage_status).toBe('STORED');
      expect(recoveryAsset.storage_key?.startsWith('media/')).toBe(true);
      expect(recoveredMessage.media_url).toBe(`asset://${recoveryAsset.id}`);
      expect(recoveredMessage.media_intake_attempt_count).toBe(2);
      expect(recoveredMessage.media_intake_lease_owner).toBeNull();
      expect(recoveredMessage.media_intake_next_attempt_at).toBeNull();
      expect(recoveredMessage.media_intake_last_error).toBeNull();
      if (!storage) throw new Error('storage ausente');
      expect(await storage.exists(recoveryAsset.storage_key as string)).toBe(true);
      const quarantineKey = (recoveryAsset.storage_key as string).replace(/^media\//, 'quarantine/');
      expect(await storage.exists(quarantineKey)).toBe(false);

      // SCAN_FAILED também é retentável: timeout não pode virar estado morto.
      const scanFailedMessageId = await insertLegacyMessage({
        conversationId,
        content: 'recovery de timeout do scanner',
        mediaUrl: null,
        mediaType: 'image',
        mimetype: 'image/png',
        filename: 'scan-failed.png',
        metadata: {
          mediaIntake: {
            state: 'PENDING_SCAN',
            mediaType: 'image',
            mimetype: 'image/png',
            filename: 'scan-failed.png',
            sourceUrl,
            updatedAt: new Date().toISOString(),
          },
        },
      });
      let scanFailedClaims = 0;
      const blackhole = await startBlackhole();
      try {
        process.env.MALWARE_SCANNER = 'clamav';
        process.env.CLAMAV_PORT = String(blackhole.port);
        process.env.MALWARE_SCAN_TIMEOUT_MS = '100';
        scanFailedClaims = await pipelineModule!.recoverPendingInboundMedia(1, {
          ...recoveryOptions,
          messageId: scanFailedMessageId,
          owner: 'prod14-recovery-scan-failed',
        });
        expect(scanFailedClaims).toBe(1);
        await drain(scanFailedMessageId);
      } finally {
        await blackhole.close();
        process.env.CLAMAV_PORT = previousPort ?? String(CLAMAV_PORT);
        if (previousTimeout === undefined) delete process.env.MALWARE_SCAN_TIMEOUT_MS;
        else process.env.MALWARE_SCAN_TIMEOUT_MS = previousTimeout;
      }
      const failedMessage = await getMessage(scanFailedMessageId);
      const failedAsset = (await getAssets(scanFailedMessageId))[0];
      expect(failedAsset.scan_status).toBe('SCAN_FAILED');
      expect(failedAsset.storage_status).toBe('QUARANTINED');
      expect(failedMessage.media_url).toBeNull();
      expect(intakeOf(failedMessage).state).toBe('SCAN_FAILED');

      await pool.query(
        'UPDATE messages SET media_intake_next_attempt_at = NOW(), media_intake_lease_until = NULL WHERE id = $1',
        [scanFailedMessageId],
      );
      process.env.MALWARE_SCANNER = 'clamav';
      process.env.CLAMAV_PORT = String(CLAMAV_PORT);
      const healedClaims = await pipelineModule!.recoverPendingInboundMedia(1, {
        ...recoveryOptions,
        messageId: scanFailedMessageId,
        owner: 'prod14-recovery-scan-failed-healed',
      });
      expect(healedClaims).toBe(1);
      await drain(scanFailedMessageId);
      const healedMessage = await getMessage(scanFailedMessageId);
      const healedAssets = await getAssets(scanFailedMessageId);
      expect(healedAssets).toHaveLength(1);
      expect(healedAssets[0].id).toBe(failedAsset.id);
      expect(healedAssets[0].scan_status).toBe('CLEAN');
      expect(healedAssets[0].storage_status).toBe('STORED');
      expect(healedMessage.media_url).toBe(`asset://${failedAsset.id}`);

      // Dois owners concorrentes disputam uma única linha; o segundo não duplica asset.
      const concurrentMessageId = await insertLegacyMessage({
        conversationId,
        content: 'claim concorrente',
        mediaUrl: null,
        mediaType: 'image',
        mimetype: 'image/png',
        filename: 'concorrente.png',
        metadata: {
          mediaIntake: {
            state: 'PENDING_SCAN',
            mediaType: 'image',
            mimetype: 'image/png',
            filename: 'concorrente.png',
            sourceUrl,
            updatedAt: new Date().toISOString(),
          },
        },
      });
      const [claimA, claimB] = await Promise.all([
        pipelineModule!.recoverPendingInboundMedia(1, { ...recoveryOptions, messageId: concurrentMessageId, owner: 'prod14-race-a' }),
        pipelineModule!.recoverPendingInboundMedia(1, { ...recoveryOptions, messageId: concurrentMessageId, owner: 'prod14-race-b' }),
      ]);
      expect(claimA + claimB).toBe(1);
      await drain(concurrentMessageId);
      expect(await getAssets(concurrentMessageId)).toHaveLength(1);

      // Uma falha permanente não vira hot loop após o teto configurado.
      const cappedMessageId = await insertLegacyMessage({
        conversationId,
        content: 'retry bounded',
        mediaUrl: null,
        mediaType: 'image',
        mimetype: 'image/png',
        filename: 'bounded.png',
        metadata: {
          mediaIntake: {
            state: 'PENDING_SCAN',
            mediaType: 'image',
            mimetype: 'image/png',
            filename: 'bounded.png',
            sourceUrl,
            updatedAt: new Date().toISOString(),
          },
        },
      });
      delete process.env.MALWARE_SCANNER;
      const capped = await pipelineModule!.recoverPendingInboundMedia(1, {
        owner: 'prod14-recovery-capped',
        messageId: cappedMessageId,
        leaseSeconds: 30,
        maxAttempts: 1,
        backoffBaseMs: 1,
        backoffMaxMs: 1,
      });
      expect(capped).toBe(1);
      await drain(cappedMessageId);
      const cappedRow = await getMessage(cappedMessageId);
      expect(cappedRow.media_intake_attempt_count).toBe(1);
      expect(cappedRow.media_intake_next_attempt_at).toBeNull();
      expect(cappedRow.media_intake_last_error).toBe('retry_exhausted:scanner_unavailable');
      expect(await pipelineModule!.recoverPendingInboundMedia(1, {
        owner: 'prod14-recovery-capped-second-poll',
        messageId: cappedMessageId,
        maxAttempts: 1,
      })).toBe(0);

      evidence.push({
        case: 'BE-A04-recovery-duravel',
        pendingMessageId,
        firstClaims,
        secondClaims,
        scanFailedClaims,
        pendingStatus: 'PENDING_SCAN/QUARANTINED',
        recoveredAssetId: recoveryAsset.id,
        recoveredStatus: 'CLEAN/STORED',
        concurrentClaims: claimA + claimB,
        boundedRetry: {
          attempts: cappedRow.media_intake_attempt_count,
          nextAttemptAt: cappedRow.media_intake_next_attempt_at,
          lastError: cappedRow.media_intake_last_error,
        },
      });
    } finally {
      if (previousScanner === undefined) delete process.env.MALWARE_SCANNER;
      else process.env.MALWARE_SCANNER = previousScanner;
      if (previousPort === undefined) delete process.env.CLAMAV_PORT;
      else process.env.CLAMAV_PORT = previousPort;
      if (previousTimeout === undefined) delete process.env.MALWARE_SCAN_TIMEOUT_MS;
      else process.env.MALWARE_SCAN_TIMEOUT_MS = previousTimeout;
    }
  });

  it('AC2 — limites e magic bytes: >16MiB, MIME divergente e executável bloqueados', async () => {
    const suffix = randomUUID().slice(0, 8);
    const messageId = `prod14-limit-${suffix}`;
    // ~1230 bytes: acima do teto temporário de 1024 e dentro do maxLength 2048
    // do contrato InboundMessageV1 (mediaUrl).
    const bigPng = Buffer.concat([PNG_BYTES, Buffer.alloc(1200, 0x41)]);

    const previousMax = process.env.MEDIA_MAX_BYTES;
    process.env.MEDIA_MAX_BYTES = '1024';
    let oversized: { messageId: string; conversationId: string };
    try {
      const body = gatewayBody({
        messageId,
        instance: `prod14-limit-${suffix}`,
        remoteJid: `5511333${suffix.replace(/\D/g, '0')}@s.whatsapp.net`,
        text: 'grande demais',
        type: 'image',
        media: { url: dataUrl('image/png', bigPng), mimetype: 'image/png', filename: 'grande.png' },
      });
      const response = await postGatewayInbound(body, `evt-limit-${suffix}`);
      expect(response.statusCode, response.body).toBe(200);
      oversized = response.json() as { messageId: string; conversationId: string };
      await drain(oversized.messageId);
    } finally {
      process.env.MEDIA_MAX_BYTES = previousMax ?? String(16 * 1024 * 1024);
    }

    const oversizedMessage = await getMessage(oversized!.messageId);
    expect(intakeOf(oversizedMessage).state).toBe('REJECTED');
    expect(intakeOf(oversizedMessage).reasonCode).toBe('media_too_large');
    expect(oversizedMessage.media_url).toBeNull();
    expect(await getAssets(oversized!.messageId)).toHaveLength(0);

    // Magic bytes: PNG declarado como PDF.
    const magicSuffix = randomUUID().slice(0, 8);
    const magicMessageId = `prod14-magic-${magicSuffix}`;
    const magicBody = gatewayBody({
      messageId: magicMessageId,
      instance: `prod14-magic-${magicSuffix}`,
      remoteJid: `5511222${magicSuffix.replace(/\D/g, '0')}@s.whatsapp.net`,
      text: 'mime mentido',
      type: 'document',
      media: { url: dataUrl('application/pdf', PNG_BYTES), mimetype: 'application/pdf', filename: 'falso.pdf' },
    });
    const magicResponse = await postGatewayInbound(magicBody, `evt-magic-${magicSuffix}`);
    expect(magicResponse.statusCode, magicResponse.body).toBe(200);
    const magicPayload = magicResponse.json() as { messageId: string };
    await drain(magicPayload.messageId);
    const magicMessage = await getMessage(magicPayload.messageId);
    expect(intakeOf(magicMessage).state).toBe('REJECTED');
    expect(intakeOf(magicMessage).reasonCode).toBe('mime_magic_mismatch');
    expect(await getAssets(magicPayload.messageId)).toHaveLength(0);

    // Limite global consistente (16 MiB) e boundary exato no pipeline.
    expect(mediaModule!.getMediaMaxBytes()).toBe(16 * 1024 * 1024);
    const overLimit = await mediaModule!.processInboundMedia({
      mediaType: 'document',
      mimetype: 'text/plain',
      bytes: Buffer.alloc(16 * 1024 * 1024 + 1, 0x41),
    });
    expect(overLimit.blocked).toBe(true);
    expect(overLimit.reasonCode).toBe('media_too_large');
    expect(overLimit.assetId).toBe('');

    evidence.push({
      case: 'AC2-limites-magic',
      oversized: {
        messageId: oversized!.messageId,
        state: intakeOf(oversizedMessage).state,
        reasonCode: intakeOf(oversizedMessage).reasonCode,
      },
      magicMismatch: {
        messageId: magicPayload.messageId,
        state: intakeOf(magicMessage).state,
        reasonCode: intakeOf(magicMessage).reasonCode,
      },
      maxBytes: mediaModule!.getMediaMaxBytes(),
      overLimitReason: overLimit.reasonCode,
    });
  });

  it('AC2 — asset de outra conversa nunca é entregue (404) e idempotência não duplica', async () => {
    const suffix = randomUUID().slice(0, 8);
    const messageId = `prod14-cross-${suffix}`;
    const body = gatewayBody({
      messageId,
      instance: `prod14-cross-${suffix}`,
      remoteJid: `5511000${suffix.replace(/\D/g, '0')}@s.whatsapp.net`,
      text: 'asset da conversa A',
      type: 'image',
      media: { url: dataUrl('image/png', PNG_BYTES), mimetype: 'image/png', filename: 'a.png' },
    });
    const response = await postGatewayInbound(body, `evt-cross-${suffix}`);
    expect(response.statusCode, response.body).toBe(200);
    const payload = response.json() as { messageId: string; conversationId: string };
    await drain(payload.messageId);
    const assets = await getAssets(payload.messageId);
    expect(assets).toHaveLength(1);

    // Conversa B independente.
    const otherSuffix = randomUUID().slice(0, 8);
    const otherMessageId = `prod14-cross-b-${otherSuffix}`;
    const otherBody = gatewayBody({
      messageId: otherMessageId,
      instance: `prod14-cross-b-${otherSuffix}`,
      remoteJid: `5511011${otherSuffix.replace(/\D/g, '0')}@s.whatsapp.net`,
      text: 'conversa B',
      type: 'image',
      media: { url: dataUrl('image/png', PNG_BYTES), mimetype: 'image/png', filename: 'b.png' },
    });
    const otherResponse = await postGatewayInbound(otherBody, `evt-cross-b-${otherSuffix}`);
    expect(otherResponse.statusCode, otherResponse.body).toBe(200);
    const otherPayload = otherResponse.json() as { messageId: string; conversationId: string };
    await drain(otherPayload.messageId);

    const crossRead = await app!.inject({
      method: 'GET',
      url: `/conversations/${otherPayload.conversationId}/media/${assets[0].id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(crossRead.statusCode).toBe(404);
    expect(crossRead.body).not.toContain('prod14-png-payload');
    // Não revela que o asset existe em outra conversa (resposta genérica).
    expect(crossRead.body).not.toContain('WRONG_CONVERSATION');
    expect((crossRead.json() as { error: string }).error).toBe('MEDIA_ASSET_NOT_FOUND');

    // Reexecutar o pipeline da MESMA mensagem não duplica asset/publicação.
    const replayOutcome = await pipelineModule!.enqueueInboundMediaProcessing({
      messageId: payload.messageId,
      conversationId: payload.conversationId,
      sourceUrl: dataUrl('image/png', PNG_BYTES),
      mediaType: 'image',
      mimetype: 'image/png',
      filename: 'a.png',
    });
    expect(replayOutcome.state).toBe('CLEAN');
    await drain(payload.messageId);
    expect(await getAssets(payload.messageId)).toHaveLength(1);
    const message = await getMessage(payload.messageId);
    expect(message.media_url).toBe(`asset://${assets[0].id}`);

    evidence.push({
      case: 'AC2-cross-conversa-e-idempotencia',
      assetId: assets[0].id,
      ownerConversation: payload.conversationId,
      otherConversation: otherPayload.conversationId,
      crossReadStatus: crossRead.statusCode,
      replayState: replayOutcome.state,
      assetCountAfterReplay: (await getAssets(payload.messageId)).length,
    });
  });

  it('AC3 — MEDIA_PIPELINE_ENABLED=false desliga o pipeline sem expor URL crua', async () => {
    const suffix = randomUUID().slice(0, 8);
    const messageId = `prod14-flag-${suffix}`;
    const body = gatewayBody({
      messageId,
      instance: `prod14-flag-${suffix}`,
      remoteJid: `5511999${suffix.replace(/\D/g, '0')}@s.whatsapp.net`,
      text: 'flag desligada',
      type: 'image',
      media: { url: dataUrl('image/png', PNG_BYTES), mimetype: 'image/png', filename: 'flag.png' },
    });

    const previous = process.env.MEDIA_PIPELINE_ENABLED;
    process.env.MEDIA_PIPELINE_ENABLED = 'false';
    let payload: { messageId: string; conversationId: string };
    try {
      const response = await postGatewayInbound(body, `evt-flag-${suffix}`);
      expect(response.statusCode, response.body).toBe(200);
      payload = response.json() as { messageId: string; conversationId: string };
      await drain(payload.messageId);
    } finally {
      process.env.MEDIA_PIPELINE_ENABLED = previous ?? 'true';
    }

    const message = await getMessage(payload!.messageId);
    expect(message.media_url).toBeNull();
    expect(intakeOf(message).state).toBe('PIPELINE_DISABLED');
    expect(await getAssets(payload!.messageId)).toHaveLength(0);

    const messages = await app!.inject({
      method: 'GET',
      url: `/conversations/${payload!.conversationId}/messages`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(messages.body).not.toContain('data:image/png;base64');
    const dto = (messages.json() as { messages: Array<Record<string, unknown>> }).messages
      .find((entry) => entry.id === payload!.messageId);
    expect(dto?.mediaUrl).toBeNull();
    expect(dto?.mediaState).toBe('PIPELINE_DISABLED');

    // Default seguro: flag ausente ⇒ pipeline habilitado.
    const defaultEnv = { ...process.env } as NodeJS.ProcessEnv;
    delete defaultEnv.MEDIA_PIPELINE_ENABLED;
    expect(pipelineModule!.isInboundMediaPipelineEnabled(defaultEnv)).toBe(true);

    evidence.push({
      case: 'AC3-flag-pipeline',
      messageId: payload!.messageId,
      state: intakeOf(message).state,
      mediaUrl: message.media_url,
      assets: 0,
      defaultEnabled: true,
    });
  });

  it('AC2/AC4 — quarentena preserva bytes do EICAR e objeto sem scan não é público', async () => {
    const suffix = randomUUID().slice(0, 8);
    const messageId = `prod14-quarantine-${suffix}`;
    const body = gatewayBody({
      messageId,
      instance: `prod14-quarantine-${suffix}`,
      remoteJid: `5511888${suffix.replace(/\D/g, '0')}@s.whatsapp.net`,
      text: 'segundo eicar',
      type: 'document',
      media: { url: dataUrl('text/plain', EICAR), mimetype: 'text/plain', filename: 'eicar2.txt' },
    });
    const response = await postGatewayInbound(body, `evt-quarantine-${suffix}`);
    expect(response.statusCode, response.body).toBe(200);
    const payload = response.json() as { messageId: string; conversationId: string };
    await drain(payload.messageId);

    const assets = await getAssets(payload.messageId);
    expect(assets).toHaveLength(1);
    const asset = assets[0];
    expect(asset.storage_status).toBe('QUARANTINED');
    expect(asset.storage_key?.startsWith('quarantine/')).toBe(true);

    if (!storage) throw new Error('storage ausente');
    const bytes = await storage.get(asset.storage_key as string);
    expect(bytes.equals(EICAR)).toBe(true);

    const anonymous = await fetch(`${s3Endpoint}/${s3Bucket}/${asset.storage_key}`);
    expect(anonymous.status).toBe(403);

    // Nenhum objeto no prefixo público para este asset.
    const publicKey = (asset.storage_key as string).replace(/^quarantine\//, 'media/');
    expect(await storage.exists(publicKey)).toBe(false);

    evidence.push({
      case: 'AC2-quarentena-bytes-preservados',
      messageId: payload.messageId,
      assetId: asset.id,
      storageKey: asset.storage_key,
      bytesPreserved: bytes.length,
      anonymousStatus: anonymous.status,
      publicObjectExists: false,
    });
  });

  it('AC4 — dry-run identifica mídias legadas fora do storage controlado sem mutação', async () => {
    const conversationId = await createLegacyConversation();
    const pendingMessageId = await insertLegacyMessage({
      conversationId,
      content: 'legado: url externa http',
      mediaUrl: 'https://legacy.prod14.invalid/foto-legado.png',
      mediaType: 'image',
      mimetype: 'image/png',
      filename: 'foto-legado.png',
    });
    const cleanMessageId = await insertLegacyMessage({
      conversationId,
      content: 'legado: data url limpa',
      mediaUrl: dataUrl('image/png', PNG_BYTES),
      mediaType: 'image',
      mimetype: 'image/png',
      filename: 'legado-limpo.png',
    });
    const eicarMessageId = await insertLegacyMessage({
      conversationId,
      content: 'legado: data url infectada',
      mediaUrl: dataUrl('text/plain', EICAR),
      mediaType: 'document',
      mimetype: 'text/plain',
      filename: 'legado-eicar.txt',
    });
    const brokenAssetId = randomUUID();
    const brokenMessageId = await insertLegacyMessage({
      conversationId,
      content: 'legado: asset quebrado',
      mediaUrl: `asset://${brokenAssetId}`,
      mediaType: 'image',
      mimetype: 'image/png',
      filename: 'quebrado.png',
    });
    const externalAssetId = await insertExternalAsset({ messageId: pendingMessageId, mimeType: 'image/png' });
    legacyFixture = {
      conversationId,
      cleanMessageId,
      eicarMessageId,
      pendingMessageId,
      brokenMessageId,
      brokenAssetId,
      externalAssetId,
    };

    const before = await snapshotMessagesAndAssets();
    const plan = await mediaModule!.dryRunLegacyMediaMigration({ limit: 500 });
    const after = await snapshotMessagesAndAssets();

    // Dry-run é somente leitura: nenhuma linha de messages/media_assets muda.
    expect(plan.readOnly).toBe(true);
    expect(after).toBe(before);

    const scoped = plan.items.filter((item) => item.conversationId === conversationId);
    const byKind = (kind: string) => scoped.filter((item) => item.kind === kind);
    expect(byKind('raw_http_url').map((item) => item.messageId)).toContain(pendingMessageId);
    expect(byKind('data_url').map((item) => item.messageId).sort()).toEqual([cleanMessageId, eicarMessageId].sort());
    expect(byKind('broken_asset').map((item) => item.messageId)).toContain(brokenMessageId);
    expect(byKind('external_asset').map((item) => item.assetId)).toContain(externalAssetId);
    expect(scoped.find((item) => item.messageId === cleanMessageId)?.migrationKey).toBe(`legacy:message:${cleanMessageId}`);

    // Contagem global por tipo (inclui legados de outros casos da suíte).
    expect(plan.counts.raw_http_url).toBeGreaterThanOrEqual(1);
    expect(plan.counts.data_url).toBeGreaterThanOrEqual(2);
    expect(plan.counts.broken_asset).toBeGreaterThanOrEqual(1);
    expect(plan.counts.external_asset).toBeGreaterThanOrEqual(1);
    expect(plan.totalCandidates).toBeGreaterThanOrEqual(scoped.length);

    writeEvidenceJson('prod-14-ac4-dry-run.json', {
      generatedAt: plan.generatedAt,
      readOnly: plan.readOnly,
      zeroMutations: after === before,
      counts: plan.counts,
      totalCandidates: plan.totalCandidates,
      fixtures: scoped.map((item) => ({
        kind: item.kind,
        messageId: item.messageId,
        assetId: item.assetId,
        migrationKey: item.migrationKey,
      })),
    });

    evidence.push({
      case: 'AC4-dry-run-sem-mutacao',
      conversationId,
      counts: plan.counts,
      totalCandidates: plan.totalCandidates,
      zeroMutations: after === before,
      fixtures: scoped.length,
    });
  });

  it('AC4 — migração idempotente publica CLEAN, bloqueia INFECTED e mantém pendente indisponível', async () => {
    if (!legacyFixture) throw new Error('fixtures AC4 ausentes (dry-run não executou)');
    const fixture = legacyFixture;

    const first = await legacyModule!.migrateLegacyInboundMedia({ limit: 500 });
    expect(first.published.map((record) => record.messageId)).toContain(fixture.cleanMessageId);
    expect(first.blocked.map((record) => record.messageId)).toContain(fixture.eicarMessageId);
    expect(first.pending.map((record) => record.messageId)).toContain(fixture.pendingMessageId);
    expect(first.unavailable.map((record) => record.messageId)).toContain(fixture.brokenMessageId);
    expect(first.revalidated).toBeGreaterThanOrEqual(1);

    // Nenhuma mensagem é apagada/alterada no conteúdo pelo plano.
    const cleanMessage = await getMessage(fixture.cleanMessageId);
    const eicarMessage = await getMessage(fixture.eicarMessageId);
    const pendingMessage = await getMessage(fixture.pendingMessageId);
    const brokenMessage = await getMessage(fixture.brokenMessageId);
    expect(cleanMessage.content).toBe('legado: data url limpa');
    expect(eicarMessage.content).toBe('legado: data url infectada');
    expect(pendingMessage.content).toBe('legado: url externa http');
    expect(brokenMessage.content).toBe('legado: asset quebrado');

    // 1 asset controlado publicado (CLEAN+STORED em media/).
    const cleanStored = (await getAssets(fixture.cleanMessageId)).filter((asset) => asset.storage_status === 'STORED');
    expect(cleanStored).toHaveLength(1);
    expect(cleanStored[0].scan_status).toBe('CLEAN');
    expect(cleanStored[0].storage_key?.startsWith(`media/${fixture.conversationId}/${fixture.cleanMessageId}/`)).toBe(true);
    expect(cleanMessage.media_url).toBe(`asset://${cleanStored[0].id}`);
    expect(intakeOf(cleanMessage).state).toBe('CLEAN');
    expect(intakeOf(cleanMessage).sourceUrl).toBeUndefined();

    // 1 infectado bloqueado em quarentena (media_url neutralizada).
    const eicarAssets = await getAssets(fixture.eicarMessageId);
    expect(eicarAssets).toHaveLength(1);
    expect(eicarAssets[0].scan_status).toBe('INFECTED');
    expect(eicarAssets[0].storage_status).toBe('QUARANTINED');
    expect(eicarAssets[0].storage_key?.startsWith(`quarantine/${fixture.conversationId}/${fixture.eicarMessageId}/`)).toBe(true);
    expect(eicarMessage.media_url).toBeNull();
    expect(intakeOf(eicarMessage).state).toBe('INFECTED');

    // 1 pendente: segue fora do storage controlado, retentável server-side.
    expect((await getAssets(fixture.pendingMessageId)).filter((asset) => asset.storage_status === 'STORED')).toHaveLength(0);
    expect(pendingMessage.media_url).toBeNull();
    expect(intakeOf(pendingMessage).state).toBe('FAILED');
    expect(intakeOf(pendingMessage).sourceUrl).toBe('https://legacy.prod14.invalid/foto-legado.png');

    // asset:// quebrado neutralizado, referência preservada server-side.
    expect(brokenMessage.media_url).toBeNull();
    expect(intakeOf(brokenMessage).state).toBe('REJECTED');
    expect(intakeOf(brokenMessage).reasonCode).toBe('asset_unavailable');
    expect(String(intakeOf(brokenMessage).legacyRef)).toBe(`asset://${fixture.brokenAssetId}`);
    expect(await getAssets(fixture.brokenMessageId)).toHaveLength(0);

    // HTTP: nenhum item não-pronto é servido; o publicado é proxiado autorizado.
    const cleanRead = await app!.inject({
      method: 'GET',
      url: `/conversations/${fixture.conversationId}/media/${cleanStored[0].id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(cleanRead.statusCode, cleanRead.body).toBe(200);
    expect(Buffer.from(cleanRead.rawPayload).equals(PNG_BYTES)).toBe(true);

    const eicarRead = await app!.inject({
      method: 'GET',
      url: `/conversations/${fixture.conversationId}/media/${eicarAssets[0].id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(eicarRead.statusCode).toBe(422);
    expect((eicarRead.json() as { error: string }).error).toBe('MEDIA_ASSET_INFECTED');
    expect(eicarRead.body).not.toContain('EICAR');

    const brokenRead = await app!.inject({
      method: 'GET',
      url: `/conversations/${fixture.conversationId}/media/${fixture.brokenAssetId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(brokenRead.statusCode).toBe(404);
    expect((brokenRead.json() as { error: string }).error).toBe('MEDIA_ASSET_NOT_FOUND');

    const pendingRead = await app!.inject({
      method: 'GET',
      url: `/conversations/${fixture.conversationId}/media/${fixture.externalAssetId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(pendingRead.statusCode).toBe(409);
    expect((pendingRead.json() as { error: string }).error).toBe('MEDIA_ASSET_PENDING_SCAN');

    const legacyMessages = await app!.inject({
      method: 'GET',
      url: `/conversations/${fixture.conversationId}/messages`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(legacyMessages.statusCode, legacyMessages.body).toBe(200);
    expect(legacyMessages.body).not.toContain('legacy.prod14.invalid');
    expect(legacyMessages.body).not.toContain(`asset://${fixture.brokenAssetId}`);
    expect(legacyMessages.body).not.toContain('sourceUrl');
    const dtos = (legacyMessages.json() as { messages: Array<Record<string, unknown>> }).messages;
    expect(dtos.find((entry) => entry.id === fixture.cleanMessageId)?.mediaUrl).toBe(`asset://${cleanStored[0].id}`);
    expect(dtos.find((entry) => entry.id === fixture.eicarMessageId)?.mediaUrl).toBeNull();
    expect(dtos.find((entry) => entry.id === fixture.pendingMessageId)?.mediaUrl).toBeNull();
    expect(dtos.find((entry) => entry.id === fixture.brokenMessageId)?.mediaUrl).toBeNull();

    // Storage: quarentena privada; sem cópia no prefixo público.
    if (!storage) throw new Error('storage ausente');
    const anonymous = await fetch(`${s3Endpoint}/${s3Bucket}/${eicarAssets[0].storage_key}`);
    expect(anonymous.status).toBe(403);
    const publicEicarKey = (eicarAssets[0].storage_key as string).replace(/^quarantine\//, 'media/');
    expect(await storage.exists(publicEicarKey)).toBe(false);

    // Idempotência: reexecução não duplica asset nem apaga mensagem.
    const snapshotBefore = JSON.parse(await snapshotMessagesAndAssets()) as { messages: unknown[]; assets: unknown[] };
    const second = await legacyModule!.migrateLegacyInboundMedia({ limit: 500 });
    const snapshotAfter = JSON.parse(await snapshotMessagesAndAssets()) as { messages: unknown[]; assets: unknown[] };
    expect(second.published).toHaveLength(0);
    expect(snapshotAfter.assets.length).toBe(snapshotBefore.assets.length);
    expect(snapshotAfter.messages.length).toBe(snapshotBefore.messages.length);
    expect((await getAssets(fixture.cleanMessageId)).filter((asset) => asset.storage_status === 'STORED')).toHaveLength(1);
    expect((await getMessage(fixture.cleanMessageId)).media_url).toBe(`asset://${cleanStored[0].id}`);

    // Revalidação periódica respeita o backoff persistido do retry anterior.
    const revalidated = await legacyModule!.revalidatePendingLegacyInboundMedia(50);
    expect(revalidated).toBe(0);
    const pendingAfterRevalidation = await getMessage(fixture.pendingMessageId);
    expect(pendingAfterRevalidation.media_url).toBeNull();
    expect(intakeOf(pendingAfterRevalidation).state).toBe('FAILED');
    expect((await getMessage(fixture.cleanMessageId)).media_url).toBe(`asset://${cleanStored[0].id}`);

    writeEvidenceJson('prod-14-ac4-migration.json', {
      conversationId: fixture.conversationId,
      first: {
        published: first.published,
        blocked: first.blocked,
        pending: first.pending,
        unavailable: first.unavailable,
        skipped: first.skipped,
        revalidated: first.revalidated,
      },
      second: {
        published: second.published.length,
        blocked: second.blocked.length,
        pending: second.pending.length,
        unavailable: second.unavailable.length,
        skipped: second.skipped.length,
        revalidated: second.revalidated,
      },
      http: {
        cleanRead: cleanRead.statusCode,
        eicarRead: eicarRead.statusCode,
        brokenRead: brokenRead.statusCode,
        pendingRead: pendingRead.statusCode,
        anonymousS3: anonymous.status,
      },
      idempotent: {
        assetsBefore: snapshotBefore.assets.length,
        assetsAfter: snapshotAfter.assets.length,
        messagesBefore: snapshotBefore.messages.length,
        messagesAfter: snapshotAfter.messages.length,
      },
      revalidated,
    });

    evidence.push({
      case: 'AC4-migracao-idempotente',
      conversationId: fixture.conversationId,
      published: first.published.map((record) => ({ messageId: record.messageId, assetId: record.assetId, storageKey: record.storageKey })),
      blocked: first.blocked.map((record) => ({ messageId: record.messageId, scanStatus: record.scanStatus, reasonCode: record.reasonCode })),
      pending: first.pending.map((record) => ({ messageId: record.messageId, reasonCode: record.reasonCode })),
      unavailable: first.unavailable.map((record) => ({ messageId: record.messageId, reasonCode: record.reasonCode })),
      http: {
        cleanRead: cleanRead.statusCode,
        eicarRead: eicarRead.statusCode,
        brokenRead: brokenRead.statusCode,
        pendingRead: pendingRead.statusCode,
      },
      idempotent: {
        assetsBefore: snapshotBefore.assets.length,
        assetsAfter: snapshotAfter.assets.length,
        messagesBefore: snapshotBefore.messages.length,
        messagesAfter: snapshotAfter.messages.length,
      },
      revalidated,
    });
  });
});
