import type { FastifyInstance } from 'fastify';
import { authenticate, authorizeConversationResource, requirePermission } from '@cvg/auth';
import { conversationRepository } from '../../infrastructure/repositories/conversation.repository';

/**
 * PROD-14/AC2 — leitura de mídia privada por HTTP autenticado.
 *
 *   GET /conversations/:conversationId/media/:assetId
 *
 * Mesma permissão/autorização de conversa do restante do chat
 * (`chat:read` + recurso). O asset precisa estar CLEAN+STORED e vinculado à
 * conversa; os bytes são servidos pelo próprio API (nenhuma URL pública de
 * storage é exposta ao consumidor) com TTL de cache privado alinhado a
 * `MEDIA_SIGNED_URL_TTL_SECONDS`.
 */

interface ErrorBodyInput {
  code: string;
  message: string;
  statusCode: number;
  retryable?: boolean;
  extra?: Record<string, unknown>;
}

function errorBody({ code, message, statusCode, retryable, extra }: ErrorBodyInput) {
  return {
    error: code,
    message,
    statusCode,
    recoverable: statusCode === 503 || retryable === true,
    ...(retryable !== undefined ? { retryable } : {}),
    ...extra,
    timestamp: new Date().toISOString(),
  };
}

export async function registerMediaReadController(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { conversationId: string; assetId: string } }>(
    '/conversations/:conversationId/media/:assetId',
    {
      preHandler: [authenticate, requirePermission('chat:read')],
      schema: {
        description: 'Leitura autorizada de mídia privada (somente asset CLEAN+STORED da conversa)',
        tags: ['Chat'],
        params: {
          type: 'object',
          properties: {
            conversationId: { type: 'string', format: 'uuid' },
            assetId: { type: 'string', format: 'uuid' },
          },
          required: ['conversationId', 'assetId'],
        },
      },
    },
    async (request, reply) => {
      const { conversationId, assetId } = request.params;

      const conversation = await conversationRepository.findById(conversationId);
      const access = await authorizeConversationResource({
        actor: request.user,
        action: 'chat:read',
        conversation,
        requiredLevel: 'read',
      });
      if (!access.allowed) {
        return reply.status(access.statusCode).send(errorBody({
          code: access.error,
          message: access.message,
          statusCode: access.statusCode,
          retryable: false,
        }));
      }

      try {
        const { resolveDeliverableAsset, getMediaStorage } = await import('@cvg/media');
        const delivery = await resolveDeliverableAsset({ assetId, conversationId });
        if (!delivery.ok) {
          // Não revelar existência de asset de outra conversa/sem vínculo.
          if (delivery.reason === 'asset_not_found' || delivery.reason === 'wrong_conversation' || delivery.reason === 'asset_unbound') {
            if (delivery.reason === 'wrong_conversation') {
              request.log.warn(
                { assetId, conversationId },
                '[media] tentativa de leitura de asset de outra conversa negada',
              );
            }
            return reply.status(404).send(errorBody({
              code: 'MEDIA_ASSET_NOT_FOUND',
              message: 'Asset de mídia indisponível',
              statusCode: 404,
              retryable: false,
            }));
          }

          const scanStatus = delivery.scanStatus;
          if (scanStatus === 'INFECTED') {
            return reply.status(422).send(errorBody({
              code: 'MEDIA_ASSET_INFECTED',
              message: 'Asset de mídia infectado e em quarentena; nunca será entregue',
              statusCode: 422,
              retryable: false,
              extra: { scanStatus, storageStatus: delivery.storageStatus },
            }));
          }
          if (scanStatus === 'SCAN_FAILED') {
            return reply.status(503).send(errorBody({
              code: 'MEDIA_ASSET_SCAN_FAILED',
              message: 'Scan de mídia falhou (timeout/indisponível); tentativa recuperável',
              statusCode: 503,
              retryable: true,
              extra: { scanStatus, storageStatus: delivery.storageStatus },
            }));
          }
          if (scanStatus === 'PENDING_SCAN' || scanStatus === undefined) {
            return reply.status(409).send(errorBody({
              code: 'MEDIA_ASSET_PENDING_SCAN',
              message: 'Asset de mídia ainda em análise; indisponível até CLEAN',
              statusCode: 409,
              retryable: true,
              extra: { scanStatus: scanStatus ?? 'PENDING_SCAN', storageStatus: delivery.storageStatus },
            }));
          }
          return reply.status(409).send(errorBody({
            code: 'MEDIA_ASSET_NOT_READY',
            message: 'Asset de mídia indisponível para leitura',
            statusCode: 409,
            retryable: true,
            extra: { scanStatus, storageStatus: delivery.storageStatus },
          }));
        }

        const storage = getMediaStorage();
        const bytes = await storage.get(delivery.asset.storageKey as string);
        const ttlSeconds = Math.max(1, Number(process.env.MEDIA_SIGNED_URL_TTL_SECONDS) || 300);
        reply.header('content-type', delivery.asset.mimeType || 'application/octet-stream');
        reply.header('content-length', String(bytes.length));
        // Sem URL pública: os bytes são proxiados pela rota autorizada e só o
        // cache PRIVADO do cliente respeita o TTL do storage.
        reply.header('cache-control', `private, max-age=${ttlSeconds}`);
        reply.header('x-content-type-options', 'nosniff');
        return reply.status(200).send(bytes);
      } catch (error) {
        request.log.error({ err: error, assetId }, '[media] falha ao ler asset');
        return reply.status(503).send(errorBody({
          code: 'MEDIA_STORAGE_UNAVAILABLE',
          message: 'Armazenamento de mídia indisponível; tentativa recuperável',
          statusCode: 503,
          retryable: true,
        }));
      }
    },
  );
}
