import { describe, it, expect, vi } from 'vitest';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { S3MediaStorage } from '../s3-storage';
import { Readable } from 'node:stream';

/**
 * S3 driver com client stub (sem rede): verifica comandos, bucket/key,
 * serialização e tratamento de NotFound. Assinatura de URLs (SigV4) é
 * exercitada apenas contra MinIO/S3 real (ver docs).
 */
function stubClient(impl: (command: unknown) => unknown): S3Client {
  return { send: vi.fn().mockImplementation(impl) } as unknown as S3Client;
}

describe('S3MediaStorage (mocked client)', () => {
  function makeStorage(send: (command: unknown) => unknown): { storage: S3MediaStorage; calls: unknown[] } {
    const calls: unknown[] = [];
    const client = stubClient((command: unknown) => {
      calls.push(command);
      return send(command);
    });
    return {
      storage: new S3MediaStorage({
        region: 'us-east-1',
        bucket: 'cvg-media',
        accessKeyId: 'test',
        secretAccessKey: 'test',
        client,
      }),
      calls,
    };
  }

  it('put serializes bucket/key/body/content-type', async () => {
    const { storage, calls } = makeStorage(() => ({ ETag: '"abc"' }));
    const out = await storage.put({ key: 'media/x', body: Buffer.from('data'), contentType: 'image/jpeg' });
    expect(out.etag).toBe('"abc"');
    expect(calls[0]).toBeInstanceOf(PutObjectCommand);
    expect((calls[0] as PutObjectCommand).input).toMatchObject({
      Bucket: 'cvg-media',
      Key: 'media/x',
      ContentType: 'image/jpeg',
    });
  });

  it('get concatenates streaming body', async () => {
    const { storage } = makeStorage(() => ({
      Body: Readable.from([Buffer.from('he'), Buffer.from('llo')]),
    }));
    const bytes = await storage.get('media/x');
    expect(bytes.toString()).toBe('hello');
  });

  it('delete sends bucket/key', async () => {
    const { storage, calls } = makeStorage(() => ({}));
    await storage.delete('quarantine/y');
    expect(calls[0]).toBeInstanceOf(DeleteObjectCommand);
    expect((calls[0] as DeleteObjectCommand).input).toMatchObject({ Bucket: 'cvg-media', Key: 'quarantine/y' });
  });

  it('exists maps NotFound to false and rethrows unexpected errors', async () => {
    const { storage } = makeStorage(() => {
      const error = new Error('not here');
      error.name = 'NotFound';
      throw error;
    });
    expect(await storage.exists('media/missing')).toBe(false);

    const broken = makeStorage(() => {
      throw new Error('connection reset');
    });
    await expect(broken.storage.exists('media/x')).rejects.toThrow('connection reset');
  });

  it('get without body throws explicit error', async () => {
    const { storage } = makeStorage(() => ({}));
    await expect(storage.get('media/empty')).rejects.toThrow('Empty body');
  });

  it('sends HeadObject for exists checks', async () => {
    const { storage, calls } = makeStorage(() => ({}));
    await storage.exists('media/x');
    expect(calls[0]).toBeInstanceOf(HeadObjectCommand);
  });

  it('get uses GetObjectCommand with bucket/key', async () => {
    const { storage, calls } = makeStorage(() => ({ Body: Readable.from([Buffer.from('d')]) }));
    await storage.get('media/k');
    expect(calls[0]).toBeInstanceOf(GetObjectCommand);
  });

  it('object storage unavailable → explicit rejection (no silent success)', async () => {
    const { storage } = makeStorage(() => {
      throw new Error('socket hang up');
    });
    await expect(
      storage.put({ key: 'media/x', body: Buffer.from('d'), contentType: 'image/jpeg' }),
    ).rejects.toThrow('socket hang up');
  });
});
