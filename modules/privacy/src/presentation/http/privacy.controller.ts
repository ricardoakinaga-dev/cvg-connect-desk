import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authenticate, requirePermission } from '@cvg/auth';
import { exportContactData, anonymizeContactData } from '../../application/data-subject-service';
import { exportContactDataScoped } from '../../application/scoped-export';
import { buildContactInventory } from '../../application/data-inventory';
import {
  cancelPrivacyOperation,
  getPrivacyOperation,
  resumeContactErasure,
  runContactErasure,
  type RunErasureFailureReason,
} from '../../application/erasure-operation';
import { resolveActorScope, type PrivacyActorLike } from '../../application/privacy-access';
import { recordPrivacyRefusal } from '../../application/privacy-audit';
import { loadContactGraph, normalizeScope, type InventoryScope } from '../../application/contact-graph';

/**
 * DSAR endpoints (Final-9 + AAA-17/C07 + PROD-16/BK13).
 *
 * Compatibilidade preservada:
 *   - `GET /privacy/contacts/:id/export` (global) continua integral para quem
 *     tem escopo global; ator setorial é direcionado a `scope=authorized`;
 *   - `POST /privacy/contacts/:id/anonymize` continua o caminho legado, agora
 *     sempre revalidado no escopo ATUAL do ator.
 *
 * Regras PROD-16 (chat:read/admin revalidados pela fonte efetiva D01):
 *   - consulta/listagem/retomada/cancelamento revalidam ator+escopo atuais;
 *   - operação fora do escopo responde 404 sem revelar existência/relatório;
 *   - `requestId` é vinculado a ator+contato+modo+escopo; reuso divergente é
 *     409 sem relatório alheio;
 *   - exclusão irreversível exige `confirmIrreversible: true` e é auditada;
 *   - toda recusa de escopo/confirmação é auditada sem PII.
 */

function privacyActor(request: FastifyRequest): { actorId: string; profile: PrivacyActorLike } {
  const profile = (request.user ?? {}) as PrivacyActorLike;
  return { actorId: request.user?.id || 'unknown', profile };
}

async function resolveScope(request: FastifyRequest): Promise<Required<InventoryScope>> {
  const { profile } = privacyActor(request);
  return resolveActorScope(profile);
}

function scopeForAudit(scope: Required<InventoryScope>): InventoryScope {
  return { all: scope.all, sectorIds: scope.sectorIds };
}

function sendErasureFailure(reply: FastifyReply, reason: RunErasureFailureReason) {
  switch (reason) {
    case 'conflict':
      return reply.status(409).send({
        error: 'REQUEST_ID_CONFLICT',
        message: 'requestId already bound to another actor/contact/payload',
      });
    case 'confirmation_required':
      return reply.status(409).send({
        error: 'IRREVERSIBLE_CONFIRMATION_REQUIRED',
        message: 'Explicit confirmation is required for irreversible deletion',
      });
    case 'not_resumable':
      return reply.status(409).send({
        error: 'OPERATION_NOT_RESUMABLE',
        message: 'Operation is not resumable',
      });
    case 'not_found':
    case 'out_of_scope':
    default:
      return reply.status(404).send({
        error: 'NOT_FOUND',
        message: 'Contact or operation not found in authorized scope',
      });
  }
}

export async function registerPrivacyRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string }; Querystring: { reason: string; requestId?: string; scope?: 'full' | 'authorized' } }>(
    '/privacy/contacts/:id/export',
    {
      preHandler: [authenticate, requirePermission('admin:read')],
      schema: {
        description: 'Exporta dados do titular (global; escopo autorizado com scope=authorized)',
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
      const { actorId } = privacyActor(request);
      const actorScope = await resolveScope(request);

      if (request.query.scope === 'authorized') {
        const scoped = await exportContactDataScoped({
          contactId: request.params.id,
          actor: {
            userId: actorId,
            reason: request.query.reason,
            requestId: request.query.requestId,
          },
          scope: actorScope,
        });
        if (!scoped.ok) {
          if (scoped.reason === 'out_of_scope') {
            await recordPrivacyRefusal({
              actorId,
              action: 'lgpd.export.refused',
              reasonCode: 'contact-out-of-scope',
              entityType: 'contact',
              entityId: request.params.id,
              requestId: request.query.requestId,
              scope: scopeForAudit(actorScope),
            });
          }
          return reply.status(404).send({ error: 'NOT_FOUND', message: 'Contact not found in authorized scope' });
        }
        return reply.status(200).send(scoped.data);
      }

      // Export integral NUNCA atravessa setor: exige escopo global (Admin).
      if (!actorScope.all) {
        await recordPrivacyRefusal({
          actorId,
          action: 'lgpd.export.refused',
          reasonCode: 'full-export-denied',
          entityType: 'contact',
          entityId: request.params.id,
          requestId: request.query.requestId,
          scope: scopeForAudit(actorScope),
        });
        return reply.status(403).send({
          error: 'FULL_EXPORT_DENIED',
          message: 'Full export requires global scope; use scope=authorized',
        });
      }

      const data = await exportContactData(request.params.id, {
        userId: actorId,
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
      const { actorId } = privacyActor(request);
      const actorScope = await resolveScope(request);
      const inventory = await buildContactInventory({ contactId: request.params.id, scope: actorScope });
      if (!inventory) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Contact not found' });
      }
      if (!actorScope.all && !inventory.contactInScope) {
        await recordPrivacyRefusal({
          actorId,
          action: 'lgpd.inventory.refused',
          reasonCode: 'contact-out-of-scope',
          entityType: 'contact',
          entityId: request.params.id,
          scope: scopeForAudit(actorScope),
        });
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Contact not found in authorized scope' });
      }
      return reply.status(200).send(inventory);
    },
  );

  app.post<{
    Params: { id: string };
    Body: { reason: string; requestId?: string; dryRun?: boolean; confirmIrreversible?: boolean };
  }>(
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
            confirmIrreversible: { type: 'boolean' },
          },
          required: ['reason'],
        },
      },
    },
    async (
      request,
      reply,
    ) => {
      const { actorId } = privacyActor(request);
      try {
        const actorScope = await resolveScope(request);
        const result = await runContactErasure({
          contactId: request.params.id,
          actor: {
            userId: actorId,
            reason: request.body.reason,
          },
          scope: actorScope,
          requestId: request.body.requestId,
          dryRun: request.body.dryRun,
          confirmIrreversible: request.body.confirmIrreversible,
        });
        if (!result.ok) {
          if (result.reason === 'out_of_scope' || result.reason === 'not_found') {
            await recordPrivacyRefusal({
              actorId,
              action: 'lgpd.pseudonymize.refused',
              reasonCode: 'contact-out-of-scope',
              entityType: 'contact',
              entityId: request.params.id,
              requestId: request.body.requestId,
              scope: scopeForAudit(actorScope),
            });
          }
          return sendErasureFailure(reply, result.reason);
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
        description: 'Estado/relatório de uma operação de privacidade (checkpoint; escopo atual do ator)',
        tags: ['Privacy'],
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
          required: ['id'],
        },
      },
    },
    async (request, reply) => {
      const { actorId } = privacyActor(request);
      const actorScope = await resolveScope(request);
      const result = await getPrivacyOperation(request.params.id, { actorId, scope: actorScope });
      if (!result.ok) {
        if (result.reason === 'out_of_scope') {
          await recordPrivacyRefusal({
            actorId,
            action: 'lgpd.operation.refused',
            reasonCode: 'operation-out-of-scope',
            entityType: 'privacy_operation',
            entityId: request.params.id,
            scope: scopeForAudit(actorScope),
          });
        }
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Operation not found' });
      }
      return reply.status(200).send(result.report);
    },
  );

  app.post<{ Params: { id: string }; Body?: { reason?: string; confirmIrreversible?: boolean } }>(
    '/privacy/operations/:id/resume',
    {
      preHandler: [authenticate, requirePermission('admin:write')],
      schema: {
        description: 'Retoma operação de privacidade a partir do checkpoint persistido, no escopo atual do ator',
        tags: ['Privacy'],
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
          required: ['id'],
        },
        body: {
          type: 'object',
          properties: {
            reason: { type: 'string', maxLength: 500 },
            confirmIrreversible: { type: 'boolean' },
          },
        },
      },
    },
    async (request, reply) => {
      const { actorId } = privacyActor(request);
      try {
        const actorScope = await resolveScope(request);
        const result = await resumeContactErasure({
          operationId: request.params.id,
          actor: { userId: actorId, reason: request.body?.reason ?? 'resume' },
          scope: actorScope,
          confirmIrreversible: request.body?.confirmIrreversible,
        });
        if (!result.ok) {
          if (result.reason === 'out_of_scope') {
            await recordPrivacyRefusal({
              actorId,
              action: 'lgpd.operation.refused',
              reasonCode: 'operation-out-of-scope',
              entityType: 'privacy_operation',
              entityId: request.params.id,
              scope: scopeForAudit(actorScope),
            });
          }
          return sendErasureFailure(reply, result.reason);
        }
        return reply.status(200).send(result.report);
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Privacy operation failed' });
      }
    },
  );

  app.post<{ Params: { id: string }; Body?: { reason?: string } }>(
    '/privacy/operations/:id/cancel',
    {
      preHandler: [authenticate, requirePermission('admin:write')],
      schema: {
        description: 'Cancela operação de privacidade não terminal no escopo atual do ator',
        tags: ['Privacy'],
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
          required: ['id'],
        },
        body: {
          type: 'object',
          properties: { reason: { type: 'string', maxLength: 500 } },
        },
      },
    },
    async (request, reply) => {
      const { actorId } = privacyActor(request);
      try {
        const actorScope = await resolveScope(request);
        const result = await cancelPrivacyOperation({
          operationId: request.params.id,
          actor: { userId: actorId, reason: request.body?.reason ?? 'cancel' },
          scope: actorScope,
        });
        if (!result.ok) {
          if (result.reason === 'out_of_scope') {
            await recordPrivacyRefusal({
              actorId,
              action: 'lgpd.operation.refused',
              reasonCode: 'operation-out-of-scope',
              entityType: 'privacy_operation',
              entityId: request.params.id,
              scope: scopeForAudit(actorScope),
            });
          }
          return sendErasureFailure(reply, result.reason);
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
      const { actorId } = privacyActor(request);
      const actorScope = await resolveScope(request);
      const graph = await loadContactGraph(request.params.id, actorScope);
      const normalized = normalizeScope(actorScope);
      if (!graph || (!normalized.all && !graph.contactInScope)) {
        await recordPrivacyRefusal({
          actorId,
          action: 'lgpd.anonymize.refused',
          reasonCode: 'contact-out-of-scope',
          entityType: 'contact',
          entityId: request.params.id,
          requestId: request.body.requestId,
          scope: scopeForAudit(normalized),
        });
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Contact not found in authorized scope' });
      }
      const result = await anonymizeContactData(request.params.id, {
        userId: actorId,
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
