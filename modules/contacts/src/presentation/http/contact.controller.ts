import { FastifyInstance } from 'fastify';
import { eq, inArray } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import {
  authenticate,
  authorizeContactResource,
  authorizeConversationResource,
  authorizeSectorScope,
  requirePermission,
  sectorPermissionService,
} from '@cvg/auth';
import { AppError, NotFoundError } from '@cvg/shared';
import * as useCases from '../../application/use-cases';
import { ContactRepository } from '../../infrastructure/repositories/contact.repository';

const contactRepository = new ContactRepository();

async function filterContactsByAccess(
  actor: { id?: string; roles?: string[] } | undefined,
  contacts: Array<{ id: string }>,
) {
  if (!actor?.id) {
    return [];
  }

  if ((actor.roles ?? []).includes('Admin') || (await sectorPermissionService.isGlobalAdmin(actor.id))) {
    return contacts;
  }

  const ids = contacts.map((contact) => contact.id);
  const links = ids.length > 0
    ? await db
        .select({ contactId: schema.contactSectors.contactId, sectorId: schema.contactSectors.sectorId })
        .from(schema.contactSectors)
        .where(inArray(schema.contactSectors.contactId, ids))
    : [];
  const byContact = new Map<string, string[]>();
  for (const link of links) {
    const list = byContact.get(link.contactId) ?? [];
    list.push(link.sectorId);
    byContact.set(link.contactId, list);
  }

  const accessCache = new Map<string, boolean>();
  const hasRead = async (sectorId: string): Promise<boolean> => {
    const cached = accessCache.get(sectorId);
    if (cached !== undefined) {
      return cached;
    }
    const allowed = await sectorPermissionService.hasAccess(actor.id as string, sectorId, 'read');
    accessCache.set(sectorId, allowed);
    return allowed;
  };

  const visible: typeof contacts = [];
  for (const contact of contacts) {
    const sectorIds = byContact.get(contact.id) ?? [];
    // D-AUTHZ-01: contato sem vinculo permanece no diretorio autenticado.
    if (sectorIds.length === 0) {
      visible.push(contact);
      continue;
    }
    for (const sectorId of sectorIds) {
      if (await hasRead(sectorId)) {
        visible.push(contact);
        break;
      }
    }
  }

  return visible;
}

async function contactSectorIds(contactId: string): Promise<string[]> {
  const rows = await db
    .select({ sectorId: schema.contactSectors.sectorId })
    .from(schema.contactSectors)
    .where(eq(schema.contactSectors.contactId, contactId));
  return rows.map((row) => row.sectorId);
}

export async function registerContactRoutes(app: FastifyInstance) {
  // Listar contatos
  app.get('/contacts', {
    preHandler: [authenticate, requirePermission('chat:read')],
    schema: {
      description: 'Listar contatos',
      tags: ['Contacts'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: { search: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const { search } = request.query as { search?: string };
    const result = await useCases.listContacts(search);
    if (result.isErr()) return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    const visible = await filterContactsByAccess(request.user, result.value);
    return reply.status(200).send(visible);
  });

  // Buscar contato
  app.get('/contacts/:id', {
    preHandler: [authenticate, requirePermission('chat:read')],
    schema: {
      description: 'Buscar contato com detalhes',
      tags: ['Contacts'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const sectorIds = await contactSectorIds(id);
    const access = await authorizeContactResource({
      actor: request.user,
      action: 'chat:read',
      contact: { id, sectorIds },
      requiredLevel: 'read',
    });
    if (!access.allowed) {
      // SA-013/G02: a negação 404 deve ser indistinguível de um contato
      // inexistente (mesma mensagem de NotFoundError('Contato')).
      const message = access.statusCode === 404 ? 'Contato' : access.message;
      return reply.status(access.statusCode).send({ error: access.error, message });
    }

    const result = await useCases.getContact(id);
    if (result.isErr()) {
      const e = result.error;
      if (e instanceof AppError) return reply.status(e.statusCode).send({ error: e.code, message: e.message });
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }

    // H1 (revisao AAA-04 v3): o detalhe nao pode devolver conversas de setores
    // sem acesso. Filtra por recurso no servidor antes de responder.
    const details = result.value as { conversations?: Array<{ id: string }> } & Record<string, unknown>;
    const conversations = details.conversations ?? [];
    if (conversations.length > 0) {
      const isAdmin = (request.user?.roles ?? []).includes('Admin')
        || (request.user ? await sectorPermissionService.isGlobalAdmin(request.user.id) : false);

      if (!isAdmin) {
        const ids = conversations.map((conversation) => conversation.id);
        const rows = await db
          .select({
            id: schema.conversations.id,
            sectorId: schema.conversations.sectorId,
            assignedUserId: schema.conversations.assignedUserId,
          })
          .from(schema.conversations)
          .where(inArray(schema.conversations.id, ids));
        const byId = new Map(rows.map((row) => [row.id, row]));

        const allowed: Array<{ id: string }> = [];
        for (const conversation of conversations) {
          const access = await authorizeConversationResource({
            actor: request.user,
            action: 'chat:read',
            conversation: byId.get(conversation.id) ?? null,
            requiredLevel: 'read',
          });
          if (access.allowed) {
            allowed.push(conversation);
          }
        }

        return reply.status(200).send({ ...details, conversations: allowed });
      }
    }

    return result.value;
  });

  // Criar contato
  app.post('/contacts', {
    preHandler: [authenticate, requirePermission('chat:write')],
    schema: {
      description: 'Criar novo contato',
      tags: ['Contacts'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['name', 'phone'],
        properties: {
          name: { type: 'string', minLength: 1 },
          phone: { type: 'string', minLength: 8 },
          email: { type: 'string' },
          notes: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const result = await useCases.createContact(request.body as any);
    if (result.isErr()) {
      const e = result.error;
      if (e instanceof AppError) return reply.status(e.statusCode).send({ error: e.code, message: e.message });
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
    return reply.status(201).send(result.value);
  });

  // Atualizar contato
  app.put('/contacts/:id', {
    preHandler: [authenticate, requirePermission('chat:write')],
    schema: {
      description: 'Atualizar contato',
      tags: ['Contacts'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const sectorIds = await contactSectorIds(id);
    const access = await authorizeContactResource({
      actor: request.user,
      action: 'chat:write',
      contact: { id, sectorIds },
      requiredLevel: 'write',
    });
    if (!access.allowed) {
      return reply.status(access.statusCode).send({ error: access.error, message: access.message });
    }

    const result = await useCases.updateContact(id, request.body as any);
    if (result.isErr()) {
      const e = result.error;
      if (e instanceof AppError) return reply.status(e.statusCode).send({ error: e.code, message: e.message });
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
    return result.value;
  });

  // Deletar contato
  app.delete('/contacts/:id', {
    preHandler: [authenticate, requirePermission('admin:write')],
    schema: {
      description: 'Deletar contato',
      tags: ['Contacts'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await useCases.deleteContact(id);
    if (result.isErr()) {
      const e = result.error;
      if (e instanceof AppError) return reply.status(e.statusCode).send({ error: e.code, message: e.message });
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
    return result.value;
  });

  // Iniciar conversa com contato
  app.post('/contacts/:id/start-conversation', {
    preHandler: [authenticate, requirePermission('chat:write')],
    schema: {
      description: 'Iniciar conversa com contato',
      tags: ['Contacts'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          sectorId: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { sectorId } = request.body as { sectorId?: string };
    const userId = (request.user as any)?.id;
    const actor = request.user;

    const contact = await contactRepository.findById(id);
    if (!contact) {
      const e = new NotFoundError('Contato');
      return reply.status(e.statusCode).send({ error: e.code, message: e.message });
    }

    // 1) Autoriza o contato (vinculo de setor; sem vinculo mantem D-AUTHZ-01).
    const sectorIds = await contactSectorIds(id);
    const contactAccess = await authorizeContactResource({
      actor,
      action: 'chat:read',
      contact: { id, sectorIds },
      requiredLevel: 'read',
    });
    if (!contactAccess.allowed) {
      return reply.status(contactAccess.statusCode).send({ error: contactAccess.error, message: contactAccess.message });
    }

    // 2) Setor solicitado ou, sem setor, exige vinculo do ator.
    if (sectorId) {
      const access = await authorizeSectorScope({ actor, sectorId, requiredLevel: 'write', action: 'chat:write' });
      if (!access.allowed) {
        return reply.status(access.statusCode).send({ error: access.error, message: access.message });
      }
    } else {
      const isAdmin = (actor?.roles ?? []).includes('Admin')
        || (userId ? await sectorPermissionService.isGlobalAdmin(userId) : false);
      if (!isAdmin) {
        const memberships = userId ? await sectorPermissionService.getUserSectorIds(userId) : [];
        if (memberships.length === 0) {
          return reply.status(403).send({ error: 'FORBIDDEN', message: 'Sector membership required' });
        }
      }
    }

    // 3) Conversa existente nao pode ser revelada fora do acesso do ator.
    const existing = await contactRepository.getActiveConversation(id);
    if (existing) {
      const existingAccess = await authorizeConversationResource({
        actor,
        action: 'chat:read',
        conversation: existing,
        requiredLevel: 'read',
      });
      if (!existingAccess.allowed) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Contato não encontrado' });
      }
      return reply.status(201).send({ conversationId: existing.id, isNew: false });
    }

    const result = await useCases.startConversation(id, sectorId, userId);
    if (result.isErr()) {
      const e = result.error;
      if (e instanceof AppError) return reply.status(e.statusCode).send({ error: e.code, message: e.message });
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }

    if (!result.value.isNew) {
      const [conversation] = await db
        .select({
          id: schema.conversations.id,
          sectorId: schema.conversations.sectorId,
          assignedUserId: schema.conversations.assignedUserId,
        })
        .from(schema.conversations)
        .where(eq(schema.conversations.id, result.value.conversationId));
      const access = await authorizeConversationResource({
        actor,
        action: 'chat:read',
        conversation: conversation ?? null,
        requiredLevel: 'read',
      });
      if (!access.allowed) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Contato não encontrado' });
      }
    }

    return reply.status(201).send(result.value);
  });

  // Estatísticas
  app.get('/contacts/stats/overview', {
    preHandler: [authenticate, requirePermission('chat:read')],
    schema: {
      description: 'Estatísticas de contatos',
      tags: ['Contacts'],
      security: [{ bearerAuth: [] }],
    },
  }, async () => {
    return useCases.getContactStats();
  });
}
