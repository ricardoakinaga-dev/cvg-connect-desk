import { db, schema } from '@cvg/database';
import { eq, sql } from 'drizzle-orm';

export type OutboundDelivery = typeof schema.outboundDeliveries.$inferSelect;

/**
 * Mapping idempotency_key -> mensagem (Phase 2 §5.4).
 * Insert com onConflictDoNothing: sob concorrência, apenas um vencedor cria;
 * o perdedor lê o mapeamento existente e retorna a mensagem original.
 */
export const outboundDeliveryRepository = {
  async findByKey(idempotencyKey: string): Promise<OutboundDelivery | null> {
    const [row] = await db
      .select()
      .from(schema.outboundDeliveries)
      .where(eq(schema.outboundDeliveries.idempotencyKey, idempotencyKey));
    return row || null;
  },

  async createMapping(data: {
    internalMessageId: string;
    idempotencyKey: string;
    provider?: string;
  }): Promise<{ delivery: OutboundDelivery; isDuplicate: boolean }> {
    const [inserted] = await db
      .insert(schema.outboundDeliveries)
      .values({
        internalMessageId: data.internalMessageId,
        idempotencyKey: data.idempotencyKey,
        provider: data.provider || 'evolution',
      })
      .onConflictDoNothing({ target: schema.outboundDeliveries.idempotencyKey })
      .returning();

    if (inserted) return { delivery: inserted, isDuplicate: false };

    const existing = await this.findByKey(data.idempotencyKey);
    return { delivery: existing!, isDuplicate: true };
  },

  async recordAttempt(id: string, result: { success: boolean; providerMessageId?: string }): Promise<void> {
    await db
      .update(schema.outboundDeliveries)
      .set({
        attemptCount: sql`${schema.outboundDeliveries.attemptCount} + 1`,
        lastAttemptAt: new Date(),
        status: result.success ? 'sent' : 'failed',
        ...(result.providerMessageId ? { providerMessageId: result.providerMessageId } : {}),
      })
      .where(eq(schema.outboundDeliveries.id, id));
  },

  async findByMessageId(internalMessageId: string): Promise<OutboundDelivery[]> {
    return db
      .select()
      .from(schema.outboundDeliveries)
      .where(eq(schema.outboundDeliveries.internalMessageId, internalMessageId));
  },
};
