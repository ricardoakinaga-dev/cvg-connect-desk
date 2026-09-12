import { FastifyInstance } from 'fastify';
import { authenticate, requirePermission, requireSectorAccess } from '@cvg/auth';
import { AppError } from '@cvg/shared';
import * as useCases from '../../application/use-cases';

export async function registerSectorRoutes(app: FastifyInstance) {
  // Listar setores
  app.get('/sectors', {
    preHandler: [authenticate],
    schema: {
      description: 'Listar setores',
      tags: ['Sectors'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: { all: { type: 'boolean' } },
      },
    },
  }, async (request, reply) => {
    const { all } = request.query as { all?: boolean };
    const result = await useCases.listSectors(!all);
    if (result.isErr()) return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    return result.value;
  });

  // Criar setor
  app.post('/sectors', {
    preHandler: [authenticate, requirePermission('admin:write')],
    schema: {
      description: 'Criar setor',
      tags: ['Sectors'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['name', 'code'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          code: { type: 'string', minLength: 1, maxLength: 50 },
          description: { type: 'string' },
          color: { type: 'string' },
          icon: { type: 'string' },
          autoAssign: { type: 'boolean' },
          maxConcurrent: { type: 'integer' },
        },
      },
    },
  }, async (request, reply) => {
    const result = await useCases.createSector(request.body as any);
    if (result.isErr()) {
      const e = result.error;
      if (e instanceof AppError) return reply.status(e.statusCode).send({ error: e.code, message: e.message });
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
    return reply.status(201).send(result.value);
  });

  // Atualizar setor
  app.put('/sectors/:id', {
    preHandler: [authenticate, requirePermission('admin:write')],
    schema: {
      description: 'Atualizar setor',
      tags: ['Sectors'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await useCases.updateSector(id, request.body as any);
    if (result.isErr()) {
      const e = result.error;
      if (e instanceof AppError) return reply.status(e.statusCode).send({ error: e.code, message: e.message });
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
    return result.value;
  });

  // Deletar setor
  app.delete('/sectors/:id', {
    preHandler: [authenticate, requirePermission('admin:write')],
    schema: {
      description: 'Deletar setor',
      tags: ['Sectors'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await useCases.deleteSector(id);
    if (result.isErr()) {
      const e = result.error;
      if (e instanceof AppError) return reply.status(e.statusCode).send({ error: e.code, message: e.message });
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
    return result.value;
  });

  // Conversas do setor
  app.get('/sectors/:id/conversations', {
    preHandler: [authenticate, requireSectorAccess((req) => (req.params as { id?: string })?.id)],
    schema: {
      description: 'Conversas de um setor',
      tags: ['Sectors'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { status } = request.query as { status?: string };
    const result = await useCases.getSectorConversations(id, status);
    if (result.isErr()) {
      const e = result.error;
      if (e instanceof AppError) return reply.status(e.statusCode).send({ error: e.code, message: e.message });
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
    return result.value;
  });

  // Estatísticas do setor
  app.get('/sectors/:id/stats', {
    preHandler: [authenticate, requireSectorAccess((req) => (req.params as { id?: string })?.id)],
    schema: {
      description: 'Estatísticas de um setor',
      tags: ['Sectors'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await useCases.getSectorStats(id);
    if (result.isErr()) {
      const e = result.error;
      if (e instanceof AppError) return reply.status(e.statusCode).send({ error: e.code, message: e.message });
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
    return result.value;
  });

  // Estatísticas de todos os setores
  app.get('/sectors/stats/overview', {
    preHandler: [authenticate],
    schema: {
      description: 'Visão geral de estatísticas de todos os setores',
      tags: ['Sectors'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const result = await useCases.getAllSectorStats();
    if (result.isErr()) return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    return result.value;
  });
}
