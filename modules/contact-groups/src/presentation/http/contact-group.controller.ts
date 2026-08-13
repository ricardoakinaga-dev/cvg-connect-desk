import { FastifyInstance, type FastifyRequest } from 'fastify';
import { authenticate, requirePermission } from '@cvg/auth';
import { AppError } from '@cvg/shared';
import * as useCases from '../../application/use-cases';
import type { CreateGroupInput } from '../../types';

type AuthenticatedRequest = FastifyRequest & { user?: { id?: string } };

function getUserId(request: FastifyRequest): string | undefined {
  return (request as AuthenticatedRequest).user?.id;
}

export async function registerContactGroupRoutes(app: FastifyInstance) {
  // Listar grupos
  app.get('/contact-groups', {
    preHandler: [authenticate],
    schema: { description: 'Listar grupos de contatos', tags: ['Contact Groups'], security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    const result = await useCases.listGroups();
    if (result.isErr()) return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    return result.value;
  });

  // Criar grupo
  app.post('/contact-groups', {
    preHandler: [authenticate, requirePermission('admin:write')],
    schema: {
      description: 'Criar grupo de contatos', tags: ['Contact Groups'], security: [{ bearerAuth: [] }],
      body: {
        type: 'object', required: ['name'],
        properties: {
          name: { type: 'string' }, description: { type: 'string' },
          groupType: { type: 'string', enum: ['internal', 'external', 'mixed', 'sector', 'custom'] },
          sectorId: { type: 'string' }, color: { type: 'string' }, icon: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const userId = getUserId(request);
    const result = await useCases.createGroup(request.body as CreateGroupInput, userId);
    return reply.status(201).send(result.value);
  });

  // Atualizar grupo
  app.put('/contact-groups/:id', {
    preHandler: [authenticate, requirePermission('admin:write')],
    schema: { description: 'Atualizar grupo', tags: ['Contact Groups'], security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await useCases.updateGroup(id, request.body as Partial<CreateGroupInput>);
    if (result.isErr()) {
      const e = result.error;
      if (e instanceof AppError) return reply.status(e.statusCode).send({ error: e.code, message: e.message });
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
    return result.value;
  });

  // Deletar grupo
  app.delete('/contact-groups/:id', {
    preHandler: [authenticate, requirePermission('admin:write')],
    schema: { description: 'Deletar grupo', tags: ['Contact Groups'], security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await useCases.deleteGroup(id);
    if (result.isErr()) {
      const e = result.error;
      if (e instanceof AppError) return reply.status(e.statusCode).send({ error: e.code, message: e.message });
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
    return result.value;
  });

  // Membros do grupo
  app.get('/contact-groups/:id/members', {
    preHandler: [authenticate],
    schema: { description: 'Listar membros do grupo', tags: ['Contact Groups'], security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await useCases.getGroupMembers(id);
    if (result.isErr()) {
      const e = result.error;
      if (e instanceof AppError) return reply.status(e.statusCode).send({ error: e.code, message: e.message });
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
    return result.value;
  });

  // Adicionar membro
  app.post('/contact-groups/:id/members', {
    preHandler: [authenticate],
    schema: {
      description: 'Adicionar contato ao grupo', tags: ['Contact Groups'], security: [{ bearerAuth: [] }],
      body: { type: 'object', required: ['contactId'], properties: { contactId: { type: 'string' } } },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { contactId } = request.body as { contactId: string };
    const userId = getUserId(request);
    const result = await useCases.addGroupMember(id, contactId, userId);
    if (result.isErr()) {
      const e = result.error;
      if (e instanceof AppError) return reply.status(e.statusCode).send({ error: e.code, message: e.message });
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
    return reply.status(201).send(result.value);
  });

  // Remover membro
  app.delete('/contact-groups/:id/members/:contactId', {
    preHandler: [authenticate],
    schema: { description: 'Remover contato do grupo', tags: ['Contact Groups'], security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    const { id, contactId } = request.params as { id: string; contactId: string };
    const result = await useCases.removeGroupMember(id, contactId);
    if (result.isErr()) return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    return result.value;
  });

  // Grupos de um contato
  app.get('/contacts/:id/groups', {
    preHandler: [authenticate],
    schema: { description: 'Grupos de um contato', tags: ['Contact Groups'], security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await useCases.getContactGroups(id);
    if (result.isErr()) return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    return result.value;
  });
}
