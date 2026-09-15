/**
 * PROD-15 — upload outbound validado e resolução autorizada de assets
 * (G04/C06, BE15/BE10/UI04).
 *
 * Prova real em PostgreSQL isolado (runner `prod15`, worker 41), STORAGE real
 * (moto server S3-compatible, processo do próprio run) e SCANNER real (clamd
 * local com assinatura EICAR). O HTTP é real (`app.listen` + `fetch`), não
 * `inject`, para exercitar chunked/abort e o contrato de transporte.
 *
 *   AC1 — 16 MiB úteis consistentes no HTTP e no storage; +1 (com e sem
 *         Content-Length) → 413 recuperável; MIME/magic/executável negados;
 *         scanner ausente/falho → fail-closed em quarentena; nunca objeto
 *         público; abort de upload não deixa asset/objeto.
 *   AC2 — leitura autenticada/autorizada pela conversa (`chat:read` +
 *         membership); asset privado (S3 anônimo 403); TTL de cache/assinatura
 *         coerente; negativos 401/404/409/413/422/503; assinatura adulterada e
 *         asset revogado/removido negados.
 *   AC3 — ciclo completo upload → CLEAN → envio referencia asset → entrega
 *         (URL assinada real conferida no ato do gateway); INFECTED/PENDING/
 *         SCAN_FAILED indisponíveis no envio; URL/data-URL arbitrária nunca
 *         encaminhada; retry da mesma Idempotency-Key não duplica
 *         mensagem/delivery/asset.
 *   AC4 — integração com a mídia inbound do PROD-14 (webhook CLEAN legível e
 *         reenviável por asset) e com o legado (dry-run read-only + migração
 *         publicando CLEAN e entregando via outbound); nenhum caminho HTTP
 *         devolve URL crua.
 *
 * MinIO real permanece BLOCKED declarado (sem binário local; Docker sem
 * permissão no socket; dono: plataforma). A prova de storage usa o sandbox S3
 * por protocolo (moto 5.2.3), como em PROD-14.
 */
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ChatGatewayOutboundPort } from '@cvg/chat';
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
  published: Array<{ messageId: string; conversationId: string; assetId: string; storageKey: string | null }>;
  blocked: Array<{ messageId: string; assetId?: string; reasonCode: string }>;
  pending: Array<{ messageId: string; reasonCode: string }>;
  unavailable: Array<{ messageId?: string; assetId?: string; reasonCode: string }>;
  skipped: Array<{ messageId?: string; assetId?: string; reason: string }>;
  revalidated: number;
}

interface LegacyMediaMigrationModule {
  migrateLegacyInboundMedia: (options?: {
    limit?: number;
    revalidate?: boolean;
    revalidateLimit?: number;
  }) => Promise<LegacyMigrationReport>;
}

interface DeliverableResolution {
  ok: boolean;
  reason?: string;
  scanStatus?: string;
  storageStatus?: string;
  signedUrl?: string;
  asset?: { id: string; storageKey: string | null; mimeType: string | null; filename: string | null };
}

interface MediaModule {
  getMediaMaxBytes: () => number;
  setMediaStorage: (storage: unknown) => void;
  resetMediaStorage: () => void;
  resolveDeliverableAsset: (query: { assetId: string; conversationId: string }) => Promise<DeliverableResolution>;
  dryRunLegacyMediaMigration: (options?: { limit?: number }) => Promise<LegacyDryRunReport>;
  S3MediaStorage: new (config: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
    client?: unknown;
  }) => { driver: string; exists(key: string): Promise<boolean>; get(key: string): Promise<Buffer>; put(input: { key: string; body: Buffer; contentType: string }): Promise<{ etag?: string }> };
}

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../../..');
const PROGRAM_DIR = process.env.CVG_PROGRAM_DIR || join(REPO_ROOT, 'docs', 'producao-2026-09-13');
const EVIDENCE_SEGMENT = process.env.CVG_EVIDENCE_SEGMENT?.trim();
const EVIDENCE_DIR = join(
  PROGRAM_DIR,
  'evidencias',
  'prod-15',
  ...(EVIDENCE_SEGMENT ? [EVIDENCE_SEGMENT] : []),
);
const LOG_DIR = join(EVIDENCE_DIR, 'logs');
const MIGRATIONS_DIR = join(REPO_ROOT, 'packages', 'database', 'supabase', 'migrations');
const RUN_ID = process.env.AAA_RUN_ID || 'prod15';
const WORKER_INDEX = Number(process.env.AAA_WORKER_INDEX || '41');
const WEBHOOK_SECRET = 'prod15-webhook-secret';
const INTERNAL_SECRET = 'prod15-internal-secret';
const PASSWORD = 'Str0ngPass!42';
const PASSWORD_HASH = '$2a$10$QMxMJ8QfVxjH93DvTDs2m.OVuALoBBR6S9d58BwIPb8rcXHsUBJWC';
const CLAMAV_HOST = process.env.PROD15_CLAMAV_HOST || '127.0.0.1';
const CLAMAV_PORT = Number(process.env.PROD15_CLAMAV_PORT || '53110');
const MOTO_PYTHON = process.env.PROD15_MOTO_PYTHON || '/tmp/opencode/moto-venv/bin/python';
const MAX_BYTES = 16 * 1024 * 1024;
const TTL_SECONDS = 120;

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
process.env.RATE_LIMIT_MAX = process.env.RATE_LIMIT_MAX || '10000';
// O DATABASE_URL só é definido após provisionar o PG isolado (nunca o host).
delete process.env.DATABASE_URL;

vi.setConfig({ testTimeout: 180_000, hookTimeout: 600_000 });

const EICAR = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('prod15-png-payload'),
]);
const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n%%EOF\n');
const MZ_BYTES = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(1024, 0x90)]);
const ELF_BYTES = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(64, 0)]);
const BLACKHOLE_MS = 2000;

const evidence: Array<Record<string, unknown>> = [];

function writeEvidenceJson(name: string, value: unknown): void {
  writeFileSync(join(EVIDENCE_DIR, name), `${JSON.stringify(value, null, 2)}\n`);
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function dataUrl(mimetype: string, bytes: Buffer): string {
  return `data:${mimetype};base64,${bytes.toString('base64')}`;
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
    await sleep(100);
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
let baseUrl = '';
let databaseModulePool: PgClientLike | undefined;
let moto: ChildProcess | null = null;
let motoPort = 0;
let s3Endpoint = '';
let s3Bucket = '';
let s3Client: unknown = null;
let storage: InstanceType<MediaModule['S3MediaStorage']> | null = null;
let mediaModule: MediaModule | null = null;
let pipelineModule: InboundMediaPipelineModule | null = null;
let legacyModule: LegacyMediaMigrationModule | null = null;

let operatorUserId = '';
let outsiderUserId = '';
let adminUserId = '';
let operatorToken = '';
let outsiderToken = '';
let adminToken = '';
let convA = '';
let convB = '';
let legacyConv = '';
let cleanAssetId = '';

interface ForwardedCall {
  messageId: string;
  conversationId: string;
  content: string;
  recipient: string;
  attachmentUrl?: string;
  senderType?: string;
}
const forwarded: ForwardedCall[] = [];
const attachmentChecks: Array<{ status: number; length: number; sha256: string }> = [];

interface MessageRow {
  id: string;
  conversation_id: string;
  direction: string;
  content: string;
  media_url: string | null;
  media_type: string | null;
  media_mimetype: string | null;
  media_filename: string | null;
  metadata: string | null;
}

interface AssetRow {
  id: string;
  storage_key: string | null;
  storage_status: string;
  scan_status: string;
  mime_type: string | null;
  size_bytes: number | null;
  sha256: string | null;
  filename: string | null;
  message_id: string | null;
}

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
    provider: 'prod15-sandbox',
    channel: 'whatsapp',
    payload: {
      instance: input.instance,
      remoteJid: input.remoteJid,
      messageId: input.messageId,
      fromMe: false,
      pushName: 'Prod15 Contato',
      type: input.type ?? 'image',
      text: input.text ?? '',
      ...(input.media ? { media: input.media } : {}),
      timestamp: Math.floor(Date.now() / 1000),
    },
  });
}

async function postGatewayInbound(rawBody: string, eventId: string) {
  const timestamp = Math.floor(Date.now() / 1000);
  return fetch(`${baseUrl}/gateway/inbound`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-webhook-signature': `sha256=${signRawBody(rawBody, timestamp)}`,
      'x-webhook-timestamp': String(timestamp),
      'x-webhook-event-id': eventId,
    },
    body: rawBody,
  });
}

interface UploadOptions {
  mime?: string;
  mediaType?: string;
  filename?: string;
  token?: string;
  conversationId?: string;
}

async function upload(bytes: Buffer, options: UploadOptions = {}) {
  const response = await fetch(`${baseUrl}/conversations/${options.conversationId ?? convA}/media`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${options.token ?? operatorToken}`,
      'content-type': 'application/octet-stream',
      'x-media-type': options.mediaType ?? 'document',
      'x-media-mimetype': options.mime ?? 'application/pdf',
      ...(options.filename ? { 'x-media-filename': options.filename } : {}),
    },
    body: bytes,
  });
  const body = (await response.json()) as Record<string, unknown>;
  return { status: response.status, body };
}

async function sendMessage(
  payload: Record<string, unknown>,
  options: { conversationId?: string; token?: string; idempotencyKey?: string } = {},
) {
  const headers: Record<string, string> = {
    authorization: `Bearer ${options.token ?? operatorToken}`,
    'content-type': 'application/json',
  };
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;
  const response = await fetch(`${baseUrl}/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      conversationId: options.conversationId ?? convA,
      recipient: '+5511999999000',
      ...payload,
    }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function readAsset(
  assetId: string,
  options: { conversationId?: string; token?: string } = {},
) {
  const headers: Record<string, string> = {};
  if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`;
  const response = await fetch(
    `${baseUrl}/conversations/${options.conversationId ?? convA}/media/${assetId}`,
    { headers },
  );
  return {
    status: response.status,
    headers: response.headers,
    bytes: Buffer.from(await response.arrayBuffer()),
  };
}

async function abortPartialUpload(path: string, headers: Record<string, string>, partial: Buffer): Promise<void> {
  const url = new URL(`${baseUrl}${path}`);
  await new Promise<void>((resolveAbort) => {
    const request = http.request({
      host: url.hostname,
      port: Number(url.port),
      path: `${url.pathname}${url.search}`,
      method: 'POST',
      headers,
    });
    request.on('error', () => resolveAbort());
    request.on('close', () => resolveAbort());
    request.write(partial);
    setTimeout(() => request.destroy(), 300);
    setTimeout(() => resolveAbort(), 2000);
  });
}

async function getMessage(messageId: string): Promise<MessageRow> {
  const result = await pool.query<MessageRow>('SELECT * FROM messages WHERE id = $1', [messageId]);
  const row = result.rows[0];
  if (!row) throw new Error(`mensagem ${messageId} ausente`);
  return row;
}

async function getAsset(assetId: string): Promise<AssetRow> {
  const result = await pool.query<AssetRow>('SELECT * FROM media_assets WHERE id = $1', [assetId]);
  const row = result.rows[0];
  if (!row) throw new Error(`asset ${assetId} ausente`);
  return row;
}

async function countAssetsForConversation(conversationId: string): Promise<number> {
  const result = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM media_assets
      WHERE storage_key LIKE $1 OR storage_key LIKE $2`,
    [`media/${conversationId}/%`, `quarantine/${conversationId}/%`],
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function countMessages(conversationId: string, content: string): Promise<number> {
  const result = await pool.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM messages WHERE conversation_id = $1 AND content = $2',
    [conversationId, content],
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function countDeliveriesForMessages(conversationId: string): Promise<number> {
  const result = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM outbound_deliveries d
       JOIN messages m ON m.id = d.internal_message_id
      WHERE m.conversation_id = $1`,
    [conversationId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

function listObjectKeys(prefix: string): Promise<string[]> {
  const sdk = s3Sdk;
  const command = new sdk.ListObjectsV2Command({ Bucket: s3Bucket, Prefix: prefix });
  return (s3Client as { send(input: unknown): Promise<unknown> })
    .send(command)
    .then((listed) => ((listed as { Contents?: Array<{ Key?: string }> }).Contents ?? [])
      .map((entry) => entry.Key)
      .filter((key): key is string => Boolean(key)));
}

function headObject(key: string): Promise<{ ContentLength?: number }> {
  const sdk = s3Sdk;
  const command = new sdk.HeadObjectCommand({ Bucket: s3Bucket, Key: key });
  return (s3Client as { send(input: unknown): Promise<unknown> }).send(command)
    .then((head) => head as { ContentLength?: number });
}

let s3Sdk: {
  S3Client: new (config: Record<string, unknown>) => unknown;
  CreateBucketCommand: new (input: { Bucket: string }) => unknown;
  HeadObjectCommand: new (input: { Bucket: string; Key: string }) => unknown;
  DeleteObjectCommand: new (input: { Bucket: string; Key: string }) => unknown;
  ListObjectsV2Command: new (input: { Bucket: string; Prefix: string }) => unknown;
};

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

async function login(email: string): Promise<string> {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const text = await response.text();
  expect(response.status, text).toBe(200);
  return (JSON.parse(text) as { token: string }).token;
}

async function insertLegacyMessage(input: {
  conversationId: string;
  content: string;
  mediaUrl: string | null;
  mediaType?: string;
  mimetype?: string;
  filename?: string;
}): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO messages (id, conversation_id, direction, content, status, media_url, media_type, media_mimetype, media_filename)
     VALUES ($1, $2, 'inbound', $3, 'delivered', $4, $5, $6, $7)`,
    [id, input.conversationId, input.content, input.mediaUrl, input.mediaType ?? null, input.mimetype ?? null, input.filename ?? null],
  );
  return id;
}

async function snapshotMessagesAndAssets(): Promise<string> {
  const messages = await pool.query('SELECT * FROM messages ORDER BY id');
  const assets = await pool.query('SELECT * FROM media_assets ORDER BY id');
  return JSON.stringify({ messages: messages.rows, assets: assets.rows });
}

function intakeOf(message: MessageRow): Record<string, unknown> {
  if (!message.metadata) return {};
  const parsed = JSON.parse(message.metadata) as Record<string, unknown>;
  return (parsed.mediaIntake as Record<string, unknown>) ?? {};
}

function repoFile(relativeFromRepoRoot: string): string {
  const candidates = [
    resolve(REPO_ROOT, relativeFromRepoRoot),
    resolve(process.cwd(), '..', '..', relativeFromRepoRoot),
    resolve(process.cwd(), relativeFromRepoRoot),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error(`Arquivo não encontrado para verificação de configuração: ${relativeFromRepoRoot}`);
  return readFileSync(found, 'utf8');
}

beforeAll(async () => {
  mkdirSync(LOG_DIR, { recursive: true });

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

  // Scanner real (clamd com EICAR). Ausência = BLOCKED explícito, nunca PASS.
  if (!(await clamdPing())) {
    throw new Error(
      `BLOCKED (PROD-15): clamd real não respondeu zPING em ${CLAMAV_HOST}:${CLAMAV_PORT}. `
      + 'Provisione ClamAV local antes de executar; a prova de scanner real NÃO pode ser simulada.',
    );
  }

  // Storage real S3-compatible: moto server do PRÓPRIO run (porta livre).
  motoPort = await getFreePort();
  s3Endpoint = `http://127.0.0.1:${motoPort}`;
  s3Bucket = `cvg-media-prod15-${randomUUID().slice(0, 8)}`;
  const motoLog = join(LOG_DIR, 'moto-server.log');
  const motoOut = await import('node:fs').then((fs) => fs.openSync(motoLog, 'w'));
  moto = spawn(MOTO_PYTHON, ['-m', 'moto.server', '-p', String(motoPort), '-H', '127.0.0.1'], {
    stdio: ['ignore', motoOut, motoOut],
  });
  moto.on('error', (error) => {
    throw new Error(`BLOCKED (PROD-15): falha ao iniciar moto S3 real: ${error.message}`);
  });
  await waitForTcpPort(motoPort);

  const requireFromMedia = createRequire(import.meta.url);
  const s3Entry = requireFromMedia.resolve('@aws-sdk/client-s3', { paths: [join(REPO_ROOT, 'packages', 'media')] });
  s3Sdk = (await import(pathToFileURL(s3Entry).href)) as unknown as typeof s3Sdk;
  const client = new s3Sdk.S3Client({
    endpoint: s3Endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: 'prod15key', secretAccessKey: 'prod15secret' },
  });
  s3Client = client;
  await (client as { send(command: unknown): Promise<unknown> }).send(new s3Sdk.CreateBucketCommand({ Bucket: s3Bucket }));

  // Configuração de produção ANTES de importar o app (limite/TTL capturados no registro).
  process.env.MEDIA_STORAGE_DRIVER = 's3';
  process.env.S3_ENDPOINT = s3Endpoint;
  process.env.S3_REGION = 'us-east-1';
  process.env.S3_BUCKET = s3Bucket;
  process.env.S3_ACCESS_KEY_ID = 'prod15key';
  process.env.S3_SECRET_ACCESS_KEY = 'prod15secret';
  process.env.S3_FORCE_PATH_STYLE = 'true';
  process.env.MALWARE_SCANNER = 'clamav';
  process.env.CLAMAV_HOST = CLAMAV_HOST;
  process.env.CLAMAV_PORT = String(CLAMAV_PORT);
  process.env.MEDIA_MAX_BYTES = String(MAX_BYTES);
  process.env.MEDIA_REQUIRE_SCAN = 'all';
  process.env.MEDIA_PIPELINE_ENABLED = 'true';
  process.env.MEDIA_SIGNED_URL_TTL_SECONDS = String(TTL_SECONDS);
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
    accessKeyId: 'prod15key',
    secretAccessKey: 'prod15secret',
    forcePathStyle: true,
    client,
  });
  mediaModule.setMediaStorage(storage);

  const appModule = (await import('../../app.ts')) as { buildDeskApiApp: () => Promise<FastifyInstance> };
  app = await appModule.buildDeskApiApp();
  await app.ready();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address() as net.AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;

  // Provider outbound real da composição é substituído por um dublê de
  // gravação que CONFERE a URL assinada no ato do envio (o que se julga é o
  // gating/entrega, não o WhatsApp).
  const chatModule = (await import(/* @vite-ignore */ '@cvg/chat')) as {
    setGatewayOutboundPort: (port: ChatGatewayOutboundPort) => void;
  };
  const capturePort: ChatGatewayOutboundPort = {
    providerSupportsIdempotency: () => true,
    async sendOutbound(request) {
      forwarded.push({
        messageId: request.messageId,
        conversationId: request.conversationId,
        content: request.content,
        recipient: request.externalPhone,
        attachmentUrl: request.attachmentUrl,
        senderType: request.senderType,
      });
      if (request.attachmentUrl) {
        const response = await fetch(request.attachmentUrl);
        const bytes = Buffer.from(await response.arrayBuffer());
        attachmentChecks.push({ status: response.status, length: bytes.length, sha256: sha256(bytes) });
      }
      return { success: true, messageId: `prod15-gw-${forwarded.length}` };
    },
  };
  chatModule.setGatewayOutboundPort(capturePort);

  const databaseModule = await import('../../../../../packages/database/src/index.ts');
  databaseModulePool = databaseModule.getPool() as unknown as PgClientLike;

  const suffix = String(Date.now()).slice(-6);
  const sectorId = randomUUID();
  await pool.query('INSERT INTO sectors (id, name, code) VALUES ($1, $2, $3)', [
    sectorId,
    `prod15 midia ${suffix}`,
    `p15m${suffix}`,
  ]);

  operatorUserId = await insertUser(`prod15-operator-${suffix}@cvg.test`, 'PROD-15 Operator', 'Receptionist');
  outsiderUserId = await insertUser(`prod15-outsider-${suffix}@cvg.test`, 'PROD-15 Outsider', 'Receptionist');
  adminUserId = await insertUser(`prod15-admin-${suffix}@cvg.test`, 'PROD-15 Admin', 'Admin');
  await pool.query('INSERT INTO user_sectors (user_id, sector_id, access_level) VALUES ($1, $2, $3)', [
    operatorUserId,
    sectorId,
    'write',
  ]);

  convA = randomUUID();
  convB = randomUUID();
  legacyConv = randomUUID();
  for (const conversationId of [convA, convB, legacyConv]) {
    await pool.query('INSERT INTO conversations (id, sector_id) VALUES ($1, $2)', [conversationId, sectorId]);
  }

  operatorToken = await login(`prod15-operator-${suffix}@cvg.test`);
  outsiderToken = await login(`prod15-outsider-${suffix}@cvg.test`);
  adminToken = await login(`prod15-admin-${suffix}@cvg.test`);

  // Asset CLEAN de referência compartilhado pelos negativos/TTL (AC2).
  const clean = await upload(PNG_BYTES, { mime: 'image/png', mediaType: 'image', filename: 'referencia.png' });
  expect(clean.status, JSON.stringify(clean.body)).toBe(201);
  cleanAssetId = String(clean.body.assetId);
});

afterAll(async () => {
  writeEvidenceJson('prod-15-evidence.json', {
    generatedAt: new Date().toISOString(),
    runId: RUN_ID,
    workerIndex: WORKER_INDEX,
    database: isolatedEnv?.databaseName,
    postgresPort: ctx?.ports.postgres,
    storage: {
      driver: 's3',
      endpoint: s3Endpoint,
      bucket: s3Bucket,
      backend: 'moto real (S3 protocol sandbox)',
      minio: 'BLOCKED sem binário local; Docker sem permissão no socket; dono: plataforma',
    },
    scanner: { driver: 'clamav', host: CLAMAV_HOST, port: CLAMAV_PORT, real: true },
    limitBytes: MAX_BYTES,
    ttlSeconds: TTL_SECONDS,
    users: { operatorUserId, outsiderUserId, adminUserId },
    conversations: { convA, convB, legacyConv },
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

describe('PROD-15 — upload validado e resolução autorizada de assets (G04/C06)', () => {
  it('AC1 — limite 16 MiB exato; +1 com e sem Content-Length → 413 recuperável; objeto com tamanho exato', async () => {
    expect(mediaModule!.getMediaMaxBytes()).toBe(MAX_BYTES);

    const exact = await upload(Buffer.alloc(MAX_BYTES, 0x41), { mime: 'text/plain', filename: 'limite.txt' });
    expect(exact.status, JSON.stringify(exact.body)).toBe(201);
    expect(exact.body.scanStatus).toBe('CLEAN');
    expect(exact.body.storageStatus).toBe('STORED');
    expect(exact.body.sizeBytes).toBe(MAX_BYTES);
    const exactAssetId = String(exact.body.assetId);
    const exactRow = await getAsset(exactAssetId);
    expect(exactRow.storage_key?.startsWith(`media/${convA}/${operatorUserId}/`)).toBe(true);
    const head = await headObject(exactRow.storage_key as string);
    expect(head.ContentLength).toBe(MAX_BYTES);
    expect(exact.body).not.toHaveProperty('signedUrl');
    expect(JSON.stringify(exact.body)).not.toContain('X-Amz-Signature');

    const over = await upload(Buffer.alloc(MAX_BYTES + 1, 0x41), { mime: 'text/plain', filename: 'excesso.txt' });
    expect(over.status).toBe(413);
    expect(over.body.error).toBe('PAYLOAD_TOO_LARGE');
    expect(over.body.recoverable).toBe(true);
    expect(over.body.maxBytes).toBe(MAX_BYTES);

    const overStream = Buffer.alloc(MAX_BYTES + 1, 0x42);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(overStream);
        controller.close();
      },
    });
    const streamed = await fetch(`${baseUrl}/conversations/${convA}/media`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${operatorToken}`,
        'content-type': 'application/octet-stream',
        'x-media-type': 'document',
        'x-media-mimetype': 'text/plain',
      },
      body: stream,
      duplex: 'half',
    });
    expect(streamed.status).toBe(413);
    const streamedBody = (await streamed.json()) as Record<string, unknown>;
    expect(streamedBody.error).toBe('PAYLOAD_TOO_LARGE');
    expect(streamedBody.recoverable).toBe(true);

    // Acima do teto DURO do parser (maxBytes + overhead) o handler global
    // também responde o mesmo contrato recuperável, sem exceder a memória.
    const hardStream = Buffer.alloc(MAX_BYTES + 8192, 0x43);
    const hardBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(hardStream);
        controller.close();
      },
    });
    const hardLimited = await fetch(`${baseUrl}/conversations/${convA}/media`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${operatorToken}`,
        'content-type': 'application/octet-stream',
        'x-media-type': 'document',
        'x-media-mimetype': 'text/plain',
      },
      body: hardBody,
      duplex: 'half',
    });
    expect(hardLimited.status).toBe(413);
    const hardBodyJson = (await hardLimited.json()) as Record<string, unknown>;
    expect(hardBodyJson.error).toBe('PAYLOAD_TOO_LARGE');
    expect(hardBodyJson.maxBytes).toBe(MAX_BYTES);

    const disallowed = await upload(Buffer.from('#!/bin/sh\necho x\n'), {
      mime: 'text/x-shellscript',
      filename: 'script.sh',
    });
    expect(disallowed.status).toBe(415);
    expect(disallowed.body.error).toBe('MEDIA_MIME_NOT_ALLOWED');

    const mismatch = await upload(PNG_BYTES, { mime: 'application/pdf', filename: 'falso.pdf' });
    expect(mismatch.status).toBe(415);
    expect(mismatch.body.error).toBe('MEDIA_MIME_MISMATCH');

    const executable = await upload(MZ_BYTES, { mime: 'application/pdf', filename: 'mz.pdf' });
    expect(executable.status).toBe(415);
    expect(executable.body.error).toBe('MEDIA_EXECUTABLE_CONTENT');

    const elf = await upload(ELF_BYTES, { mime: 'application/pdf', filename: 'elf.pdf' });
    expect(elf.status).toBe(415);
    expect(elf.body.error).toBe('MEDIA_EXECUTABLE_CONTENT');

    for (const blocked of [over, disallowed, mismatch, executable, elf]) {
      expect(blocked.body.assetId).toBeUndefined();
    }
    // Nomes rejeitados nunca geraram linha em media_assets.
    const rejectedRows = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM media_assets WHERE filename IN ('excesso.txt','script.sh','falso.pdf','mz.pdf','elf.pdf')",
    );
    expect(Number(rejectedRows.rows[0]?.count ?? 0)).toBe(0);

    evidence.push({
      case: 'AC1-limite-16MiB-magic',
      exact: { status: exact.status, assetId: exactAssetId, sizeBytes: exact.body.sizeBytes, objectBytes: head.ContentLength },
      overContentLength: { status: over.status, error: over.body.error, recoverable: over.body.recoverable },
      overStream: { status: streamed.status, error: streamedBody.error },
      overHardLimit: { status: hardLimited.status, error: hardBodyJson.error, maxBytes: hardBodyJson.maxBytes },
      disallowed: disallowed.body.error,
      mismatch: mismatch.body.error,
      executable: executable.body.error,
      elf: elf.body.error,
      maxBytes: mediaModule!.getMediaMaxBytes(),
    });
  });

  it('AC1 — EICAR real → 422 fail-closed: quarentena privada, sem cópia pública', async () => {
    const infected = await upload(EICAR, { mime: 'text/plain', filename: 'eicar.txt' });
    expect(infected.status).toBe(422);
    expect(infected.body.error).toBe('MEDIA_INFECTED');
    expect(infected.body.scanStatus).toBe('INFECTED');
    expect(infected.body.storageStatus).toBe('QUARANTINED');
    expect(infected.body.recoverable).toBe(false);
    const assetId = String(infected.body.assetId);
    const row = await getAsset(assetId);
    expect(row.storage_key?.startsWith(`quarantine/${convA}/${operatorUserId}/`)).toBe(true);
    expect(row.sha256).toBe(sha256(EICAR));

    const object = await storage!.get(row.storage_key as string);
    expect(object.equals(EICAR)).toBe(true);
    const publicTwin = (row.storage_key as string).replace(/^quarantine\//, 'media/');
    expect(await storage!.exists(publicTwin)).toBe(false);
    const anonymous = await fetch(`${s3Endpoint}/${s3Bucket}/${row.storage_key}`);
    expect(anonymous.status).toBe(403);

    evidence.push({
      case: 'AC1-eicar-quarentena',
      assetId,
      scanStatus: row.scan_status,
      storageStatus: row.storage_status,
      storageKey: row.storage_key,
      bytesPreserved: object.length,
      publicTwinExists: false,
      anonymousS3: anonymous.status,
    });
  });

  it('AC1 — scanner ausente/timeout e storage fora → 503 recuperável, fail-closed sem publicação', async () => {
    const previousScanner = process.env.MALWARE_SCANNER;
    delete process.env.MALWARE_SCANNER;
    let missingScanner: Awaited<ReturnType<typeof upload>>;
    try {
      missingScanner = await upload(PDF_BYTES, { mime: 'application/pdf', filename: 'sem-scanner.pdf' });
    } finally {
      process.env.MALWARE_SCANNER = previousScanner ?? 'clamav';
    }
    expect(missingScanner!.status).toBe(503);
    expect(missingScanner!.body.error).toBe('SCANNER_UNAVAILABLE');
    expect(missingScanner!.body.retryable).toBe(true);
    expect(missingScanner!.body.scanStatus).toBe('PENDING_SCAN');
    expect(missingScanner!.body.storageStatus).toBe('QUARANTINED');
    const pendingRow = await getAsset(String(missingScanner!.body.assetId));
    expect(pendingRow.storage_key?.startsWith(`quarantine/${convA}/${operatorUserId}/`)).toBe(true);
    expect(await storage!.exists((pendingRow.storage_key as string).replace(/^quarantine\//, 'media/'))).toBe(false);

    const blackhole = await startBlackhole();
    const previousPort = process.env.CLAMAV_PORT;
    const previousTimeout = process.env.MALWARE_SCAN_TIMEOUT_MS;
    process.env.CLAMAV_PORT = String(blackhole.port);
    process.env.MALWARE_SCAN_TIMEOUT_MS = String(BLACKHOLE_MS);
    let timedOut: Awaited<ReturnType<typeof upload>>;
    try {
      timedOut = await upload(PDF_BYTES, { mime: 'application/pdf', filename: 'timeout.pdf' });
    } finally {
      process.env.CLAMAV_PORT = previousPort ?? String(CLAMAV_PORT);
      if (previousTimeout === undefined) delete process.env.MALWARE_SCAN_TIMEOUT_MS;
      else process.env.MALWARE_SCAN_TIMEOUT_MS = previousTimeout;
      await blackhole.close();
    }
    expect(timedOut!.status).toBe(503);
    expect(timedOut!.body.error).toBe('SCANNER_UNAVAILABLE');
    expect(timedOut!.body.retryable).toBe(true);
    expect(timedOut!.body.scanStatus).toBe('SCAN_FAILED');
    const failedRow = await getAsset(String(timedOut!.body.assetId));
    const failedBytes = await storage!.get(failedRow.storage_key as string);
    expect(failedBytes.equals(PDF_BYTES)).toBe(true);

    // Storage indisponível: driver real apontado para porta fechada.
    const downClient = new s3Sdk.S3Client({
      endpoint: 'http://127.0.0.1:9',
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId: 'none', secretAccessKey: 'none' },
      maxAttempts: 1,
    });
    const downStorage = new mediaModule!.S3MediaStorage({
      endpoint: 'http://127.0.0.1:9',
      region: 'us-east-1',
      bucket: s3Bucket,
      accessKeyId: 'none',
      secretAccessKey: 'none',
      forcePathStyle: true,
      client: downClient,
    });
    const assetsBeforeDown = await countAssetsForConversation(convB);
    let storageDown: Awaited<ReturnType<typeof upload>>;
    mediaModule!.setMediaStorage(downStorage);
    try {
      storageDown = await upload(PDF_BYTES, { mime: 'application/pdf', filename: 'storage-fora.pdf', conversationId: convB });
    } finally {
      mediaModule!.setMediaStorage(storage);
    }
    expect(storageDown!.status).toBe(503);
    expect(storageDown!.body.error).toBe('MEDIA_STORAGE_UNAVAILABLE');
    expect(storageDown!.body.recoverable).toBe(true);
    expect(await countAssetsForConversation(convB)).toBe(assetsBeforeDown);

    evidence.push({
      case: 'AC1-fail-closed-servicos',
      scannerMissing: { status: missingScanner!.status, scanStatus: missingScanner!.body.scanStatus, storageStatus: missingScanner!.body.storageStatus },
      scannerTimeout: { status: timedOut!.status, error: timedOut!.body.error, scanStatus: timedOut!.body.scanStatus, bytesPreserved: failedBytes.length },
      storageDown: { status: storageDown!.status, error: storageDown!.body.error, recoverable: storageDown!.body.recoverable },
    });
  });

  it('AC1 — abort de upload parcial não persiste asset/objeto e não afeta assets do run', async () => {
    const assetsBefore = await countAssetsForConversation(convA);
    const publicBefore = await listObjectKeys(`media/${convA}/`);
    const quarantineBefore = await listObjectKeys(`quarantine/${convA}/`);

    await abortPartialUpload(
      `/conversations/${convA}/media`,
      {
        authorization: `Bearer ${operatorToken}`,
        'content-type': 'application/octet-stream',
        'x-media-type': 'image',
        'x-media-mimetype': 'image/png',
      },
      PNG_BYTES.subarray(0, 12),
    );
    await sleep(500);

    expect(await countAssetsForConversation(convA)).toBe(assetsBefore);
    expect((await listObjectKeys(`media/${convA}/`)).sort()).toEqual([...publicBefore].sort());
    expect((await listObjectKeys(`quarantine/${convA}/`)).sort()).toEqual([...quarantineBefore].sort());

    // O asset CLEAN do run continua íntegro e legível.
    const read = await readAsset(cleanAssetId, { token: operatorToken });
    expect(read.status).toBe(200);
    expect(Buffer.compare(read.bytes, PNG_BYTES)).toBe(0);

    evidence.push({
      case: 'AC1-abort-upload',
      assetsBefore,
      assetsAfter: await countAssetsForConversation(convA),
      publicObjectsBefore: publicBefore.length,
      publicObjectsAfter: (await listObjectKeys(`media/${convA}/`)).length,
      cleanAssetStillReadable: read.status,
    });
  });

  it('AC2 — leitura do CLEAN: bytes proxiados, cache privado com TTL e sem URL pública', async () => {
    const row = await getAsset(cleanAssetId);
    const anonymousObject = await fetch(`${s3Endpoint}/${s3Bucket}/${row.storage_key}`);
    expect(anonymousObject.status).toBe(403);

    const read = await readAsset(cleanAssetId, { token: operatorToken });
    expect(read.status, read.bytes.toString('utf8')).toBe(200);
    expect(read.headers.get('content-type')).toBe('image/png');
    expect(read.headers.get('cache-control')).toBe(`private, max-age=${TTL_SECONDS}`);
    expect(read.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.compare(read.bytes, PNG_BYTES)).toBe(0);
    expect(read.bytes.toString('latin1')).not.toContain('X-Amz-Signature');

    evidence.push({
      case: 'AC2-leitura-clean',
      assetId: cleanAssetId,
      anonymousS3: anonymousObject.status,
      readStatus: read.status,
      contentType: read.headers.get('content-type'),
      cacheControl: read.headers.get('cache-control'),
      sha256: sha256(read.bytes),
    });
  });

  it('AC2 — negativos 401/404/409/422/503 e adulteração/revogação negadas', async () => {
    // Não autenticado → 401.
    const anonymousRead = await readAsset(cleanAssetId);
    expect(anonymousRead.status).toBe(401);
    expect(anonymousRead.bytes.length).toBeGreaterThan(0);

    // Ator sem membership no setor da conversa → 404 genérico (sem vazamento).
    const outsiderRead = await readAsset(cleanAssetId, { token: outsiderToken });
    expect(outsiderRead.status).toBe(404);
    expect(outsiderRead.bytes.toString('utf8')).not.toContain('prod15-png-payload');

    // Asset de outra conversa visto pela conversa errada → 404, sem bytes.
    const wrongConversation = await readAsset(cleanAssetId, { conversationId: convB, token: operatorToken });
    expect(wrongConversation.status).toBe(404);
    expect(wrongConversation.bytes.toString('utf8')).not.toContain('prod15-png-payload');

    // assetId inexistente/adulterado → 404; formato inválido → 400.
    const unknown = await readAsset(randomUUID(), { token: operatorToken });
    expect(unknown.status).toBe(404);
    const malformed = await readAsset('not-a-uuid', { token: operatorToken });
    expect(malformed.status).toBe(400);

    // INFECTED → 422; PENDING → 409; SCAN_FAILED → 503 (anti-leak de bytes).
    const infected = await upload(EICAR, { mime: 'text/plain', filename: 'neg-eicar.txt' });
    const infectedRead = await readAsset(String(infected.body.assetId), { token: operatorToken });
    expect(infectedRead.status).toBe(422);
    expect((JSON.parse(infectedRead.bytes.toString('utf8')) as { error: string }).error).toBe('MEDIA_ASSET_INFECTED');
    expect(infectedRead.bytes.toString('latin1')).not.toContain('EICAR');

    const previousScanner = process.env.MALWARE_SCANNER;
    delete process.env.MALWARE_SCANNER;
    let pending: Awaited<ReturnType<typeof upload>>;
    try {
      pending = await upload(PDF_BYTES, { mime: 'application/pdf', filename: 'neg-pendente.pdf' });
    } finally {
      process.env.MALWARE_SCANNER = previousScanner ?? 'clamav';
    }
    const pendingRead = await readAsset(String(pending!.body.assetId), { token: operatorToken });
    expect(pendingRead.status).toBe(409);
    expect((JSON.parse(pendingRead.bytes.toString('utf8')) as { error: string }).error).toBe('MEDIA_ASSET_PENDING_SCAN');

    const blackhole = await startBlackhole();
    const previousPort = process.env.CLAMAV_PORT;
    const previousTimeout = process.env.MALWARE_SCAN_TIMEOUT_MS;
    process.env.CLAMAV_PORT = String(blackhole.port);
    process.env.MALWARE_SCAN_TIMEOUT_MS = String(BLACKHOLE_MS);
    let failed: Awaited<ReturnType<typeof upload>>;
    try {
      failed = await upload(PDF_BYTES, { mime: 'application/pdf', filename: 'neg-falha.pdf' });
    } finally {
      process.env.CLAMAV_PORT = previousPort ?? String(CLAMAV_PORT);
      if (previousTimeout === undefined) delete process.env.MALWARE_SCAN_TIMEOUT_MS;
      else process.env.MALWARE_SCAN_TIMEOUT_MS = previousTimeout;
      await blackhole.close();
    }
    const failedRead = await readAsset(String(failed!.body.assetId), { token: operatorToken });
    expect(failedRead.status).toBe(503);
    expect((JSON.parse(failedRead.bytes.toString('utf8')) as { error: string }).error).toBe('MEDIA_ASSET_SCAN_FAILED');

    // Revogação: asset deixa de estar STORED → leitura e envio negados.
    const revoked = await upload(PNG_BYTES, { mime: 'image/png', mediaType: 'image', filename: 'revogado.png' });
    const revokedId = String(revoked.body.assetId);
    await pool.query("UPDATE media_assets SET storage_status = 'DELETED' WHERE id = $1", [revokedId]);
    const revokedRead = await readAsset(revokedId, { token: operatorToken });
    expect(revokedRead.status).toBe(409);
    const revokedSend = await sendMessage({ content: 'revogado', mediaAssetId: revokedId });
    expect(revokedSend.status).toBe(409);
    expect(revokedSend.body.error).toBe('MEDIA_ASSET_NOT_CLEAN');

    // Objeto removido do storage: leitura falha recuperável (sem bytes de outro asset).
    const removed = await upload(PNG_BYTES, { mime: 'image/png', mediaType: 'image', filename: 'removido.png' });
    const removedId = String(removed.body.assetId);
    const removedRow = await getAsset(removedId);
    await (s3Client as { send(input: unknown): Promise<unknown> }).send(
      new s3Sdk.DeleteObjectCommand({ Bucket: s3Bucket, Key: removedRow.storage_key as string }),
    );
    const removedRead = await readAsset(removedId, { token: operatorToken });
    expect(removedRead.status).toBe(503);
    expect((JSON.parse(removedRead.bytes.toString('utf8')) as { error: string }).error).toBe('MEDIA_STORAGE_UNAVAILABLE');

    evidence.push({
      case: 'AC2-negativos',
      anonymous: anonymousRead.status,
      outsider: outsiderRead.status,
      wrongConversation: wrongConversation.status,
      unknownAsset: unknown.status,
      malformedAsset: malformed.status,
      infected: infectedRead.status,
      pending: pendingRead.status,
      scanFailed: failedRead.status,
      revoked: revokedRead.status,
      removedObject: removedRead.status,
    });
  });

  it('AC2 — TTL assinado coerente e objeto acessível apenas com assinatura', async () => {
    process.env.MEDIA_SIGNED_URL_TTL_SECONDS = '2';
    try {
      const resolution = await mediaModule!.resolveDeliverableAsset({ assetId: cleanAssetId, conversationId: convA });
      expect(resolution.ok).toBe(true);
      const signedUrl = resolution.signedUrl as string;
      expect(signedUrl).toContain('X-Amz-Expires=2');

      const read = await readAsset(cleanAssetId, { token: operatorToken });
      expect(read.headers.get('cache-control')).toBe('private, max-age=2');

      // Sem assinatura (URL base do objeto) o storage real nega.
      const bareObject = await fetch(signedUrl.split('?')[0]);
      expect(bareObject.status).toBe(403);

      // Assinatura adulterada: o moto sandbox NÃO valida a assinatura (blind
      // spot registrado); a validação HMAC do S3 real é dívida da prova em
      // MinIO real (BLOCKED, dono plataforma). Registramos o observado sem
      // convertê-lo em PASS de segurança.
      const tampered = signedUrl.replace(/X-Amz-Signature=[0-9a-f]+/, `X-Amz-Signature=${'0'.repeat(64)}`);
      const forged = await fetch(tampered);

      evidence.push({
        case: 'AC2-ttl-assinatura',
        signedExpiresSeconds: 2,
        cacheControl: read.headers.get('cache-control'),
        bareObjectStatus: bareObject.status,
        forgedSignatureStatus: forged.status,
        forgedSignatureEnforcedBySandbox: forged.status === 403,
        note: 'moto 5.2.3 não aplica expiração por relógio nem valida HMAC de URL assinada; S3/MinIO real são a fonte dessas garantias (MinIO BLOCKED).',
      });
    } finally {
      process.env.MEDIA_SIGNED_URL_TTL_SECONDS = String(TTL_SECONDS);
    }
  });

  it('AC3 — ciclo completo upload→CLEAN→envio por asset→entrega e retry idempotente', async () => {
    const uploaded = await upload(PNG_BYTES, { mime: 'image/png', mediaType: 'image', filename: 'ciclo.png' });
    expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(201);
    const assetId = String(uploaded.body.assetId);
    const assetsBefore = await countAssetsForConversation(convA);

    forwarded.length = 0;
    attachmentChecks.length = 0;
    const idempotencyKey = `prod15-send-${randomUUID()}`;
    const sent = await sendMessage(
      { content: 'ciclo completo', mediaAssetId: assetId },
      { idempotencyKey },
    );
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    expect(sent.body.outcome).toBe('accepted');
    expect(sent.body.deduplicated).toBe(false);
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0].attachmentUrl).toContain('X-Amz-Signature');
    expect(attachmentChecks).toHaveLength(1);
    expect(attachmentChecks[0].status).toBe(200);
    expect(attachmentChecks[0].sha256).toBe(sha256(PNG_BYTES));
    expect(forwarded[0].attachmentUrl).not.toContain(`asset://${assetId}`);

    const firstMessageId = String(sent.body.messageId);
    const message = await getMessage(firstMessageId);
    expect(message.media_url).toBe(`asset://${assetId}`);
    expect(message.media_type).toBe('image');
    expect(message.media_mimetype).toBe('image/png');
    expect(message.media_filename).toBe('ciclo.png');

    // Retry da MESMA intenção: nada reenvia e nada duplica.
    const retry = await sendMessage({ content: 'ciclo completo', mediaAssetId: assetId }, { idempotencyKey });
    expect(retry.status).toBe(200);
    expect(retry.body.deduplicated).toBe(true);
    expect(retry.body.messageId).toBe(firstMessageId);
    expect(forwarded).toHaveLength(1);
    expect(await countMessages(convA, 'ciclo completo')).toBe(1);
    expect(await countDeliveriesForMessages(convA)).toBe(1);
    expect(await countAssetsForConversation(convA)).toBe(assetsBefore);

    // DTO sanitizado: referência interna, sem URL assinada.
    const messages = await fetch(`${baseUrl}/conversations/${convA}/messages`, {
      headers: { authorization: `Bearer ${operatorToken}` },
    });
    expect(messages.status).toBe(200);
    const dtoBody = await messages.text();
    expect(dtoBody).not.toContain('X-Amz-Signature');
    expect(dtoBody).not.toContain(s3Endpoint);
    const list = (JSON.parse(dtoBody) as { messages: Array<Record<string, unknown>> }).messages;
    const dto = list.find((entry) => entry.id === firstMessageId);
    expect(dto?.mediaUrl).toBe(`asset://${assetId}`);
    expect(dto?.mediaAssetId).toBe(assetId);
    expect(dto?.mediaMimetype).toBe('image/png');

    evidence.push({
      case: 'AC3-ciclo-completo',
      assetId,
      messageId: firstMessageId,
      uploadStatus: uploaded.status,
      sendStatus: sent.status,
      outcome: sent.body.outcome,
      attachmentFetch: attachmentChecks[0],
      persistedMediaUrl: message.media_url,
      retryStatus: retry.status,
      retryDeduplicated: retry.body.deduplicated,
      gatewayCalls: forwarded.length,
      messages: await countMessages(convA, 'ciclo completo'),
      deliveries: await countDeliveriesForMessages(convA),
      assets: await countAssetsForConversation(convA),
    });
  });

  it('AC3 — INFECTED/PENDING/SCAN_FAILED indisponíveis no envio; URL arbitrária nunca encaminhada', async () => {
    forwarded.length = 0;

    const infected = await upload(EICAR, { mime: 'text/plain', filename: 'send-eicar.txt' });
    const infectedSend = await sendMessage({ content: 'envio infectado', mediaAssetId: String(infected.body.assetId) });
    expect(infectedSend.status).toBe(409);
    expect(infectedSend.body.error).toBe('MEDIA_ASSET_NOT_CLEAN');

    const previousScanner = process.env.MALWARE_SCANNER;
    delete process.env.MALWARE_SCANNER;
    let pending: Awaited<ReturnType<typeof upload>>;
    try {
      pending = await upload(PDF_BYTES, { mime: 'application/pdf', filename: 'send-pending.pdf' });
    } finally {
      process.env.MALWARE_SCANNER = previousScanner ?? 'clamav';
    }
    const pendingSend = await sendMessage({ content: 'envio pendente', mediaAssetId: String(pending!.body.assetId) });
    expect(pendingSend.status).toBe(409);

    const blackhole = await startBlackhole();
    const previousPort = process.env.CLAMAV_PORT;
    const previousTimeout = process.env.MALWARE_SCAN_TIMEOUT_MS;
    process.env.CLAMAV_PORT = String(blackhole.port);
    process.env.MALWARE_SCAN_TIMEOUT_MS = String(BLACKHOLE_MS);
    let failed: Awaited<ReturnType<typeof upload>>;
    try {
      failed = await upload(PDF_BYTES, { mime: 'application/pdf', filename: 'send-failed.pdf' });
    } finally {
      process.env.CLAMAV_PORT = previousPort ?? String(CLAMAV_PORT);
      if (previousTimeout === undefined) delete process.env.MALWARE_SCAN_TIMEOUT_MS;
      else process.env.MALWARE_SCAN_TIMEOUT_MS = previousTimeout;
      await blackhole.close();
    }
    const failedSend = await sendMessage({ content: 'envio falha', mediaAssetId: String(failed!.body.assetId) });
    expect(failedSend.status).toBe(409);

    // URL/data-URL arbitrária nunca é aceita nem encaminhada.
    for (const mediaUrl of [
      'https://example.com/evil.sh',
      'http://169.254.169.254/latest/meta-data/',
      dataUrl('image/png', PNG_BYTES),
    ]) {
      const arbitrary = await sendMessage({ content: 'url arbitraria', mediaUrl, mediaType: 'image', mediaMimetype: 'image/png' });
      expect(arbitrary.status).toBe(400);
      expect(arbitrary.body.error).toBe('MEDIA_ASSET_REQUIRED');
    }

    const conflicting = await sendMessage({
      content: 'asset e url',
      mediaAssetId: cleanAssetId,
      mediaUrl: 'https://example.com/x.png',
    });
    expect(conflicting.status).toBe(400);
    expect(conflicting.body.error).toBe('MEDIA_URL_NOT_ALLOWED');

    const unknown = await sendMessage({ content: 'asset inexistente', mediaAssetId: randomUUID() });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error).toBe('MEDIA_ASSET_NOT_FOUND');

    const wrongConversation = await sendMessage(
      { content: 'asset de outra conversa', mediaAssetId: cleanAssetId },
      { conversationId: convB },
    );
    expect(wrongConversation.status).toBe(403);
    expect(wrongConversation.body.error).toBe('MEDIA_ASSET_FORBIDDEN');

    expect(forwarded).toHaveLength(0);
    for (const content of ['envio infectado', 'envio pendente', 'envio falha', 'url arbitraria', 'asset e url', 'asset inexistente', 'asset de outra conversa']) {
      expect(await countMessages(convA, content)).toBe(0);
      expect(await countMessages(convB, content)).toBe(0);
    }

    evidence.push({
      case: 'AC3-envio-bloqueado',
      infected: infectedSend.status,
      pending: pendingSend.status,
      scanFailed: failedSend.status,
      arbitraryUrl: 400,
      conflicting: conflicting.body.error,
      unknownAsset: unknown.status,
      wrongConversation: wrongConversation.status,
      gatewayCalls: forwarded.length,
    });
  });

  it('AC4 — mídia inbound do PROD-14 entra no fluxo e é entregue por asset no outbound', async () => {
    const suffix = randomUUID().slice(0, 8);
    const messageId = `prod15-inbound-${suffix}`;
    const body = gatewayBody({
      messageId,
      instance: `prod15-${suffix}`,
      remoteJid: `5511999${suffix.replace(/\D/g, '0')}@s.whatsapp.net`,
      text: 'exame inbound',
      type: 'image',
      media: { url: dataUrl('image/png', PNG_BYTES), mimetype: 'image/png', filename: 'inbound.png' },
    });
    const response = await postGatewayInbound(body, `evt-prod15-${suffix}`);
    const responseText = await response.text();
    expect(response.status, responseText).toBe(200);
    const payload = JSON.parse(responseText) as { messageId: string; conversationId: string };
    await pipelineModule!.waitForInboundMediaProcessing(payload.messageId, 30_000);

    const message = await getMessage(payload.messageId);
    expect(message.media_url?.startsWith('asset://')).toBe(true);
    expect(intakeOf(message).state).toBe('CLEAN');
    const inboundAssetId = message.media_url!.slice('asset://'.length);
    const inboundRow = await getAsset(inboundAssetId);
    expect(inboundRow.storage_key?.startsWith(`media/${payload.conversationId}/${payload.messageId}/`)).toBe(true);

    // Leitura autorizada do asset inbound (admin global; conversa criada por webhook).
    const read = await readAsset(inboundAssetId, { conversationId: payload.conversationId, token: adminToken });
    expect(read.status, read.bytes.toString('utf8')).toBe(200);
    expect(Buffer.compare(read.bytes, PNG_BYTES)).toBe(0);

    // Envio outbound referenciando o asset inbound: mesma resolução autorizada.
    forwarded.length = 0;
    attachmentChecks.length = 0;
    const sent = await sendMessage(
      { content: 'resposta com imagem', mediaAssetId: inboundAssetId },
      { conversationId: payload.conversationId, token: adminToken, idempotencyKey: `prod15-inbound-send-${suffix}` },
    );
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    expect(forwarded).toHaveLength(1);
    expect(attachmentChecks[0]?.status).toBe(200);
    expect(attachmentChecks[0]?.sha256).toBe(sha256(PNG_BYTES));

    evidence.push({
      case: 'AC4-inbound-prod14-outbound',
      messageId: payload.messageId,
      conversationId: payload.conversationId,
      inboundAssetId,
      storageKey: inboundRow.storage_key,
      intakeState: intakeOf(message).state,
      readStatus: read.status,
      sendStatus: sent.status,
      attachmentFetch: attachmentChecks[0],
    });
  });

  it('AC4 — legado: dry-run read-only, migração publica CLEAN e entrega; nenhum caminho serve URL crua', async () => {
    const rawMessageId = await insertLegacyMessage({
      conversationId: legacyConv,
      content: 'legado http',
      mediaUrl: 'https://legacy.prod15.invalid/foto.png',
      mediaType: 'image',
      mimetype: 'image/png',
      filename: 'foto.png',
    });
    const cleanMessageId = await insertLegacyMessage({
      conversationId: legacyConv,
      content: 'legado data-url limpa',
      mediaUrl: dataUrl('image/png', PNG_BYTES),
      mediaType: 'image',
      mimetype: 'image/png',
      filename: 'limpa.png',
    });
    const brokenAssetId = randomUUID();
    const brokenMessageId = await insertLegacyMessage({
      conversationId: legacyConv,
      content: 'legado asset quebrado',
      mediaUrl: `asset://${brokenAssetId}`,
      mediaType: 'image',
      mimetype: 'image/png',
      filename: 'quebrado.png',
    });

    const before = await snapshotMessagesAndAssets();
    const dryRun = await mediaModule!.dryRunLegacyMediaMigration({ limit: 500 });
    const after = await snapshotMessagesAndAssets();
    expect(dryRun.readOnly).toBe(true);
    expect(after).toBe(before);
    const scoped = dryRun.items.filter((item) => item.conversationId === legacyConv);
    expect(scoped.map((item) => item.messageId)).toEqual(
      expect.arrayContaining([rawMessageId, cleanMessageId, brokenMessageId]),
    );
    expect(scoped.filter((item) => item.kind === 'raw_http_url').map((item) => item.messageId)).toContain(rawMessageId);

    // Migração real: publica o data-URL CLEAN, bloqueia o resto sem apagar mensagens.
    const first = await legacyModule!.migrateLegacyInboundMedia({ limit: 500, revalidate: false });
    const published = first.published.filter((record) => record.messageId === cleanMessageId);
    expect(published).toHaveLength(1);
    const migratedAssetId = published[0].assetId;
    const migratedRow = await getAsset(migratedAssetId);
    expect(migratedRow.scan_status).toBe('CLEAN');
    expect(migratedRow.storage_status).toBe('STORED');
    expect(migratedRow.storage_key?.startsWith(`media/${legacyConv}/${cleanMessageId}/`)).toBe(true);

    const cleanMessage = await getMessage(cleanMessageId);
    expect(cleanMessage.media_url).toBe(`asset://${migratedAssetId}`);
    expect(cleanMessage.content).toBe('legado data-url limpa');

    const rawMessage = await getMessage(rawMessageId);
    expect(rawMessage.media_url).toBeNull();
    expect(intakeOf(rawMessage).reasonCode).toBe('fetch_failed');
    expect(intakeOf(rawMessage).sourceUrl).toBe('https://legacy.prod15.invalid/foto.png');

    const brokenMessage = await getMessage(brokenMessageId);
    expect(brokenMessage.media_url).toBeNull();
    expect(intakeOf(brokenMessage).reasonCode).toBe('asset_unavailable');
    expect(String(intakeOf(brokenMessage).legacyRef)).toBe(`asset://${brokenAssetId}`);

    // Leitura e entrega outbound do asset migrado.
    const migratedRead = await readAsset(migratedAssetId, { conversationId: legacyConv, token: operatorToken });
    expect(migratedRead.status, migratedRead.bytes.toString('utf8')).toBe(200);
    expect(Buffer.compare(migratedRead.bytes, PNG_BYTES)).toBe(0);

    forwarded.length = 0;
    attachmentChecks.length = 0;
    const sent = await sendMessage(
      { content: 'legado respondido', mediaAssetId: migratedAssetId },
      { conversationId: legacyConv, token: operatorToken, idempotencyKey: `prod15-legacy-send-${randomUUID()}` },
    );
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    expect(attachmentChecks[0]?.status).toBe(200);
    expect(attachmentChecks[0]?.sha256).toBe(sha256(PNG_BYTES));

    // Idempotência da migração: reexecutar não duplica asset nem apaga mensagem.
    const assetsBeforeSecond = JSON.parse(await snapshotMessagesAndAssets()) as { messages: unknown[]; assets: unknown[] };
    const second = await legacyModule!.migrateLegacyInboundMedia({ limit: 500, revalidate: false });
    const assetsAfterSecond = JSON.parse(await snapshotMessagesAndAssets()) as { messages: unknown[]; assets: unknown[] };
    expect(second.published.filter((record) => record.messageId === cleanMessageId)).toHaveLength(0);
    expect(assetsAfterSecond.assets.length).toBe(assetsBeforeSecond.assets.length);
    expect(assetsAfterSecond.messages.length).toBe(assetsBeforeSecond.messages.length);

    // Nenhum caminho HTTP devolve URL crua: DTO e listagem sanitizados.
    const messages = await fetch(`${baseUrl}/conversations/${legacyConv}/messages`, {
      headers: { authorization: `Bearer ${operatorToken}` },
    });
    expect(messages.status).toBe(200);
    const messagesBody = await messages.text();
    expect(messagesBody).not.toContain('legacy.prod15.invalid');
    expect(messagesBody).not.toContain('data:image/png');
    expect(messagesBody).not.toContain('sourceUrl');
    expect(messagesBody).not.toContain(`asset://${brokenAssetId}`);
    const dtos = (JSON.parse(messagesBody) as { messages: Array<Record<string, unknown>> }).messages;
    expect(dtos.find((entry) => entry.id === cleanMessageId)?.mediaUrl).toBe(`asset://${migratedAssetId}`);
    expect(dtos.find((entry) => entry.id === rawMessageId)?.mediaUrl).toBeNull();
    expect(dtos.find((entry) => entry.id === brokenMessageId)?.mediaUrl).toBeNull();

    const conversationList = await fetch(`${baseUrl}/conversations?limit=100`, {
      headers: { authorization: `Bearer ${operatorToken}` },
    });
    expect(conversationList.status).toBe(200);
    const listBody = await conversationList.text();
    expect(listBody).not.toContain('legacy.prod15.invalid');
    expect(listBody).not.toContain('data:image/png');
    expect(listBody).not.toContain('sourceUrl');

    evidence.push({
      case: 'AC4-legado-integracao',
      dryRun: { readOnly: dryRun.readOnly, zeroMutations: after === before, scopedCandidates: scoped.length },
      migration: {
        published: first.published.map((record) => ({ messageId: record.messageId, assetId: record.assetId, storageKey: record.storageKey })),
        blocked: first.blocked.map((record) => ({ messageId: record.messageId, reasonCode: record.reasonCode })),
        pending: first.pending.map((record) => ({ messageId: record.messageId, reasonCode: record.reasonCode })),
        unavailable: first.unavailable.map((record) => ({ messageId: record.messageId, reasonCode: record.reasonCode })),
      },
      readStatus: migratedRead.status,
      sendStatus: sent.status,
      attachmentFetch: attachmentChecks[0],
      idempotent: {
        assetsBefore: assetsBeforeSecond.assets.length,
        assetsAfter: assetsAfterSecond.assets.length,
        messagesBefore: assetsBeforeSecond.messages.length,
        messagesAfter: assetsAfterSecond.messages.length,
      },
      noRawUrlInHttp: true,
    });
  });

  it('AC1/AC4 — configuração implantada mantém 16 MiB úteis consistentes (proxy/API/storage)', () => {
    const nginx = repoFile('apps/desk-web/nginx.conf');
    expect(nginx).toContain('client_max_body_size 17m;');
    expect(nginx).toContain('@api_payload_too_large');
    const compose = repoFile('docker-compose.yml');
    expect(compose).toContain('MEDIA_STORAGE_DRIVER: s3');
    expect(compose).toContain('MEDIA_MAX_BYTES: ${MEDIA_MAX_BYTES:-16777216}');
    expect(compose).toContain('MEDIA_REQUIRE_SCAN: all');
    expect(compose).toContain('MEDIA_PIPELINE_ENABLED: "true"');
    expect(compose).toContain('MALWARE_SCANNER: clamav');
    expect(mediaModule!.getMediaMaxBytes()).toBe(MAX_BYTES);

    evidence.push({
      case: 'AC1-config-limite',
      nginxProxyLimit: '17m',
      apiMaxBytes: mediaModule!.getMediaMaxBytes(),
      composeDefaults: { MEDIA_MAX_BYTES: 16777216, MEDIA_REQUIRE_SCAN: 'all', MEDIA_PIPELINE_ENABLED: 'true' },
    });
  });
});
