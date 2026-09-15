import { createHash, randomUUID } from 'crypto';
import {
  getMediaMaxBytes,
  safeRemoteFetch,
  safeFilename,
  mediaKindForMime,
  sniffMimeType,
  validateMedia,
  validateMediaBytes,
  type MediaKind,
} from '@cvg/shared';
import { mediaAssetRepository, type MediaAsset } from './repository';
import { MemoryMediaStorage } from './memory-storage';
import { S3MediaStorage, s3ConfigFromEnv } from './s3-storage';
import { getMalwareScanner, type MalwareScanner, type ScanStatus } from './scanner';
import { mediaKey, quarantineKey, type MediaStorage } from './storage';

export { MemoryMediaStorage } from './memory-storage';
export { S3MediaStorage, s3ConfigFromEnv } from './s3-storage';
export { getMediaMaxBytes, MEDIA_MAX_BYTES_DEFAULT } from '@cvg/shared';
export * from './storage';
export * from './scanner';
export * from './repository';
export * from './legacy';

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
  /** Vínculo conversa/ator gravado na chave do objeto (C06: asset privado por conversa). */
  conversationId?: string;
  actorId?: string;
  mediaType?: string;
  mimetype?: string;
  filename?: string;
  url?: string;
  sizeBytes?: number;
  bytes?: Buffer;
  /**
   * Pipeline inbound produtivo: busca a URL remota com `safeRemoteFetch`
   * (SSRF/DNS rebinding/redirect/timeout/limite). Ausente preserva o
   * comportamento legado de referência externa (sem bytes ⇒ EXTERNAL).
   */
  fetchRemote?: boolean;
}

export type PipelineBlockReason =
  | 'media_too_large'
  | 'mime_not_allowed'
  | 'unsafe_url'
  | 'invalid_data_url'
  | 'executable_content'
  | 'mime_magic_mismatch'
  | 'fetch_failed'
  | 'fetch_disabled'
  | 'scanner_unavailable'
  | 'scanner_failed'
  | 'infected'
  | 'storage_unavailable';

export interface PipelineResult {
  assetId: string;
  storageStatus: 'EXTERNAL' | 'QUARANTINED' | 'STORED';
  scanStatus: ScanStatus;
  sha256?: string;
  storageKey?: string;
  mimetype?: string;
  blocked?: boolean;
  reasonCode?: PipelineBlockReason;
  reason?: string;
  scanSignature?: string;
}

function blockedPipeline(reasonCode: PipelineBlockReason, reason: string): PipelineResult {
  return { assetId: '', storageStatus: 'EXTERNAL', scanStatus: 'PENDING_SCAN', blocked: true, reasonCode, reason };
}

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function fetchBytesControlled(url: string, maxBytes: number): Promise<Buffer> {
  // C05: revalidação de SSRF a cada hop, DNS rebinding e limite de redirects
  // (default 0 = redirect recusado). Nunca confiar no hostname pré-validação.
  return safeRemoteFetch(url, maxBytes, {
    maxRedirects: Number(process.env.MEDIA_FETCH_MAX_REDIRECTS) || 0,
  });
}

function decodeDataUrl(url: string): { bytes: Buffer; mimetype: string } {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
  if (!match) throw new Error('Malformed data URL');
  const [, mime, base64, data] = match;
  const bytes = base64 ? Buffer.from(data, 'base64') : Buffer.from(decodeURIComponent(data), 'utf8');
  return { bytes, mimetype: mime || 'application/octet-stream' };
}

const QUARANTINE_RETENTION_MS_INBOUND = 7 * 24 * 60 * 60 * 1000;

/**
 * Persistência idempotente do asset: a chave do objeto é determinística por
 * mensagem+sha256, então um retry após crash reencontra a MESMA linha em vez
 * de duplicar o lifecycle.
 */
async function persistInboundAsset(input: {
  messageId?: string;
  storageDriver: string;
  storageKey: string;
  sha256: string;
  mimetype: string;
  filename?: string;
  bytes: Buffer;
  scanStatus: ScanStatus;
  storageStatus: 'QUARANTINED' | 'STORED';
}): Promise<MediaAsset> {
  const existingByKey = await mediaAssetRepository.findByStorageKey(input.storageKey);
  const existing = existingByKey || (input.messageId
    ? await mediaAssetRepository.findByMessageIdAndSha256(input.messageId, input.sha256)
    : null);
  if (existing) {
    // CLEAN/INFECTED são vereditos terminais: um retry nunca pode rebaixar ou
    // reclassificar o mesmo bytes. PENDING/SCAN_FAILED podem avançar para CLEAN.
    if (existing.scanStatus === 'INFECTED'
      || (existing.scanStatus === 'CLEAN' && existing.storageStatus === 'STORED')) {
      return existing;
    }
    if (existing.storageKey === input.storageKey
      && existing.scanStatus === input.scanStatus
      && existing.storageStatus === input.storageStatus) {
      return existing;
    }
    const updated = await mediaAssetRepository.updateStatus(existing.id, {
      scanStatus: input.scanStatus,
      storageStatus: input.storageStatus,
      storageKey: input.storageKey,
      retentionUntil: input.storageStatus === 'QUARANTINED'
        ? new Date(Date.now() + QUARANTINE_RETENTION_MS_INBOUND)
        : null,
    });
    if (!updated) throw new Error(`Media asset ${existing.id} disappeared during retry`);
    return updated;
  }
  const values = {
    messageId: input.messageId,
    storageDriver: input.storageDriver,
    storageKey: input.storageKey,
    sha256: input.sha256,
    mimeType: input.mimetype,
    sizeBytes: input.bytes.length,
    filename: input.filename,
    scanStatus: input.scanStatus,
    storageStatus: input.storageStatus,
    ...(input.storageStatus === 'QUARANTINED'
      ? { retentionUntil: new Date(Date.now() + QUARANTINE_RETENTION_MS_INBOUND) }
      : {}),
  };
  try {
    return await mediaAssetRepository.create(values);
  } catch (error) {
    // Corrida de retry concorrente: a chave única já foi gravada pelo vencedor.
    const raced = await mediaAssetRepository.findByStorageKey(input.storageKey);
    if (raced) return raced;
    throw error;
  }
}

/**
 * Pipeline inbound (Final-3/4, reconectado em PROD-14): validate → fetch
 * controlado → magic bytes → scan/quarentena com vínculo de conversa →
 * `media/` somente CLEAN. Fail-closed: sem scanner, INFECTED, SCAN_FAILED,
 * SSRF, fetch falho ou MIME/magic divergente NUNCA produz asset referenciável.
 */
export async function processInboundMedia(input: PipelineInput): Promise<PipelineResult> {
  const maxBytes = getMediaMaxBytes();

  const validation = validateMedia({
    mediaType: input.mediaType,
    mimetype: input.mimetype,
    url: input.url,
    sizeBytes: input.sizeBytes,
  });
  if (!validation.ok) {
    return blockedPipeline((validation.reason as PipelineBlockReason) ?? 'unsafe_url', validation.message || 'Mídia inválida');
  }

  let bytes: Buffer | undefined = input.bytes;
  let mimetype = input.mimetype;
  if (!bytes && input.url) {
    if (input.url.startsWith('data:')) {
      try {
        const decoded = decodeDataUrl(input.url);
        bytes = decoded.bytes;
        mimetype = mimetype || decoded.mimetype;
      } catch (error) {
        return blockedPipeline('invalid_data_url', error instanceof Error ? error.message : 'Malformed data URL');
      }
    } else if (input.fetchRemote === true || (process.env.MEDIA_FETCH_REMOTE || 'false').toLowerCase() === 'true') {
      try {
        // C05/PROD-14: revalidação de SSRF a cada hop, DNS rebinding e limite
        // de redirects (default 0 = redirect recusado).
        bytes = await fetchBytesControlled(input.url, maxBytes);
      } catch (error) {
        return blockedPipeline('fetch_failed', error instanceof Error ? error.message : 'Falha ao buscar mídia remota');
      }
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
    return {
      assetId: asset.id,
      storageStatus: 'EXTERNAL',
      scanStatus: 'PENDING_SCAN',
      blocked: true,
      reasonCode: 'fetch_disabled',
      reason: 'Mídia sem bytes disponíveis; referência externa nunca é entregável sem scan',
    };
  }

  if (bytes.length > maxBytes) {
    return blockedPipeline('media_too_large', `Media exceeds ${maxBytes} bytes`);
  }

  // Nunca confiar no MIME declarado pelo provider: exige tipo permitido e
  // confere a assinatura real dos bytes (magic/executável).
  const declared = (mimetype || '').split(';')[0].trim().toLowerCase() || (sniffMimeType(bytes) ?? '');
  if (!declared || !mediaKindForMime(declared)) {
    return blockedPipeline('mime_not_allowed', `MIME ${mimetype || 'desconhecido'} não permitido para mídia inbound`);
  }
  const bytesCheck = validateMediaBytes(declared, bytes);
  if (!bytesCheck.ok) {
    return blockedPipeline((bytesCheck.reason as PipelineBlockReason) ?? 'mime_magic_mismatch', bytesCheck.message || 'Bytes não correspondem ao MIME declarado');
  }
  const filename = input.filename ? safeFilename(input.filename) : undefined;

  const sha256 = sha256Hex(bytes);
  const binding = input.conversationId && input.actorId
    ? { conversationId: input.conversationId, actorId: input.actorId }
    : null;
  const objectBase = `${input.messageId ?? randomUUID()}-${sha256.slice(0, 16)}`;
  const storage = getMediaStorage();
  const keyFor = (quarantine: boolean): string => (binding
    ? uploadObjectKey(binding.conversationId, binding.actorId, objectBase, quarantine)
    : (quarantine ? quarantineKey(`unbound/${objectBase}`) : mediaKey(`unbound/${objectBase}`)));

  const scanner: MalwareScanner | null = getMalwareScanner();
  let scanStatus: ScanStatus = 'PENDING_SCAN';
  let scanSignature: string | undefined;
  let scanError: string | undefined;
  if (scanner) {
    const outcome = await scanner.scan(bytes, filename);
    scanStatus = outcome.status;
    scanSignature = outcome.signature;
    scanError = outcome.error;
  }

  // CLEAN → prefixo privado media/; qualquer outro veredito → quarantine/.
  const clean = scanStatus === 'CLEAN';
  const storageStatus: 'STORED' | 'QUARANTINED' = clean ? 'STORED' : 'QUARANTINED';
  const key = keyFor(!clean);
  try {
    await storage.put({ key, body: bytes, contentType: declared });
  } catch (error) {
    return blockedPipeline('storage_unavailable', `Falha ao gravar mídia: ${error instanceof Error ? error.message : String(error)}`);
  }

  const previousKey = input.messageId
    ? (await mediaAssetRepository.findByMessageIdAndSha256(input.messageId, sha256))?.storageKey
    : undefined;
  const asset = await persistInboundAsset({
    messageId: input.messageId,
    storageDriver: storage.driver,
    storageKey: key,
    sha256,
    mimetype: declared,
    filename,
    bytes,
    scanStatus,
    storageStatus,
  });

  // A scanner recovery can promote the same asset from quarantine/ to media/.
  // The new key is durable before this cleanup; a crash leaves only an old
  // private object, which is safe and removable on the next retry.
  if (previousKey && previousKey !== key) {
    await storage.delete(previousKey).catch(() => undefined);
  }

  if (clean) {
    return { assetId: asset.id, storageStatus, scanStatus, sha256, storageKey: key, mimetype: declared };
  }

  const reasonCode: PipelineBlockReason = scanStatus === 'INFECTED'
    ? 'infected'
    : scanStatus === 'SCAN_FAILED'
      ? 'scanner_failed'
      : 'scanner_unavailable';
  const reason = scanStatus === 'INFECTED'
    ? `Malware detectado${scanSignature ? ` (${scanSignature})` : ''} — quarentena, nunca entregável`
    : scanStatus === 'SCAN_FAILED'
      ? `Scanner falhou (${scanError || 'erro'}); quarentena preservada`
      : 'Scanner indisponível (fail-closed); quarentena preservada';
  return { assetId: asset.id, storageStatus, scanStatus, sha256, storageKey: key, mimetype: declared, blocked: true, reasonCode, reason, scanSignature };
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

// ============================================
// C05 — transporte dedicado de upload + entrega condicionada a CLEAN.
// ============================================

export interface UploadIngestInput {
  conversationId: string;
  /** Ator autenticado que fez o upload (vinculado à chave, para auditoria). */
  actorId: string;
  mediaType: string;
  mimetype: string;
  filename?: string;
  bytes: Buffer;
}

export type UploadBlockReason =
  | 'media_too_large'
  | 'mime_not_allowed'
  | 'executable_content'
  | 'mime_magic_mismatch'
  | 'scanner_unavailable'
  | 'scanner_failed'
  | 'infected'
  | 'storage_unavailable';

export interface UploadIngestResult {
  assetId: string;
  storageStatus: 'EXTERNAL' | 'QUARANTINED' | 'STORED' | 'DELETED';
  scanStatus: ScanStatus;
  sha256?: string;
  storageKey?: string;
  sizeBytes: number;
  mimetype: string;
  mediaType: MediaKind | string;
  filename?: string;
  blocked: boolean;
  reasonCode?: UploadBlockReason;
  reason?: string;
  signedUrl?: string;
  scanSignature?: string;
}

function signedReadTtlSeconds(): number {
  return Number(process.env.MEDIA_SIGNED_URL_TTL_SECONDS) || 300;
}

const QUARANTINE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Vincula o objeto à conversa/ator sem alterar schema (packages/database fora do escopo). */
function uploadObjectKey(conversationId: string, actorId: string, base: string, quarantine: boolean): string {
  const relative = `${conversationId}/${actorId}/${base}`;
  return quarantine ? quarantineKey(relative) : mediaKey(relative);
}

export interface AssetBinding {
  conversationId: string;
  actorId: string;
}

/** Extrai o vínculo (conversa/ator) gravado na chave no momento do upload. */
export function assetBindingFromKey(storageKey: string | null | undefined): AssetBinding | null {
  if (!storageKey) return null;
  const match = /^(?:quarantine|media)\/([0-9a-fA-F-]{36})\/([0-9a-fA-F-]{36})\//.exec(storageKey);
  if (!match) return null;
  return { conversationId: match[1], actorId: match[2] };
}

/**
 * Upload dedicado (C05): bytes reais (sem base64), limite de 16 MiB, MIME
 * declarado + magic bytes, armazenamento privado e scan obrigatório.
 * CLEAN → `media/`; qualquer outro veredito → quarentena e bloqueio.
 */
export async function ingestUploadedMedia(input: UploadIngestInput): Promise<UploadIngestResult> {
  const maxBytes = getMediaMaxBytes();
  const filename = input.filename ? safeFilename(input.filename) : undefined;
  const base: Omit<UploadIngestResult, 'assetId' | 'storageStatus' | 'scanStatus' | 'blocked'> = {
    sizeBytes: input.bytes.length,
    mimetype: input.mimetype,
    mediaType: input.mediaType,
    filename,
  };

  if (input.bytes.length > maxBytes) {
    return { ...base, assetId: '', storageStatus: 'EXTERNAL', scanStatus: 'PENDING_SCAN', blocked: true, reasonCode: 'media_too_large', reason: `Media exceeds ${maxBytes} bytes` };
  }

  const declared = validateMedia({ mediaType: input.mediaType, mimetype: input.mimetype, sizeBytes: input.bytes.length });
  if (!declared.ok) {
    return { ...base, assetId: '', storageStatus: 'EXTERNAL', scanStatus: 'PENDING_SCAN', blocked: true, reasonCode: declared.reason === 'media_too_large' ? 'media_too_large' : 'mime_not_allowed', reason: declared.message };
  }

  // Assinatura real dos bytes (MZ/ELF disfarçado de PDF, MIME mentido).
  const bytesCheck = validateMediaBytes(input.mimetype, input.bytes);
  if (!bytesCheck.ok) {
    return { ...base, assetId: '', storageStatus: 'EXTERNAL', scanStatus: 'PENDING_SCAN', blocked: true, reasonCode: bytesCheck.reason === 'executable_content' ? 'executable_content' : 'mime_magic_mismatch', reason: bytesCheck.message };
  }

  const sha256 = sha256Hex(input.bytes);
  const objectBase = `${sha256}-${randomUUID().slice(0, 8)}`;
  const storage = getMediaStorage();

  const quarantineOutcome = async (
    scanStatus: ScanStatus,
    reasonCode: UploadBlockReason,
    reason: string,
    signature?: string,
  ): Promise<UploadIngestResult> => {
    const key = uploadObjectKey(input.conversationId, input.actorId, objectBase, true);
    await storage.put({ key, body: input.bytes, contentType: input.mimetype });
    const asset = await mediaAssetRepository.create({
      storageDriver: storage.driver,
      storageKey: key,
      sha256,
      mimeType: input.mimetype,
      sizeBytes: input.bytes.length,
      filename,
      scanStatus,
      storageStatus: 'QUARANTINED',
      retentionUntil: new Date(Date.now() + QUARANTINE_RETENTION_MS),
    });
    return { ...base, assetId: asset.id, storageStatus: 'QUARANTINED', scanStatus, sha256, storageKey: key, blocked: true, reasonCode, reason, ...(signature ? { scanSignature: signature } : {}) };
  };

  const scanner: MalwareScanner | null = getMalwareScanner();
  if (!scanner) {
    // Fail-secure: upload sem scanner nunca é entregável; bytes preservados.
    return quarantineOutcome('PENDING_SCAN', 'scanner_unavailable', 'Scanner de malware indisponível (fail-secure); upload mantido em quarentena');
  }

  const scan = await scanner.scan(input.bytes, filename);
  if (scan.status === 'INFECTED') {
    return quarantineOutcome('INFECTED', 'infected', 'Malware detectado; anexo em quarentena e nunca entregue', scan.signature);
  }
  if (scan.status !== 'CLEAN') {
    return quarantineOutcome('SCAN_FAILED', 'scanner_failed', `Scanner não retornou CLEAN (${scan.error || 'falha'}); quarentena preservada`);
  }

  const key = uploadObjectKey(input.conversationId, input.actorId, objectBase, false);
  await storage.put({ key, body: input.bytes, contentType: input.mimetype });
  const asset = await mediaAssetRepository.create({
    storageDriver: storage.driver,
    storageKey: key,
    sha256,
    mimeType: input.mimetype,
    sizeBytes: input.bytes.length,
    filename,
    scanStatus: 'CLEAN',
    storageStatus: 'STORED',
  });
  const signedUrl = await storage.createSignedReadUrl(key, signedReadTtlSeconds());
  return { ...base, assetId: asset.id, storageStatus: 'STORED', scanStatus: 'CLEAN', sha256, storageKey: key, blocked: false, signedUrl };
}

export type DeliveryBlockReason = 'asset_not_found' | 'asset_not_clean' | 'wrong_conversation' | 'asset_unbound';

export interface DeliverableAssetQuery {
  assetId: string;
  conversationId: string;
}

export type DeliverableAssetResult =
  | { ok: true; asset: MediaAsset; signedUrl: string }
  | { ok: false; reason: DeliveryBlockReason; scanStatus?: ScanStatus; storageStatus?: string };

/**
 * Resolve um asset para entrega. Só CLEAN+STORED sob `media/` e vinculado à
 * conversa informada gera URL assinada; INFECTED/PENDING/SCAN_FAILED/quarentena
 * e conversa divergente são recusados.
 */
export async function resolveDeliverableAsset(query: DeliverableAssetQuery): Promise<DeliverableAssetResult> {
  const asset = await mediaAssetRepository.findById(query.assetId);
  if (!asset) return { ok: false, reason: 'asset_not_found' };

  const storedPublic = asset.storageStatus === 'STORED' && asset.scanStatus === 'CLEAN' && !!asset.storageKey?.startsWith('media/');
  if (!storedPublic) {
    return { ok: false, reason: 'asset_not_clean', scanStatus: asset.scanStatus, storageStatus: asset.storageStatus };
  }

  const binding = assetBindingFromKey(asset.storageKey);
  // Asset sem vínculo de conversa na chave não é atribuível com segurança:
  // nunca é entregue a nenhuma conversa (default-deny).
  if (!binding) {
    return { ok: false, reason: 'asset_unbound', scanStatus: asset.scanStatus, storageStatus: asset.storageStatus };
  }
  if (binding.conversationId !== query.conversationId) {
    return { ok: false, reason: 'wrong_conversation', scanStatus: asset.scanStatus, storageStatus: asset.storageStatus };
  }

  const signedUrl = await getMediaStorage().createSignedReadUrl(asset.storageKey as string, signedReadTtlSeconds());
  return { ok: true, asset, signedUrl };
}
