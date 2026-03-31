import { FastifyInstance } from 'fastify';
import { authenticate, requirePermission } from '@cvg/auth';
import { AppError } from '@cvg/shared';
import * as useCases from '../../application/use-cases';

export async function registerTutorRoutes(app: FastifyInstance) {
  // Listar tutores
  app.get('/tutors', {
    preHandler: [authenticate],
    schema: {
      description: 'Listar tutores',
      tags: ['Tutors'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: { search: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const { search } = request.query as { search?: string };
    const result = await useCases.listTutors(search);
    if (result.isErr()) return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    return result.value;
  });

  // Buscar tutor
  app.get('/tutors/:id', {
    preHandler: [authenticate],
    schema: {
      description: 'Buscar tutor com detalhes (pacientes, conversas)',
      tags: ['Tutors'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await useCases.getTutor(id);
    if (result.isErr()) {
      const e = result.error;
      if (e instanceof AppError) return reply.status(e.statusCode).send({ error: e.code, message: e.message });
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
    return result.value;
  });

  // Criar tutor
  app.post('/tutors', {
    preHandler: [authenticate],
    schema: {
      description: 'Criar novo tutor',
      tags: ['Tutors'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1 },
          phone: { type: 'string' },
          email: { type: 'string' },
          externalId: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const result = await useCases.createTutor(request.body as any);
    if (result.isErr()) {
      const e = result.error;
      if (e instanceof AppError) return reply.status(e.statusCode).send({ error: e.code, message: e.message });
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
    return reply.status(201).send(result.value);
  });

  // Atualizar tutor
  app.put('/tutors/:id', {
    preHandler: [authenticate],
    schema: {
      description: 'Atualizar tutor',
      tags: ['Tutors'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await useCases.updateTutor(id, request.body as any);
    if (result.isErr()) {
      const e = result.error;
      if (e instanceof AppError) return reply.status(e.statusCode).send({ error: e.code, message: e.message });
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
    return result.value;
  });

  // Deletar tutor
  app.delete('/tutors/:id', {
    preHandler: [authenticate, requirePermission('admin:write')],
    schema: {
      description: 'Deletar tutor',
      tags: ['Tutors'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await useCases.deleteTutor(id);
    if (result.isErr()) {
      const e = result.error;
      if (e instanceof AppError) return reply.status(e.statusCode).send({ error: e.code, message: e.message });
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
    return result.value;
  });

  // Estatísticas
  app.get('/tutors/stats/overview', {
    preHandler: [authenticate],
    schema: {
      description: 'Estatísticas de tutores',
      tags: ['Tutors'],
      security: [{ bearerAuth: [] }],
    },
  }, async () => {
    return useCases.getTutorStats();
  });
}
