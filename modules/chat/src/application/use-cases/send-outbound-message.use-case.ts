import { conversationRepository } from '../../infrastructure/repositories/conversation.repository';
import { messageRepository } from '../../infrastructure/repositories/message.repository';
import { ok, err, type Result } from '@cvg/shared';
import { NotFoundError, BadRequestError } from '@cvg/shared';
import { publishMessagePersisted } from '../events/chat-publisher';
import { createAuditLog } from '@cvg/audit';

export interface SendOutboundMessageInput {
  conversationId: string;
  content: string;
  recipient: string;
  sender?: string;
  // Media fields
  mediaUrl?: string;
  mediaType?: string; // 'image', 'audio', 'video', 'document'
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
    if (!input.content && !input.mediaUrl) {
      return err(new BadRequestError('Content or media is required'));
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
    return err(error as Error);
  }
}

/**
 * Envia mensagem via Evolution API de forma assíncrona.
 */
async function sendViaEvolution(recipient: string, input: SendOutboundMessageInput) {
  try {
    // Extrair telefone do recipient (pode ser JID ou telefone puro)
    const phone = recipient.replace(/@.*$/, '').replace(/\D/g, '');

    // Importar media service do gateway adapter
    const { mediaService } = await import('@cvg/gateway-adapter');

    let result: { success: boolean; messageId?: string; error?: string };

    if (input.mediaUrl && input.mediaType === 'image') {
      result = await mediaService.sendImage(phone, input.mediaUrl, input.content);
    } else if (input.mediaUrl && input.mediaType === 'audio') {
      result = await mediaService.sendAudio(phone, input.mediaUrl);
    } else if (input.mediaUrl && input.mediaType === 'document') {
      result = await mediaService.sendDocument(phone, input.mediaUrl, input.mediaFilename);
    } else {
      // Texto simples
      result = await mediaService.sendText(phone, input.content);
    }

    if (result.success) {
      console.log(`[sendViaEvolution] Mensagem enviada: ${result.messageId}`);
    } else {
      console.error(`[sendViaEvolution] Falha: ${result.error}`);
    }
  } catch (error) {
    console.error('[sendViaEvolution] Erro:', error);
  }
}
