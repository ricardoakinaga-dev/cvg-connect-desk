import {
  dryRunLegacyMediaMigration,
  mediaAssetRepository,
  processInboundMedia,
  type LegacyMediaItem,
  type MediaAsset,
} from '@cvg/media';
import { messageRepository, type Message } from '../../infrastructure/repositories/message.repository';
import {
  parseIntakeMetadata,
  recoverPendingInboundMedia,
  waitForInboundMediaProcessing,
  type InboundMediaIntake,
  type InboundMediaReasonCode,
  type InboundMediaState,
} from './inbound-media-pipeline';

/**
 * PROD-14/AC4 — plano e migração de mídias legadas para o storage controlado.
 *
 * O plano é o dry-run read-only (`dryRunLegacyMediaMigration`, packages/media):
 * nenhuma escrita, contagem por tipo. A execução é idempotente por
 * mensagem/URL: a chave do objeto é determinística (`messageId`+sha256) e o
 * asset é reaproveitado por `storage_key`; reexecutar não duplica asset nem
 * apaga mensagem. Itens pendentes/infectados permanecem indisponíveis para
 * leitura HTTP (quarentena + `resolveDeliverableAsset`).
 *
 * Revalidação de pendentes reutiliza `recoverPendingInboundMedia` (o mesmo
 * caminho de recuperação pós-crash do pipeline).
 */

export interface LegacyMediaPublishedRecord {
  messageId: string;
  conversationId: string;
  assetId: string;
  storageKey: string | null;
  sha256: string | null;
  mimetype: string | null;
}

export interface LegacyMediaBlockedRecord {
  messageId: string;
  assetId?: string;
  scanStatus?: string;
  reasonCode: string;
}

export interface LegacyMediaPendingRecord {
  messageId: string;
  reasonCode: string;
}

export interface LegacyMediaUnavailableRecord {
  messageId?: string;
  assetId?: string;
  reasonCode: string;
  reason: string;
}

export interface LegacyMediaSkippedRecord {
  messageId?: string;
  assetId?: string;
  reason: string;
}

export interface LegacyMigrationReport {
  generatedAt: string;
  dryRun: { counts: Record<string, number>; totalCandidates: number };
  published: LegacyMediaPublishedRecord[];
  blocked: LegacyMediaBlockedRecord[];
  pending: LegacyMediaPendingRecord[];
  unavailable: LegacyMediaUnavailableRecord[];
  skipped: LegacyMediaSkippedRecord[];
  /** Mensagens pendentes reenfileiradas pela revalidação (recoverPendingInboundMedia). */
  revalidated: number;
}

export interface MigrateLegacyMediaOptions {
  /** Máximo de candidatos processados (também limita o dry-run quando maior). */
  limit?: number;
  /** Executa a revalidação de pendentes ao final (default true). */
  revalidate?: boolean;
  revalidateLimit?: number;
}

async function writeIntake(
  message: Message,
  intake: InboundMediaIntake,
  media?: {
    mediaUrl?: string | null;
    mediaType?: string;
    mediaMimetype?: string;
    mediaFilename?: string;
  },
): Promise<void> {
  const parsed = parseIntakeMetadata(message.metadata);
  parsed.mediaIntake = intake;
  await messageRepository.update(message.id, {
    metadata: JSON.stringify(parsed),
    ...(media && Object.prototype.hasOwnProperty.call(media, 'mediaUrl') ? { mediaUrl: media.mediaUrl } : {}),
    ...(media?.mediaType ? { mediaType: media.mediaType } : {}),
    ...(media?.mediaMimetype ? { mediaMimetype: media.mediaMimetype } : {}),
    ...(media?.mediaFilename ? { mediaFilename: media.mediaFilename } : {}),
  });
}

function baseIntake(message: Message): Pick<InboundMediaIntake, 'mediaType' | 'mimetype' | 'filename'> & { updatedAt: string } {
  return {
    mediaType: message.mediaType ?? undefined,
    mimetype: message.mediaMimetype ?? undefined,
    filename: message.mediaFilename ?? undefined,
    updatedAt: new Date().toISOString(),
  };
}

async function publishFromAsset(message: Message, asset: MediaAsset, report: LegacyMigrationReport): Promise<void> {
  const mimetype = asset.mimeType ?? message.mediaMimetype ?? undefined;
  const filename = asset.filename ?? message.mediaFilename ?? undefined;
  const intake: InboundMediaIntake = {
    state: 'CLEAN',
    mediaType: message.mediaType ?? undefined,
    mimetype,
    filename,
    assetId: asset.id,
    sha256: asset.sha256 ?? undefined,
    scanStatus: 'CLEAN',
    storageStatus: 'STORED',
    updatedAt: new Date().toISOString(),
  };
  await writeIntake(message, intake, {
    mediaUrl: `asset://${asset.id}`,
    mediaType: message.mediaType ?? undefined,
    mediaMimetype: mimetype,
    mediaFilename: filename,
  });
  report.published.push({
    messageId: message.id,
    conversationId: message.conversationId,
    assetId: asset.id,
    storageKey: asset.storageKey,
    sha256: asset.sha256,
    mimetype: asset.mimeType,
  });
}

async function markQuarantined(
  message: Message,
  state: Extract<InboundMediaState, 'INFECTED' | 'SCAN_FAILED' | 'PENDING_SCAN'>,
  reasonCode: InboundMediaReasonCode,
  reason: string,
  extra: Pick<InboundMediaIntake, 'assetId' | 'sha256' | 'scanStatus' | 'storageStatus'>,
): Promise<void> {
  await writeIntake(message, {
    state,
    ...baseIntake(message),
    ...extra,
    reasonCode,
    reason,
  }, { mediaUrl: null });
}

async function migrateCandidate(item: LegacyMediaItem, report: LegacyMigrationReport): Promise<void> {
  if (!item.messageId) {
    report.unavailable.push({
      assetId: item.assetId ?? undefined,
      reasonCode: 'external_reference_without_source',
      reason: 'Asset EXTERNAL sem mensagem/URL de origem migrável',
    });
    return;
  }

  const message = await messageRepository.findById(item.messageId);
  if (!message) {
    report.unavailable.push({
      messageId: item.messageId,
      reasonCode: 'message_missing',
      reason: 'Mensagem do candidato não existe mais',
    });
    return;
  }

  const intake = parseIntakeMetadata(message.metadata).mediaIntake;

  // `asset://` — só é legado quando o asset não está publicado; referência
  // quebrada é neutralizada em `media_url` mas preservada no metadata.
  if (message.mediaUrl?.startsWith('asset://')) {
    const assetId = message.mediaUrl.slice('asset://'.length);
    const asset = await mediaAssetRepository.findById(assetId);
    if (asset && asset.scanStatus === 'CLEAN' && asset.storageStatus === 'STORED' && asset.storageKey?.startsWith('media/')) {
      report.skipped.push({ messageId: message.id, assetId: asset.id, reason: 'already_published' });
      return;
    }
    if (asset && asset.scanStatus === 'INFECTED') {
      report.blocked.push({ messageId: message.id, assetId: asset.id, scanStatus: asset.scanStatus, reasonCode: 'infected' });
      return;
    }
    await writeIntake(message, {
      state: 'REJECTED',
      legacyRef: message.mediaUrl,
      reasonCode: 'asset_unavailable',
      reason: 'Referência asset:// quebrada ou não publicada; media_url neutralizada sem apagar a mensagem',
      updatedAt: new Date().toISOString(),
    }, { mediaUrl: null });
    report.unavailable.push({
      messageId: message.id,
      assetId: asset?.id,
      reasonCode: 'asset_unavailable',
      reason: 'asset:// sem asset CLEAN+STORED',
    });
    return;
  }

  // Bytes já persistidos de tentativa anterior (crash entre store e publicar):
  // associa sem rebaixar/duplicar o asset determinístico.
  const existingAssets = await mediaAssetRepository.findByMessageId(message.id);
  const stored = existingAssets.find(
    (asset) => asset.scanStatus === 'CLEAN' && asset.storageStatus === 'STORED' && asset.storageKey?.startsWith('media/'),
  );
  if (stored) {
    await publishFromAsset(message, stored, report);
    return;
  }
  const infected = existingAssets.find((asset) => asset.scanStatus === 'INFECTED');
  if (infected) {
    await markQuarantined(message, 'INFECTED', 'infected', 'Malware detectado em tentativa anterior; quarentena preservada', {
      assetId: infected.id,
      sha256: infected.sha256 ?? undefined,
      scanStatus: infected.scanStatus,
      storageStatus: infected.storageStatus,
    });
    report.blocked.push({ messageId: message.id, assetId: infected.id, scanStatus: infected.scanStatus, reasonCode: 'infected' });
    return;
  }

  const sourceUrl = message.mediaUrl ?? intake?.sourceUrl;
  if (!sourceUrl || sourceUrl.startsWith('asset://')) {
    report.unavailable.push({
      messageId: message.id,
      assetId: item.assetId ?? undefined,
      reasonCode: 'asset_unavailable',
      reason: 'Sem URL de origem migrável para o storage controlado',
    });
    return;
  }

  // Mesmo caminho produtivo do pipeline: safeRemoteFetch (SSRF/limite),
  // magic bytes, quarentena e CLEAN+STORED como única publicação.
  const result = await processInboundMedia({
    messageId: message.id,
    conversationId: message.conversationId,
    actorId: message.id,
    mediaType: message.mediaType ?? undefined,
    mimetype: message.mediaMimetype ?? undefined,
    filename: message.mediaFilename ?? undefined,
    url: sourceUrl,
    fetchRemote: true,
  });

  if (result.assetId && result.scanStatus === 'CLEAN' && result.storageStatus === 'STORED') {
    const asset = await mediaAssetRepository.findById(result.assetId);
    if (asset) {
      await publishFromAsset(message, asset, report);
      return;
    }
  }

  if (result.assetId && result.scanStatus === 'INFECTED') {
    await markQuarantined(message, 'INFECTED', 'infected', result.reason ?? 'Malware detectado; quarentena preservada', {
      assetId: result.assetId,
      sha256: result.sha256,
      scanStatus: result.scanStatus,
      storageStatus: result.storageStatus,
    });
    report.blocked.push({
      messageId: message.id,
      assetId: result.assetId,
      scanStatus: result.scanStatus,
      reasonCode: result.reasonCode ?? 'infected',
    });
    return;
  }

  if (result.assetId) {
    // Bytes em quarentena sem veredito CLEAN (scanner ausente/falho): segue
    // indisponível e retentável pela revalidação.
    const state: Extract<InboundMediaState, 'SCAN_FAILED' | 'PENDING_SCAN'> =
      result.scanStatus === 'SCAN_FAILED' ? 'SCAN_FAILED' : 'PENDING_SCAN';
    await markQuarantined(message, state, result.reasonCode ?? 'scanner_unavailable', result.reason ?? 'Quarentena aguardando veredito', {
      assetId: result.assetId,
      sha256: result.sha256,
      scanStatus: result.scanStatus,
      storageStatus: result.storageStatus,
    });
    report.pending.push({ messageId: message.id, reasonCode: result.reasonCode ?? state });
    return;
  }

  const retryable = result.reasonCode === 'fetch_failed' || result.reasonCode === 'storage_unavailable';
  if (retryable) {
    await writeIntake(message, {
      state: 'FAILED',
      ...baseIntake(message),
      sourceUrl,
      reasonCode: result.reasonCode,
      reason: result.reason,
    }, { mediaUrl: null });
    report.pending.push({ messageId: message.id, reasonCode: result.reasonCode ?? 'fetch_failed' });
    return;
  }

  await writeIntake(message, {
    state: 'REJECTED',
    ...baseIntake(message),
    reasonCode: result.reasonCode,
    reason: result.reason,
  }, { mediaUrl: null });
  report.blocked.push({ messageId: message.id, reasonCode: result.reasonCode ?? 'rejected' });
}

/**
 * Revalida pendentes reutilizando o caminho de recuperação existente
 * (PENDING_SCAN/FAILED com `sourceUrl` server-side). Idempotente.
 */
export async function revalidatePendingLegacyInboundMedia(limit = 50, timeoutMs = 30_000): Promise<number> {
  const queued = await recoverPendingInboundMedia(limit);
  if (queued > 0) {
    await waitForInboundMediaProcessing(undefined, timeoutMs);
  }
  return queued;
}

export async function migrateLegacyInboundMedia(options: MigrateLegacyMediaOptions = {}): Promise<LegacyMigrationReport> {
  const limit = Math.max(1, options.limit ?? 500);
  const dryRun = await dryRunLegacyMediaMigration({ limit });
  const report: LegacyMigrationReport = {
    generatedAt: new Date().toISOString(),
    dryRun: { counts: dryRun.counts, totalCandidates: dryRun.totalCandidates },
    published: [],
    blocked: [],
    pending: [],
    unavailable: [],
    skipped: [],
    revalidated: 0,
  };

  const handledMessages = new Set<string>();
  for (const item of dryRun.items) {
    if (item.kind === 'pending_intake') {
      if (item.messageId) report.pending.push({ messageId: item.messageId, reasonCode: 'awaiting_revalidation' });
      continue;
    }
    if (item.messageId) {
      if (handledMessages.has(item.messageId)) {
        report.skipped.push({ messageId: item.messageId, assetId: item.assetId ?? undefined, reason: 'duplicate_candidate' });
        continue;
      }
      handledMessages.add(item.messageId);
    }
    await migrateCandidate(item, report);
  }

  if (options.revalidate !== false) {
    report.revalidated = await revalidatePendingLegacyInboundMedia(options.revalidateLimit ?? limit);
  }
  return report;
}
