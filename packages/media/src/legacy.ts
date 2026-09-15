import { and, eq, isNotNull, isNull, like, not, or, sql } from 'drizzle-orm';
import { db, schema } from '@cvg/database';

/**
 * PROD-14/AC4 — inventário READ-ONLY de mídias legadas.
 *
 * Identifica referências de mídia que NÃO estão sob o storage controlado
 * (prefixos `media/`+CLEAN+STORED) a partir do schema real:
 *
 *   - `messages.media_url` com URL externa `http(s)://`, `data:` ou esquema
 *     desconhecido (referência crua persistida antes do pipeline);
 *   - `messages.media_url` com `asset://<id>` cujo `media_assets` não existe
 *     ou não está CLEAN+STORED (referência quebrada/não publicada);
 *   - `media_assets.storage_status = 'EXTERNAL'` (asset registrado sem cópia
 *     controlada);
 *   - `messages.metadata.mediaIntake` em estado retentável (PENDING_SCAN/FAILED)
 *     sem asset publicado.
 *
 * Nenhuma query aqui escreve: o dry-run é somente leitura e a contagem por
 * tipo serve de plano para a migração idempotente.
 */

export type LegacyMediaKind =
  | 'raw_http_url'
  | 'data_url'
  | 'other_url'
  | 'broken_asset'
  | 'external_asset'
  | 'pending_intake';

export interface LegacyMediaItem {
  kind: LegacyMediaKind;
  /** Chave determinística de migração (por mensagem/URL), reexecutável. */
  migrationKey: string;
  messageId: string | null;
  conversationId: string | null;
  assetId: string | null;
  mediaUrl: string | null;
  mediaType: string | null;
  mimetype: string | null;
  filename: string | null;
  scanStatus: string | null;
  storageStatus: string | null;
}

export interface LegacyMediaDryRun {
  readOnly: true;
  generatedAt: string;
  counts: Record<LegacyMediaKind, number>;
  totalCandidates: number;
  /** Itens completos (limitados), para inspeção/plano de execução. */
  items: LegacyMediaItem[];
}

function classifyUrl(url: string): LegacyMediaKind {
  if (/^https?:/i.test(url)) return 'raw_http_url';
  if (url.startsWith('data:')) return 'data_url';
  return 'other_url';
}

function intakeOfMetadata(metadata: string | null): { state?: string; sourceUrl?: string } {
  if (!metadata) return {};
  try {
    const parsed = JSON.parse(metadata) as { mediaIntake?: { state?: string; sourceUrl?: string } };
    return parsed && typeof parsed === 'object' && parsed.mediaIntake && typeof parsed.mediaIntake === 'object'
      ? parsed.mediaIntake
      : {};
  } catch {
    return {};
  }
}

export interface DryRunLegacyMediaOptions {
  /** Máximo de itens devolvidos em `items` (as contagens cobrem tudo). */
  limit?: number;
}

export async function dryRunLegacyMediaMigration(options: DryRunLegacyMediaOptions = {}): Promise<LegacyMediaDryRun> {
  const limit = Math.max(1, options.limit ?? 200);
  const items: LegacyMediaItem[] = [];

  // 1) `messages.media_url` cru (não asset://) — check column real.
  const rawMessages = await db
    .select({
      id: schema.messages.id,
      conversationId: schema.messages.conversationId,
      mediaUrl: schema.messages.mediaUrl,
      mediaType: schema.messages.mediaType,
      mediaMimetype: schema.messages.mediaMimetype,
      mediaFilename: schema.messages.mediaFilename,
    })
    .from(schema.messages)
    .where(and(
      eq(schema.messages.direction, 'inbound'),
      isNotNull(schema.messages.mediaUrl),
      not(like(schema.messages.mediaUrl, 'asset://%')),
    ));
  for (const row of rawMessages) {
    const url = row.mediaUrl as string;
    items.push({
      kind: classifyUrl(url),
      migrationKey: `legacy:message:${row.id}`,
      messageId: row.id,
      conversationId: row.conversationId,
      assetId: null,
      mediaUrl: url,
      mediaType: row.mediaType,
      mimetype: row.mediaMimetype,
      filename: row.mediaFilename,
      scanStatus: null,
      storageStatus: null,
    });
  }

  // 2) `asset://` quebrado: sem asset interno ou sem CLEAN+STORED.
  const assetRefs = await db
    .select({
      id: schema.messages.id,
      conversationId: schema.messages.conversationId,
      mediaUrl: schema.messages.mediaUrl,
      mediaType: schema.messages.mediaType,
      mediaMimetype: schema.messages.mediaMimetype,
      mediaFilename: schema.messages.mediaFilename,
      assetId: schema.mediaAssets.id,
      assetScanStatus: schema.mediaAssets.scanStatus,
      assetStorageStatus: schema.mediaAssets.storageStatus,
    })
    .from(schema.messages)
    .leftJoin(
      schema.mediaAssets,
      sql`${schema.mediaAssets.id}::text = substring(${schema.messages.mediaUrl} from 9)`,
    )
    .where(and(
      eq(schema.messages.direction, 'inbound'),
      like(schema.messages.mediaUrl, 'asset://%'),
    ));
  for (const row of assetRefs) {
    const published = Boolean(row.assetId)
      && row.assetScanStatus === 'CLEAN'
      && row.assetStorageStatus === 'STORED';
    if (published) continue;
    items.push({
      kind: 'broken_asset',
      migrationKey: `legacy:message:${row.id}`,
      messageId: row.id,
      conversationId: row.conversationId,
      assetId: row.assetId,
      mediaUrl: row.mediaUrl,
      mediaType: row.mediaType,
      mimetype: row.mediaMimetype,
      filename: row.mediaFilename,
      scanStatus: row.assetScanStatus,
      storageStatus: row.assetStorageStatus,
    });
  }

  // 3) `media_assets` registrado como EXTERNAL (sem cópia controlada).
  const externalAssets = await db
    .select({
      assetId: schema.mediaAssets.id,
      messageId: schema.mediaAssets.messageId,
      scanStatus: schema.mediaAssets.scanStatus,
      storageStatus: schema.mediaAssets.storageStatus,
      mimeType: schema.mediaAssets.mimeType,
      filename: schema.mediaAssets.filename,
      conversationId: schema.messages.conversationId,
      mediaUrl: schema.messages.mediaUrl,
      mediaType: schema.messages.mediaType,
      mediaMimetype: schema.messages.mediaMimetype,
      mediaFilename: schema.messages.mediaFilename,
    })
    .from(schema.mediaAssets)
    .leftJoin(schema.messages, eq(schema.mediaAssets.messageId, schema.messages.id))
    .where(eq(schema.mediaAssets.storageStatus, 'EXTERNAL'));
  for (const row of externalAssets) {
    items.push({
      kind: 'external_asset',
      migrationKey: `legacy:asset:${row.assetId}`,
      messageId: row.messageId,
      conversationId: row.conversationId,
      assetId: row.assetId,
      mediaUrl: row.mediaUrl,
      mediaType: row.mediaType,
      mimetype: row.mimeType ?? row.mediaMimetype,
      filename: row.filename ?? row.mediaFilename,
      scanStatus: row.scanStatus,
      storageStatus: row.storageStatus,
    });
  }

  // 4) Intake retentável no metadata (mesmo filtro do recovery worker).
  const pendingIntake = await db
    .select({
      id: schema.messages.id,
      conversationId: schema.messages.conversationId,
      metadata: schema.messages.metadata,
      mediaType: schema.messages.mediaType,
      mediaMimetype: schema.messages.mediaMimetype,
      mediaFilename: schema.messages.mediaFilename,
    })
    .from(schema.messages)
    .where(and(
      eq(schema.messages.direction, 'inbound'),
      isNull(schema.messages.mediaUrl),
      like(schema.messages.metadata, '%"mediaIntake"%'),
      or(
        like(schema.messages.metadata, '%"state":"PENDING_SCAN"%'),
        like(schema.messages.metadata, '%"state":"SCAN_FAILED"%'),
        like(schema.messages.metadata, '%"state":"FAILED"%'),
      ),
    ));
  for (const row of pendingIntake) {
    const intake = intakeOfMetadata(row.metadata);
    items.push({
      kind: 'pending_intake',
      migrationKey: `legacy:message:${row.id}`,
      messageId: row.id,
      conversationId: row.conversationId,
      assetId: null,
      mediaUrl: intake.sourceUrl ?? null,
      mediaType: row.mediaType,
      mimetype: row.mediaMimetype,
      filename: row.mediaFilename,
      scanStatus: intake.state ?? null,
      storageStatus: null,
    });
  }

  const counts: Record<LegacyMediaKind, number> = {
    raw_http_url: 0,
    data_url: 0,
    other_url: 0,
    broken_asset: 0,
    external_asset: 0,
    pending_intake: 0,
  };
  for (const item of items) counts[item.kind] += 1;

  return {
    readOnly: true,
    generatedAt: new Date().toISOString(),
    counts,
    totalCandidates: items.length,
    items: items.slice(0, limit),
  };
}
