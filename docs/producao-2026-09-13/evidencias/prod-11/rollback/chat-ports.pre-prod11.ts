import { messageRepository, type Message } from '../../infrastructure/repositories/message.repository';
import { receiveInboundMessage } from '../use-cases/receive-inbound-message.use-case';
import { mapProviderReceiptStatus, type GatewayHandlerPorts, type MessageView } from '@cvg/messaging-contracts';

function toMessageView(message: Message): MessageView {
  return {
    id: message.id,
    conversationId: message.conversationId,
    direction: message.direction as 'inbound' | 'outbound',
    content: message.content,
    sender: message.sender ?? null,
    recipient: message.recipient ?? null,
    status: message.status,
    externalMessageId: message.externalMessageId ?? null,
    createdAt: message.createdAt,
  };
}

/**
 * Implementações das portas C02 §5 consumidas pelo gateway.
 * A composição (`apps/desk-api/src/app.ts`) injeta este objeto nos handlers.
 */
export function createChatPorts(): GatewayHandlerPorts {
  return {
    inbound: {
      async submit(input) {
        const result = await receiveInboundMessage(input);
        if (result.isErr()) {
          const error = result.error as { code?: string; message?: string };
          return {
            ok: false,
            error: {
              code: error.code ?? 'BAD_REQUEST',
              message: error.message ?? 'Inbound message rejected',
            },
          };
        }
        return { ok: true, value: result.value };
      },
    },

    messageRead: {
      async findByExternalId(externalMessageId) {
        const message = await messageRepository.findByExternalId(externalMessageId);
        return message ? toMessageView(message) : null;
      },
      async listPendingOutbound(limit) {
        const messages = await messageRepository.findPendingOutbound(limit);
        return messages.map(toMessageView);
      },
    },

    messageStatus: {
      async applyReceipt({ externalMessageId, status, statusAt }) {
        const message = await messageRepository.findByExternalId(externalMessageId);
        if (!message) {
          return { updated: false };
        }
        const updated = await messageRepository.update(message.id, {
          status: mapProviderReceiptStatus(status),
          deliveredAt: status === 'delivered' ? statusAt : undefined,
        });
        return { updated: Boolean(updated), messageId: updated?.id ?? message.id };
      },
    },

    confirmation: {
      async markOutboundSent({ internalMessageId, externalMessageId }) {
        const updated = await messageRepository.update(internalMessageId, {
          status: 'sent',
          ...(externalMessageId ? { externalMessageId } : {}),
        });
        return { updated: Boolean(updated), messageId: updated?.id };
      },
    },
  };
}
