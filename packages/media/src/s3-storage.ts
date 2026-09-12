import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { MediaStorage, PutMediaInput } from './storage';

export interface S3StorageConfig {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
  serverSideEncryption?: 'AES256' | false;
  client?: S3Client;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`[Media] ${name} é obrigatório para MEDIA_STORAGE_DRIVER=s3`);
  }
  return value;
}

export function s3ConfigFromEnv(): S3StorageConfig {
  return {
    endpoint: process.env.S3_ENDPOINT || undefined,
    region: process.env.S3_REGION || 'us-east-1',
    bucket: requireEnv('S3_BUCKET'),
    accessKeyId: requireEnv('S3_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('S3_SECRET_ACCESS_KEY'),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE || 'true').toLowerCase() === 'true',
    serverSideEncryption: ['none', 'off', 'false'].includes(
      (process.env.S3_SERVER_SIDE_ENCRYPTION || 'AES256').toLowerCase(),
    ) ? false : 'AES256',
  };
}

/**
 * S3-compatible storage (AWS S3, MinIO, Cloudflare R2).
 * Toda mídia escaneada vive sob `media/`; pré-scan sob `quarantine/`.
 */
export class S3MediaStorage implements MediaStorage {
  readonly driver = 's3';
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly serverSideEncryption?: 'AES256';

  constructor(config: S3StorageConfig) {
    this.bucket = config.bucket;
    this.serverSideEncryption = config.serverSideEncryption === false
      ? undefined
      : config.serverSideEncryption ?? 'AES256';
    this.client =
      config.client ||
      new S3Client({
        endpoint: config.endpoint,
        region: config.region,
        forcePathStyle: config.forcePathStyle ?? true,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
      } satisfies S3ClientConfig);
  }

  async put(input: PutMediaInput): Promise<{ etag?: string }> {
    const out = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.body as Uint8Array,
        ContentType: input.contentType,
        Metadata: input.metadata,
        ...(this.serverSideEncryption ? { ServerSideEncryption: this.serverSideEncryption } : {}),
      }),
    );
    return { etag: out.ETag };
  }

  async get(key: string): Promise<Buffer> {
    const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!out.Body) throw new Error(`Empty body for key: ${key}`);
    const chunks: Buffer[] = [];
    for await (const chunk of out.Body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (error: unknown) {
      const name = (error as { name?: string }).name || '';
      if (name === 'NotFound' || name === 'NoSuchKey' || name === '404') return false;
      throw error;
    }
  }

  async createSignedReadUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }
}
