import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate, requirePermission } from '@cvg/auth';
import { exportContactData, anonymizeContactData } from '../../application/data-subject-service';

/**
 * DSAR endpoints (Final-9). Autorização forte + audit em todas as operações.
 * - export: admin:read (leitura de PII completa — auditada);
 * - anonymize: admin:write (irreversível — auditada com actor/reason/requestId).
 */
export async function registerPrivacyRoutes(app: FastifyInstance) {
  app.get(
    '/privacy/contacts/:id/export',
    {
      preHandler: [authenticate, requirePermission('admin:read')],
      schema: {
        description: 'Exporta todos os dados do titular (LGPD art. 18)',
        tags: ['Privacy'],
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
          required: ['id'],
        },
        querystring: {
          type: 'object',
          properties: {
            reason: { type: 'string', maxLength: 500 },
            requestId: { type: 'string', maxLength: 128 },
          },
          required: ['reason'],
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string }; Querystring: { reason: string; requestId?: string } }>, reply: FastifyReply) => {
      const data = await exportContactData(request.params.id, {
        userId: request.user?.id || 'unknown',
        reason: request.query.reason,
        requestId: request.query.requestId,
      });
      if (!data) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Contact not found' });
      }
      return reply.status(200).send(data);
    },
  );

  app.post(
    '/privacy/contacts/:id/anonymize',
    {
      preHandler: [authenticate, requirePermission('admin:write')],
      schema: {
        description: 'Anonimiza PII direto do titular, preservando histórico (LGPD art. 18)',
        tags: ['Privacy'],
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
          required: ['id'],
        },
        body: {
          type: 'object',
          properties: {
            reason: { type: 'string', minLength: 1, maxLength: 500 },
            requestId: { type: 'string', maxLength: 128 },
          },
          required: ['reason'],
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string }; Body: { reason: string; requestId?: string } }>, reply: FastifyReply) => {
      const result = await anonymizeContactData(request.params.id, {
        userId: request.user?.id || 'unknown',
        reason: request.body.reason,
        requestId: request.body.requestId,
      });
      if (!result) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Contact not found' });
      }
      return reply.status(200).send(result);
    },
  );
}
