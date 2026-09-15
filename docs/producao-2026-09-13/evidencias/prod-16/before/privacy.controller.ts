import { FastifyInstance } from 'fastify';
import { authenticate, requirePermission, sectorPermissionService } from '@cvg/auth';
import { exportContactData, anonymizeContactData } from '../../application/data-subject-service';
import { exportContactDataScoped } from '../../application/scoped-export';
import { buildContactInventory } from '../../application/data-inventory';
import { getPrivacyOperation, resumeContactErasure, runContactErasure } from '../../application/erasure-operation';
import type { InventoryScope } from '../../application/contact-graph';

/**
 * DSAR endpoints (Final-9 + AAA-17/C07).
 *
 * Compatibilidade preservada:
 *   - `GET /privacy/contacts/:id/export` (admin) continua integral;
 *   - `POST /privacy/contacts/:id/anonymize` continua sendo o caminho
 *     legado (pseudonimização direta do contato), com o mesmo contrato.
 *
 * C07 (escopo + política D02):
 *   - `GET .../export?scope=authorized` respeita o setor do ator;
 *   - `GET .../inventory` inventaria todas as cópias para o escopo do ator;
 *   - `POST .../erasure` executa/planeja a política por configuração
 *     (default dry-run; nunca eliminação irreversível sem flag explícita);
 *   - operações retomáveis: `GET /privacy/operations/:id` e
 *     `POST /privacy/operations/:id/resume`.
 */

async function resolveActorScope(user: { id?: string; roles?: string[] } | undefined): Promise<InventoryScope> {
  if (!user?.id) return { all: false, sectorIds: [] };
  if ((user.roles ?? []).includes('Admin')) return { all: true };
  if (await sectorPermissionService.isGlobalAdmin(user.id)) return { all: true };
  const sectorIds = await sectorPermissionService.getUserSectorIds(user.id);
  return { all: false, sectorIds };
}

export async function registerPrivacyRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string }; Querystring: { reason: string; requestId?: string; scope?: 'full' | 'authorized' } }>(
    '/privacy/contacts/:id/export',
    {
      preHandler: [authenticate, requirePermission('admin:read')],
      schema: {
        description: 'Exporta dados do titular (integral para admin; escopo autorizado com scope=authorized)',
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
            scope: { type: 'string', enum: ['full', 'authorized'] },
          },
          required: ['reason'],
        },
      },
    },
    async (
      request,
      reply,
    ) => {
      if (request.query.scope === 'authorized') {
        const actorScope = await resolveActorScope(request.user);
        const scoped = await exportContactDataScoped({
          contactId: request.params.id,
          actor: {
            userId: request.user?.id || 'unknown',
            reason: request.query.reason,
            requestId: request.query.requestId,
          },
          scope: actorScope,
        });
        if (!scoped.ok) {
          return reply.status(404).send({ error: 'NOT_FOUND', message: 'Contact not found in authorized scope' });
        }
        return reply.status(200).send(scoped.data);
      }

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

  app.get<{ Params: { id: string } }>(
    '/privacy/contacts/:id/inventory',
    {
      preHandler: [authenticate, requirePermission('admin:read')],
      schema: {
        description: 'Inventário de cópias do titular no escopo autorizado do ator (C07)',
        tags: ['Privacy'],
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
          required: ['id'],
        },
      },
    },
    async (request, reply) => {
      const actorScope = await resolveActorScope(request.user);
      const inventory = await buildContactInventory({ contactId: request.params.id, scope: actorScope });
      if (!inventory) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Contact not found' });
      }
      return reply.status(200).send(inventory);
    },
  );

  app.post<{ Params: { id: string }; Body: { reason: string; requestId?: string; dryRun?: boolean } }>(
    '/privacy/contacts/:id/erasure',
    {
      preHandler: [authenticate, requirePermission('admin:write')],
      schema: {
        description: 'Planeja/executa pseudonimização conforme política configurada (default dry-run, D02 pendente)',
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
            dryRun: { type: 'boolean' },
          },
          required: ['reason'],
        },
      },
    },
    async (
      request,
      reply,
    ) => {
      try {
        const actorScope = await resolveActorScope(request.user);
        const result = await runContactErasure({
          contactId: request.params.id,
          actor: {
            userId: request.user?.id || 'unknown',
            reason: request.body.reason,
          },
          scope: actorScope,
          requestId: request.body.requestId,
          dryRun: request.body.dryRun,
        });
        if (!result.ok) {
          return reply.status(404).send({ error: 'NOT_FOUND', message: 'Contact not found in authorized scope' });
        }
        return reply.status(200).send(result.report);
      } catch (error) {
        request.log.error(error);
        const operationId = (error as { operationId?: string }).operationId;
        return reply.status(500).send({
          error: 'PRIVACY_OPERATION_FAILED',
          message: 'Privacy operation failed',
          ...(operationId ? { operationId } : {}),
        });
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    '/privacy/operations/:id',
    {
      preHandler: [authenticate, requirePermission('admin:read')],
      schema: {
        description: 'Estado/relatório de uma operação de privacidade (checkpoint)',
        tags: ['Privacy'],
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
          required: ['id'],
        },
      },
    },
    async (request, reply) => {
      const report = await getPrivacyOperation(request.params.id);
      if (!report) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Operation not found' });
      }
      return reply.status(200).send(report);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/privacy/operations/:id/resume',
    {
      preHandler: [authenticate, requirePermission('admin:write')],
      schema: {
        description: 'Retoma operação de privacidade a partir do checkpoint persistido',
        tags: ['Privacy'],
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
          required: ['id'],
        },
      },
    },
    async (request, reply) => {
      try {
        const result = await resumeContactErasure(request.params.id);
        if (!result.ok) {
          return reply.status(404).send({ error: 'NOT_FOUND', message: 'Operation not resumable' });
        }
        return reply.status(200).send(result.report);
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Privacy operation failed' });
      }
    },
  );

  app.post<{ Params: { id: string }; Body: { reason: string; requestId?: string } }>(
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
    async (request, reply) => {
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
