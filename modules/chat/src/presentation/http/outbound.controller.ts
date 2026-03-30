import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { sendOutboundMessage } from '../../application/use-cases/send-outbound-message.use-case';
import { conversationRepository, Conversation } from '../../infrastructure/repositories/conversation.repository';
import { messageRepository } from '../../infrastructure/repositories/message.repository';
import { AppError } from '@cvg/shared';
import { authenticate, requirePermission } from '@cvg/auth';

interface SendMessageBody {
  conversationId: string;
  content: string;
  recipient: string;
  sender?: string;
}

export async function registerOutboundController(app: FastifyInstance) {
  app.post(
    '/messages',
    {
      preHandler: [authenticate, requirePermission('chat:write')],
      schema: {
        body: {
          type: 'object',
          properties: {
            conversationId: { type: 'string', format: 'uuid' },
            content: { type: 'string', minLength: 1 },
            recipient: { type: 'string', minLength: 1 },
            sender: { type: 'string' },
          },
          required: ['conversationId', 'content', 'recipient'],
        },
      },
    },
    async (request: FastifyRequest<{ Body: SendMessageBody }>, reply: FastifyReply) => {
      try {
        const { conversationId, content, recipient, sender } = request.body;
        const userId = request.user?.id;

        const result = await sendOutboundMessage({
          conversationId,
          content,
          recipient,
          sender,
          userId,
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
            message: 'Failed to send message',
          });
        }

        return reply.status(201).send({
          messageId: result.value.messageId,
          conversationId: result.value.conversationId,
          status: result.value.status,
        });
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({
          error: 'INTERNAL_ERROR',
          message: 'Failed to send message',
        });
      }
    }
  );

  app.get(
    '/conversations/:conversationId/messages',
    {
      preHandler: authenticate,
      schema: {
        params: {
          type: 'object',
          properties: {
            conversationId: { type: 'string', format: 'uuid' },
          },
          required: ['conversationId'],
        },
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'integer', default: 50, minimum: 1, maximum: 100 },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { conversationId: string }; Querystring: { limit?: number } }>, reply: FastifyReply) => {
      try {
        const { conversationId } = request.params;
        const limit = request.query.limit || 50;

        const { messageRepository } = await import('../../infrastructure/repositories/message.repository');
        const messages = await messageRepository.findRecentByConversationId(conversationId, limit);

        return reply.status(200).send({ messages });
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({
          error: 'INTERNAL_ERROR',
          message: 'Failed to fetch messages',
        });
      }
    }
  );

  app.get(
    '/conversations',
    {
      preHandler: authenticate,
      schema: {
        querystring: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            queueId: { type: 'string', format: 'uuid' },
            teamId: { type: 'string', format: 'uuid' },
            sectorId: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: { status?: string; queueId?: string; teamId?: string; sectorId?: string } }>, reply: FastifyReply) => {
      try {
        const { status, queueId, teamId, sectorId } = request.query;
        const userId = (request.user as any)?.id;
        const conversations = await conversationRepository.findAll({ status, queueId, teamId, sectorId, userId });
        
        const conversationsWithLastMessage = await Promise.all(
          conversations.map(async (conv) => {
            const messages = await messageRepository.findRecentByConversationId(conv.id, 1);
            return {
              ...conv,
              lastMessage: messages[0] || null,
            };
          })
        );

        return reply.status(200).send({ conversations: conversationsWithLastMessage });
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({
          error: 'INTERNAL_ERROR',
          message: 'Failed to fetch conversations',
        });
      }
    }
  );
}
