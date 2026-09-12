import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { sendOutboundMessage } from '../../application/use-cases/send-outbound-message.use-case';
import { conversationRepository, Conversation } from '../../infrastructure/repositories/conversation.repository';
import { messageRepository } from '../../infrastructure/repositories/message.repository';
import { AppError, messagesOutboundTotal } from '@cvg/shared';
import { authenticate, authorize, requirePermission, sectorPermissionService } from '@cvg/auth';
import { inArray } from 'drizzle-orm';

interface SendMessageBody {
  conversationId: string;
  content?: string;
  recipient: string;
  sender?: string;
  mediaUrl?: string;
  mediaType?: string;
  mediaMimetype?: string;
  mediaFilename?: string;
  clientMessageId?: string;
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
            content: { type: 'string' },
            recipient: { type: 'string', minLength: 1 },
            sender: { type: 'string' },
            mediaUrl: { type: 'string' },
            mediaType: { type: 'string', enum: ['image', 'audio', 'video', 'document'] },
            mediaMimetype: { type: 'string' },
            mediaFilename: { type: 'string' },
            clientMessageId: { type: 'string', maxLength: 128 },
          },
          required: ['conversationId', 'recipient'],
        },
      },
    },
    async (request: FastifyRequest<{ Body: SendMessageBody }>, reply: FastifyReply) => {
      try {
        const { conversationId, content, recipient, sender, mediaUrl, mediaType, mediaMimetype, mediaFilename, clientMessageId } = request.body;
        const userId = request.user?.id;
        const headerKey = request.headers['idempotency-key'];
        const idempotencyKey = (typeof headerKey === 'string' && headerKey.trim()) || clientMessageId;

        const result = await sendOutboundMessage({
          conversationId,
          content: content || '',
          recipient,
          sender,
          mediaUrl,
          mediaType,
          mediaMimetype,
          mediaFilename,
          userId,
          idempotencyKey,
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

        try {
          messagesOutboundTotal.inc({ deduplicated: result.value.deduplicated });
        } catch {
          // Métricas nunca quebram o envio.
        }
        return reply.status(result.value.deduplicated ? 200 : 201).send({
          messageId: result.value.messageId,
          conversationId: result.value.conversationId,
          status: result.value.status,
          deduplicated: result.value.deduplicated,
        });
      } catch (error) {        request.log.error(error);
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
        const roles = (request.user?.roles ?? []) as string[];

        // Zero-trust (§7.2): filtro explícito de setor exige membership;
        // sem setores atribuídos, não-admin não enxerga nada (default-deny).
        if (sectorId) {
          const decision = await authorize(
            { id: userId, roles },
            'chat:read',
            { type: 'conversation', sectorId },
          );
          if (!decision.allowed) {
            return reply.status(403).send({ error: 'FORBIDDEN', message: 'No access to this sector' });
          }
        } else if (!roles.includes('Admin')) {
          const memberOf = await sectorPermissionService.getUserSectorIds(userId);
          if (memberOf.length === 0) {
            return reply.status(200).send({ conversations: [] });
          }
        }

        const conversations = await conversationRepository.findAll({ status, queueId, teamId, sectorId, userId });
        
        // Buscar contatos para resolver nomes
        const contactIds = [...new Set(conversations.map(c => c.contactId).filter(Boolean))];
        const contactsMap = new Map<string, { name: string | null; phone: string | null }>();
        
        if (contactIds.length > 0) {
          const { db } = await import('@cvg/database');
          const { contacts } = await import('@cvg/database');
          const contactsResult = await db.select({ id: contacts.id, name: contacts.name, phone: contacts.phone })
            .from(contacts)
            .where(inArray(contacts.id, contactIds as string[]));
          for (const c of contactsResult) {
            contactsMap.set(c.id, { name: c.name, phone: c.phone });
          }
        }

        const conversationsWithLastMessage = await Promise.all(
          conversations.map(async (conv) => {
            const messages = await messageRepository.findRecentByConversationId(conv.id, 1);
            const contact = conv.contactId ? contactsMap.get(conv.contactId) : null;
            return {
              ...conv,
              contactName: contact?.name || null,
              contactPhone: contact?.phone || null,
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
