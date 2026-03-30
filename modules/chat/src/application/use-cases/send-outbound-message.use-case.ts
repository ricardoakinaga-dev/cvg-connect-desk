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
  metadata?: Record<string, unknown>;
  userId?: string; // Para auditoria
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
    if (!input.content || !input.recipient) {
      return err(new BadRequestError('Content and recipient are required'));
    }

    const conversation = await conversationRepository.findById(input.conversationId);
    if (!conversation) {
      return err(new NotFoundError('Conversation not found'));
    }

    if (!conversation.isActive) {
      return err(new BadRequestError('Cannot send message to closed conversation'));
    }

    const message = await messageRepository.create({
      conversationId: input.conversationId,
      direction: 'outbound',
      content: input.content,
      recipient: input.recipient,
      sender: input.sender,
      status: 'pending',
      metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
    });

    await publishMessagePersisted(message);

    // Audit: registrar envio de mensagem outbound
    if (input.userId) {
      await createAuditLog({
        userId: input.userId,
        action: 'message.outbound.sent',
        entityType: 'message',
        entityId: message.id,
        newValue: { content: input.content, recipient: input.recipient },
        metadata: {
          conversationId: input.conversationId,
        },
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
