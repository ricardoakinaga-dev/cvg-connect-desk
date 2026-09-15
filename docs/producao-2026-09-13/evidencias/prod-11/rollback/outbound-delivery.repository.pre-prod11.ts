import { db, schema } from '@cvg/database';
import { eq, sql } from 'drizzle-orm';
import { messageRepository } from './message.repository';

export type OutboundDelivery = typeof schema.outboundDeliveries.$inferSelect;

export type FinalizeOutboundResult =
  | { status: 'sent'; providerMessageId?: string }
  | { status: 'failed'; error?: string }
  | { status: 'unknown_reconciling'; error?: string };

/**
 * Superfície mínima do mapping outbound após AAA-12/C04.
 *
 * Decisão registrada: o caminho legado (`findByKey`, `createMapping` com
 * `ON CONFLICT (idempotency_key)`, `recordAttempt`) foi REMOVIDO por não ter
 * mais chamadores — a persistência escopada é responsabilidade de
 * `persistOutboundIntentAtomically` (advisory lock + seleção escopada). O
 * índice único global `idx_outbound_deliveries_key` permanece no banco para
 * writers antigos durante rolling deploy (teste de compatibilidade em
 * `aaa-12.integration.test.ts`); nenhuma função do módulo o utiliza.
 * A ausência dos métodos legados é verificada em
 * `__tests__/outbound-delivery-surface.test.ts`.
 */
export const outboundDeliveryRepository = {
  /**
   * Fecha a tentativa externa em UMA transação:
   *  - `sent`: mensagem `sent` (+ externalMessageId quando não colide) e
   *    mapping `sent`. Gateway aceitou, destinatário ainda não confirmou.
   *  - `failed`: falha definitiva do provider.
   *  - `unknown_reconciling`: resultado ambíguo (timeout/reset/5xx). A
   *    mensagem permanece `pending` e o mapping entra em reconciliação
   *    explícita; nenhum caminho faz retry cego deste estado.
   */
  async finalizeDelivery(
    deliveryId: string,
    messageId: string,
    result: FinalizeOutboundResult,
  ): Promise<void> {
    let externalMessageId: string | undefined;
    if (result.status === 'sent' && result.providerMessageId) {
      const collision = await messageRepository.findByExternalId(result.providerMessageId);
      if (!collision || collision.id === messageId) {
        externalMessageId = result.providerMessageId;
      }
    }

    const apply = async (externalId?: string) => {
      await db.transaction(async (tx) => {
        await tx
          .update(schema.outboundDeliveries)
          .set({
            status: result.status,
            attemptCount: sql`${schema.outboundDeliveries.attemptCount} + 1`,
            lastAttemptAt: new Date(),
            lastError: result.status === 'sent' ? null : result.error ?? null,
            reconcilingAt: result.status === 'unknown_reconciling' ? new Date() : null,
            ...(result.status === 'sent' && result.providerMessageId
              ? { providerMessageId: result.providerMessageId }
              : {}),
          })
          .where(eq(schema.outboundDeliveries.id, deliveryId));

        if (result.status === 'sent') {
          await tx
            .update(schema.messages)
            .set({
              status: 'sent',
              ...(externalId ? { externalMessageId: externalId } : {}),
            })
            .where(eq(schema.messages.id, messageId));
        } else if (result.status === 'failed') {
          await tx
            .update(schema.messages)
            .set({ status: 'failed' })
            .where(eq(schema.messages.id, messageId));
        }
        // unknown_reconciling: a mensagem fica `pending` de propósito.
      });
    };

    try {
      await apply(externalMessageId);
    } catch (error) {
      // Corrida no unique de external_message_id: o provider aceitou o envio;
      // fecha como `sent` sem o ID para não deixar a mensagem `pending`.
      if (externalMessageId && (error as { cause?: { code?: string } }).cause?.code === '23505') {
        await apply(undefined);
        return;
      }
      throw error;
    }
  },
};
