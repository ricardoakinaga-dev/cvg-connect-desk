import type { FastifyInstance } from 'fastify';
import type { Readable } from 'node:stream';
import {
  AppError,
  getMediaMaxBytes,
  type MediaKind,
} from '@cvg/shared';
import { authenticate, requirePermission, authorizeConversationResource } from '@cvg/auth';
import { conversationRepository } from '../../infrastructure/repositories/conversation.repository';

/**
 * C05 — transporte dedicado de anexos (stream binário, sem base64):
 *   POST /conversations/:conversationId/media
 *   Content-Type: application/octet-stream
 *   X-Media-Type: image|audio|video|document
 *   X-Media-Mimetype: <mime real declarado>
 *   X-Media-Filename: opcional
 *
 * Limite de 16 MiB de conteúdo REAL; excesso → 413 com contrato recuperável.
 * MIME/magic bytes, quarentena e scan CLEAN antes de qualquer entrega.
 */

interface UploadHeaders {
  'x-media-type'?: string;
  'x-media-mimetype'?: string;
  'x-media-filename'?: string;
  'content-length'?: string;
}

function errorBody(
  error: string,
  message: string,
  statusCode: number,
  extra: Record<string, unknown> = {},
) {
  return {
    error,
    message,
    statusCode,
    // 413 (reenviar menor) e 503 (tentar de novo) são recuperáveis; 415/422 não.
    recoverable: statusCode === 413 || statusCode === 503,
    ...extra,
    timestamp: new Date().toISOString(),
  };
}

async function readStreamCapped(stream: Readable, maxBytes: number): Promise<{ bytes?: Buffer; tooLarge: boolean }> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += buffer.length;
    if (total > maxBytes) {
      return { tooLarge: true };
    }
    chunks.push(buffer);
  }
  return { bytes: Buffer.concat(chunks), tooLarge: false };
}

export async function registerMediaUploadController(app: FastifyInstance): Promise<void> {
  const maxBytes = getMediaMaxBytes();

  // Parser dedicado: entrega o stream cru ao handler (nenhuma transformação
  // base64/JSON). O limite duro de Fastify fica alguns KiB acima para que o
  // handler produza o contrato 413 exato; acima disso vira FST_ERR... mapeado
  // pelo error handler global.
  app.addContentTypeParser(
    'application/octet-stream',
    { bodyLimit: maxBytes + 4096 },
    (_request: unknown, payload: unknown, done: (error: Error | null, body?: unknown) => void) => done(null, payload),
  );

  app.post<{ Params: { conversationId: string }; Headers: UploadHeaders }>(
    '/conversations/:conversationId/media',
    {
      preHandler: [authenticate, requirePermission('chat:write')],
      bodyLimit: maxBytes + 4096,
      schema: {
        description: 'Upload dedicado de anexo (bytes reais, sem base64) com scan antes da entrega',
        tags: ['Chat'],
        params: {
          type: 'object',
          properties: { conversationId: { type: 'string', format: 'uuid' } },
          required: ['conversationId'],
        },
      },
    },
    async (
      request,
      reply,
    ) => {
      const { conversationId } = request.params;
      const declaredType = (request.headers['x-media-type'] || '').trim().toLowerCase();
      const declaredMime = (request.headers['x-media-mimetype'] || '').trim().toLowerCase();
      const filename = typeof request.headers['x-media-filename'] === 'string'
        ? request.headers['x-media-filename']
        : undefined;

      if (!declaredType || !declaredMime) {
        return reply.status(400).send(errorBody(
          'MEDIA_METADATA_REQUIRED',
          'Cabeçalhos X-Media-Type e X-Media-Mimetype são obrigatórios no upload',
          400,
        ));
      }

      const contentLength = Number(request.headers['content-length'] || '0');
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        reply.header('connection', 'close');
        return reply.status(413).send(errorBody(
          'PAYLOAD_TOO_LARGE',
          `Conteúdo excede o limite de ${maxBytes} bytes`,
          413,
          { maxBytes, contentLength },
        ));
      }

      const conversation = await conversationRepository.findById(conversationId);
      const access = await authorizeConversationResource({
        actor: request.user,
        action: 'chat:write',
        conversation,
        requiredLevel: 'write',
      });
      if (!access.allowed) {
        return reply.status(access.statusCode).send({
          error: access.error,
          message: access.message,
          statusCode: access.statusCode,
          recoverable: false,
          timestamp: new Date().toISOString(),
        });
      }

      const stream = request.body as Readable | undefined;
      if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') {
        return reply.status(400).send(errorBody('EMPTY_BODY', 'Corpo binário ausente no upload', 400));
      }

      let bytes: Buffer;
      try {
        const read = await readStreamCapped(stream, maxBytes);
        if (read.tooLarge || !read.bytes) {
          reply.header('connection', 'close');
          return reply.status(413).send(errorBody(
            'PAYLOAD_TOO_LARGE',
            `Conteúdo excede o limite de ${maxBytes} bytes`,
            413,
            { maxBytes },
          ));
        }
        bytes = read.bytes;
      } catch (error) {
        // Limite duro do Fastify → 413; stream abortado → 400 (não confundir).
        const code = (error as { code?: string }).code;
        if (code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
          reply.header('connection', 'close');
          return reply.status(413).send(errorBody(
            'PAYLOAD_TOO_LARGE',
            `Conteúdo excede o limite de ${maxBytes} bytes`,
            413,
            { maxBytes },
          ));
        }
        request.log.warn({ err: error }, '[media] stream de upload interrompido');
        return reply.status(400).send(errorBody('UPLOAD_ABORTED', 'Upload interrompido antes de completar os bytes', 400));
      }

      try {
        const { ingestUploadedMedia } = await import('@cvg/media');
        const result = await ingestUploadedMedia({
          conversationId,
          actorId: request.user?.id || 'anonymous',
          mediaType: declaredType as MediaKind,
          mimetype: declaredMime,
          filename,
          bytes,
        });

        if (!result.blocked) {
          return reply.status(201).send({
            assetId: result.assetId,
            mediaType: result.mediaType,
            mimetype: result.mimetype,
            filename: result.filename,
            sizeBytes: result.sizeBytes,
            sha256: result.sha256,
            scanStatus: result.scanStatus,
            storageStatus: result.storageStatus,
          });
        }

        const base = {
          assetId: result.assetId || undefined,
          mediaType: result.mediaType,
          mimetype: result.mimetype,
          filename: result.filename,
          sizeBytes: result.sizeBytes,
          sha256: result.sha256,
          scanStatus: result.scanStatus,
          storageStatus: result.storageStatus,
          reasonCode: result.reasonCode,
        };

        switch (result.reasonCode) {
          case 'media_too_large':
            reply.header('connection', 'close');
            return reply.status(413).send(errorBody('PAYLOAD_TOO_LARGE', result.reason || 'Conteúdo excede o limite', 413, { maxBytes, ...base }));
          case 'mime_not_allowed':
            return reply.status(415).send(errorBody('MEDIA_MIME_NOT_ALLOWED', result.reason || 'MIME não permitido', 415, base));
          case 'executable_content':
            return reply.status(415).send(errorBody('MEDIA_EXECUTABLE_CONTENT', result.reason || 'Conteúdo executável bloqueado', 415, base));
          case 'mime_magic_mismatch':
            return reply.status(415).send(errorBody('MEDIA_MIME_MISMATCH', result.reason || 'Bytes não correspondem ao MIME declarado', 415, base));
          case 'infected':
            return reply.status(422).send(errorBody('MEDIA_INFECTED', result.reason || 'Malware detectado; anexo em quarentena', 422, { ...base, retryable: false }));
          case 'scanner_unavailable':
          case 'scanner_failed':
            return reply.status(503).send(errorBody('SCANNER_UNAVAILABLE', result.reason || 'Scanner indisponível (fail-secure)', 503, { ...base, retryable: true }));
          default:
            return reply.status(503).send(errorBody('MEDIA_UNAVAILABLE', result.reason || 'Falha ao processar anexo', 503, { ...base, retryable: true }));
        }
      } catch (error) {
        request.log.error({ err: error }, '[media] falha no pipeline de upload');
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(errorBody(error.code, error.message, error.statusCode));
        }
        return reply.status(503).send(errorBody('MEDIA_STORAGE_UNAVAILABLE', 'Armazenamento de mídia indisponível; tentativa recuperável', 503, { retryable: true }));
      }
    },
  );
}
