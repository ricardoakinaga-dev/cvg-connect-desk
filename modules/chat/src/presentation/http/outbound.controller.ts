import { FastifyInstance } from 'fastify';
import { sendOutboundMessage } from '../../application/use-cases/send-outbound-message.use-case';
import { conversationRepository, conversationCursorScope, decodeConversationCursor, encodeConversationCursor } from '../../infrastructure/repositories/conversation.repository';
import { messageRepository } from '../../infrastructure/repositories/message.repository';
import { AppError, messagesOutboundTotal } from '@cvg/shared';
import { authenticate, authorize, authorizeConversationResource, requirePermission, sectorPermissionService } from '@cvg/auth';
import { inArray } from 'drizzle-orm';
import { toSanitizedMessage } from './message-dto';
import { registerConversationOperations } from './conversation-operations.controller';

interface SendMessageBody {
  conversationId: string;
  content?: string;
  recipient?: string;
  sender?: string;
  /** C05: anexo por referência a asset autorizado (upload dedicado). */
  mediaAssetId?: string;
  mediaUrl?: string;
  mediaType?: string;
  mediaMimetype?: string;
  mediaFilename?: string;
  clientMessageId?: string;
}

export async function registerOutboundController(app: FastifyInstance) {
  app.post<{ Body: SendMessageBody }>(
    '/messages',
    {
      preHandler: [authenticate, requirePermission('chat:write')],
      schema: {
        body: {
          type: 'object',
          properties: {
            conversationId: { type: 'string', format: 'uuid' },
            content: { type: 'string' },
            recipient: { type: 'string' },
            sender: { type: 'string' },
            mediaAssetId: { type: 'string', format: 'uuid' },
            mediaUrl: { type: 'string' },
            mediaType: { type: 'string', enum: ['image', 'audio', 'video', 'document'] },
            mediaMimetype: { type: 'string' },
            mediaFilename: { type: 'string' },
            clientMessageId: { type: 'string', maxLength: 128 },
          },
          required: ['conversationId'],
        },
      },
    },
    async (request, reply) => {
      try {
        const { conversationId, content, recipient, sender, mediaAssetId, mediaUrl, mediaType, mediaMimetype, mediaFilename, clientMessageId } = request.body;
        const userId = request.user?.id;
        const headerKey = request.headers['idempotency-key'];
        const idempotencyKey = (typeof headerKey === 'string' && headerKey.trim()) || clientMessageId;

        const conversation = await conversationRepository.findById(conversationId);
        const access = await authorizeConversationResource({
          actor: request.user,
          action: 'chat:write',
          conversation,
          requiredLevel: 'write',
        });
        if (!access.allowed) {
          return reply.status(access.statusCode).send({ error: access.error, message: access.message });
        }

        const result = await sendOutboundMessage({
          conversationId,
          content: content || '',
          recipient,
          sender,
          mediaAssetId,
          mediaUrl,
          mediaType,
          mediaMimetype,
          mediaFilename,
          userId,
          roles: request.user?.roles,
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
          // C04: distingue aceito/pending/sent/failed/unknown-reconciling.
          outcome: result.value.outcome,
          deduplicated: result.value.deduplicated,
          ...(result.value.expired ? { expired: true } : {}),
        });
      } catch (error) {        request.log.error(error);
        return reply.status(500).send({
          error: 'INTERNAL_ERROR',
          message: 'Failed to send message',
        });
      }
    }
  );

  app.get<{ Params: { conversationId: string }; Querystring: { limit?: number } }>(
    '/conversations/:conversationId/messages',
    {
      preHandler: [authenticate, requirePermission('chat:read')],
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
    async (request, reply) => {
      try {
        const { conversationId } = request.params;
        const limit = request.query.limit || 50;

        const conversation = await conversationRepository.findById(conversationId);
        const access = await authorizeConversationResource({
          actor: request.user,
          action: 'chat:read',
          conversation,
          requiredLevel: 'read',
        });
        if (!access.allowed) {
          return reply.status(access.statusCode).send({ error: access.error, message: access.message });
        }

        const { messageRepository } = await import('../../infrastructure/repositories/message.repository');
        const messages = await messageRepository.findRecentByConversationId(conversationId, limit);

        // PROD-14/AC3: DTO nunca entrega URL crua de mídia (não-pronta/anexa
        // referência pública); somente `asset://<id>` publicado após CLEAN.
        return reply.status(200).send({ messages: messages.map(toSanitizedMessage) });
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({
          error: 'INTERNAL_ERROR',
          message: 'Failed to fetch messages',
        });
      }
    }
  );

  app.post<{ Params: { conversationId: string } }>(
    '/conversations/:conversationId/read',
    {
      preHandler: [authenticate, requirePermission('chat:read')],
      schema: {
        params: {
          type: 'object',
          properties: { conversationId: { type: 'string', format: 'uuid' } },
          required: ['conversationId'],
        },
      },
    },
    async (request, reply) => {
      const conversation = await conversationRepository.findById(request.params.conversationId);
      const access = await authorizeConversationResource({
        actor: request.user,
        action: 'chat:read',
        conversation,
        requiredLevel: 'read',
      });
      if (!access.allowed) {
        return reply.status(access.statusCode).send({ error: access.error, message: access.message });
      }

      const updated = await conversationRepository.markRead(request.params.conversationId);
      if (!updated) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Conversation not found' });
      }
      return reply.status(200).send({ conversationId: updated.id, unreadCount: updated.unreadCount });
    },
  );

  app.get<{ Querystring: { status?: string; queueId?: string; teamId?: string; sectorId?: string; limit?: number; cursor?: string } }>(
    '/conversations',
    {
      // AC1 (C02): toda variante da listagem exige a permissão de ação antes
      // de qualquer consulta; o escopo de recurso entra em seguida.
      preHandler: [authenticate, requirePermission('chat:read')],
      schema: {
        querystring: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            queueId: { type: 'string', format: 'uuid' },
            teamId: { type: 'string', format: 'uuid' },
            sectorId: { type: 'string', format: 'uuid' },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
            cursor: { type: 'string', maxLength: 4096 },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const { status, queueId, teamId, sectorId, cursor: rawCursor } = request.query;
        const limit = request.query.limit ?? 50;
        const userId = (request.user as any)?.id;
        const roles = (request.user?.roles ?? []) as string[];

        // Papel global explícito (D01): role Admin OU marcação no banco. Só
        // este caminho dispensa o filtro de memberships — ausência de setores
        // jamais é interpretada como admin.
        const isGlobalAdmin = roles.includes('Admin')
          || (userId ? await sectorPermissionService.isGlobalAdmin(userId) : false);

        // Zero-trust (§7.2): filtro explícito de setor exige membership;
        // sem setores atribuídos, não-admin não enxerga nada (default-deny).
        if (sectorId) {
          const decision = await authorize(
            {
              id: userId,
              roles,
              // F2: a decisão por ação usa a fonte efetiva do banco, não só o
              // catálogo estático; sem o campo o papel customizado era negado.
              permissions: request.user?.permissions,
              permissionsAuthoritative: request.user?.permissionsAuthoritative,
            },
            'chat:read',
            { type: 'conversation', sectorId },
          );
          if (!decision.allowed) {
            return reply.status(403).send({ error: 'FORBIDDEN', message: 'No access to this sector' });
          }
        } else if (!isGlobalAdmin) {
          const memberOf = await sectorPermissionService.getUserSectorIds(userId);
          if (memberOf.length === 0) {
            return reply.status(200).send({ items: [], conversations: [], nextCursor: null });
          }
        }

        // Recusa antecipada acima é só UX; o filtro efetivo é recalculado pelo
        // repositório na query (não confia na decisão da rota — TOCTOU).
        const filters = { status, queueId, teamId, sectorId, userId, globalAdmin: isGlobalAdmin };
        const scope = conversationCursorScope(userId, filters);

        let cursor: ReturnType<typeof decodeConversationCursor> = null;
        if (rawCursor !== undefined) {
          // Autorização precede a paginação: o cursor só é aceito depois do
          // escopo autorizado (e recalculado no servidor); inválido -> 400 seco.
          cursor = decodeConversationCursor(rawCursor, scope);
          if (!cursor) {
            return reply.status(400).send({ error: 'INVALID_CURSOR', message: 'Invalid cursor' });
          }
        }

        const page = await conversationRepository.findPage(filters, limit, cursor);
        const conversations = page.items;

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

        const conversationsWithLastMessage = await (async () => {
          // Última mensagem/inbound da PÁGINA selecionadas no banco com
          // LATERAL + LIMIT 1 (uma sondagem de índice por conversa, sem N+1 e
          // sem transferir histórico). DTO existente preservado.
          const conversationIds = conversations.map((conv) => conv.id);
          const [latestByConversation, latestInboundByConversation] = await Promise.all([
            messageRepository.findLatestByConversationIds(conversationIds),
            messageRepository.findLatestInboundByConversationIds(conversationIds),
          ]);
          return conversations.map((conv) => {
            const contact = conv.contactId ? contactsMap.get(conv.contactId) : null;
            const lastMessage = latestByConversation.get(conv.id);
            const lastInboundMessage = latestInboundByConversation.get(conv.id);
            return {
              ...conv,
              contactName: contact?.name || null,
              contactPhone: contact?.phone || null,
              lastMessage: lastMessage ? toSanitizedMessage(lastMessage) : null,
              lastInboundMessage: lastInboundMessage ? toSanitizedMessage(lastInboundMessage) : null,
            };
          });
        })();

        const nextCursor = page.nextKeyset ? encodeConversationCursor(page.nextKeyset, scope) : null;

        // `items` é o nome canônico de C06; `conversations` permanece como
        // alias legado para não quebrar o DTO consumido pelo frontend atual.
        return reply.status(200).send({
          items: conversationsWithLastMessage,
          conversations: conversationsWithLastMessage,
          nextCursor,
        });
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({
          error: 'INTERNAL_ERROR',
          message: 'Failed to fetch conversations',
        });
      }
    }
  );

  // PROD-18/UI05: estado/atribuição/handoff transacionais no módulo chat.
  await registerConversationOperations(app);
}
