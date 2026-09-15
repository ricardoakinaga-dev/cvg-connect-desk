import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  MemoryMediaStorage,
  ClamAVScanner,
  processInboundMedia,
  promoteQuarantinedAsset,
  mediaAssetRepository,
  setMediaStorage,
  resetMediaStorage,
  quarantineKey,
  mediaKey,
  isQuarantined,
} from '../index';

describe('media storage + quarantine pipeline', () => {
  const createdAssetIds: string[] = [];

  beforeEach(() => {
    resetMediaStorage();
    delete process.env.MEDIA_STORAGE_DRIVER;
    delete process.env.MALWARE_SCANNER;
    delete process.env.MEDIA_REQUIRE_SCAN;
    delete process.env.MEDIA_FETCH_REMOTE;
    setMediaStorage(new MemoryMediaStorage());
  });

  afterEach(async () => {
    if (createdAssetIds.length > 0) {
      const { db, schema } = await import('@cvg/database');
      const { inArray } = await import('drizzle-orm');
      await db.delete(schema.mediaAssets).where(inArray(schema.mediaAssets.id, createdAssetIds.splice(0)));
    }
  });

  function track(result: { assetId?: string }): void {
    if (result.assetId) createdAssetIds.push(result.assetId);
  }

  it('memory driver round-trips objects', async () => {
    const storage = new MemoryMediaStorage();
    await storage.put({ key: 'media/a', body: Buffer.from('hello'), contentType: 'text/plain' });
    expect(await storage.exists('media/a')).toBe(true);
    expect((await storage.get('media/a')).toString()).toBe('hello');
    expect(await storage.createSignedReadUrl('media/a')).toContain('media/a');
    await storage.delete('media/a');
    expect(await storage.exists('media/a')).toBe(false);
  });

  it('memory driver refuses production silently', () => {
    process.env.NODE_ENV = 'production';
    try {
      expect(() => new MemoryMediaStorage()).toThrow(/produção/);
    } finally {
      process.env.NODE_ENV = 'test';
    }
  });

  it('key helpers separate quarantine from public prefix', () => {
    expect(quarantineKey('abc')).toBe('quarantine/abc');
    expect(mediaKey('quarantine/abc')).toBe('media/abc');
    expect(isQuarantined('quarantine/abc')).toBe(true);
    expect(isQuarantined('media/abc')).toBe(false);
  });

  it('clean bytes with fake scanner → STORED under media/', async () => {
    process.env.MALWARE_SCANNER = 'fake';
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('fake-jpeg-bytes')]);
    const result = await processInboundMedia({
      mediaType: 'image',
      mimetype: 'image/jpeg',
      filename: 'foto.jpg',
      bytes: jpeg,
    });
    track(result);
    expect(result.storageStatus).toBe('STORED');
    expect(result.scanStatus).toBe('CLEAN');
    expect(result.storageKey?.startsWith('media/')).toBe(true);
    expect(result.sha256).toHaveLength(64);
  });

  it('infected bytes → QUARANTINED, never public', async () => {
    process.env.MALWARE_SCANNER = 'fake';
    const eicar = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
    const result = await processInboundMedia({
      mediaType: 'document',
      mimetype: 'text/plain',
      filename: 'evil.txt',
      bytes: Buffer.from(eicar),
    });
    track(result);
    expect(result.storageStatus).toBe('QUARANTINED');
    expect(result.scanStatus).toBe('INFECTED');
    expect(result.blocked).toBe(true);
    expect(result.storageKey?.startsWith('quarantine/')).toBe(true);
  });

  it('documents without scanner are blocked fail-secure', async () => {
    delete process.env.MALWARE_SCANNER;
    const result = await processInboundMedia({
      mediaType: 'document',
      mimetype: 'application/pdf',
      bytes: Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n'),
    });
    track(result);
    expect(result.blocked).toBe(true);
    expect(result.storageStatus).toBe('QUARANTINED');
    expect(result.reasonCode).toBe('scanner_unavailable');
  });

  it('oversized and disallowed media blocked', async () => {
    const big = await processInboundMedia({
      mediaType: 'image',
      mimetype: 'image/jpeg',
      sizeBytes: 1_000_000_000,
      bytes: Buffer.from('x'),
    });
    expect(big.blocked).toBe(true);

    const badMime = await processInboundMedia({
      mediaType: 'image',
      mimetype: 'application/x-sh',
      bytes: Buffer.from('x'),
    });
    expect(badMime.blocked).toBe(true);
  });

  it('remote URL without fetch → EXTERNAL metadata, never public', async () => {
    const result = await processInboundMedia({
      mediaType: 'image',
      mimetype: 'image/jpeg',
      url: 'https://example.com/foto.jpg',
    });
    track(result);
    expect(result.storageStatus).toBe('EXTERNAL');
    expect(result.scanStatus).toBe('PENDING_SCAN');
    expect(result.storageKey).toBeUndefined();
  });

  it('promote moves quarantine/ → media/ after CLEAN', async () => {
    const storage = new MemoryMediaStorage();
    setMediaStorage(storage);
    await storage.put({ key: 'quarantine/abc', body: Buffer.from('data'), contentType: 'image/jpeg' });
    const asset = await mediaAssetRepository.create({
      storageDriver: 'memory',
      storageKey: 'quarantine/abc',
      scanStatus: 'CLEAN',
      storageStatus: 'QUARANTINED',
      mimeType: 'image/jpeg',
    });
    try {
      const target = await promoteQuarantinedAsset(asset.id);
      expect(target).toBe('media/abc');
      expect(await storage.exists('media/abc')).toBe(true);
      expect(await storage.exists('quarantine/abc')).toBe(false);
    } finally {
      await storage.delete('media/abc').catch(() => {});
      const { db, schema } = await import('@cvg/database');
      const { eq } = await import('drizzle-orm');
      await db.delete(schema.mediaAssets).where(eq(schema.mediaAssets.id, asset.id));
    }
  });
});

describe('ClamAVScanner client', () => {
  it('reports CLEAN from a fake clamd server', async () => {
    const net = await import('node:net');
    const server = net.createServer((socket) => {
      socket.on('data', () => {});
      socket.on('end', () => {
        socket.write('stream: OK\n');
        socket.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const scanner = new ClamAVScanner('127.0.0.1', port);
      const result = await scanner.scan(Buffer.from('clean-bytes'));
      expect(result.status).toBe('CLEAN');
    } finally {
      server.close();
    }
  });

  it('reports INFECTED with signature from fake clamd', async () => {
    const net = await import('node:net');
    const server = net.createServer((socket) => {
      socket.on('data', () => {});
      socket.on('end', () => {
        socket.write('stream: Eicar-Test-Signature FOUND\n');
        socket.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const scanner = new ClamAVScanner('127.0.0.1', port);
      const result = await scanner.scan(Buffer.from('infected-bytes'));
      expect(result.status).toBe('INFECTED');
      expect(result.signature).toBe('Eicar-Test-Signature');
    } finally {
      server.close();
    }
  });

  it('returns SCAN_FAILED on timeout/unavailable (never throws)', async () => {
    const scanner = new ClamAVScanner('127.0.0.1', 9);
    const result = await scanner.scan(Buffer.from('x'));
    expect(result.status).toBe('SCAN_FAILED');
    expect(result.error).toBeTypeOf('string');
  });
});
