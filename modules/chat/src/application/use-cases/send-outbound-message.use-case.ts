import { conversationRepository } from '../../infrastructure/repositories/conversation.repository';
import { messageRepository } from '../../infrastructure/repositories/message.repository';
import { outboundDeliveryRepository } from '../../infrastructure/repositories/outbound-delivery.repository';
import { ok, err, type Result } from '@cvg/shared';
import { NotFoundError, BadRequestError, validateMedia, safeFilename } from '@cvg/shared';
import { publishMessagePersisted } from '../events/chat-publisher';
import { createAuditLog } from '@cvg/audit';

export interface SendOutboundMessageInput {
  conversationId: string;
  content: string;
  recipient?: string;
  sender?: string;
  senderType?: 'human' | 'bot' | 'system';
  instance?: string;
  // Media fields
  mediaUrl?: string;
  mediaType?: string; // 'image', 'audio', 'video', 'document'
  mediaMimetype?: string;
  mediaFilename?: string;
  metadata?: Record<string, unknown>;
  userId?: string;
  /** Idempotency-Key (header) ou clientMessageId (body). Sem chave, cada request é nova. */
  idempotencyKey?: string;
}

export interface SendOutboundMessageOutput {
  messageId: string;
  conversationId: string;
  status: string;
  deduplicated: boolean;
}

export async function sendOutboundMessage(
  input: SendOutboundMessageInput
): Promise<Result<SendOutboundMessageOutput, NotFoundError | BadRequestError>> {
  try {
    // Texto ou mídia é obrigatório
    if (!input.content && !input.mediaUrl) {
      return err(new BadRequestError('Content or media is required'));
    }

    if (input.mediaUrl || input.mediaType || input.mediaMimetype) {
      const check = validateMedia({
        mediaType: input.mediaType,
        mimetype: input.mediaMimetype,
        url: input.mediaUrl,
      });
      if (!check.ok) {
        return err(new BadRequestError(check.message || 'Invalid media'));
      }
      if (input.mediaFilename) {
        input.mediaFilename = safeFilename(input.mediaFilename);
      }

      // Pipeline profundo (Final-3/4, opt-in): escaneia bytes embarcados
      // (data-URLs do composer) antes de encaminhar ao provider.
      if (
        input.mediaUrl?.startsWith('data:') &&
        (process.env.MEDIA_PIPELINE_ENABLED || '').toLowerCase() === 'true'
      ) {
        const { processInboundMedia } = await import('@cvg/media');
        const scanned = await processInboundMedia({
          mediaType: input.mediaType,
          mimetype: input.mediaMimetype,
          filename: input.mediaFilename,
          url: input.mediaUrl,
        });
        if (scanned.blocked) {
          return err(new BadRequestError(scanned.reason || 'Media blocked by security pipeline'));
        }
      }
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

    const idempotencyKey = input.idempotencyKey?.trim() || undefined;

    // Dedup prévio: chave já vista retorna a mensagem original (sem side effects).
    if (idempotencyKey) {
      const existing = await outboundDeliveryRepository.findByKey(idempotencyKey);
      if (existing) {
        const original = await messageRepository.findById(existing.internalMessageId);
        if (original) {
          return ok({
            messageId: original.id,
            conversationId: original.conversationId,
            status: original.status,
            deduplicated: true,
          });
        }
      }
    }

    // Criar mensagem no banco
    const message = await messageRepository.create({
      conversationId: input.conversationId,
      direction: 'outbound',
      senderType: input.senderType || 'human',
      content: input.content || '',
      recipient,
      sender: input.sender,
      status: 'pending',
      // Media fields
      mediaUrl: input.mediaUrl,
      mediaType: input.mediaType,
      mediaMimetype: input.mediaMimetype,
      mediaFilename: input.mediaFilename,
      metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
    });

    let deliveryId: string | undefined;
    if (idempotencyKey) {
      const { delivery, isDuplicate } = await outboundDeliveryRepository.createMapping({
        internalMessageId: message.id,
        idempotencyKey,
      });
      deliveryId = delivery.id;
      if (isDuplicate) {
        // Corrida perdida: outro request venceu; retornar o original.
        const original = await messageRepository.findById(delivery.internalMessageId);
        if (original) {
          return ok({
            messageId: original.id,
            conversationId: original.conversationId,
            status: original.status,
            deduplicated: true,
          });
        }
      }
    }

    // O Desk nunca fala diretamente com a Evolution: entrega ao Gateway, que
    // persiste uma intenção idempotente e só então chama o provider.
    await sendViaGateway(recipient, input, { messageId: message.id, deliveryId });

    await publishMessagePersisted(message);

    // Audit
    if (input.userId) {
      await createAuditLog({
        userId: input.userId,
        action: input.mediaType ? `message.outbound.${input.mediaType}` : 'message.outbound.sent',
        entityType: 'message',
        entityId: message.id,
        newValue: { content: input.content, recipient, mediaType: input.mediaType },
        metadata: { conversationId: input.conversationId },
      });
    }

    return ok({
      messageId: message.id,
      conversationId: message.conversationId,
      status: (await messageRepository.findById(message.id))?.status || message.status,
      deduplicated: false,
    });
  } catch (error) {
    return err(error as Error);
  }
}

/**
 * Entrega mensagem ao Gateway, com reconciliação:
 * atualiza messages.status (sent/failed) e o mapping de idempotência, de modo
 * que a mensagem nunca fique em `pending` para sempre sem explicação.
 */
async function sendViaGateway(
  recipient: string,
  input: SendOutboundMessageInput,
  ids: { messageId: string; deliveryId?: string },
) {
  try {
    const { gatewayService } = await import('@cvg/gateway-adapter');
    const result = await gatewayService.sendOutbound({
      messageId: ids.messageId,
      conversationId: input.conversationId,
      externalPhone: recipient,
      content: input.content,
      instance: input.instance,
      senderName: input.sender,
      senderType: input.senderType === 'bot' ? 'bot' : input.senderType === 'system' ? 'system' : 'agent',
      attachmentUrl: input.mediaUrl,
    });

    if (result.success) {
      try {
        await messageRepository.update(ids.messageId, {
          status: 'sent',
          ...(result.messageId ? { externalMessageId: result.messageId } : {}),
        });
      } catch {
        // Provider confirmou o envio mas o ID externo colidiu (unique):
        // marcar como enviada sem o ID para não ficar `pending` para sempre.
        await messageRepository.update(ids.messageId, { status: 'sent' });
      }
    } else {
      await messageRepository.update(ids.messageId, { status: 'failed' });
    }

    if (ids.deliveryId) {
      await outboundDeliveryRepository.recordAttempt(ids.deliveryId, {
        success: result.success,
        providerMessageId: result.messageId,
      });
    }

    if (result.success) {
      console.log(`[sendViaGateway] Mensagem aceita: ${result.messageId}`);
    } else {
      console.error(`[sendViaGateway] Falha: ${result.error}`);
    }
  } catch (error) {
    try {
      await messageRepository.update(ids.messageId, { status: 'failed' });
      if (ids.deliveryId) {
        await outboundDeliveryRepository.recordAttempt(ids.deliveryId, { success: false });
      }
    } catch {
      // Reconciliação é best-effort; o erro original prevalece no log.
    }
    console.error('[sendViaGateway] Erro:', error);
  }
}
