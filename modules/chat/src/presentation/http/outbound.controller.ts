import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { sendOutboundMessage } from '../../application/use-cases/send-outbound-message.use-case';
import { conversationRepository, Conversation } from '../../infrastructure/repositories/conversation.repository';
import { messageRepository } from '../../infrastructure/repositories/message.repository';
import { AppError } from '@cvg/shared';
import { authenticate, requirePermission } from '@cvg/auth';
import { db, schema } from '@cvg/database';
import { eq, desc, asc, and, inArray, sql, isNull } from 'drizzle-orm';

interface SendMessageBody {
  conversationId: string;
  content?: string;
  recipient: string;
  sender?: string;
  mediaUrl?: string;
  mediaType?: string;
  mediaMimetype?: string;
  mediaFilename?: string;
}

export async function registerOutboundController(app: FastifyInstance) {
  // ==========================================
  // POST /messages — enviar mensagem
  // ==========================================
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
          },
          required: ['conversationId', 'recipient'],
        },
      },
    },
    async (request: FastifyRequest<{ Body: SendMessageBody }>, reply: FastifyReply) => {
      try {
        const { conversationId, content, recipient, sender, mediaUrl, mediaType, mediaMimetype, mediaFilename } = request.body;
        const userId = request.user?.id;

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

  // ==========================================
  // GET /conversations/:conversationId/messages
  // ==========================================
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
            before: { type: 'string' },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { conversationId: string }; Querystring: { limit?: number; before?: string } }>, reply: FastifyReply) => {
      try {
        const { conversationId } = request.params;
        const limit = request.query.limit || 50;
        const before = request.query.before;

        // Build query with optional cursor pagination
        let query = db.select()
          .from(schema.messages)
          .where(eq(schema.messages.conversationId, conversationId))
          .$dynamic();

        if (before) {
          query = query.where(sql`${schema.messages.createdAt} < ${new Date(before)}`);
        }

        // ASC order — oldest first, newest last (WhatsApp behavior)
        const messages = await query
          .orderBy(asc(schema.messages.createdAt))
          .limit(limit);

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

  // ==========================================
  // GET /conversations — lista otimizada
  // ==========================================
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

        // 1. Buscar conversas com filtros
        const conversations = await conversationRepository.findAll({ status, queueId, teamId, sectorId, userId });

        if (conversations.length === 0) {
          return reply.status(200).send({ conversations: [] });
        }

        // 2. Batch: buscar contatos de uma vez
        const contactIds = [...new Set(conversations.map(c => c.contactId).filter(Boolean))];
        const contactsMap = new Map<string, { name: string | null; phone: string | null }>();

        if (contactIds.length > 0) {
          const { contacts, inArray: inArr } = schema;
          const contactsResult = await db.select({
            id: contacts.id,
            name: contacts.name,
            phone: contacts.phone,
          })
            .from(contacts)
            .where(inArr(contacts.id, contactIds as string[]));

          for (const c of contactsResult) {
            contactsMap.set(c.id, { name: c.name, phone: c.phone });
          }
        }

        // 3. Batch: buscar setores de uma vez
        const sectorIds = [...new Set(conversations.map(c => c.sectorId).filter(Boolean))];
        const sectorsMap = new Map<string, { name: string; icon: string; color: string }>();

        if (sectorIds.length > 0) {
          const sectorsResult = await db.select({
            id: schema.sectors.id,
            name: schema.sectors.name,
            icon: schema.sectors.icon,
            color: schema.sectors.color,
          })
            .from(schema.sectors)
            .where(inArray(schema.sectors.id, sectorIds as string[]));

          for (const s of sectorsResult) {
            sectorsMap.set(s.id, { name: s.name, icon: s.icon, color: s.color });
          }
        }

        // 4. Batch: buscar última mensagem de todas as conversas de uma vez
        const convIds = conversations.map(c => c.id);
        const lastMessagesMap = new Map<string, { content: string; direction: string; createdAt: string }>();

        if (convIds.length > 0) {
          // Use a window function to get the latest message per conversation
          const lastMsgsResult = await db.execute(sql`
            SELECT DISTINCT ON (conversation_id)
              conversation_id,
              content,
              direction,
              created_at
            FROM messages
            WHERE conversation_id = ANY(${convIds})
            ORDER BY conversation_id, created_at DESC
          `);

          const rows = (lastMsgsResult as any).rows || [];
          for (const row of rows) {
            lastMessagesMap.set(row.conversation_id, {
              content: row.content,
              direction: row.direction,
              createdAt: row.created_at,
            });
          }
        }

        // 5. Batch: contar mensagens não lidas (inbound não visualizadas)
        // Para simplificar, contamos mensagens inbound criadas após o último fechamento
        // ou todas se nunca foi fechada
        const unreadCountsMap = new Map<string, number>();

        if (convIds.length > 0) {
          const unreadResult = await db.execute(sql`
            SELECT conversation_id, COUNT(*) as count
            FROM messages
            WHERE conversation_id = ANY(${convIds})
              AND direction = 'inbound'
              AND status = 'pending'
            GROUP BY conversation_id
          `);

          const rows = (unreadResult as any).rows || [];
          for (const row of rows) {
            unreadCountsMap.set(row.conversation_id, Number(row.count));
          }
        }

        // 6. Montar resposta
        const enriched = conversations.map(conv => {
          const contact = conv.contactId ? contactsMap.get(conv.contactId) : null;
          const sector = conv.sectorId ? sectorsMap.get(conv.sectorId) : null;
          const lastMessage = lastMessagesMap.get(conv.id) || null;
          const unreadCount = unreadCountsMap.get(conv.id) || 0;

          return {
            ...conv,
            contactName: contact?.name || null,
            contactPhone: contact?.phone || null,
            sectorName: sector?.name || null,
            sectorIcon: sector?.icon || null,
            sectorColor: sector?.color || null,
            lastMessage,
            unreadCount,
          };
        });

        return reply.status(200).send({ conversations: enriched });
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({
          error: 'INTERNAL_ERROR',
          message: 'Failed to fetch conversations',
        });
      }
    }
  );

  // ==========================================
  // PATCH /conversations/:id/status — atualizar status
  // ==========================================
  app.patch(
    '/conversations/:conversationId/status',
    {
      preHandler: [authenticate, requirePermission('chat:write')],
      schema: {
        params: {
          type: 'object',
          properties: { conversationId: { type: 'string', format: 'uuid' } },
          required: ['conversationId'],
        },
        body: {
          type: 'object',
          properties: { statusV2: { type: 'string', enum: ['novo', 'em_atendimento', 'pendente', 'em_espera', 'finalizado', 'arquivado'] } },
          required: ['statusV2'],
        },
      },
    },
    async (request: FastifyRequest<{ Params: { conversationId: string }; Body: { statusV2: string } }>, reply: FastifyReply) => {
      try {
        const { conversationId } = request.params;
        const { statusV2 } = request.body;
        const userId = (request.user as any)?.id;

        const conversation = await conversationRepository.findById(conversationId);
        if (!conversation) {
          return reply.status(404).send({ error: 'NOT_FOUND', message: 'Conversation not found' });
        }

        const updated = await conversationRepository.updateStatusV2(conversationId, statusV2, userId);
        await conversationRepository.addStatusHistory(conversationId, statusV2, userId);

        return reply.status(200).send(updated);
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to update status' });
      }
    }
  );

  // ==========================================
  // POST /conversations/:id/transfer — transferir conversa
  // ==========================================
  app.post(
    '/conversations/:conversationId/transfer',
    {
      preHandler: [authenticate, requirePermission('chat:write')],
      schema: {
        params: {
          type: 'object',
          properties: { conversationId: { type: 'string', format: 'uuid' } },
          required: ['conversationId'],
        },
        body: {
          type: 'object',
          properties: {
            toSectorId: { type: 'string', format: 'uuid' },
            reason: { type: 'string' },
          },
          required: ['toSectorId'],
        },
      },
    },
    async (request: FastifyRequest<{ Params: { conversationId: string }; Body: { toSectorId: string; reason?: string } }>, reply: FastifyReply) => {
      try {
        const { conversationId } = request.params;
        const { toSectorId, reason } = request.body;
        const userId = (request.user as any)?.id;

        const conversation = await conversationRepository.findById(conversationId);
        if (!conversation) {
          return reply.status(404).send({ error: 'NOT_FOUND', message: 'Conversation not found' });
        }

        // Criar registro de transferência
        const [transfer] = await db.insert(schema.contactTransfers).values({
          contactId: conversation.contactId!,
          conversationId,
          fromSectorId: conversation.sectorId,
          toSectorId,
          fromUserId: userId,
          reason,
          status: 'accepted', // Auto-aceitar transferência via UI
          resolvedAt: new Date(),
        }).returning();

        // Atualizar setor da conversa
        const updated = await conversationRepository.updateSector(conversationId, toSectorId);

        return reply.status(200).send({ conversation: updated, transfer });
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to transfer conversation' });
      }
    }
  );

  // ==========================================
  // PATCH /conversations/:id/assign — atribuir usuário
  // ==========================================
  app.patch(
    '/conversations/:conversationId/assign',
    {
      preHandler: [authenticate, requirePermission('chat:write')],
      schema: {
        params: {
          type: 'object',
          properties: { conversationId: { type: 'string', format: 'uuid' } },
          required: ['conversationId'],
        },
        body: {
          type: 'object',
          properties: { userId: { type: 'string', format: 'uuid' } },
          required: ['userId'],
        },
      },
    },
    async (request: FastifyRequest<{ Params: { conversationId: string }; Body: { userId: string } }>, reply: FastifyReply) => {
      try {
        const { conversationId } = request.params;
        const { userId: assignUserId } = request.body;

        const conversation = await conversationRepository.findById(conversationId);
        if (!conversation) {
          return reply.status(404).send({ error: 'NOT_FOUND', message: 'Conversation not found' });
        }

        const updated = await conversationRepository.assignUser(conversationId, assignUserId);

        return reply.status(200).send(updated);
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to assign conversation' });
      }
    }
  );

  // ==========================================
  // POST /conversations/:id/close — fechar conversa
  // ==========================================
  app.post(
    '/conversations/:conversationId/close',
    {
      preHandler: [authenticate, requirePermission('chat:write')],
      schema: {
        params: {
          type: 'object',
          properties: { conversationId: { type: 'string', format: 'uuid' } },
          required: ['conversationId'],
        },
      },
    },
    async (request: FastifyRequest<{ Params: { conversationId: string } }>, reply: FastifyReply) => {
      try {
        const { conversationId } = request.params;
        const userId = (request.user as any)?.id;

        const conversation = await conversationRepository.findById(conversationId);
        if (!conversation) {
          return reply.status(404).send({ error: 'NOT_FOUND', message: 'Conversation not found' });
        }

        const updated = await conversationRepository.close(conversationId);
        await conversationRepository.addStatusHistory(conversationId, 'finalizado', userId, 'Conversa fechada');

        return reply.status(200).send(updated);
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to close conversation' });
      }
    }
  );

  // ==========================================
  // POST /conversations/:id/mark-read — marcar como lida
  // ==========================================
  app.post(
    '/conversations/:conversationId/mark-read',
    {
      preHandler: [authenticate],
      schema: {
        params: {
          type: 'object',
          properties: { conversationId: { type: 'string', format: 'uuid' } },
          required: ['conversationId'],
        },
      },
    },
    async (request: FastifyRequest<{ Params: { conversationId: string } }>, reply: FastifyReply) => {
      try {
        const { conversationId } = request.params;

        // Marcar todas as mensagens inbound como 'delivered' (lidas)
        await db.update(schema.messages)
          .set({ status: 'delivered' })
          .where(and(
            eq(schema.messages.conversationId, conversationId),
            eq(schema.messages.direction, 'inbound'),
            eq(schema.messages.status, 'pending')
          ));

        return reply.status(200).send({ success: true });
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to mark as read' });
      }
    }
  );
}
