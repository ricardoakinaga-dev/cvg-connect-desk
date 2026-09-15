import { FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { AppError } from '@cvg/shared';
import { authenticate, authorizeConversationResource, requirePermission } from '@cvg/auth';
import { conversationRepository } from '../../infrastructure/repositories/conversation.repository';
import {
  changeConversationState,
  assignConversation,
  handoffConversation,
  CONVERSATION_STATUS_V2,
  CONVERSATION_HANDLERS,
  type ConversationStatusV2,
  type ConversationHandler,
} from '../../application/use-cases/conversation-operations.use-case';

interface ConversationParams {
  id: string;
}

/** Correlação estável da ação (PROD-18/AC2): header ou request id. */
function requestCorrelationId(request: FastifyRequest): string {
  const header = request.headers['x-correlation-id'];
  return (typeof header === 'string' && header.trim()) || String(request.id);
}

async function authorizeWrite(request: FastifyRequest, conversationId: string) {
  const conversation = await conversationRepository.findById(conversationId);
  return authorizeConversationResource({
    actor: request.user,
    action: 'chat:write',
    conversation,
    requiredLevel: 'write',
  });
}

function replyFromAppError(reply: FastifyReply, error: unknown) {
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({ error: error.code, message: error.message });
  }
  return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to update conversation' });
}

/**
 * PROD-18 — operações públicas de operação do atendimento (C07/UI05):
 * estado, atribuição e handoff transacionais, com ação+recurso, CAS (409) e
 * erros 401/403/404 estáveis. Registradas junto ao controller de conversas
 * existente para não duplicar rotas.
 */
export async function registerConversationOperations(app: FastifyInstance) {
  app.patch<{ Params: ConversationParams; Body: { statusV2: ConversationStatusV2; expectedStatusV2?: ConversationStatusV2; expectedUpdatedAt?: string; reason?: string } }>(
    '/conversations/:id/state',
    {
      preHandler: [authenticate, requirePermission('chat:write')],
      schema: {
        description: 'Alterar estado (statusV2) da conversa com CAS e auditoria',
        tags: ['Chat'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
          required: ['id'],
        },
        body: {
          type: 'object',
          properties: {
            statusV2: { type: 'string', enum: [...CONVERSATION_STATUS_V2] },
            expectedStatusV2: { type: 'string', enum: [...CONVERSATION_STATUS_V2] },
            expectedUpdatedAt: { type: 'string', format: 'date-time' },
            reason: { type: 'string', maxLength: 500 },
          },
          required: ['statusV2'],
        },
      },
    },
    async (request, reply) => {
      try {
        const access = await authorizeWrite(request, request.params.id);
        if (!access.allowed) {
          return reply.status(access.statusCode).send({ error: access.error, message: access.message });
        }

        const result = await changeConversationState({
          conversationId: request.params.id,
          statusV2: request.body.statusV2,
          expectedStatusV2: request.body.expectedStatusV2,
          expectedUpdatedAt: request.body.expectedUpdatedAt,
          reason: request.body.reason,
          actorId: request.user!.id,
          correlationId: requestCorrelationId(request),
        });

        if (result.isErr()) {
          return replyFromAppError(reply, result.error);
        }
        return reply.status(200).send(result.value);
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to update conversation state' });
      }
    },
  );

  app.post<{ Params: ConversationParams; Body: { assigneeId: string; expectedAssignedUserId?: string | null; expectedUpdatedAt?: string } }>(
    '/conversations/:id/assign',
    {
      preHandler: [authenticate, requirePermission('chat:write')],
      schema: {
        description: 'Atribuir responsável pela conversa com CAS e auditoria',
        tags: ['Chat'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
          required: ['id'],
        },
        body: {
          type: 'object',
          properties: {
            assigneeId: { type: 'string', format: 'uuid' },
            expectedAssignedUserId: {
              anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }],
            },
            expectedUpdatedAt: { type: 'string', format: 'date-time' },
          },
          required: ['assigneeId'],
        },
      },
    },
    async (request, reply) => {
      try {
        const access = await authorizeWrite(request, request.params.id);
        if (!access.allowed) {
          return reply.status(access.statusCode).send({ error: access.error, message: access.message });
        }

        const result = await assignConversation({
          conversationId: request.params.id,
          assigneeId: request.body.assigneeId,
          expectedAssignedUserId: request.body.expectedAssignedUserId,
          expectedUpdatedAt: request.body.expectedUpdatedAt,
          actorId: request.user!.id,
          correlationId: requestCorrelationId(request),
        });

        if (result.isErr()) {
          return replyFromAppError(reply, result.error);
        }
        return reply.status(200).send(result.value);
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to assign conversation' });
      }
    },
  );

  app.post<{ Params: ConversationParams; Body: { newHandler: ConversationHandler; expectedHandler?: ConversationHandler; expectedUpdatedAt?: string; reason?: string } }>(
    '/conversations/:id/handoff',
    {
      preHandler: [authenticate, requirePermission('chat:write')],
      schema: {
        description: 'Handoff bot/humano da conversa com CAS, auditoria e eventos',
        tags: ['Chat'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
          required: ['id'],
        },
        body: {
          type: 'object',
          properties: {
            newHandler: { type: 'string', enum: [...CONVERSATION_HANDLERS] },
            expectedHandler: { type: 'string', enum: [...CONVERSATION_HANDLERS] },
            expectedUpdatedAt: { type: 'string', format: 'date-time' },
            reason: { type: 'string', maxLength: 500 },
          },
          required: ['newHandler'],
        },
      },
    },
    async (request, reply) => {
      try {
        const access = await authorizeWrite(request, request.params.id);
        if (!access.allowed) {
          return reply.status(access.statusCode).send({ error: access.error, message: access.message });
        }

        const result = await handoffConversation({
          conversationId: request.params.id,
          newHandler: request.body.newHandler,
          expectedHandler: request.body.expectedHandler,
          expectedUpdatedAt: request.body.expectedUpdatedAt,
          reason: request.body.reason,
          actorId: request.user!.id,
          correlationId: requestCorrelationId(request),
        });

        if (result.isErr()) {
          return replyFromAppError(reply, result.error);
        }
        return reply.status(200).send(result.value);
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to handoff conversation' });
      }
    },
  );
}
