import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { sendOutboundMessage } from '../../application/use-cases/send-outbound-message.use-case';
import { conversationRepository } from '../../infrastructure/repositories/conversation.repository';
import { messageRepository } from '../../infrastructure/repositories/message.repository';
import { AppError } from '@cvg/shared';
import { authenticate, requirePermission } from '@cvg/auth';
import { db, schema } from '@cvg/database';
import { eq, desc, asc, and, inArray, sql } from 'drizzle-orm';
import { publishConversationStatusChanged, publishConversationAssigned } from '../../application/events/chat-publisher';

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
  app.post('/messages', {
    preHandler: [authenticate, requirePermission('chat:write')],
  }, async (request: FastifyRequest<{ Body: SendMessageBody }>, reply: FastifyReply) => {
    try {
      const { conversationId, content, recipient, sender, mediaUrl, mediaType, mediaMimetype, mediaFilename } = request.body;
      const userId = request.user?.id;
      const result = await sendOutboundMessage({
        conversationId, content: content || '', recipient, sender,
        mediaUrl, mediaType, mediaMimetype, mediaFilename, userId,
      });
      if (result.isErr()) {
        const error = result.error;
        if (error instanceof AppError) return reply.status(error.statusCode).send({ error: error.code, message: error.message });
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to send message' });
      }
      return reply.status(201).send({ messageId: result.value.messageId, conversationId: result.value.conversationId, status: result.value.status });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to send message' });
    }
  });

  app.get('/conversations/:conversationId/messages', {
    preHandler: authenticate,
  }, async (request: FastifyRequest<{ Params: { conversationId: string }; Querystring: { limit?: number; before?: string } }>, reply: FastifyReply) => {
    try {
      const { conversationId } = request.params;
      const limit = request.query.limit || 50;
      let query = db.select().from(schema.messages).where(eq(schema.messages.conversationId, conversationId)).$dynamic();
      if (request.query.before) {
        query = query.where(sql`${schema.messages.createdAt} < ${new Date(request.query.before)}`);
      }
      const messages = await query.orderBy(asc(schema.messages.createdAt)).limit(limit);
      return reply.status(200).send({ messages });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to fetch messages' });
    }
  });

  app.get('/conversations', {
    preHandler: authenticate,
  }, async (request: FastifyRequest<{ Querystring: { status?: string; queueId?: string; teamId?: string; sectorId?: string } }>, reply: FastifyReply) => {
    try {
      const { status, queueId, teamId, sectorId } = request.query;
      const userId = (request.user as any)?.id;
      const conversations = await conversationRepository.findAll({ status, queueId, teamId, sectorId, userId });

      if (conversations.length === 0) return reply.status(200).send({ conversations: [] });

      // Batch: contatos
      const contactIds = [...new Set(conversations.map(c => c.contactId).filter(Boolean))];
      const contactsMap = new Map<string, { name: string | null; phone: string | null }>();
      if (contactIds.length > 0) {
        const contactsResult = await db.select({ id: schema.contacts.id, name: schema.contacts.name, phone: schema.contacts.phone })
          .from(schema.contacts).where(inArray(schema.contacts.id, contactIds as string[]));
        for (const c of contactsResult) contactsMap.set(c.id, { name: c.name, phone: c.phone });
      }

      // Batch: setores
      const sectorIds = [...new Set(conversations.map(c => c.sectorId).filter(Boolean))];
      const sectorsMap = new Map<string, { name: string; icon: string; color: string }>();
      if (sectorIds.length > 0) {
        const sectorsResult = await db.select({ id: schema.sectors.id, name: schema.sectors.name, icon: schema.sectors.icon, color: schema.sectors.color })
          .from(schema.sectors).where(inArray(schema.sectors.id, sectorIds as string[]));
        for (const s of sectorsResult) sectorsMap.set(s.id, { name: s.name, icon: s.icon, color: s.color });
      }

      // Batch: última mensagem por conversa
      const convIds = conversations.map(c => c.id);
      const lastMessagesMap = new Map<string, { content: string; direction: string; createdAt: string }>();
      if (convIds.length > 0) {
        const allMessages = await db.select({
          conversationId: schema.messages.conversationId,
          content: schema.messages.content,
          direction: schema.messages.direction,
          createdAt: schema.messages.createdAt,
        }).from(schema.messages)
          .where(inArray(schema.messages.conversationId, convIds))
          .orderBy(desc(schema.messages.createdAt));
        const seen = new Set<string>();
        for (const msg of allMessages) {
          if (!seen.has(msg.conversationId)) {
            seen.add(msg.conversationId);
            lastMessagesMap.set(msg.conversationId, { content: msg.content, direction: msg.direction, createdAt: msg.createdAt.toISOString() });
          }
        }
      }

      // Batch: contagem de não lidas
      const unreadCountsMap = new Map<string, number>();
      if (convIds.length > 0) {
        const unreadMessages = await db.select({ conversationId: schema.messages.conversationId })
          .from(schema.messages).where(and(
            inArray(schema.messages.conversationId, convIds),
            eq(schema.messages.direction, 'inbound'),
            eq(schema.messages.status, 'pending')
          ));
        for (const msg of unreadMessages) {
          unreadCountsMap.set(msg.conversationId, (unreadCountsMap.get(msg.conversationId) || 0) + 1);
        }
      }

      // Montar resposta
      const enriched = conversations.map(conv => {
        const contact = conv.contactId ? contactsMap.get(conv.contactId) : null;
        const sector = conv.sectorId ? sectorsMap.get(conv.sectorId) : null;
        return {
          ...conv,
          contactName: contact?.name || null,
          contactPhone: contact?.phone || null,
          sectorName: sector?.name || null,
          sectorIcon: sector?.icon || null,
          sectorColor: sector?.color || null,
          lastMessage: lastMessagesMap.get(conv.id) || null,
          unreadCount: unreadCountsMap.get(conv.id) || 0,
        };
      });

      return reply.status(200).send({ conversations: enriched });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to fetch conversations' });
    }
  });

  app.patch('/conversations/:conversationId/status', {
    preHandler: [authenticate, requirePermission('chat:write')],
  }, async (request: FastifyRequest<{ Params: { conversationId: string }; Body: { statusV2: string } }>, reply: FastifyReply) => {
    try {
      const { conversationId } = request.params;
      const { statusV2 } = request.body;
      const userId = (request.user as any)?.id;
      const conversation = await conversationRepository.findById(conversationId);
      if (!conversation) return reply.status(404).send({ error: 'NOT_FOUND', message: 'Conversation not found' });
      const updated = await conversationRepository.updateStatusV2(conversationId, statusV2, userId);
      await conversationRepository.addStatusHistory(conversationId, statusV2, userId);

      // Publish event for realtime consumers
      await publishConversationStatusChanged(conversationId, conversation.statusV2 || conversation.status, statusV2);

      return reply.status(200).send(updated);
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
  });

  app.post('/conversations/:conversationId/transfer', {
    preHandler: [authenticate, requirePermission('chat:write')],
  }, async (request: FastifyRequest<{ Params: { conversationId: string }; Body: { toSectorId: string; reason?: string } }>, reply: FastifyReply) => {
    try {
      const { conversationId } = request.params;
      const { toSectorId, reason } = request.body;
      const userId = (request.user as any)?.id;
      const conversation = await conversationRepository.findById(conversationId);
      if (!conversation) return reply.status(404).send({ error: 'NOT_FOUND' });
      const [transfer] = await db.insert(schema.contactTransfers).values({
        contactId: conversation.contactId!, conversationId,
        fromSectorId: conversation.sectorId, toSectorId,
        fromUserId: userId, reason, status: 'accepted', resolvedAt: new Date(),
      }).returning();
      const updated = await conversationRepository.updateSector(conversationId, toSectorId);
      return reply.status(200).send({ conversation: updated, transfer });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
  });

  app.patch('/conversations/:conversationId/assign', {
    preHandler: [authenticate as any, requirePermission('chat:write') as any],
  }, async (request, reply) => {
    try {
      const params = request.params as { conversationId: string };
      const body = request.body as { userId: string };
      const { conversationId } = params;
      const { userId: assignUserId } = body;
      const existing = await conversationRepository.findById(conversationId);
      const updated = await conversationRepository.assignUser(conversationId, assignUserId);
      await publishConversationAssigned(
        conversationId,
        (existing as any)?.assignedTo ?? undefined,
        assignUserId,
        (request as any).user?.id,
      );
      return reply.status(200).send(updated);
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
  });

  app.post('/conversations/:conversationId/close', {
    preHandler: [authenticate as any, requirePermission('chat:write') as any],
  }, async (request, reply) => {
    try {
      const params = request.params as { conversationId: string };
      const { conversationId } = params;
      const userId = (request as any).user?.id;
      const updated = await conversationRepository.close(conversationId);
      await conversationRepository.addStatusHistory(conversationId, 'finalizado', userId, 'Conversa fechada');
      return reply.status(200).send(updated);
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
  });

  app.post('/conversations/:conversationId/mark-read', {
    preHandler: authenticate,
  }, async (request: FastifyRequest<{ Params: { conversationId: string } }>, reply: FastifyReply) => {
    try {
      const { conversationId } = request.params;
      await db.update(schema.messages).set({ status: 'delivered' }).where(and(
        eq(schema.messages.conversationId, conversationId),
        eq(schema.messages.direction, 'inbound'),
        eq(schema.messages.status, 'pending')
      ));
      return reply.status(200).send({ success: true });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
  });
}
