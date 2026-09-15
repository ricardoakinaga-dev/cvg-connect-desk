import './integration-mocks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import net from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { assertSafeMediaUrl, safeRemoteFetch, mediaKindForMime, validateMediaBytes } from '@cvg/shared';
import { setGatewayOutboundPort, type ChatGatewayOutboundPort } from '@cvg/chat';
import { buildDeskApiApp } from '../app.ts';

/**
 * AAA-10 — contrato e segurança de anexos (C05; achado A09; QA04/QA11).
 *
 * Fronteiras REAIS, sem mocks do que é julgado:
 *   - transporte HTTP real (app.listen + fetch) na fronteira de 16 MiB;
 *   - S3-compatible REAL (moto server) em 127.0.0.1:59010 — bucket privado,
 *     URL assinada vs GET anônimo;
 *   - ClamAV REAL (clamd INSTREAM) em 127.0.0.1:53110 — clean e EICAR;
 *   - PostgreSQL real do run a10 (marcador obrigatório; sem fallback 5432).
 * O provider outbound é um dublê de gravação: o que se julga é o gating e a
 * referência entregue, não o provider WhatsApp.
 */

const DATABASE_URL = process.env.DATABASE_URL ?? '';
const DB_MARKER = 'aaa-20260912-a10';
const S3_ENDPOINT = 'http://127.0.0.1:59010';
const S3_BUCKET = 'cvg-media-a10';
const CLAMAV_HOST = '127.0.0.1';
const CLAMAV_PORT = 53110;
const MAX_BYTES = 16 * 1024 * 1024;

const EICAR = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n%%EOF\n');
const MZ = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(1024, 0x90)]);
const ELF = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(1024, 0)]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const ENV_KEYS = [
  'MEDIA_STORAGE_DRIVER', 'S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY',
  'S3_FORCE_PATH_STYLE', 'MALWARE_SCANNER', 'CLAMAV_HOST', 'CLAMAV_PORT', 'MEDIA_REQUIRE_SCAN',
  'MEDIA_MAX_BYTES', 'MALWARE_SCAN_TIMEOUT_MS',
] as const;

function clamdReachable(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(CLAMAV_PORT, CLAMAV_HOST);
    let reply = '';
    const timer = setTimeout(() => { socket.destroy(); resolve(false); }, 3000);
    socket.on('connect', () => socket.write('zPING\0'));
    socket.on('data', (chunk) => { reply += chunk.toString(); });
    socket.on('end', () => { clearTimeout(timer); resolve(reply.includes('PONG')); });
    socket.on('error', () => { clearTimeout(timer); resolve(false); });
  });
}

async function startBlackhole(): Promise<{ port: number; close: () => Promise<void> }> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    close: () => new Promise<void>((done) => {
      for (const socket of sockets) socket.destroy();
      server.close(() => done());
    }),
  };
}

describe('AAA-10 — anexos: transporte, limites e entrega C05 (S3 + ClamAV reais)', () => {
  let app: Awaited<ReturnType<typeof buildDeskApiApp>>;
  let baseUrl = '';
  let token = '';
  const conversationId = randomUUID();
  const otherConversationId = randomUUID();
  let sectorId = '';
  let userId = '';
  const forwarded: Array<Record<string, unknown>> = [];
  const createdAssetIds: string[] = [];
  const envSnapshot = new Map<string, string | undefined>();
  const servers: Array<{ close: () => Promise<void> }> = [];
  let suiteReady = false;

  const authHeaders = (mime: string, mediaType: string, filename: string) => ({
    authorization: `Bearer ${token}`,
    'content-type': 'application/octet-stream',
    'x-media-type': mediaType,
    'x-media-mimetype': mime,
    'x-media-filename': filename,
  });

  async function upload(
    bytes: Buffer,
    { mime = 'application/pdf', mediaType = 'document', filename = 'doc.pdf' } = {},
    targetConversation = conversationId,
  ) {
    const response = await fetch(`${baseUrl}/conversations/${targetConversation}/media`, {
      method: 'POST',
      headers: authHeaders(mime, mediaType, filename),
      body: bytes,
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  async function sendMessage(payload: Record<string, unknown>) {
    const response = await fetch(`${baseUrl}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId, recipient: '+5511999999000', ...payload }),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  beforeAll(async () => {
    for (const key of ENV_KEYS) envSnapshot.set(key, process.env[key]);

    if (!DATABASE_URL.includes('127.0.0.1:56432') || !/\/cvg_aaa_aaa_20260912_a10(\?|$)/.test(DATABASE_URL)) {
      throw new Error(`AAA-10 exige DATABASE_URL do run a10 em 127.0.0.1:56432; recebido: ${DATABASE_URL}`);
    }
    const markerResult = await db.execute(sql`SELECT run_id FROM aaa_environment_marker WHERE run_id = ${DB_MARKER}`);
    const markerRows = (markerResult as unknown as { rows: Array<{ run_id: string }> }).rows ?? [];
    if (markerRows.length === 0) throw new Error(`Marcador ${DB_MARKER} ausente no banco a10.`);

    // S3-compatible real (moto) no porto dedicado; sem fallback silencioso.
    const s3Up = await fetch(`${S3_ENDPOINT}/`).then((r) => r.ok || r.status === 403).catch(() => false);
    if (!s3Up) throw new Error(`S3-compatible real ausente em ${S3_ENDPOINT} (porta dedicada AAA-10).`);
    await fetch(`${S3_ENDPOINT}/${S3_BUCKET}`, { method: 'PUT' }).catch(() => undefined);

    if (!(await clamdReachable())) {
      throw new Error(`clamd real ausente em ${CLAMAV_HOST}:${CLAMAV_PORT}; serviço dedicado AAA-10 obrigatório.`);
    }

    // Política C05 habilitada no runtime sob teste (equivale ao Compose).
    process.env.MEDIA_STORAGE_DRIVER = 's3';
    process.env.S3_ENDPOINT = S3_ENDPOINT;
    process.env.S3_BUCKET = S3_BUCKET;
    process.env.S3_ACCESS_KEY_ID = 'aaa10key';
    process.env.S3_SECRET_ACCESS_KEY = 'aaa10secret';
    process.env.S3_FORCE_PATH_STYLE = 'true';
    process.env.MALWARE_SCANNER = 'clamav';
    process.env.CLAMAV_HOST = CLAMAV_HOST;
    process.env.CLAMAV_PORT = String(CLAMAV_PORT);
    process.env.MEDIA_REQUIRE_SCAN = 'all';
    process.env.MEDIA_MAX_BYTES = String(MAX_BYTES);

    const password = 'ChatRoutePass!42';
    const passwordHash = '$2a$10$UX/LcD/6NKhheDIZmbHyN.a6Hc8SW6ytZ/LCCZW3un3h5vJ9n/1h6';
    const email = `aaa10.integration.${Date.now()}@example.com`;
    userId = randomUUID();
    sectorId = randomUUID();

    const [role] = await db.select().from(schema.roles).where(eq(schema.roles.name, 'Receptionist'));
    await db.insert(schema.users).values({ id: userId, name: 'AAA10 Integration', email, passwordHash, isActive: true } as never);
    await db.insert(schema.userRoles).values({ userId, roleId: role.id } as never);
    const suffix = String(Date.now()).slice(-6);
    await db.insert(schema.sectors).values({ id: sectorId, name: `aaa10-integration ${suffix}`, code: `a10i${suffix}` } as never);
    await db.insert(schema.userSectors).values({ userId, sectorId, accessLevel: 'write' } as never);
    await db.insert(schema.conversations).values({ id: conversationId, status: 'open', statusV2: 'novo', currentHandler: 'bot', isActive: true, sectorId } as never);
    await db.insert(schema.conversations).values({ id: otherConversationId, status: 'open', statusV2: 'novo', currentHandler: 'bot', isActive: true, sectorId } as never);

    app = await buildDeskApiApp();
    await app.ready();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address() as net.AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;

    const gatewayStub: ChatGatewayOutboundPort = {
      providerSupportsIdempotency: () => true,
      async sendOutbound(params) {
        forwarded.push(params as unknown as Record<string, unknown>);
        return { success: true, messageId: `recorded-${forwarded.length}` };
      },
    };
    setGatewayOutboundPort(gatewayStub);

    const login = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    expect(login.status).toBe(200);
    token = ((await login.json()) as { token: string }).token;
    suiteReady = true;
  });

  afterAll(async () => {
    for (const server of servers) await server.close();
    if (suiteReady) {
      const messages = await db.select({ id: schema.messages.id }).from(schema.messages).where(inArray(schema.messages.conversationId, [conversationId, otherConversationId]));
      if (messages.length > 0) {
        await db.delete(schema.outboundDeliveries).where(inArray(schema.outboundDeliveries.internalMessageId, messages.map((m) => m.id)));
      }
      await db.delete(schema.messages).where(inArray(schema.messages.conversationId, [conversationId, otherConversationId]));
      await db.delete(schema.conversationStatusHistory).where(inArray(schema.conversationStatusHistory.conversationId, [conversationId, otherConversationId]));
      await db.delete(schema.conversations).where(inArray(schema.conversations.id, [conversationId, otherConversationId]));
    }
    if (createdAssetIds.length > 0) {
      await db.delete(schema.mediaAssets).where(inArray(schema.mediaAssets.id, createdAssetIds)).catch(() => undefined);
    }
    if (userId) {
      await db.delete(schema.auditLogs).where(eq(schema.auditLogs.userId, userId));
      await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
      await db.delete(schema.userRoles).where(eq(schema.userRoles.userId, userId));
      await db.delete(schema.userSectors).where(eq(schema.userSectors.userId, userId));
      await db.delete(schema.users).where(eq(schema.users.id, userId));
    }
    if (sectorId) await db.delete(schema.sectors).where(eq(schema.sectors.id, sectorId));
    for (const [key, value] of envSnapshot) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (suiteReady) await app.close();
  });

  function trackAsset(body: Record<string, unknown>): string {
    const assetId = typeof body.assetId === 'string' ? body.assetId : '';
    if (assetId) createdAssetIds.push(assetId);
    return assetId;
  }

  function repoFile(relativeFromRepoRoot: string): string {
    const candidates = [
      resolve(process.cwd(), '..', '..', relativeFromRepoRoot),
      resolve(process.cwd(), relativeFromRepoRoot),
    ];
    const found = candidates.find((candidate) => existsSync(candidate));
    if (!found) throw new Error(`Arquivo não encontrado para verificação de configuração: ${relativeFromRepoRoot}`);
    return readFileSync(found, 'utf8');
  }

  it('configuração implantada habilita a política C05 (nginx + Compose)', () => {
    const nginx = repoFile('apps/desk-web/nginx.conf');
    expect(nginx).toContain('client_max_body_size 17m;');
    expect(nginx).toContain('@api_payload_too_large');

    const compose = repoFile('docker-compose.yml');
    expect(compose).toContain('MEDIA_STORAGE_DRIVER: s3');
    expect(compose).toContain('MEDIA_REQUIRE_SCAN: all');
    expect(compose).toContain('MEDIA_PIPELINE_ENABLED: "true"');
    expect(compose).toContain('MALWARE_SCANNER: clamav');
    expect(compose).toContain('image: clamav/clamav');
  });

  it('16 MiB exatos passam; 16 MiB + 1 → 413 com contrato recuperável', async () => {
    const ok = await upload(Buffer.alloc(MAX_BYTES, 0x41), { mime: 'text/plain', filename: 'limite.txt' });
    expect(ok.status).toBe(201);
    expect(ok.body.scanStatus).toBe('CLEAN');
    expect(ok.body.storageStatus).toBe('STORED');
    expect(ok.body.sizeBytes).toBe(MAX_BYTES);
    trackAsset(ok.body);

    const over = await upload(Buffer.alloc(MAX_BYTES + 1, 0x41), { mime: 'text/plain', filename: 'excesso.txt' });
    expect(over.status).toBe(413);
    expect(over.body.error).toBe('PAYLOAD_TOO_LARGE');
    expect(over.body.recoverable).toBe(true);
    expect(over.body.maxBytes).toBe(MAX_BYTES);
  }, 90000);

  it('magic bytes: MZ/ELF/PNG-declarado-PDF rejeitados (415); PDF real aceito', async () => {
    for (const bytes of [MZ, ELF, PNG_MAGIC]) {
      const spoof = await upload(bytes, { mime: 'application/pdf', filename: 'falso.pdf' });
      expect(spoof.status).toBe(415);
      expect(['MEDIA_EXECUTABLE_CONTENT', 'MEDIA_MIME_MISMATCH']).toContain(spoof.body.error);
      expect(spoof.body.assetId).toBeUndefined();
    }
    const plainAsPdf = await upload(Buffer.from('apenas texto'), { mime: 'application/pdf', filename: 'texto.pdf' });
    expect(plainAsPdf.status).toBe(415);
    expect(plainAsPdf.body.error).toBe('MEDIA_MIME_MISMATCH');

    const real = await upload(PDF);
    expect(real.status).toBe(201);
    expect(real.body.scanStatus).toBe('CLEAN');
    trackAsset(real.body);

    expect(validateMediaBytes('application/pdf', MZ).ok).toBe(false);
    expect(validateMediaBytes('application/pdf', PDF).ok).toBe(true);
    expect(mediaKindForMime('application/pdf')).toBe('document');
  });

  it('SSRF/destino: URL arbitrária não é aceita nem encaminhada', async () => {
    // Guard de política (URL/destino/credenciais/esquema):
    for (const unsafe of [
      'http://169.254.169.254/latest/meta-data/',
      'http://127.0.0.1:59010/cvg-media-a10/x',
      'http://localhost/x',
      'file:///etc/passwd',
      'http://user:pass@example.com/x',
    ]) {
      expect(assertSafeMediaUrl(unsafe).ok, unsafe).toBe(false);
    }

    // Redirecionamento local também é recusado antes de qualquer conexão.
    const redirectServer = await new Promise<{ port: number; close: () => Promise<void> }>((resolve) => {
      const server = net.createServer((socket) => {
        socket.on('data', () => {
          socket.write('HTTP/1.1 302 Found\r\nLocation: http://169.254.169.254/latest/meta-data/\r\nContent-Length: 0\r\n\r\n');
          socket.end();
        });
      });
      server.listen(0, '127.0.0.1', () => {
        const port = (server.address() as net.AddressInfo).port;
        resolve({ port, close: () => new Promise<void>((done) => server.close(() => done())) });
      });
    });
    servers.push(redirectServer);
    await expect(safeRemoteFetch(`http://127.0.0.1:${redirectServer.port}/r`, 1024, { maxRedirects: 1 })).rejects.toThrow();

    forwarded.length = 0;
    for (const mediaUrl of [
      'https://example.com/evil.sh',
      'http://169.254.169.254/latest/meta-data/',
      `http://127.0.0.1:${redirectServer.port}/r`,
      `data:application/pdf;base64,${PDF.toString('base64')}`,
    ]) {
      const response = await sendMessage({ content: 'ssrf', mediaUrl, mediaType: 'document', mediaMimetype: 'application/pdf' });
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('MEDIA_ASSET_REQUIRED');
    }
    expect(forwarded).toHaveLength(0);
  });

  it('EICAR real → 422, quarentena privada e nunca entregue', async () => {
    const infected = await upload(EICAR, { mime: 'text/plain', filename: 'eicar.txt' });
    expect(infected.status).toBe(422);
    expect(infected.body.error).toBe('MEDIA_INFECTED');
    expect(infected.body.scanStatus).toBe('INFECTED');
    expect(infected.body.storageStatus).toBe('QUARANTINED');
    const assetId = trackAsset(infected.body);
    expect(assetId).toBeTruthy();

    const [row] = await db.select().from(schema.mediaAssets).where(eq(schema.mediaAssets.id, assetId));
    expect(row.scanStatus).toBe('INFECTED');
    expect(row.storageStatus).toBe('QUARANTINED');
    expect(row.storageKey?.startsWith('quarantine/')).toBe(true);
    expect(row.sha256).toBe(createHash('sha256').update(EICAR).digest('hex'));

    forwarded.length = 0;
    const delivery = await sendMessage({ content: 'infectado', mediaAssetId: assetId });
    expect(delivery.status).toBe(409);
    expect(delivery.body.error).toBe('MEDIA_ASSET_NOT_CLEAN');
    expect(forwarded).toHaveLength(0);

    const outbound = await db.select().from(schema.messages).where(and(eq(schema.messages.conversationId, conversationId), eq(schema.messages.direction, 'outbound')));
    expect(outbound.filter((message) => message.content === 'infectado')).toHaveLength(0);
  });

  it('scanner timeout → 503 fail-closed, quarentena preservada e sem entrega', async () => {
    const blackhole = await startBlackhole();
    servers.push(blackhole);
    process.env.CLAMAV_PORT = String(blackhole.port);
    process.env.MALWARE_SCAN_TIMEOUT_MS = '700';
    try {
      const response = await upload(PDF, { mime: 'application/pdf', filename: 'timeout.pdf' });
      expect(response.status).toBe(503);
      expect(response.body.error).toBe('SCANNER_UNAVAILABLE');
      expect(response.body.retryable).toBe(true);
      expect(response.body.scanStatus).toBe('SCAN_FAILED');
      expect(response.body.storageStatus).toBe('QUARANTINED');
      const assetId = trackAsset(response.body);

      forwarded.length = 0;
      const delivery = await sendMessage({ content: 'timeout', mediaAssetId: assetId });
      expect(delivery.status).toBe(409);
      expect(forwarded).toHaveLength(0);
    } finally {
      process.env.CLAMAV_PORT = String(CLAMAV_PORT);
      delete process.env.MALWARE_SCAN_TIMEOUT_MS;
    }
  }, 30000);

  it('scanner ausente → 503 fail-closed com PENDING_SCAN em quarentena', async () => {
    delete process.env.MALWARE_SCANNER;
    try {
      const response = await upload(PDF, { mime: 'application/pdf', filename: 'sem-scanner.pdf' });
      expect(response.status).toBe(503);
      expect(response.body.error).toBe('SCANNER_UNAVAILABLE');
      expect(response.body.scanStatus).toBe('PENDING_SCAN');
      expect(response.body.storageStatus).toBe('QUARANTINED');
      const assetId = trackAsset(response.body);

      forwarded.length = 0;
      const delivery = await sendMessage({ content: 'pendente', mediaAssetId: assetId });
      expect(delivery.status).toBe(409);
      expect(forwarded).toHaveLength(0);
    } finally {
      process.env.MALWARE_SCANNER = 'clamav';
    }
  });

  it('entrega: asset CLEAN autorizado, URL assinada privada e gating de referência', async () => {
    const clean = await upload(PDF, { mime: 'application/pdf', filename: 'ok.pdf' });
    expect(clean.status).toBe(201);
    const assetId = trackAsset(clean.body);
    expect(assetId).toBeTruthy();

    forwarded.length = 0;
    const sent = await sendMessage({ content: 'anexo ok', mediaAssetId: assetId });
    expect(sent.status).toBe(201);
    expect(sent.body.outcome).toBe('accepted');
    expect(forwarded).toHaveLength(1);
    const attachmentUrl = String(forwarded[0].attachmentUrl ?? '');
    expect(attachmentUrl).toContain(S3_ENDPOINT);
    expect(attachmentUrl).toContain('X-Amz-Signature');

    const signed = await fetch(attachmentUrl);
    expect(signed.status).toBe(200);
    expect(Buffer.from(await signed.arrayBuffer()).equals(PDF)).toBe(true);

    const anonymous = await fetch(attachmentUrl.split('?')[0]);
    expect(anonymous.status).toBe(403);

    const [message] = await db.select().from(schema.messages).where(and(eq(schema.messages.conversationId, conversationId), eq(schema.messages.content, 'anexo ok')));
    expect(message.mediaUrl).toBe(`asset://${assetId}`);
    expect(message.mediaMimetype).toBe('application/pdf');

    const wrongConversation = await sendMessage({ content: 'conversa errada', mediaAssetId: assetId, conversationId: otherConversationId, recipient: '+5511999999000' });
    expect(wrongConversation.status).toBe(403);
    expect(wrongConversation.body.error).toBe('MEDIA_ASSET_FORBIDDEN');

    const unknown = await sendMessage({ content: 'inexistente', mediaAssetId: randomUUID() });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error).toBe('MEDIA_ASSET_NOT_FOUND');

    const conflicting = await sendMessage({ content: 'duplo', mediaAssetId: assetId, mediaUrl: 'https://example.com/x.pdf' });
    expect(conflicting.status).toBe(400);
    expect(conflicting.body.error).toBe('MEDIA_URL_NOT_ALLOWED');
  }, 60000);
});
