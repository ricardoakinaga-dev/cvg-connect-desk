import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import {
  S3Client,
  CreateBucketCommand,
  HeadObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { inArray, sql } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { S3MediaStorage } from '../s3-storage.ts';
import { setMediaStorage, resetMediaStorage, ingestUploadedMedia, resolveDeliverableAsset, assetBindingFromKey } from '../index.ts';

/**
 * AAA-10 — fronteira REAL de mídia (S3 protocol + ClamAV), QA11/C05.
 *
 * Exige `AAA10_REAL_SERVICES=1` e serviços locais dedicados:
 *   - S3-compatible (moto server) em 127.0.0.1:59010;
 *   - clamd real em 127.0.0.1:53110 (INSTREAM);
 *   - PostgreSQL do run a10 em 127.0.0.1:56432.
 * Sem esses serviços o arquivo é skipado explicitamente — nunca "passa" falso.
 */

const REAL = process.env.AAA10_REAL_SERVICES === '1';
const S3_ENDPOINT = process.env.AAA10_S3_ENDPOINT || 'http://127.0.0.1:59010';
const S3_BUCKET = process.env.AAA10_S3_BUCKET || 'cvg-media-a10';
const S3_ACCESS_KEY_ID = process.env.AAA10_S3_ACCESS_KEY_ID || 'aaa10key';
const S3_SECRET_ACCESS_KEY = process.env.AAA10_S3_SECRET_ACCESS_KEY || 'aaa10secret';
const CLAMAV_HOST = process.env.AAA10_CLAMAV_HOST || '127.0.0.1';
const CLAMAV_PORT = Number(process.env.AAA10_CLAMAV_PORT || 53110);
const DATABASE_URL = process.env.DATABASE_URL ?? '';
const DB_MARKER = 'aaa-20260912-a10';

const EICAR = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n%%EOF\n');
const MZ = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(1024, 0x90)]);
const ELF = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(1024, 0)]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function clamdPing(): Promise<boolean> {
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

const suite = REAL ? describe : describe.skip;

suite('AAA-10 — mídia real: S3 privado + ClamAV real + quarentena', () => {
  let client: S3Client;
  let storage: S3MediaStorage;
  const conversationId = randomUUID();
  const actorId = randomUUID();
  const createdAssetIds: string[] = [];
  const envSnapshot = new Map<string, string | undefined>();

  beforeAll(async () => {
    for (const key of ['MALWARE_SCANNER', 'CLAMAV_HOST', 'CLAMAV_PORT', 'MALWARE_SCAN_TIMEOUT_MS', 'MEDIA_STORAGE_DRIVER', 'MEDIA_MAX_BYTES']) {
      envSnapshot.set(key, process.env[key]);
    }

    if (!DATABASE_URL.includes('127.0.0.1:56432') || !/\/cvg_aaa_aaa_20260912_a10(\?|$)/.test(DATABASE_URL)) {
      throw new Error(`AAA-10 mídia exige DATABASE_URL do run a10 em 127.0.0.1:56432; recebido: ${DATABASE_URL}`);
    }
    const marker = await db.execute(sql`SELECT run_id FROM aaa_environment_marker WHERE run_id = ${DB_MARKER}`);
    const rows = (marker as unknown as { rows: Array<{ run_id: string }> }).rows ?? [];
    if (rows.length === 0) throw new Error(`Marcador ${DB_MARKER} ausente no banco a10.`);

    const pinged = await clamdPing();
    if (!pinged) {
      throw new Error(`clamd real não respondeu zPING em ${CLAMAV_HOST}:${CLAMAV_PORT}; ver evidência do run.`);
    }

    client = new S3Client({
      endpoint: S3_ENDPOINT,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
    });
    await client.send(new CreateBucketCommand({ Bucket: S3_BUCKET })).catch((error: { name?: string }) => {
      if (error.name !== 'BucketAlreadyOwnedByYou' && error.name !== 'BucketAlreadyExists') throw error;
    });
    storage = new S3MediaStorage({
      endpoint: S3_ENDPOINT,
      region: 'us-east-1',
      bucket: S3_BUCKET,
      accessKeyId: S3_ACCESS_KEY_ID,
      secretAccessKey: S3_SECRET_ACCESS_KEY,
      forcePathStyle: true,
      client,
    });

    process.env.MEDIA_STORAGE_DRIVER = 's3';
    process.env.MALWARE_SCANNER = 'clamav';
    process.env.CLAMAV_HOST = CLAMAV_HOST;
    process.env.CLAMAV_PORT = String(CLAMAV_PORT);
    resetMediaStorage();
    setMediaStorage(storage);
  });

  afterAll(async () => {
    if (createdAssetIds.length > 0) {
      await db.delete(schema.mediaAssets).where(inArray(schema.mediaAssets.id, createdAssetIds));
    }
    for (const prefix of [`media/${conversationId}/`, `quarantine/${conversationId}/`]) {
      const listed = await client.send(new ListObjectsV2Command({ Bucket: S3_BUCKET, Prefix: prefix }));
      const keys = (listed.Contents ?? []).map((entry) => ({ Key: entry.Key as string }));
      if (keys.length > 0) {
        await client.send(new DeleteObjectsCommand({ Bucket: S3_BUCKET, Delete: { Objects: keys } }));
      }
    }
    for (const [key, value] of envSnapshot) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetMediaStorage();
    client.destroy();
  });

  function track(assetId: string): void {
    if (assetId) createdAssetIds.push(assetId);
  }

  it('objeto é PRIVADO: GET anônimo 403; URL assinada entrega os bytes', async () => {
    const key = `media/${conversationId}/${actorId}/privado.txt`;
    await storage.put({ key, body: Buffer.from('privado'), contentType: 'text/plain' });
    expect(await storage.exists(key)).toBe(true);

    const anonymous = await fetch(`${S3_ENDPOINT}/${S3_BUCKET}/${key}`);
    expect(anonymous.status).toBe(403);

    const signed = await storage.createSignedReadUrl(key, 60);
    expect(signed).toContain('X-Amz-Signature');
    const authorized = await fetch(signed);
    expect(authorized.status).toBe(200);
    expect(await authorized.text()).toBe('privado');

    await storage.delete(key);
  });

  it('CLEAN real (ClamAV) grava sob media/ e assina URL de leitura', async () => {
    const result = await ingestUploadedMedia({
      conversationId, actorId, mediaType: 'document', mimetype: 'application/pdf', filename: 'ok.pdf', bytes: PDF,
    });
    track(result.assetId);
    expect(result.blocked).toBe(false);
    expect(result.scanStatus).toBe('CLEAN');
    expect(result.storageStatus).toBe('STORED');
    expect(result.storageKey?.startsWith(`media/${conversationId}/${actorId}/`)).toBe(true);
    expect(assetBindingFromKey(result.storageKey)).toEqual({ conversationId, actorId });

    const signed = await storage.createSignedReadUrl(result.storageKey as string, 60);
    const fetched = await fetch(signed);
    expect(fetched.status).toBe(200);
    expect(Buffer.from(await fetched.arrayBuffer()).equals(PDF)).toBe(true);
  });

  it('EICAR real → INFECTED, bytes preservados em quarantine/ e nunca entregáveis', async () => {
    const result = await ingestUploadedMedia({
      conversationId, actorId, mediaType: 'document', mimetype: 'text/plain', filename: 'eicar.txt', bytes: EICAR,
    });
    track(result.assetId);
    expect(result.blocked).toBe(true);
    expect(result.scanStatus).toBe('INFECTED');
    expect(result.storageStatus).toBe('QUARANTINED');
    expect(result.storageKey?.startsWith(`quarantine/${conversationId}/${actorId}/`)).toBe(true);

    const head = await client.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: result.storageKey as string }));
    expect(head.ContentLength).toBe(EICAR.length);

    const publicKey = (result.storageKey as string).replace(/^quarantine\//, 'media/');
    expect(await storage.exists(publicKey)).toBe(false);

    const delivery = await resolveDeliverableAsset({ assetId: result.assetId, conversationId });
    expect(delivery.ok).toBe(false);
    if (!delivery.ok) expect(delivery.reason).toBe('asset_not_clean');
  });

  it('MIME/executável: MZ, ELF e PNG-declarado-PDF são bloqueados sem gravar asset', async () => {
    for (const [bytes, mime, expected] of [
      [MZ, 'application/pdf', 'executable_content'],
      [ELF, 'application/pdf', 'executable_content'],
      [PNG_MAGIC, 'application/pdf', 'mime_magic_mismatch'],
    ] as Array<[Buffer, string, string]>) {
      const result = await ingestUploadedMedia({
        conversationId, actorId, mediaType: 'document', mimetype: mime, filename: 'spoof.pdf', bytes,
      });
      expect(result.blocked).toBe(true);
      expect(result.reasonCode).toBe(expected);
      expect(result.assetId).toBe('');
    }
  });

  it('timeout de scanner → SCAN_FAILED em quarentena (bytes preservados, sem entrega)', async () => {
    const blackhole = await startBlackhole();
    process.env.CLAMAV_PORT = String(blackhole.port);
    process.env.MALWARE_SCAN_TIMEOUT_MS = '700';
    try {
      const result = await ingestUploadedMedia({
        conversationId, actorId, mediaType: 'document', mimetype: 'application/pdf', filename: 'timeout.pdf', bytes: PDF,
      });
      track(result.assetId);
      expect(result.blocked).toBe(true);
      expect(result.reasonCode).toBe('scanner_failed');
      expect(result.scanStatus).toBe('SCAN_FAILED');
      expect(result.storageStatus).toBe('QUARANTINED');
      const head = await client.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: result.storageKey as string }));
      expect(head.ContentLength).toBe(PDF.length);
      const delivery = await resolveDeliverableAsset({ assetId: result.assetId, conversationId });
      expect(delivery.ok).toBe(false);
    } finally {
      process.env.CLAMAV_PORT = String(CLAMAV_PORT);
      delete process.env.MALWARE_SCAN_TIMEOUT_MS;
      await blackhole.close();
    }
  });

  it('scanner ausente → PENDING_SCAN em quarentena (fail-closed)', async () => {
    delete process.env.MALWARE_SCANNER;
    try {
      const result = await ingestUploadedMedia({
        conversationId, actorId, mediaType: 'document', mimetype: 'application/pdf', filename: 'noscanner.pdf', bytes: PDF,
      });
      track(result.assetId);
      expect(result.blocked).toBe(true);
      expect(result.reasonCode).toBe('scanner_unavailable');
      expect(result.scanStatus).toBe('PENDING_SCAN');
      expect(result.storageStatus).toBe('QUARANTINED');
      const head = await client.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: result.storageKey as string }));
      expect(head.ContentLength).toBe(PDF.length);
    } finally {
      process.env.MALWARE_SCANNER = 'clamav';
    }
  });

  it('excesso de tamanho é bloqueado no pipeline (16 MiB reais)', async () => {
    const result = await ingestUploadedMedia({
      conversationId, actorId, mediaType: 'document', mimetype: 'text/plain', filename: 'big.txt',
      bytes: Buffer.alloc(16 * 1024 * 1024 + 1, 0x41),
    });
    expect(result.blocked).toBe(true);
    expect(result.reasonCode).toBe('media_too_large');
    expect(result.assetId).toBe('');
  });

  it('asset de outra conversa não é entregável', async () => {
    const result = await ingestUploadedMedia({
      conversationId, actorId, mediaType: 'document', mimetype: 'application/pdf', filename: 'ok2.pdf', bytes: PDF,
    });
    track(result.assetId);
    const delivery = await resolveDeliverableAsset({ assetId: result.assetId, conversationId: randomUUID() });
    expect(delivery.ok).toBe(false);
    if (!delivery.ok) expect(delivery.reason).toBe('wrong_conversation');
  });
});
