import { createHash, randomUUID } from 'crypto';
import { assertSafeMediaUrl, dataUrlSizeBytes, validateMedia } from '@cvg/shared';
import { mediaAssetRepository } from './repository';
import { MemoryMediaStorage } from './memory-storage';
import { S3MediaStorage, s3ConfigFromEnv } from './s3-storage';
import { getMalwareScanner, requiresCleanScan, type MalwareScanner, type ScanStatus } from './scanner';
import { mediaKey, quarantineKey, type MediaStorage } from './storage';

export { MemoryMediaStorage } from './memory-storage';
export { S3MediaStorage, s3ConfigFromEnv } from './s3-storage';
export * from './storage';
export * from './scanner';
export * from './repository';

let singleton: MediaStorage | null = null;

/** Factory por ambiente (MEDIA_STORAGE_DRIVER=memory|s3). Fail-secure se mal configurado. */
export function getMediaStorage(): MediaStorage {
  if (!singleton) {
    const driver = (process.env.MEDIA_STORAGE_DRIVER || 'memory').toLowerCase();
    if (driver === 's3') {
      singleton = new S3MediaStorage(s3ConfigFromEnv());
    } else if (driver === 'memory') {
      singleton = new MemoryMediaStorage();
    } else {
      throw new Error(`[Media] driver desconhecido: ${driver} (use memory|s3)`);
    }
  }
  return singleton;
}

export function setMediaStorage(storage: MediaStorage): void {
  singleton = storage;
}

export function resetMediaStorage(): void {
  singleton = null;
}

export interface PipelineInput {
  messageId?: string;
  mediaType?: string;
  mimetype?: string;
  filename?: string;
  url?: string;
  sizeBytes?: number;
  bytes?: Buffer;
}

export interface PipelineResult {
  assetId: string;
  storageStatus: 'EXTERNAL' | 'QUARANTINED' | 'STORED';
  scanStatus: ScanStatus;
  sha256?: string;
  storageKey?: string;
  blocked?: boolean;
  reason?: string;
}

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function fetchBytesControlled(url: string, maxBytes: number): Promise<Buffer> {
  const safe = assertSafeMediaUrl(url);
  if (!safe.ok) {
    throw new Error(safe.message || 'Unsafe media URL');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.MEDIA_FETCH_TIMEOUT_MS) || 20000);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'error' });
    if (!response.ok) {
      throw new Error(`Media fetch failed: HTTP ${response.status}`);
    }
    const contentLength = response.headers.get('content-length');
    if (contentLength && Number(contentLength) > maxBytes) {
      throw new Error(`Media exceeds ${maxBytes} bytes`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      throw new Error(`Media exceeds ${maxBytes} bytes`);
    }
    return buffer;
  } finally {
    clearTimeout(timer);
  }
}

function decodeDataUrl(url: string): { bytes: Buffer; mimetype: string } {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
  if (!match) throw new Error('Malformed data URL');
  const [, mime, base64, data] = match;
  const bytes = base64 ? Buffer.from(data, 'base64') : Buffer.from(decodeURIComponent(data), 'utf8');
  return { bytes, mimetype: mime || 'application/octet-stream' };
}

/**
 * Pipeline inbound (Final-3/4): validate → fetch → scan/quarantine → sha256 →
 * object storage → metadata. Sem bytes disponíveis (URL remota sem fetch),
 * registra EXTERNAL com PENDING_SCAN (fetch controlado é etapa explícita).
 */
export async function processInboundMedia(input: PipelineInput): Promise<PipelineResult> {
  const maxBytes = Number(process.env.MEDIA_MAX_BYTES) || 16 * 1024 * 1024;

  const validation = validateMedia({
    mediaType: input.mediaType,
    mimetype: input.mimetype,
    url: input.url,
    sizeBytes: input.sizeBytes,
  });
  if (!validation.ok) {
    return { assetId: '', storageStatus: 'EXTERNAL', scanStatus: 'PENDING_SCAN', blocked: true, reason: validation.message };
  }

  let bytes: Buffer | undefined = input.bytes;
  let mimetype = input.mimetype;
  if (!bytes && input.url) {
    if (input.url.startsWith('data:')) {
      const decoded = decodeDataUrl(input.url);
      bytes = decoded.bytes;
      mimetype = mimetype || decoded.mimetype;
    } else if ((process.env.MEDIA_FETCH_REMOTE || 'false').toLowerCase() === 'true') {
      bytes = await fetchBytesControlled(input.url, maxBytes);
    }
  }

  if (!bytes) {
    // Sem bytes: referência externa registrada, scan pendente (não público).
    const asset = await mediaAssetRepository.create({
      messageId: input.messageId,
      storageDriver: 'external',
      mimeType: mimetype,
      sizeBytes: input.sizeBytes,
      filename: input.filename,
      scanStatus: 'PENDING_SCAN',
      storageStatus: 'EXTERNAL',
    });
    return { assetId: asset.id, storageStatus: 'EXTERNAL', scanStatus: 'PENDING_SCAN' };
  }

  if (bytes.length > maxBytes) {
    return { assetId: '', storageStatus: 'EXTERNAL', scanStatus: 'PENDING_SCAN', blocked: true, reason: `Media exceeds ${maxBytes} bytes` };
  }

  const sha256 = sha256Hex(bytes);
  const scanner: MalwareScanner | null = getMalwareScanner();
  let scanStatus: ScanStatus = 'PENDING_SCAN';
  if (scanner) {
    const result = await scanner.scan(bytes, input.filename);
    scanStatus = result.status;
  } else if (requiresCleanScan(input.mediaType)) {
    // Fail-secure: documentos exigem CLEAN; sem scanner, bloqueia.
    return { assetId: '', storageStatus: 'EXTERNAL', scanStatus: 'PENDING_SCAN', blocked: true, reason: 'Scanner required for documents (fail-secure)' };
  }

  if (scanStatus === 'INFECTED') {
    // Quarentena com retenção curta; nunca no prefixo público.
    const storage = getMediaStorage();
    const key = quarantineKey(`${sha256}/${Date.now()}-${randomUUID().slice(0, 8)}`);
    await storage.put({ key, body: bytes, contentType: mimetype || 'application/octet-stream' });
    const asset = await mediaAssetRepository.create({
      messageId: input.messageId,
      storageDriver: storage.driver,
      storageKey: key,
      sha256,
      mimeType: mimetype,
      sizeBytes: bytes.length,
      filename: input.filename,
      scanStatus: 'INFECTED',
      storageStatus: 'QUARANTINED',
      retentionUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    return { assetId: asset.id, storageStatus: 'QUARANTINED', scanStatus: 'INFECTED', sha256, storageKey: key, blocked: true, reason: 'Malware detected — quarantined' };
  }

  if (scanStatus !== 'CLEAN') {
    const asset = await mediaAssetRepository.create({
      messageId: input.messageId,
      storageDriver: 'external',
      sha256,
      mimeType: mimetype,
      sizeBytes: bytes.length,
      filename: input.filename,
      scanStatus,
      storageStatus: 'EXTERNAL',
    });
    return { assetId: asset.id, storageStatus: 'EXTERNAL', scanStatus, sha256 };
  }

  // CLEAN → prefixo público media/.
  const storage = getMediaStorage();
  const key = mediaKey(`${sha256}/${Date.now()}-${randomUUID().slice(0, 8)}`);
  await storage.put({ key, body: bytes, contentType: mimetype || 'application/octet-stream' });
  const asset = await mediaAssetRepository.create({
    messageId: input.messageId,
    storageDriver: storage.driver,
    storageKey: key,
    sha256,
    mimeType: mimetype,
    sizeBytes: bytes.length,
    filename: input.filename,
    scanStatus: 'CLEAN',
    storageStatus: 'STORED',
  });
  return { assetId: asset.id, storageStatus: 'STORED', scanStatus: 'CLEAN', sha256, storageKey: key };
}

/**
 * Promove asset de quarantine/ para media/ após CLEAN (cópia + delete).
 * Retorna null se o scan não estiver CLEAN.
 */
export async function promoteQuarantinedAsset(assetId: string): Promise<string | null> {
  const asset = await mediaAssetRepository.findById(assetId);
  if (!asset || asset.scanStatus !== 'CLEAN' || !asset.storageKey) return null;
  if (!asset.storageKey.startsWith('quarantine/')) return asset.storageKey;

  const storage = getMediaStorage();
  const target = mediaKey(asset.storageKey);
  const bytes = await storage.get(asset.storageKey);
  await storage.put({ key: target, body: bytes, contentType: asset.mimeType || 'application/octet-stream' });
  await storage.delete(asset.storageKey);
  await mediaAssetRepository.updateStatus(assetId, { storageKey: target, storageStatus: 'STORED' });
  return target;
}
