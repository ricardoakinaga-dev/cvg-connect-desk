import { db, schema } from '@cvg/database';
import { and, eq } from 'drizzle-orm';

export type MediaAsset = typeof schema.mediaAssets.$inferSelect;

/** Registro de metadados de mídia (Final-3/4). */
export const mediaAssetRepository = {
  async create(data: {
    messageId?: string;
    storageDriver: string;
    storageBucket?: string;
    storageKey?: string;
    sha256?: string;
    mimeType?: string;
    sizeBytes?: number;
    filename?: string;
    scanStatus?: 'PENDING_SCAN' | 'CLEAN' | 'INFECTED' | 'SCAN_FAILED';
    storageStatus?: 'EXTERNAL' | 'QUARANTINED' | 'STORED' | 'DELETED';
    retentionUntil?: Date;
  }): Promise<MediaAsset> {
    const [row] = await db
      .insert(schema.mediaAssets)
      .values({
        messageId: data.messageId,
        storageDriver: data.storageDriver,
        storageBucket: data.storageBucket,
        storageKey: data.storageKey,
        sha256: data.sha256,
        mimeType: data.mimeType,
        sizeBytes: data.sizeBytes,
        filename: data.filename,
        scanStatus: data.scanStatus ?? 'PENDING_SCAN',
        storageStatus: data.storageStatus ?? 'EXTERNAL',
        retentionUntil: data.retentionUntil,
      })
      .returning();
    return row;
  },

  async findById(id: string): Promise<MediaAsset | null> {
    const [row] = await db.select().from(schema.mediaAssets).where(eq(schema.mediaAssets.id, id));
    return row || null;
  },

  async findBySha256(sha256: string): Promise<MediaAsset[]> {
    return db.select().from(schema.mediaAssets).where(eq(schema.mediaAssets.sha256, sha256));
  },

  async findByMessageId(messageId: string): Promise<MediaAsset[]> {
    return db.select().from(schema.mediaAssets).where(eq(schema.mediaAssets.messageId, messageId));
  },

  async findByStorageKey(storageKey: string): Promise<MediaAsset | null> {
    const [row] = await db.select().from(schema.mediaAssets).where(eq(schema.mediaAssets.storageKey, storageKey));
    return row || null;
  },

  /** Identidade estável para reprocessar o mesmo bytes sem criar outro asset. */
  async findByMessageIdAndSha256(messageId: string, sha256: string): Promise<MediaAsset | null> {
    const [row] = await db
      .select()
      .from(schema.mediaAssets)
      .where(and(eq(schema.mediaAssets.messageId, messageId), eq(schema.mediaAssets.sha256, sha256)))
      .limit(1);
    return row || null;
  },

  async updateStatus(
    id: string,
    patch: Partial<Pick<MediaAsset, 'scanStatus' | 'storageStatus' | 'storageKey' | 'storageBucket' | 'retentionUntil'>>,
  ): Promise<MediaAsset | null> {
    const [row] = await db
      .update(schema.mediaAssets)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(schema.mediaAssets.id, id))
      .returning();
    return row || null;
  },
};
