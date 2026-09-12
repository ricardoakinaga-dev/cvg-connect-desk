import type { MediaStorage, PutMediaInput } from './storage';

/**
 * MemoryMediaStorage — desenvolvimento/teste EXPLÍCITO.
 * Fail-secure: recusa operar em produção, salvo MEDIA_ALLOW_MEMORY=true
 * (para ambientes efêmeros de preview com dados descartáveis).
 */
export class MemoryMediaStorage implements MediaStorage {
  readonly driver = 'memory';
  private objects = new Map<string, { body: Buffer; contentType: string; metadata?: Record<string, string> }>();

  constructor() {
    const env = (process.env.NODE_ENV || process.env.DESK_ENV || '').toLowerCase();
    const isProd = env === 'production' || env === 'prod';
    if (isProd && process.env.MEDIA_ALLOW_MEMORY !== 'true') {
      throw new Error('[Media] memory driver proibido em produção (configure MEDIA_STORAGE_DRIVER=s3)');
    }
  }

  async put(input: PutMediaInput): Promise<{ etag?: string }> {
    this.objects.set(input.key, {
      body: Buffer.from(input.body),
      contentType: input.contentType,
      metadata: input.metadata,
    });
    return {};
  }

  async get(key: string): Promise<Buffer> {
    const obj = this.objects.get(key);
    if (!obj) {
      const error = new Error(`Object not found: ${key}`);
      (error as NodeJS.ErrnoException).code = 'NoSuchKey';
      throw error;
    }
    return obj.body;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }

  async createSignedReadUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    if (!(await this.exists(key))) throw new Error(`Object not found: ${key}`);
    return `memory://signed/${key}?expires_in=${expiresInSeconds}`;
  }

  size(): number {
    return this.objects.size;
  }
}
