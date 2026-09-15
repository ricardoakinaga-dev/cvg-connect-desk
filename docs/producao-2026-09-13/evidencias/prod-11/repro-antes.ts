/**
 * PROD-11 — repro ANTES do delta.
 *
 * Usa o CÓDIGO REAL (use case de envio + portas do chat + repositórios) contra
 * o PostgreSQL/Redis isolados do runner. Demonstra, no estado anterior:
 *
 *  A. intenção ambígua (`unknown_reconciling`) NÃO é resolvida por callback:
 *     `applyReceipt` só procura mensagem por `external_message_id`, que não
 *     existe nesse estado; o callback tardio vira `message_not_found` e a
 *     intenção permanece presa para sempre;
 *  B. não existe função de reconciliação explícita para intenção órfã nem
 *     listagem de intenções reconciliáveis (crash entre envio e callback);
 *  C. não existe política/função testável de retenção (expiração de
 *     não-terminais, terminalização de `unknown` antigo, purge de terminais
 *     com tombstone);
 *  D. contraprova do que JÁ funciona: retry da mesma chave não reenvia.
 *
 * Veredito: DEFECT_REPRODUCED quando A/B/C confirmam a ausência (e D continua
 * sem reenvio cego). Roda pelo runner isolado; nunca no banco do host.
 */
import { randomUUID } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { sendOutboundMessage } from '../../../../modules/chat/src/application/use-cases/send-outbound-message.use-case';
import {
  setGatewayOutboundPort,
  resetGatewayOutboundPort,
} from '../../../../modules/chat/src/application/ports/gateway-outbound-registry';
import { createChatPorts } from '../../../../modules/chat/src/application/ports/chat-ports';
import { conversationRepository } from '../../../../modules/chat/src/infrastructure/repositories/conversation.repository';
import { outboundDeliveryRepository } from '../../../../modules/chat/src/infrastructure/repositories/outbound-delivery.repository';

const runId = process.env.AAA_RUN_ID ?? 'prod11-repro';
const prefix = `prod11-repro-${runId}-${randomUUID().slice(0, 8)}`;

async function main(): Promise<void> {
  const conversation = await conversationRepository.create({
    externalConversationId: `${prefix}-conv`,
    externalChannelId: 'whatsapp',
    status: 'open',
    isActive: true,
  });
  const conversationId = conversation.id;
  const report: Record<string, unknown> = { runId, prefix, conversationId };

  const ports = createChatPorts();

  // Cenário A — intenção ambígua + callback tardio não a resolve.
  {
    const key = `${prefix}-A`;
    let sends = 0;
    setGatewayOutboundPort({
      async sendOutbound() {
        sends += 1;
        return { success: false, error: 'gateway timeout após aceite', failureKind: 'unknown' } as never;
      },
    });

    const sent = await sendOutboundMessage({
      conversationId,
      content: 'repro A',
      recipient: '+5511900000811',
      idempotencyKey: key,
    });
    const messageId = sent.isOk() ? sent.value.messageId : null;
    const outcome = sent.isOk() ? sent.value.outcome : 'err';

    const [delivery] = await db
      .select()
      .from(schema.outboundDeliveries)
      .where(eq(schema.outboundDeliveries.clientKey, key));

    // O gateway "confirma" pelo id interno (event_id do DESK_OUTBOUND) — forma
    // usada pelo sandbox real do contrato; hoje applyReceipt nem chega a olhar
    // a intenção.
    const receipt = await ports.messageStatus.applyReceipt({
      externalMessageId: messageId ?? `${prefix}-missing`,
      status: 'delivered',
      statusAt: new Date(),
    });

    const [afterDelivery] = await db
      .select()
      .from(schema.outboundDeliveries)
      .where(eq(schema.outboundDeliveries.clientKey, key));
    const afterMessage = messageId
      ? await db.select().from(schema.messages).where(eq(schema.messages.id, messageId))
      : [];

    report.A_intencao_ambigua_callback = {
      sendOutcome: outcome,
      deliveryStatusBeforeReceipt: delivery?.status ?? null,
      deliveryStatusAfterReceipt: afterDelivery?.status ?? null,
      messageStatusAfterReceipt: afterMessage[0]?.status ?? null,
      receiptUpdated: receipt.updated,
      gatewaySends: sends,
      defect: delivery?.status === 'unknown_reconciling'
        && afterDelivery?.status === 'unknown_reconciling'
        && receipt.updated === false,
    };

    // Retry da mesma chave: não pode reenviar (contraprova D).
    const retry = await sendOutboundMessage({
      conversationId,
      content: 'repro A',
      recipient: '+5511900000811',
      idempotencyKey: key,
    });
    report.D_retry_sem_reenvio = {
      retryOutcome: retry.isOk() ? retry.value.outcome : 'err',
      retryDeduplicated: retry.isOk() ? retry.value.deduplicated : null,
      gatewaySends: sends,
      noBlindResend: sends === 1,
    };
  }

  // Cenário B — intenção órfã (crash entre persistência e callback): não há
  // função de reconciliação explícita nem listagem de reconciliáveis.
  {
    const key = `${prefix}-B`;
    setGatewayOutboundPort({
      async sendOutbound() {
        return { success: false, error: 'crash janela', failureKind: 'unknown' } as never;
      },
    });
    const sent = await sendOutboundMessage({
      conversationId,
      content: 'repro B',
      recipient: '+5511900000811',
      idempotencyKey: key,
    });
    const messageId = sent.isOk() ? sent.value.messageId : null;
    await db.execute(sql`
      UPDATE outbound_deliveries SET status = 'unknown_reconciling', reconciling_at = NOW()
       WHERE client_key = ${key}
    `);
    const repo = outboundDeliveryRepository as unknown as Record<string, unknown>;
    const reconcileFn = repo.reconcileOutboundReceiptFromCallback ?? repo.resolveOutboundReceipt;
    const listFn = repo.listOutboundIntentsForReconciliation ?? repo.findReconcilableOutboundIntents;
    const resolveFn = repo.resolveOutboundIntentExplicitly ?? repo.resolveOutboundIntentManually;
    const [orphanDelivery] = await db
      .select()
      .from(schema.outboundDeliveries)
      .where(eq(schema.outboundDeliveries.clientKey, key));
    report.B_orfa_sem_reconciliacao = {
      messageId,
      deliveryStatus: orphanDelivery?.status ?? null,
      hasReceiptReconciler: typeof reconcileFn === 'function',
      hasOrphanList: typeof listFn === 'function',
      hasExplicitResolve: typeof resolveFn === 'function',
      defect: typeof reconcileFn !== 'function' && typeof resolveFn !== 'function',
    };
  }

  // Cenário C — retenção sem política testável.
  {
    const key = `${prefix}-C`;
    setGatewayOutboundPort({
      async sendOutbound() {
        return { success: false, error: 'ambiguo', failureKind: 'unknown' } as never;
      },
    });
    const sent = await sendOutboundMessage({
      conversationId,
      content: 'repro C',
      recipient: '+5511900000811',
      idempotencyKey: key,
    });
    const messageId = sent.isOk() ? sent.value.messageId : null;
    await db.execute(sql`
      UPDATE outbound_deliveries
         SET status = 'unknown_reconciling', expires_at = NOW() - INTERVAL '2 days', reconciling_at = NOW() - INTERVAL '2 days'
       WHERE client_key = ${key}
    `);
    const repo = outboundDeliveryRepository as unknown as Record<string, unknown>;
    report.C_retencao_sem_politica = {
      messageId,
      hasExpireStale: typeof repo.expireStaleOutboundIntents === 'function',
      hasListExpired: typeof repo.listExpiredOutboundIntents === 'function',
      hasPurge: typeof repo.purgeTerminalOutboundDeliveries === 'function',
      unknownRetainedAfterTtl:
        (
          await db.select().from(schema.outboundDeliveries).where(eq(schema.outboundDeliveries.clientKey, key))
        )[0]?.status ?? null,
      defect:
        typeof repo.expireStaleOutboundIntents !== 'function'
        && typeof repo.purgeTerminalOutboundDeliveries !== 'function',
    };
  }

  // Cleanup do próprio run (não depende do teardown do runner).
  await cleanup([conversationId]);

  const defects = [
    report.A_intencao_ambigua_callback,
    report.B_orfa_sem_reconciliacao,
    report.C_retencao_sem_politica,
  ].map((item) => (item as { defect: boolean }).defect);
  const noBlindResend = (report.D_retry_sem_reenvio as { noBlindResend: boolean }).noBlindResend;
  report.verdict = defects.every(Boolean) && noBlindResend ? 'DEFECT_REPRODUCED' : 'NO_DEFECT_OBSERVED';
  console.log(JSON.stringify(report, null, 2));
  resetGatewayOutboundPort();
  process.exit(0);
}

async function cleanup(conversationIds: string[]): Promise<void> {
  if (conversationIds.length === 0) return;
  const messageIds = await db
    .select({ id: schema.messages.id })
    .from(schema.messages)
    .where(inArray(schema.messages.conversationId, conversationIds));
  const ids = messageIds.map((row) => row.id);
  if (ids.length > 0) {
    await db.delete(schema.outboundDeliveries).where(inArray(schema.outboundDeliveries.internalMessageId, ids));
    await db.delete(schema.outboxEvents).where(inArray(schema.outboxEvents.aggregateId, ids));
  }
  await db.delete(schema.messages).where(inArray(schema.messages.conversationId, conversationIds));
  await db
    .delete(schema.outboundIdempotencyTombstones)
    .where(inArray(schema.outboundIdempotencyTombstones.scopeConversationId, conversationIds));
  await db
    .delete(schema.conversationStatusHistory)
    .where(inArray(schema.conversationStatusHistory.conversationId, conversationIds));
  await db.delete(schema.conversations).where(inArray(schema.conversations.id, conversationIds));
}

main().catch(async (error) => {
  console.error('[prod-11 repro] falha:', error);
  process.exit(1);
});
