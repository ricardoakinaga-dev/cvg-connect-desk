import { conversationRepository } from '../../infrastructure/repositories/conversation.repository';
import { messageRepository } from '../../infrastructure/repositories/message.repository';
import { ok, err, type Result } from '@cvg/shared';
import { NotFoundError, BadRequestError } from '@cvg/shared';
import { publishMessagePersisted } from '../events/chat-publisher';
import { createAuditLog } from '@cvg/audit';
import { getOutboundDeliveryService } from '../outbound-delivery';

export interface SendOutboundMessageInput {
  conversationId: string;
  content: string;
  recipient: string;
  sender?: string;
  senderType?: 'human' | 'bot' | 'system';
  // Media fields
  mediaUrl?: string;
  mediaType?: string; // 'image', 'audio', 'video', 'document'
  latitude?: number;
  longitude?: number;
  mediaMimetype?: string;
  mediaFilename?: string;
  metadata?: Record<string, unknown>;
  userId?: string;
}

export interface SendOutboundMessageOutput {
  messageId: string;
  conversationId: string;
  status: string;
}

export async function sendOutboundMessage(
  input: SendOutboundMessageInput
): Promise<Result<SendOutboundMessageOutput, NotFoundError | BadRequestError>> {
  try {
    if (!input.recipient) {
      return err(new BadRequestError('Recipient is required'));
    }

    // Texto ou mídia é obrigatório
    if (!input.content && !input.mediaUrl && !input.mediaType) {
      return err(new BadRequestError('Content or media is required'));
    }

    // Validação específica para localização
    if (input.mediaType === 'location') {
      if (typeof input.latitude !== 'number' || typeof input.longitude !== 'number') {
        return err(new BadRequestError('Latitude and longitude are required for location media type'));
      }
    }

    const conversation = await conversationRepository.findById(input.conversationId);
    if (!conversation) {
      return err(new NotFoundError('Conversation not found'));
    }

    if (!conversation.isActive) {
      return err(new BadRequestError('Cannot send message to closed conversation'));
    }

    // Criar mensagem no banco
    const message = await messageRepository.create({
      conversationId: input.conversationId,
      direction: 'outbound',
      content: input.content || '',
      recipient: input.recipient,
      sender: input.sender,
      senderType: input.senderType || 'human',
      status: 'pending',
      // Media fields
      mediaUrl: input.mediaUrl,
      mediaType: input.mediaType,
      mediaMimetype: input.mediaMimetype,
      mediaFilename: input.mediaFilename,
      metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
    });

    // Enviar via Evolution API (assíncrono)
    sendViaEvolution(input.recipient, input).catch(err => {
      console.error('[sendOutboundMessage] Erro ao enviar via Evolution:', err);
    });

    await publishMessagePersisted(message);

    // Audit
    if (input.userId) {
      await createAuditLog({
        userId: input.userId,
        action: input.mediaType ? `message.outbound.${input.mediaType}` : 'message.outbound.sent',
        entityType: 'message',
        entityId: message.id,
        newValue: { content: input.content, recipient: input.recipient, mediaType: input.mediaType },
        metadata: { conversationId: input.conversationId },
      });
    }

    return ok({
      messageId: message.id,
      conversationId: message.conversationId,
      status: message.status,
    });
  } catch (error) {
    return err(new BadRequestError(error instanceof Error ? error.message : 'Failed to send outbound message'));
  }
}

/**
 * Envia mensagem via Evolution API de forma assíncrona.
 */
async function sendViaEvolution(recipient: string, input: SendOutboundMessageInput) {
  try {
    const deliveryService = getOutboundDeliveryService();
    if (!deliveryService) {
      console.warn('[sendViaEvolution] Outbound delivery service not configured');
      return;
    }
    const phone = recipient.replace(/@.*$/, '').replace(/\D/g, '');

    const result = await deliveryService.send({
      ...input,
      recipient: phone,
      content: input.mediaType === 'location' ? formatLocationMessage(input) : input.content,
    });

    if (result.success) {
      console.log(`[sendViaEvolution] Mensagem enviada: ${result.messageId}`);
    } else {
      console.error(`[sendViaEvolution] Falha: ${result.error}`);
    }
  } catch (error) {
    console.error('[sendViaEvolution] Erro:', error);
  }
}

function formatLocationMessage(input: SendOutboundMessageInput): string {
  const lat = input.latitude as number;
  const lng = input.longitude as number;
  const coordinates = `${lat.toFixed(6)},${lng.toFixed(6)}`;

  if (input.content?.trim()) {
    return `[Localização] ${input.content} (${coordinates})`;
  }

  return `[Localização] ${coordinates}`;
}
