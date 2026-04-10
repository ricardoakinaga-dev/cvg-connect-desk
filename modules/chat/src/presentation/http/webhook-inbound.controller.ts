import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { receiveInboundMessage } from '../../application/use-cases/receive-inbound-message.use-case';
import { AppError, createWebhookGuard } from '@cvg/shared';

interface InboundWebhookBody {
  messageId?: string;
  conversationId?: string;
  from?: string;
  to?: string;
  content?: string;
  text?: string;
  timestamp?: string;
  type?: string;
}

export async function registerInboundWebhook(app: FastifyInstance) {
  const webhookGuard = createWebhookGuard();

  app.post(
    '/webhook/inbound',
    {
      preHandler: webhookGuard,
      schema: {
        description: 'Webhook inbound do Gateway — recebe mensagens do WhatsApp',
        tags: ['Webhook'],
        body: {
          type: 'object',
          properties: {
            messageId: { type: 'string', maxLength: 128 },
            conversationId: { type: 'string', maxLength: 128 },
            from: { type: 'string', minLength: 1, maxLength: 32 },
            to: { type: 'string', maxLength: 32 },
            content: { type: 'string', maxLength: 10000 },
            text: { type: 'string', maxLength: 10000 },
            timestamp: { type: 'string', maxLength: 32 },
            type: { type: 'string', maxLength: 32 },
          },
          required: ['from'],
          additionalProperties: false,
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              messageId: { type: 'string' },
              conversationId: { type: 'string' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: InboundWebhookBody }>, reply: FastifyReply) => {
      try {
        const { messageId, conversationId, from, to, content, text, timestamp } = request.body;

        const messageContent = content || text || '';
        const sentAt = timestamp ? new Date(timestamp) : new Date();

        const result = await receiveInboundMessage({
          externalMessageId: messageId || `msg_${Date.now()}`,
          externalConversationId: conversationId,
          content: messageContent,
          sender: from,
          senderType: 'contact',
          contactPhone: from,
          sentAt,
        });

        if (result.isErr()) {
          const error = result.error;
          if (error instanceof AppError) {
            return reply.status(error.statusCode).send({
              error: error.code,
              message: error.message,
            });
          }
          return reply.status(500).send({
            error: 'INTERNAL_ERROR',
            message: 'Failed to process inbound message',
          });
        }

        return reply.status(200).send({
          success: true,
          messageId: result.value.messageId,
          conversationId: result.value.conversationId,
        });
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({
          error: 'INTERNAL_ERROR',
          message: 'Webhook processing failed',
        });
      }
    }
  );
}
