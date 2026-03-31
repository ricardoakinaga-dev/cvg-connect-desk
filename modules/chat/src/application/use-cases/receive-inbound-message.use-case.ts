import { conversationRepository } from '../../infrastructure/repositories/conversation.repository';
import { messageRepository } from '../../infrastructure/repositories/message.repository';
import { ok, err, type Result } from '@cvg/shared';
import { BadRequestError } from '@cvg/shared';
import { publishMessagePersisted, publishConversationCreated } from '../events/chat-publisher';
import { processMessageWithSecretary, type ProcessMessageWithSecretaryOutput } from './process-message-with-secretary.use-case';
import { triggerHandoff } from '@cvg/secretary-adapter';
import { createAuditLog } from '@cvg/audit';

export interface ReceiveInboundMessageInput {
  externalMessageId: string;
  externalConversationId?: string;
  content: string;
  sender: string;
  senderType?: 'contact' | 'system' | 'unknown';
  contactPhone?: string;
  contactName?: string;
  sentAt?: Date;
  // Media fields
  mediaUrl?: string;
  mediaType?: string;
  mediaMimetype?: string;
  mediaFilename?: string;
  metadata?: Record<string, unknown>;
  userId?: string; // Para auditoria (null para webhook externo)
}

export interface ReceiveInboundMessageOutput {
  messageId: string;
  conversationId: string;
  isNewConversation: boolean;
}

export async function receiveInboundMessage(
  input: ReceiveInboundMessageInput
): Promise<Result<ReceiveInboundMessageOutput, BadRequestError>> {
  try {
    if (!input.content || !input.sender) {
      return err(new BadRequestError('Content and sender are required'));
    }

    const existingMessage = await messageRepository.findByExternalId(input.externalMessageId);
    if (existingMessage) {
      return ok({
        messageId: existingMessage.id,
        conversationId: existingMessage.conversationId,
        isNewConversation: false,
      });
    }

    let conversationId: string;
    let isNewConversation = false;

    if (input.externalConversationId) {
      const existingConversation = await conversationRepository.findByExternalId(input.externalConversationId);
      if (existingConversation) {
        conversationId = existingConversation.id;
      } else {
        const newConv = await conversationRepository.create({
          externalConversationId: input.externalConversationId,
          externalChannelId: 'whatsapp',
          status: 'open',
          isActive: true,
        });
        conversationId = newConv.id;
        isNewConversation = true;
        await conversationRepository.addStatusHistory(conversationId, 'open', undefined, 'Created from inbound message');
        await publishConversationCreated(newConv);

        // Audit: registro de criação de conversa (se houver userId)
        if (input.userId) {
          await createAuditLog({
            userId: input.userId,
            action: 'conversation.created',
            entityType: 'conversation',
            entityId: newConv.id,
            newValue: newConv,
            metadata: {
              externalConversationId: input.externalConversationId,
              source: 'inbound',
            },
          });
        }
      }
    } else {
      const newConv = await conversationRepository.create({
        externalChannelId: 'whatsapp',
        status: 'open',
        isActive: true,
      });
      conversationId = newConv.id;
      isNewConversation = true;
      await conversationRepository.addStatusHistory(conversationId, 'open', undefined, 'Created from inbound message');
      await publishConversationCreated(newConv);

      // Audit: registro de criação de conversa (se houver userId)
      if (input.userId) {
        await createAuditLog({
          userId: input.userId,
          action: 'conversation.created',
          entityType: 'conversation',
          entityId: newConv.id,
          newValue: newConv,
          metadata: {
            source: 'inbound',
          },
        });
      }
    }

    const message = await messageRepository.create({
      conversationId,
      direction: 'inbound',
      content: input.content,
      sender: input.sender,
      senderType: input.senderType,
      externalMessageId: input.externalMessageId,
      sentAt: input.sentAt || new Date(),
      status: 'pending',
      // Media fields
      mediaUrl: input.mediaUrl,
      mediaType: input.mediaType,
      mediaMimetype: input.mediaMimetype,
      mediaFilename: input.mediaFilename,
      metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
    });

    await publishMessagePersisted(message);

    // Audit: registrar recebimento de mensagem inbound
    if (input.userId) {
      await createAuditLog({
        userId: input.userId,
        action: 'message.inbound.received',
        entityType: 'message',
        entityId: message.id,
        metadata: {
          externalMessageId: input.externalMessageId,
          conversationId,
          sender: input.sender,
        },
      });
    }

    // Integração com Secretary: processar mensagem apenas se a conversa está com bot ativo
    // Erros na Secretary não devem quebrar o fluxo de inbound
    try {
      const conversation = await conversationRepository.findById(conversationId);
      if (conversation && conversation.currentHandler === 'bot') {
        const secretaryResult = await processMessageWithSecretary({
          conversationId,
          messageId: message.id,
          content: input.content,
          sender: input.sender,
        });

        if (secretaryResult.isOk()) {
          const secretaryOutput: ProcessMessageWithSecretaryOutput = secretaryResult.value;

          if (secretaryOutput.handoffTriggered) {
            // Atualiza currentHandler da conversa primeiro (fonte da verdade)
            await conversationRepository.updateCurrentHandler(conversationId, 'human');

            // Audit: registrar handoff bot→human
            if (input.userId) {
              await createAuditLog({
                userId: input.userId,
                action: 'conversation.handoff',
                entityType: 'conversation',
                entityId: conversationId,
                oldValue: { handler: 'bot' },
                newValue: { handler: 'human' },
                metadata: {
                  reason: secretaryOutput.classification?.handoffReason || 'Secretary requested handoff',
                  classification: secretaryOutput.classification,
                  messageId: message.id,
                },
              });
            }

            // Dispara eventos de handoff (best-effort)
            await triggerHandoff({
              conversationId,
              previousHandler: 'bot',
              newHandler: 'human',
              reason: secretaryOutput.classification?.handoffReason || 'Secretary requested handoff',
              metadata: {
                classification: secretaryOutput.classification,
                messageId: message.id,
              },
            });
          }
        }
      }
    } catch (secretaryError) {
      // Secretary failure é não-crítica; logamos mas não interrompemos o fluxo
      console.error('[receiveInboundMessage] Secretary integration failed:', secretaryError);
    }

    return ok({
      messageId: message.id,
      conversationId,
      isNewConversation,
    });
  } catch (error) {
    return err(error as Error);
  }
}
