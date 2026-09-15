import { FastifyInstance } from 'fastify';
import { receiveInboundMessage } from '../../application/use-cases/receive-inbound-message.use-case';
import {
  AppError,
  completeWebhookClaim,
  createWebhookGuard,
  failWebhookClaim,
  messagesInboundTotal,
} from '@cvg/shared';
import { withSpan, withExtractedContext, correlationAttributes } from '@cvg/tracing';

interface InboundWebhookBody {
  messageId?: string;
  conversationId?: string;
  from?: string;
  to?: string;
  content?: string;
  text?: string;
  timestamp?: string;
  type?: string;
  // PROD-14: mídia inbound entra pelo pipeline (nunca persistida como URL crua).
  mediaUrl?: string;
  mediaType?: string;
  mediaMimetype?: string;
  mediaFilename?: string;
}

export async function registerInboundWebhook(app: FastifyInstance) {
  const webhookGuard = createWebhookGuard();

  app.post<{ Body: InboundWebhookBody }>(
    '/webhook/inbound',
    {
      preHandler: webhookGuard,
      config: {
        rateLimit: {
          max: Number(process.env.RATE_LIMIT_WEBHOOK_MAX) || 300,
          timeWindow: process.env.RATE_LIMIT_WEBHOOK_WINDOW || '1 minute',
        },
      },
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
            mediaUrl: { type: 'string', maxLength: 2048 },
            mediaType: { type: 'string', maxLength: 32 },
            mediaMimetype: { type: 'string', maxLength: 128 },
            mediaFilename: { type: 'string', maxLength: 255 },
          },
          required: ['from', 'messageId'],
          additionalProperties: false,
        },
        response: {
          200: {
            type: 'object',
              properties: {
                success: { type: 'boolean' },
                messageId: { type: 'string' },
                conversationId: { type: 'string' },
                deduplicated: { type: 'boolean' },
                eventId: { type: 'string' },
              },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const { messageId, conversationId, from, content, text, timestamp, mediaUrl, mediaType, mediaMimetype, mediaFilename } = request.body;

        const messageContent = content || text || '';
        const sentAt = timestamp ? new Date(timestamp) : new Date();
        if (!messageId) {
          await failWebhookClaim(request, request.log);
          return reply.status(400).send({
            error: 'BAD_REQUEST',
            message: 'messageId (externalMessageId) é obrigatório',
          });
        }

        if (!from) {
          await failWebhookClaim(request, request.log);
          return reply.status(400).send({
            error: 'BAD_REQUEST',
            message: 'from é obrigatório',
          });
        }

        const result = await withExtractedContext(request.headers, () =>
          withSpan(
            'webhook.receive',
            () =>
              receiveInboundMessage({
                externalMessageId: messageId,
                externalConversationId: conversationId,
                content: messageContent,
                sender: from,
                senderType: 'contact',
                contactPhone: from,
                sentAt,
                mediaUrl,
                mediaType,
                mediaMimetype,
                mediaFilename,
              }),
            correlationAttributes({
              event_id: messageId,
              conversation_id: conversationId,
            }),
          ),
        );

        if (result.isErr()) {
          await failWebhookClaim(request, request.log);
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

        try {
          messagesInboundTotal.inc();
        } catch {
          // Métricas nunca quebram o webhook.
        }
        // Recibo durável só vira `completed` depois do negócio persistido.
        // Falha aqui derruba para 5xx e o retry reprocessa de forma idempotente.
        await completeWebhookClaim(request);
        return reply.status(200).send({
          success: true,
          messageId: result.value.messageId,
          conversationId: result.value.conversationId,
        });
      } catch (error) {
        await failWebhookClaim(request, request.log);
        request.log.error(error);
        return reply.status(500).send({
          error: 'INTERNAL_ERROR',
          message: 'Webhook processing failed',
        });
      }
    }
  );
}
