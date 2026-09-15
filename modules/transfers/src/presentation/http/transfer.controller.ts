import { FastifyInstance, type FastifyRequest } from 'fastify';
import { eq, inArray } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { AppError } from '@cvg/shared';
import {
  authenticate,
  authorizeContactResource,
  authorizeConversationResource,
  authorizeSectorScope,
  requirePermission,
  sectorPermissionService,
  type ResourceActor,
} from '@cvg/auth';
import * as useCases from '../../application/use-cases';

interface TransferLike {
  contactId: string;
  conversationId?: string | null;
  toSectorId: string;
  toUserId?: string | null;
}
async function isGlobalAdmin(actor: ResourceActor | undefined): Promise<boolean> {
  if ((actor?.roles ?? []).includes('Admin')) {
    return true;
  }
  return actor?.id ? sectorPermissionService.isGlobalAdmin(actor.id) : false;
}

/** Correlação estável da ação (PROD-18/AC2): header ou request id. */
function requestCorrelationId(request: FastifyRequest): string {
  const header = request.headers['x-correlation-id'];
  return (typeof header === 'string' && header.trim()) || String(request.id);
}

async function contactSectorIds(contactIds: string[]): Promise<Map<string, string[]>> {
  const byContact = new Map<string, string[]>();
  if (contactIds.length === 0) {
    return byContact;
  }
  const links = await db
    .select({ contactId: schema.contactSectors.contactId, sectorId: schema.contactSectors.sectorId })
    .from(schema.contactSectors)
    .where(inArray(schema.contactSectors.contactId, contactIds));
  for (const link of links) {
    const list = byContact.get(link.contactId) ?? [];
    list.push(link.sectorId);
    byContact.set(link.contactId, list);
  }
  return byContact;
}

async function filterTransfersByAccess(
  actor: ResourceActor | undefined,
  transfers: TransferLike[],
): Promise<TransferLike[]> {
  if (!actor?.id) {
    return [];
  }

  if (await isGlobalAdmin(actor)) {
    return transfers;
  }

  const contactIds = Array.from(new Set(transfers.map((transfer) => transfer.contactId)));
  const sectorsByContact = await contactSectorIds(contactIds);

  const conversationIds = Array.from(
    new Set(transfers.map((transfer) => transfer.conversationId).filter((id): id is string => Boolean(id))),
  );
  const conversations = conversationIds.length > 0
    ? await db
        .select({
          id: schema.conversations.id,
          sectorId: schema.conversations.sectorId,
          assignedUserId: schema.conversations.assignedUserId,
        })
        .from(schema.conversations)
        .where(inArray(schema.conversations.id, conversationIds))
    : [];
  const byConversation = new Map(conversations.map((conversation) => [conversation.id, conversation]));

  const visible: TransferLike[] = [];
  for (const transfer of transfers) {
    const contactAccess = await authorizeContactResource({
      actor,
      action: 'contacts:read',
      contact: { id: transfer.contactId, sectorIds: sectorsByContact.get(transfer.contactId) ?? [] },
      requiredLevel: 'read',
    });
    if (!contactAccess.allowed) {
      continue;
    }

    if (transfer.conversationId) {
      const conversationAccess = await authorizeConversationResource({
        actor,
        action: 'contacts:read',
        conversation: byConversation.get(transfer.conversationId) ?? null,
        requiredLevel: 'read',
      });
      if (!conversationAccess.allowed) {
        continue;
      }
    }

    visible.push(transfer);
  }

  return visible;
}

async function authorizeRecipient(actor: ResourceActor | undefined, transfer: TransferLike) {
  if (!actor?.id) {
    return { allowed: false as const, statusCode: 401 as const, error: 'UNAUTHORIZED' as const, message: 'Authentication required' };
  }

  if (await isGlobalAdmin(actor)) {
    return { allowed: true as const };
  }

  if (transfer.toUserId && transfer.toUserId === actor.id) {
    return { allowed: true as const };
  }

  if (transfer.toSectorId && (await sectorPermissionService.hasAccess(actor.id, transfer.toSectorId, 'write'))) {
    return { allowed: true as const };
  }

  return { allowed: false as const, statusCode: 404 as const, error: 'NOT_FOUND' as const, message: 'Transferência não encontrada' };
}

export async function registerTransferRoutes(app: FastifyInstance) {
  // Criar transferência
  app.post('/transfers', {
    preHandler: [authenticate, requirePermission('chat:write')],
    schema: {
      description: 'Transferir contato entre setores',
      tags: ['Transfers'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['contactId', 'toSectorId'],
        properties: {
          contactId: { type: 'string', format: 'uuid' },
          conversationId: { type: 'string', format: 'uuid' },
          toSectorId: { type: 'string', format: 'uuid' },
          fromSectorId: { type: 'string', format: 'uuid' },
          toUserId: { type: 'string', format: 'uuid' },
          reason: { type: 'string', maxLength: 500 },
          autoAccept: { type: 'boolean', default: true },
        },
      },
    },
  }, async (request, reply) => {
    const userId = (request.user as any)?.id;
    const payload = request.body as {
      contactId: string;
      conversationId?: string;
      toSectorId: string;
      fromSectorId?: string;
      toUserId?: string;
      reason?: string;
      autoAccept?: boolean;
    };

    const sectors = await contactSectorIds([payload.contactId]);
    const contactAccess = await authorizeContactResource({
      actor: request.user,
      action: 'contacts:write',
      contact: { id: payload.contactId, sectorIds: sectors.get(payload.contactId) ?? [] },
      requiredLevel: 'write',
    });
    if (!contactAccess.allowed) {
      return reply.status(contactAccess.statusCode).send({ error: contactAccess.error, message: contactAccess.message });
    }

    if (payload.conversationId) {
      const [conversation] = await db
        .select({
          id: schema.conversations.id,
          sectorId: schema.conversations.sectorId,
          assignedUserId: schema.conversations.assignedUserId,
        })
        .from(schema.conversations)
        .where(eq(schema.conversations.id, payload.conversationId));
      const conversationAccess = await authorizeConversationResource({
        actor: request.user,
        action: 'chat:write',
        conversation: conversation ?? null,
        requiredLevel: 'write',
      });
      if (!conversationAccess.allowed) {
        return reply.status(conversationAccess.statusCode).send({ error: conversationAccess.error, message: conversationAccess.message });
      }
    }

    const sectorAccess = await authorizeSectorScope({ actor: request.user, sectorId: payload.toSectorId, requiredLevel: 'write' });
    if (!sectorAccess.allowed && !(await isGlobalAdmin(request.user))) {
      return reply.status(sectorAccess.statusCode).send({ error: sectorAccess.error, message: sectorAccess.message });
    }

    const result = await useCases.createTransfer({
      ...payload,
      fromUserId: userId,
      correlationId: requestCorrelationId(request),
    });
    if (result.isErr()) {
      const e = result.error;
      if (e instanceof AppError) return reply.status(e.statusCode).send({ error: e.code, message: e.message });
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
    return reply.status(201).send(result.value);
  });

  // Listar transferências
  app.get<{ Querystring: { limit?: number; offset?: number } }>('/transfers', {
    preHandler: [authenticate, requirePermission('chat:read')],
    schema: {
      description: 'Listar transferências',
      tags: ['Transfers'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 100 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
  }, async (request, reply) => {
    const result = await useCases.listTransfers(request.query.limit, request.query.offset);
    if (result.isErr()) return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    const visible = await filterTransfersByAccess(request.user, result.value);
    return reply.status(200).send(visible);
  });

  // Histórico de transferências de um contato
  app.get('/contacts/:id/transfers', {
    preHandler: [authenticate, requirePermission('chat:read')],
    schema: {
      description: 'Histórico de transferências de um contato',
      tags: ['Transfers'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    // SA-013/G02: contato inexistente deve ser 404 idêntico ao negado, não 200 [].
    const [contactRow] = await db.select({ id: schema.contacts.id }).from(schema.contacts).where(eq(schema.contacts.id, id));
    if (!contactRow) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Contact not found' });
    }
    const sectors = await contactSectorIds([id]);
    const access = await authorizeContactResource({
      actor: request.user,
      action: 'contacts:read',
      contact: { id, sectorIds: sectors.get(id) ?? [] },
      requiredLevel: 'read',
    });
    if (!access.allowed) {
      return reply.status(access.statusCode).send({ error: access.error, message: access.message });
    }

    const result = await useCases.getContactTransfers(id);
    if (result.isErr()) return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    return result.value;
  });

  // Aceitar transferência
  app.post('/transfers/:id/accept', {
    preHandler: [authenticate, requirePermission('chat:write')],
    schema: {
      description: 'Aceitar transferência pendente',
      tags: ['Transfers'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const existing = await useCases.getTransfer(id);
    if (existing.isErr()) return reply.status(404).send({ error: 'NOT_FOUND', message: 'Transferência não encontrada' });
    const access = await authorizeRecipient(request.user, existing.value);
    if (!access.allowed) {
      return reply.status(access.statusCode).send({ error: access.error, message: access.message });
    }

    const result = await useCases.acceptTransfer({
      transferId: id,
      actorId: (request.user as any)?.id,
      correlationId: requestCorrelationId(request),
    });
    if (result.isErr()) {
      const e = result.error;
      if (e instanceof AppError) return reply.status(e.statusCode).send({ error: e.code, message: e.message });
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
    return result.value;
  });

  // Rejeitar transferência
  app.post('/transfers/:id/reject', {
    preHandler: [authenticate, requirePermission('chat:write')],
    schema: {
      description: 'Rejeitar transferência pendente',
      tags: ['Transfers'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const existing = await useCases.getTransfer(id);
    if (existing.isErr()) return reply.status(404).send({ error: 'NOT_FOUND', message: 'Transferência não encontrada' });
    const access = await authorizeRecipient(request.user, existing.value);
    if (!access.allowed) {
      return reply.status(access.statusCode).send({ error: access.error, message: access.message });
    }

    const result = await useCases.rejectTransfer({
      transferId: id,
      actorId: (request.user as any)?.id,
      correlationId: requestCorrelationId(request),
    });
    if (result.isErr()) {
      const e = result.error;
      if (e instanceof AppError) return reply.status(e.statusCode).send({ error: e.code, message: e.message });
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
    return result.value;
  });
}
