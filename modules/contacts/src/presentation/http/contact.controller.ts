import { FastifyInstance, type FastifyRequest } from 'fastify';
import { authenticate, requirePermission } from '@cvg/auth';
import { AppError } from '@cvg/shared';
import * as useCases from '../../application/use-cases';
import type { CreateContactInput, UpdateContactInput } from '../../types';

type AuthenticatedRequest = FastifyRequest & { user?: { id?: string } };

function getUserId(request: FastifyRequest): string | undefined {
  return (request as AuthenticatedRequest).user?.id;
}

export async function registerContactRoutes(app: FastifyInstance) {
  // Listar contatos
  app.get('/contacts', {
    preHandler: [authenticate],
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
    return result.value;
  });

  // Buscar contato
  app.get('/contacts/:id', {
    preHandler: [authenticate],
    schema: {
      description: 'Buscar contato com detalhes',
      tags: ['Contacts'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await useCases.getContact(id);
    if (result.isErr()) {
      const e = result.error;
      if (e instanceof AppError) return reply.status(e.statusCode).send({ error: e.code, message: e.message });
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
    return result.value;
  });

  // Criar contato
  app.post('/contacts', {
    preHandler: [authenticate],
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
    const result = await useCases.createContact(request.body as CreateContactInput);
    if (result.isErr()) {
      const e = result.error;
      if (e instanceof AppError) return reply.status(e.statusCode).send({ error: e.code, message: e.message });
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
    return reply.status(201).send(result.value);
  });

  // Atualizar contato
  app.put('/contacts/:id', {
    preHandler: [authenticate],
    schema: {
      description: 'Atualizar contato',
      tags: ['Contacts'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await useCases.updateContact(id, request.body as UpdateContactInput);
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
    preHandler: [authenticate],
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
    const userId = getUserId(request);
    const result = await useCases.startConversation(id, sectorId, userId);
    if (result.isErr()) {
      const e = result.error;
      if (e instanceof AppError) return reply.status(e.statusCode).send({ error: e.code, message: e.message });
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
    return reply.status(201).send(result.value);
  });

  // Estatísticas
  app.get('/contacts/stats/overview', {
    preHandler: [authenticate],
    schema: {
      description: 'Estatísticas de contatos',
      tags: ['Contacts'],
      security: [{ bearerAuth: [] }],
    },
  }, async () => {
    return useCases.getContactStats();
  });
}
