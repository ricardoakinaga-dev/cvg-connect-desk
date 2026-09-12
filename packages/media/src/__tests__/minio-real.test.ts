import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  S3Client,
  CreateBucketCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { S3MediaStorage } from '../s3-storage';

/**
 * MinIO REAL (integration; §7). Só roda com STAGING_SMOKE=1 (CI/staging).
 * Local sem Docker: `it.skip` com razão explícita — nunca "passa" de mentira.
 */
const STAGING = process.env.STAGING_SMOKE === '1';
const ENDPOINT = process.env.S3_ENDPOINT || 'http://127.0.0.1:9100';
const BUCKET = process.env.S3_BUCKET || 'cvg-media-test';
const maybe = STAGING ? it : it.skip;
const maybeDescribeBefore = (fn: () => Promise<void>) => {
  return STAGING ? fn() : Promise.resolve();
};

describe('MinIO real smoke (STAGING_SMOKE=1)', () => {
  let storage: S3MediaStorage;
  let client: S3Client;

  beforeAll(async () => {
    await maybeDescribeBefore(async () => {
      client = new S3Client({
        endpoint: ENDPOINT,
        region: 'us-east-1',
        forcePathStyle: true,
        credentials: { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin' },
      });
      await client.send(new CreateBucketCommand({ Bucket: BUCKET })).catch((e) => {
        if (e.name !== 'BucketAlreadyOwnedByYou' && e.name !== 'BucketAlreadyExists') throw e;
      });
      storage = new S3MediaStorage({
        endpoint: ENDPOINT,
        region: 'us-east-1',
        bucket: BUCKET,
        accessKeyId: 'minioadmin',
        secretAccessKey: 'minioadmin',
        forcePathStyle: true,
        serverSideEncryption: false,
        client,
      });
    });
  });

  afterAll(async () => {
    await maybeDescribeBefore(async () => {
      for (const key of ['media/a', 'media/large', 'media/meta']) {
        await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key })).catch(() => {});
      }
    });
  });

  maybe('upload + exists + download round-trip com SHA-256', async () => {
    const body = Buffer.from('minio-real-roundtrip');
    await storage.put({ key: 'media/a', body, contentType: 'text/plain' });
    expect(await storage.exists('media/a')).toBe(true);
    const downloaded = await storage.get('media/a');
    expect(downloaded.toString()).toBe('minio-real-roundtrip');
    expect(createHash('sha256').update(downloaded).digest('hex')).toBe(
      createHash('sha256').update(body).digest('hex'),
    );
  });

  maybe('signed URL é acessível (GET via fetch) com expiração', async () => {
    await storage.put({ key: 'media/a', body: Buffer.from('signed'), contentType: 'text/plain' });
    const url = await storage.createSignedReadUrl('media/a', 60);
    expect(url).toContain('X-Amz-Signature');
    const res = await fetch(url);
    expect(res.ok).toBe(true);
    expect(await res.text()).toBe('signed');
  });

  maybe('delete remove objeto', async () => {
    await storage.put({ key: 'media/copy', body: Buffer.from('x'), contentType: 'text/plain' });
    await storage.delete('media/copy');
    expect(await storage.exists('media/copy')).toBe(false);
  });

  maybe('metadados persistem (contentType + user meta)', async () => {
    await storage.put({ key: 'media/meta', body: Buffer.from('m'), contentType: 'image/jpeg', metadata: { f: 'x' } });
    const head = await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: 'media/meta' }));
    expect(head.ContentType).toBe('image/jpeg');
  });

  maybe('credenciais inválidas → erro explícito (nunca silencioso)', async () => {
    const bad = new S3MediaStorage({
      endpoint: ENDPOINT,
      region: 'us-east-1',
      bucket: BUCKET,
      accessKeyId: 'wrong',
      secretAccessKey: 'wrong',
      forcePathStyle: true,
      serverSideEncryption: false,
      client: new S3Client({
        endpoint: ENDPOINT,
        region: 'us-east-1',
        forcePathStyle: true,
        credentials: { accessKeyId: 'wrong', secretAccessKey: 'wrong' },
      }),
    });
    await expect(bad.put({ key: 'media/x', body: Buffer.from('x'), contentType: 'text/plain' })).rejects.toThrow();
  });

  maybe('storage indisponível → rejeição explícita', async () => {
    const down = new S3MediaStorage({
      endpoint: 'http://127.0.0.1:9',
      region: 'us-east-1',
      bucket: BUCKET,
      accessKeyId: 'minioadmin',
      secretAccessKey: 'minioadmin',
      forcePathStyle: true,
      serverSideEncryption: false,
    });
    await expect(down.put({ key: 'media/x', body: Buffer.from('x'), contentType: 'text/plain' })).rejects.toThrow();
  });

  maybe('large-file boundary: 16MB aceito pelo driver', async () => {
    const ok = Buffer.alloc(16 * 1024 * 1024, 1);
    await storage.put({ key: 'media/large', body: ok, contentType: 'application/octet-stream' });
    expect(await storage.exists('media/large')).toBe(true);
    const got = await storage.get('media/large');
    expect(got.length).toBe(ok.length);
  });
});
