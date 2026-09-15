import { createHash } from 'node:crypto';
import { db, schema, type DatabaseExecutor } from '@cvg/database';
import { and, asc, eq, inArray, lte, or, sql } from 'drizzle-orm';
import { mapProviderReceiptStatus } from '@cvg/messaging-contracts';
import { messageRepository, type Message } from './message.repository';
import { OUTBOUND_TTL_EXPIRED_ERROR } from './outbound-atomic.repository';

export type OutboundDelivery = typeof schema.outboundDeliveries.$inferSelect;

export type FinalizeOutboundResult =
  | { status: 'sent'; providerMessageId?: string }
  | { status: 'failed'; error?: string }
  | { status: 'unknown_reconciling'; error?: string };

/** Estados em que a intenção ainda pode ser resolvida por callback/reconciliação. */
const NON_TERMINAL_DELIVERY_STATUSES = ['pending', 'accepted', 'unknown_reconciling'] as const;

/** Falha definitiva registrada quando uma intenção vence o TTL sem resolução. */
export const OUTBOUND_RECEIPT_FAILED_ERROR = 'provider_receipt_failed';
/** Causa registrada na resolução explícita de uma intenção órfã. */
export const OUTBOUND_EXPLICIT_FAILURE_DEFAULT = 'reconciliation_failed';

/**
 * Retenção de intenções/deliveries (PROD-11/AC4):
 *
 *  - intenção não-terminal (`pending`/`accepted`/`unknown_reconciling`) é
 *    RETIDA e reconciliável até `expires_at` (TTL de idempotência, 24h por
 *    padrão) — nada é apagado antes disso;
 *  - vencido o TTL, `expireStaleOutboundIntents` pode terminalizá-la como
 *    `failed` (`idempotency_ttl_expired`) por decisão explícita; a linha
 *    continua no banco (material do tombstone) até a janela de retenção;
 *  - `unknown_reconciling` NUNCA é elegível a purge, por mais antigo que seja,
 *    enquanto não for resolvida: é exatamente o estado que exige reconciliação;
 *  - deliveries terminais (`sent`/`failed`) com `expires_at` anterior ao
 *    limite de retenção podem ser removidas pelo purge; o trigger
 *    `archive_outbound_delivery_tombstone` preserva a chave usada (proibição
 *    de reenvio), e a mensagem permanece intacta (retenção de mensagens é
 *    política própria, D-B5).
 */
export const DEFAULT_OUTBOUND_INTENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Resultado de uma resolução de intenção (callback, confirmação ou manual). */
export interface OutboundReconciliationOutcome {
  found: boolean;
  /** `true` quando ESTA chamada fez a transição terminal. */
  resolved: boolean;
  /** `true` quando a intenção já estava terminal e nada foi reaplicado. */
  duplicate: boolean;
  deliveryId: string | null;
  messageId: string | null;
  deliveryStatus: string | null;
  messageStatus: string | null;
  providerMessageId: string | null;
  /** `true` quando um receipt apenas progrediu a mensagem (delivered). */
  messageProgressed?: boolean;
}

function presentOutcome(
  delivery: OutboundDelivery,
  message: Message | null,
  extra: Partial<OutboundReconciliationOutcome> = {},
): OutboundReconciliationOutcome {
  return {
    found: true,
    resolved: false,
    duplicate: false,
    deliveryId: delivery.id,
    messageId: message?.id ?? delivery.internalMessageId,
    deliveryStatus: delivery.status,
    messageStatus: message?.status ?? null,
    providerMessageId: delivery.providerMessageId ?? null,
    ...extra,
  };
}

/**
 * Lock de intenção: mesma chave do advisory lock transacional do caminho de
 * persistência (`persistOutboundIntentAtomically`) para que retry, callback e
 * resolução explícita serializem na MESMA intenção. Linhas legadas sem escopo
 * usam a chave pelo id da delivery (o caminho novo nem as cria).
 */
async function acquireIntentLock(tx: DatabaseExecutor, delivery: OutboundDelivery): Promise<void> {
  const lockKey = delivery.scopeActorId && delivery.scopeConversationId && delivery.clientKey
    ? JSON.stringify([delivery.scopeActorId, delivery.scopeConversationId, delivery.clientKey])
    : `outbound-delivery:${delivery.id}`;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
}

async function lockDeliveryRow(
  tx: DatabaseExecutor,
  deliveryId: string,
): Promise<OutboundDelivery | null> {
  const [row] = await tx
    .select()
    .from(schema.outboundDeliveries)
    .where(eq(schema.outboundDeliveries.id, deliveryId))
    .for('update');
  return row ?? null;
}

async function loadMessage(tx: DatabaseExecutor, messageId: string): Promise<Message | null> {
  return (await messageRepository.findById(messageId, tx)) ?? null;
}

function isTerminal(delivery: OutboundDelivery): boolean {
  return delivery.status === 'sent' || delivery.status === 'failed';
}

interface ApplyResolutionInput {
  status: 'sent' | 'failed';
  providerMessageId?: string | null;
  /** Progresso do receipt: `sent` ou `delivered` (read/played mapeiam delivered). */
  messageStatus?: 'sent' | 'delivered';
  statusAt?: Date;
  error?: string | null;
  externalMessageId?: string | null;
}

/**
 * Aplica a transição terminal em UMA transação (delivery + mensagem). O caller
 * já segura o lock da linha; aqui só a atualização atômica.
 */
async function applyResolution(
  tx: DatabaseExecutor,
  delivery: OutboundDelivery,
  input: ApplyResolutionInput,
): Promise<{ delivery: OutboundDelivery; message: Message | null }> {
  const providerMessageId = input.status === 'sent'
    ? input.providerMessageId ?? delivery.providerMessageId ?? null
    : delivery.providerMessageId ?? null;

  const [updatedDelivery] = await tx
    .update(schema.outboundDeliveries)
    .set({
      status: input.status,
      attemptCount: sql`${schema.outboundDeliveries.attemptCount} + 1`,
      lastAttemptAt: new Date(),
      lastError: input.status === 'sent' ? null : input.error ?? OUTBOUND_RECEIPT_FAILED_ERROR,
      reconcilingAt: null,
      ...(providerMessageId ? { providerMessageId } : {}),
    })
    .where(eq(schema.outboundDeliveries.id, delivery.id))
    .returning();

  const message = await loadMessage(tx, delivery.internalMessageId);
  let updatedMessage = message;
  if (message) {
    if (input.status === 'failed') {
      // Nunca regride uma entrega já confirmada para failed por receipt tardio.
      if (message.status !== 'delivered') {
        const [row] = await tx
          .update(schema.messages)
          .set({ status: 'failed' })
          .where(eq(schema.messages.id, message.id))
          .returning();
        updatedMessage = row ?? message;
      }
    } else {
      const targetStatus = input.messageStatus ?? 'sent';
      // Progresso monotônico: `delivered` nunca volta para `sent`.
      if (targetStatus === 'delivered' || message.status !== 'delivered') {
        const [row] = await tx
          .update(schema.messages)
          .set({
            status: targetStatus,
            ...(targetStatus === 'delivered' ? { deliveredAt: input.statusAt ?? new Date() } : {}),
            ...(input.externalMessageId && !message.externalMessageId
              ? { externalMessageId: input.externalMessageId }
              : {}),
          })
          .where(eq(schema.messages.id, message.id))
          .returning();
        updatedMessage = row ?? message;
      }
    }
  }

  return { delivery: updatedDelivery ?? delivery, message: updatedMessage };
}

/**
 * Superfície do mapping outbound após AAA-12/C04 + PROD-11/C05.
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
  /** Exposto para testes/composição conferirem o limite de retenção. */
  defaultIntentRetentionMs: DEFAULT_OUTBOUND_INTENT_RETENTION_MS,

  /**
   * Fecha a tentativa externa em UMA transação:
   *  - `sent`: mensagem `sent` (+ externalMessageId quando não colide) e
   *    mapping `sent`. Gateway aceitou, destinatário ainda não confirmou.
   *  - `failed`: falha definitiva do provider.
   *  - `unknown_reconciling`: resultado ambíguo (timeout/reset/5xx). A
   *    mensagem permanece `pending` e o mapping entra em reconciliação
   *    explícita; nenhum caminho faz retry cego deste estado.
   *
   * PROD-11/AC2: a transição é GUARDADA. Um callback de reconciliação pode
   * terminalizar a intenção antes de a resposta HTTP do provider chegar; nesse
   * caso `unknown_reconciling` (resultado ambíguo do envio) NÃO regride o
   * estado terminal — a corrida callback×envio converge para um único estado.
   * O retorno é o estado FINAL observado.
   */
  async finalizeDelivery(
    deliveryId: string,
    messageId: string,
    result: FinalizeOutboundResult,
  ): Promise<{ delivery: OutboundDelivery | null; message: Message | null; applied: boolean }> {
    let externalMessageId: string | undefined;
    if (result.status === 'sent' && result.providerMessageId) {
      const collision = await messageRepository.findByExternalId(result.providerMessageId);
      if (!collision || collision.id === messageId) {
        externalMessageId = result.providerMessageId;
      }
    }

    const apply = async (
      externalId?: string,
    ): Promise<{ delivery: OutboundDelivery | null; message: Message | null; applied: boolean }> => {
      return db.transaction(async (tx) => {
        const locked = await lockDeliveryRow(tx, deliveryId);
        if (!locked) return { delivery: null, message: null, applied: false };
        await acquireIntentLock(tx, locked);

        if (isTerminal(locked)) {
          // Callback/confirmação já resolveram: nunca regride para
          // unknown_reconciling nem reaplica efeito.
          const message = await loadMessage(tx, locked.internalMessageId);
          return { delivery: locked, message, applied: false };
        }

        if (result.status === 'sent') {
          const applied = await applyResolution(tx, locked, {
            status: 'sent',
            providerMessageId: result.providerMessageId,
            messageStatus: 'sent',
            externalMessageId: externalId,
          });
          return { ...applied, applied: true };
        }

        if (result.status === 'failed') {
          const applied = await applyResolution(tx, locked, {
            status: 'failed',
            error: result.error ?? OUTBOUND_RECEIPT_FAILED_ERROR,
          });
          return { ...applied, applied: true };
        }

        const [updated] = await tx
          .update(schema.outboundDeliveries)
          .set({
            status: 'unknown_reconciling',
            attemptCount: sql`${schema.outboundDeliveries.attemptCount} + 1`,
            lastAttemptAt: new Date(),
            lastError: result.error ?? 'resultado ambíguo do provider',
            reconcilingAt: new Date(),
          })
          .where(eq(schema.outboundDeliveries.id, deliveryId))
          .returning();
        // unknown_reconciling: a mensagem fica `pending` de propósito.
        const message = await loadMessage(tx, locked.internalMessageId);
        return { delivery: updated ?? locked, message, applied: true };
      });
    };

    try {
      return await apply(externalMessageId);
    } catch (error) {
      // Corrida no unique de external_message_id: o provider aceitou o envio;
      // fecha como `sent` sem o ID para não deixar a mensagem `pending`.
      if (externalMessageId && (error as { cause?: { code?: string } }).cause?.code === '23505') {
        return apply(undefined);
      }
      throw error;
    }
  },

  /**
   * PROD-11/AC2 — reconciliação por receipt do gateway (`/gateway/receipt`).
   *
   * A referência é casada, em ordem de precedência, com:
   *  1. `outbound_deliveries.provider_message_id` (id externo já conhecido);
   *  2. `messages.external_message_id`;
   *  3. `outbound_deliveries.internal_message_id` (gateway ecoa o `event_id`
   *     do DESK_OUTBOUND — único vínculo disponível quando o aceite remoto
   *     aconteceu, mas a resposta se perdeu antes de persistir o id externo);
   *  4. `messages.id` (mesmo eco, via FK).
   *
   * Receipt de sucesso (`sent`/`delivered`/`read`/`played`) resolve para
   * `sent`; `failed` resolve para `failed`; `delivered`/`read`/`played`
   * progridem a mensagem para `delivered`. Callback duplicado (ou posterior a
   * uma resolução manual) é no-op: a intenção é resolvida UMA única vez.
   */
  async reconcileOutboundReceiptFromCallback(input: {
    reference: string;
    status: 'sent' | 'delivered' | 'read' | 'played' | 'failed';
    statusAt?: Date;
  }): Promise<OutboundReconciliationOutcome> {
    const reference = input.reference.trim();
    if (!reference) {
      return {
        found: false,
        resolved: false,
        duplicate: false,
        deliveryId: null,
        messageId: null,
        deliveryStatus: null,
        messageStatus: null,
        providerMessageId: null,
      };
    }

    const [candidate] = await db
      .select({ delivery: schema.outboundDeliveries, message: schema.messages })
      .from(schema.outboundDeliveries)
      .innerJoin(schema.messages, eq(schema.outboundDeliveries.internalMessageId, schema.messages.id))
      .where(
        or(
          eq(schema.outboundDeliveries.providerMessageId, reference),
          eq(schema.messages.externalMessageId, reference),
          sql`${schema.outboundDeliveries.internalMessageId}::text = ${reference}`,
          sql`${schema.messages.id}::text = ${reference}`,
        ),
      )
      .orderBy(
        sql`CASE
              WHEN ${schema.outboundDeliveries.providerMessageId} = ${reference} THEN 0
              WHEN ${schema.messages.externalMessageId} = ${reference} THEN 1
              WHEN ${schema.outboundDeliveries.internalMessageId}::text = ${reference} THEN 2
              ELSE 3
            END`,
      )
      .limit(1);

    if (!candidate) {
      return {
        found: false,
        resolved: false,
        duplicate: false,
        deliveryId: null,
        messageId: null,
        deliveryStatus: null,
        messageStatus: null,
        providerMessageId: null,
      };
    }

    const mapped = mapProviderReceiptStatus(input.status);
    const statusAt = input.statusAt ?? new Date();

    const outcome = await db.transaction(async (tx) => {
      const locked = await lockDeliveryRow(tx, candidate.delivery.id);
      if (!locked) {
        return {
          found: false,
          resolved: false,
          duplicate: false,
          deliveryId: null,
          messageId: null,
          deliveryStatus: null,
          messageStatus: null,
          providerMessageId: null,
        };
      }
      await acquireIntentLock(tx, locked);
      const message = await loadMessage(tx, locked.internalMessageId);

      if (isTerminal(locked)) {
        // Duplicado/idempotente. Único efeito permitido: progresso monotônico
        // de entrega na mensagem (sent → delivered), e apenas quando a
        // intenção terminal é `sent` — um `failed` definitivo não é revertido
        // por receipt tardio (entrega/mensagem permanecem consistentes).
        if (locked.status === 'sent' && mapped === 'delivered' && message && message.status !== 'delivered') {
          const [progressed] = await tx
            .update(schema.messages)
            .set({ status: 'delivered', deliveredAt: statusAt })
            .where(eq(schema.messages.id, message.id))
            .returning();
          return presentOutcome(locked, progressed ?? message, {
            duplicate: true,
            messageProgressed: true,
          });
        }
        return presentOutcome(locked, message, { duplicate: true });
      }

      if (input.status === 'failed') {
        const applied = await applyResolution(tx, locked, {
          status: 'failed',
          error: OUTBOUND_RECEIPT_FAILED_ERROR,
          statusAt,
          externalMessageId: reference,
        });
        return presentOutcome(applied.delivery, applied.message, {
          resolved: true,
          providerMessageId: applied.delivery.providerMessageId ?? null,
        });
      }

      const applied = await applyResolution(tx, locked, {
        status: 'sent',
        providerMessageId: reference,
        messageStatus: mapped === 'delivered' ? 'delivered' : 'sent',
        statusAt,
        externalMessageId: reference,
      });
      return presentOutcome(applied.delivery, applied.message, {
        resolved: true,
        providerMessageId: applied.delivery.providerMessageId ?? null,
      });
    });

    if (outcome.resolved) {
      console.log(
        `[outbound-reconciliation] receipt resolved delivery=${outcome.deliveryId} ref=${outboundReferenceDigest(reference)} status=${outcome.deliveryStatus}`,
      );
    }
    return outcome;
  },

  /**
   * PROD-11/AC2/AC3 — resolução explícita de intenção órfã (sem callback):
   * confirmação do gateway (`POST /gateway/outbound/:id/sent`), operação
   * assistida ou falha terminal decidida com causa. Nunca envia nada ao
   * provider; é idempotente e converge com o callback por advisory lock.
   */
  async resolveOutboundIntentExplicitly(input: {
    deliveryId?: string;
    internalMessageId?: string;
    resolution: 'sent' | 'failed';
    externalMessageId?: string;
    reason?: string;
  }): Promise<OutboundReconciliationOutcome> {
    const delivery = input.deliveryId
      ? (
          await db
            .select()
            .from(schema.outboundDeliveries)
            .where(eq(schema.outboundDeliveries.id, input.deliveryId))
        )[0] ?? null
      : input.internalMessageId
        ? (
            await db
              .select()
              .from(schema.outboundDeliveries)
              .where(eq(schema.outboundDeliveries.internalMessageId, input.internalMessageId))
          )[0] ?? null
        : null;

    if (!delivery) {
      return {
        found: false,
        resolved: false,
        duplicate: false,
        deliveryId: null,
        messageId: null,
        deliveryStatus: null,
        messageStatus: null,
        providerMessageId: null,
      };
    }

    const outcome = await db.transaction(async (tx) => {
      const locked = await lockDeliveryRow(tx, delivery.id);
      if (!locked) {
        return {
          found: false,
          resolved: false,
          duplicate: false,
          deliveryId: null,
          messageId: null,
          deliveryStatus: null,
          messageStatus: null,
          providerMessageId: null,
        };
      }
      await acquireIntentLock(tx, locked);
      const message = await loadMessage(tx, locked.internalMessageId);

      if (isTerminal(locked)) {
        return presentOutcome(locked, message, { duplicate: true });
      }

      const applied = await applyResolution(tx, locked, {
        status: input.resolution,
        providerMessageId: input.resolution === 'sent' ? input.externalMessageId ?? null : null,
        messageStatus: 'sent',
        error: input.reason ?? OUTBOUND_EXPLICIT_FAILURE_DEFAULT,
        externalMessageId: input.externalMessageId ?? null,
      });
      return presentOutcome(applied.delivery, applied.message, {
        resolved: true,
        providerMessageId: applied.delivery.providerMessageId ?? null,
      });
    });

    if (outcome.resolved) {
      console.log(
        `[outbound-reconciliation] explicit resolved delivery=${outcome.deliveryId} status=${outcome.deliveryStatus}`,
      );
    }
    return outcome;
  },

  /**
   * Intenções que ainda exigem reconciliação (não-terminais), opcionalmente
   * mais antigas que `olderThanMs`. Leitura pura: nenhum efeito, nenhum envio.
   */
  async listOutboundIntentsForReconciliation(options: {
    olderThanMs?: number;
    limit?: number;
    now?: Date;
  } = {}): Promise<Array<OutboundDelivery & { ageMs: number; messageStatus: string | null }>> {
    const now = options.now ?? new Date();
    const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
    const cutoff = options.olderThanMs && options.olderThanMs > 0
      ? new Date(now.getTime() - options.olderThanMs)
      : undefined;

    const rows = await db
      .select({ delivery: schema.outboundDeliveries, messageStatus: schema.messages.status })
      .from(schema.outboundDeliveries)
      .innerJoin(schema.messages, eq(schema.outboundDeliveries.internalMessageId, schema.messages.id))
      .where(
        and(
          inArray(schema.outboundDeliveries.status, [...NON_TERMINAL_DELIVERY_STATUSES]),
          ...(cutoff ? [lte(schema.outboundDeliveries.createdAt, cutoff)] : []),
        ),
      )
      .orderBy(asc(schema.outboundDeliveries.createdAt))
      .limit(limit);

    return rows.map(({ delivery, messageStatus }) => ({
      ...delivery,
      ageMs: now.getTime() - delivery.createdAt.getTime(),
      messageStatus: messageStatus ?? null,
    }));
  },

  /** Não-terminais com TTL vencido (candidatas à terminalização explícita). */
  async listExpiredOutboundIntents(options: { now?: Date; limit?: number } = {}): Promise<OutboundDelivery[]> {
    const now = options.now ?? new Date();
    const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
    return db
      .select()
      .from(schema.outboundDeliveries)
      .where(
        and(
          inArray(schema.outboundDeliveries.status, [...NON_TERMINAL_DELIVERY_STATUSES]),
          lte(schema.outboundDeliveries.expiresAt, now),
        ),
      )
      .orderBy(asc(schema.outboundDeliveries.expiresAt))
      .limit(limit);
  },

  /**
   * Terminaliza intenções não-terminais vencidas como `failed`
   * (`idempotency_ttl_expired`), preservando a linha (nada é apagado antes da
   * retenção) e a mensagem `pending` vira `failed`. Dry-run por padrão.
   */
  async expireStaleOutboundIntents(options: { now?: Date; limit?: number; apply?: boolean } = {}): Promise<{
    candidates: OutboundDelivery[];
    applied: number;
  }> {
    const candidates = await outboundDeliveryRepository.listExpiredOutboundIntents(options);
    if (options.apply !== true || candidates.length === 0) {
      return { candidates, applied: 0 };
    }

    const ids = candidates.map((candidate) => candidate.id);
    const applied = await db.transaction(async (tx) => {
      const expired = await tx
        .update(schema.outboundDeliveries)
        .set({
          status: 'failed',
          lastError: OUTBOUND_TTL_EXPIRED_ERROR,
          reconcilingAt: null,
        })
        .where(
          and(
            inArray(schema.outboundDeliveries.id, ids),
            inArray(schema.outboundDeliveries.status, [...NON_TERMINAL_DELIVERY_STATUSES]),
          ),
        )
        .returning({ id: schema.outboundDeliveries.id, internalMessageId: schema.outboundDeliveries.internalMessageId });

      if (expired.length > 0) {
        await tx
          .update(schema.messages)
          .set({ status: 'failed' })
          .where(
            and(
              inArray(schema.messages.id, expired.map((row) => row.internalMessageId)),
              eq(schema.messages.status, 'pending'),
            ),
          );
      }
      return expired.length;
    });

    return { candidates, applied };
  },

  /**
   * Purge de deliveries TERMINAIS antigas (dry-run por padrão). Exclui
   * explicitamente `unknown_reconciling` e qualquer estado não-terminal, por
   * mais antigos que sejam: estado necessário à reconciliação nunca é apagado.
   * O trigger de tombstone preserva a chave (proibição de reenvio); mensagens
   * não são tocadas.
   */
  async purgeTerminalOutboundDeliveries(options: {
    olderThan?: Date;
    limit?: number;
    apply?: boolean;
  } = {}): Promise<{ candidates: OutboundDelivery[]; deleted: number }> {
    const olderThan = options.olderThan
      ?? new Date(Date.now() - DEFAULT_OUTBOUND_INTENT_RETENTION_MS);
    const limit = Math.max(1, Math.min(options.limit ?? 100, 500));

    const candidates = await db
      .select()
      .from(schema.outboundDeliveries)
      .where(
        and(
          inArray(schema.outboundDeliveries.status, ['sent', 'failed']),
          lte(schema.outboundDeliveries.expiresAt, olderThan),
        ),
      )
      .orderBy(asc(schema.outboundDeliveries.expiresAt))
      .limit(limit);

    if (options.apply !== true || candidates.length === 0) {
      return { candidates, deleted: 0 };
    }

    const ids = candidates.map((candidate) => candidate.id);
    const deleted = await db.transaction(async (tx) => {
      const removed = await tx
        .delete(schema.outboundDeliveries)
        .where(
          and(
            inArray(schema.outboundDeliveries.id, ids),
            inArray(schema.outboundDeliveries.status, ['sent', 'failed']),
          ),
        )
        .returning({ id: schema.outboundDeliveries.id });
      return removed.length;
    });

    return { candidates, deleted };
  },
};

/** Fingerprint estável para logs de reconciliação (nunca conteúdo/PII). */
export function outboundReferenceDigest(reference: string): string {
  return createHash('sha256').update(reference).digest('hex').slice(0, 16);
}
