import { randomUUID } from 'node:crypto';
import { conversationRepository } from '../../infrastructure/repositories/conversation.repository';
import { messageRepository } from '../../infrastructure/repositories/message.repository';
import { outboundDeliveryRepository } from '../../infrastructure/repositories/outbound-delivery.repository';
import {
  computeOutboundFingerprint,
  persistOutboundIntentAtomically,
  deriveOutboundOutcome,
  resolveOutboundIdempotencyTtlMs,
  type OutboundOutcome,
} from '../../infrastructure/repositories/outbound-atomic.repository';
import { ok, err, type Result } from '@cvg/shared';
import { NotFoundError, BadRequestError, ConflictError, ForbiddenError, safeFilename, mediaKindForMime } from '@cvg/shared';
import { createAuditLog } from '@cvg/audit';
import { getGatewayOutboundPort, type ChatGatewayOutboundPort } from '../ports/gateway-outbound-registry';

export interface SendOutboundMessageInput {
  conversationId: string;
  content: string;
  recipient?: string;
  sender?: string;
  senderType?: 'human' | 'bot' | 'system';
  instance?: string;
  // Media fields
  /** C05: referência autorizada obtida no upload dedicado (nunca origem arbitrária). */
  mediaAssetId?: string;
  mediaUrl?: string;
  mediaType?: string; // 'image', 'audio', 'video', 'document'
  mediaMimetype?: string;
  mediaFilename?: string;
  metadata?: Record<string, unknown>;
  userId?: string;
  /** Roles do principal autenticado (autorização de asset/conversa). */
  roles?: string[];
  /** Idempotency-Key (header) ou clientMessageId (body). Sem chave, cada request é uma nova intenção. */
  idempotencyKey?: string;
}

export interface SendOutboundMessageOutput {
  messageId: string;
  conversationId: string;
  /** Status persistido da mensagem (pending/sent/delivered/failed). */
  status: string;
  /** C04: aceito/pending/sent/failed/unknown-reconciling. */
  outcome: OutboundOutcome;
  deduplicated: boolean;
  /** true quando o TTL da chave venceu: nunca há reenvio silencioso. */
  expired?: boolean;
}

export async function sendOutboundMessage(
  input: SendOutboundMessageInput
): Promise<Result<SendOutboundMessageOutput, NotFoundError | BadRequestError | ConflictError | ForbiddenError | Error>> {
  try {
    // Texto ou mídia é obrigatório
    if (!input.content && !input.mediaUrl && !input.mediaAssetId) {
      return err(new BadRequestError('Content or media is required'));
    }

    // C05: mídia só entra por referência a asset autorizado (upload dedicado).
    // URL remota/data-URL arbitrária nunca é encaminhada ao provider.
    let mediaDeliveryUrl: string | undefined;
    let mediaType = input.mediaType;
    let mediaMimetype = input.mediaMimetype;
    let mediaFilename = input.mediaFilename ? safeFilename(input.mediaFilename) : undefined;
    let persistedMediaUrl = input.mediaUrl;

    if (input.mediaAssetId) {
      if (input.mediaUrl) {
        return err(new BadRequestError(
          'Envio referenciando asset não aceita mediaUrl paralela',
          'MEDIA_URL_NOT_ALLOWED',
        ));
      }
      const { resolveDeliverableAsset } = await import('@cvg/media');
      const resolution = await resolveDeliverableAsset({
        assetId: input.mediaAssetId.trim(),
        conversationId: input.conversationId,
      });
      if (!resolution.ok) {
        if (resolution.reason === 'asset_not_found') {
          return err(new NotFoundError('Media asset não encontrado', 'MEDIA_ASSET_NOT_FOUND'));
        }
        if (resolution.reason === 'wrong_conversation') {
          return err(new ForbiddenError('Media asset não pertence a esta conversa', 'MEDIA_ASSET_FORBIDDEN'));
        }
        return err(new ConflictError(
          `Media asset não está CLEAN (${resolution.scanStatus ?? 'PENDING_SCAN'}); entrega bloqueada`,
          'MEDIA_ASSET_NOT_CLEAN',
        ));
      }
      mediaDeliveryUrl = resolution.signedUrl;
      mediaMimetype = resolution.asset.mimeType ?? mediaMimetype;
      mediaType = mediaType || mediaKindForMime(mediaMimetype);
      mediaFilename = mediaFilename || (resolution.asset.filename ? safeFilename(resolution.asset.filename) : undefined);
      persistedMediaUrl = `asset://${resolution.asset.id}`;
    } else if (input.mediaUrl || input.mediaType || input.mediaMimetype || input.mediaFilename) {
      return err(new BadRequestError(
        'Envio de mídia exige mediaAssetId obtido no upload dedicado (URL/data-URL arbitrária não é aceita)',
        'MEDIA_ASSET_REQUIRED',
      ));
    }

    const conversation = await conversationRepository.findById(input.conversationId);
    if (!conversation) {
      return err(new NotFoundError('Conversation not found'));
    }

    if (!conversation.isActive) {
      return err(new BadRequestError('Cannot send message to closed conversation'));
    }

    // Conversas originadas por webhook ainda podem não possuir contactId.
    // Nesse caso, o remetente inbound persistido é a fonte de verdade para o
    // destino da resposta. Mantém compatibilidade com clientes web antigos.
    const recipient = input.recipient?.trim()
      || await messageRepository.findLatestInboundSender(input.conversationId);
    if (!recipient) {
      return err(new BadRequestError('Recipient is required'));
    }

    // C02 §5, invariante 6: composição ausente falha alto e explícito, antes de
    // qualquer escrita — nenhuma mensagem fica sem provider.
    const gateway = getGatewayOutboundPort();
    const providerIdempotent = gateway.providerSupportsIdempotency?.() ?? true;

    // C04: chave estável por intenção. Sem chave do cliente, a intenção recebe
    // uma chave sintética de uso único (não deduplica requests distintos).
    const idempotencyKey = input.idempotencyKey?.trim() || `auto:${randomUUID()}`;
    const payloadFingerprint = computeOutboundFingerprint({
      conversationId: input.conversationId,
      content: input.content || '',
      recipient,
      sender: input.sender,
      senderType: input.senderType || 'human',
      instance: input.instance,
      mediaUrl: persistedMediaUrl,
      mediaType,
      mediaMimetype,
      mediaFilename,
      metadata: input.metadata,
    });

    // C03 D-C03-1: mensagem + mapping + intenção de outbox na MESMA transação.
    const persisted = await persistOutboundIntentAtomically({
      actorId: input.userId?.trim() || 'anonymous',
      idempotencyKey,
      payloadFingerprint,
      ttlMs: resolveOutboundIdempotencyTtlMs(),
      providerIdempotent,
      message: {
        conversationId: input.conversationId,
        content: input.content || '',
        recipient,
        sender: input.sender,
        senderType: input.senderType || 'human',
        mediaUrl: persistedMediaUrl,
        mediaType,
        mediaMimetype,
        mediaFilename,
        metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
      },
    });

    if (persisted.kind === 'conflict') {
      const message = persisted.reason === 'key_archived'
        ? 'Idempotency-Key arquivada após exclusão da mensagem; a chave não é reenviada'
        : persisted.reason === 'fingerprint_missing'
          ? 'Idempotency-Key existente sem fingerprint verificável; reconciliação explícita necessária'
          : 'Idempotency-Key reutilizada com payload incompatível';
      return err(new ConflictError(message, 'IDEMPOTENCY_KEY_CONFLICT'));
    }

    if (persisted.kind === 'duplicate') {
      // Mesma intenção: devolve o resultado original; NUNCA um segundo envio.
      return ok({
        messageId: persisted.message.id,
        conversationId: persisted.message.conversationId,
        status: persisted.message.status,
        outcome: deriveOutboundOutcome(persisted.delivery, persisted.message),
        deduplicated: true,
        ...(persisted.expired ? { expired: true } : {}),
      });
    }

    const delivery = await deliverOutbound(gateway, input, recipient, {
      messageId: persisted.message.id,
      deliveryId: persisted.delivery.id,
    }, mediaDeliveryUrl);

    // Audit minimizado (C07/AAA-17): não copia conteúdo nem destinatário
    // (PII). A mensagem de origem permanece a única cópia do conteúdo.
    if (input.userId) {
      await createAuditLog({
        userId: input.userId,
        action: mediaType ? `message.outbound.${mediaType}` : 'message.outbound.sent',
        entityType: 'message',
        entityId: persisted.message.id,
        metadata: {
          conversationId: input.conversationId,
          contentLength: (input.content || '').length,
          hasMedia: Boolean(mediaType),
        },
      });
    }

    return ok({
      messageId: persisted.message.id,
      conversationId: persisted.message.conversationId,
      status: delivery.status,
      outcome: delivery.outcome,
      deduplicated: false,
    });
  } catch (error) {
    // Erro de composição/operação preserva a mensagem original para chamadas
    // diretas; o controller mantém o 500 genérico para erros não-AppError.
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Entrega ao Gateway com estado explícito. Sucesso ⇒ `accepted` (o aceite do
 * Gateway NÃO significa entrega ao destinatário). Resultado ambíguo (timeout,
 * reset, 5xx ou exceção) ⇒ `unknown_reconciling`: a intenção pode ter sido
 * aceita pelo provider e só sai desse estado por reconciliação explícita.
 */
async function deliverOutbound(
  gateway: ChatGatewayOutboundPort,
  input: SendOutboundMessageInput,
  recipient: string,
  ids: { messageId: string; deliveryId: string },
  mediaDeliveryUrl?: string,
): Promise<{ outcome: OutboundOutcome; status: string }> {
  let result: { success: boolean; messageId?: string; error?: string; failureKind?: 'definitive' | 'unknown' };
  try {
    result = (await gateway.sendOutbound({
      messageId: ids.messageId,
      conversationId: input.conversationId,
      externalPhone: recipient,
      content: input.content,
      instance: input.instance,
      senderName: input.sender,
      senderType: input.senderType === 'bot' ? 'bot' : input.senderType === 'system' ? 'system' : 'agent',
      attachmentUrl: mediaDeliveryUrl,
    })) as typeof result;
  } catch (error) {
    result = {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      failureKind: 'unknown',
    };
  }

  if (result.success) {
    await outboundDeliveryRepository.finalizeDelivery(ids.deliveryId, ids.messageId, {
      status: 'sent',
      providerMessageId: result.messageId,
    });
    console.log(`[deliverOutbound] Mensagem aceita pelo gateway: ${result.messageId}`);
    return { outcome: 'accepted', status: 'sent' };
  }

  // Somente uma rejeição EXPLÍCITA do provider vira `failed`; qualquer outra
  // falha é ambígua por definição (C04) e entra em reconciliação.
  if (result.failureKind === 'definitive') {
    await outboundDeliveryRepository.finalizeDelivery(ids.deliveryId, ids.messageId, {
      status: 'failed',
      error: result.error,
    });
    console.error(`[deliverOutbound] Falha definitiva: ${result.error}`);
    return { outcome: 'failed', status: 'failed' };
  }

  await outboundDeliveryRepository.finalizeDelivery(ids.deliveryId, ids.messageId, {
    status: 'unknown_reconciling',
    error: result.error || 'resultado ambíguo do provider',
  });
  console.error(`[deliverOutbound] Resultado ambíguo (reconciliação explícita): ${result.error}`);
  return { outcome: 'unknown_reconciling', status: 'pending' };
}
