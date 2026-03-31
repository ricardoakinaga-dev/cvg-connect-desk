import { FastifyInstance } from 'fastify';
import { authenticate, requirePermission } from '@cvg/auth';
import { AppError } from '@cvg/shared';
import * as useCases from '../../application/use-cases';

export async function registerPatientRoutes(app: FastifyInstance) {
  // Listar pacientes
  app.get('/patients', {
    preHandler: [authenticate],
    schema: {
      description: 'Listar pacientes',
      tags: ['Patients'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          search: { type: 'string' },
          tutorId: { type: 'string', format: 'uuid' },
          species: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const query = request.query as { search?: string; tutorId?: string; species?: string };
    const result = await useCases.listPatients(query);
    if (result.isErr()) return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    return result.value;
  });

  // Buscar paciente
  app.get('/patients/:id', {
    preHandler: [authenticate],
    schema: {
      description: 'Buscar paciente com detalhes (tutor, conversas, tasks)',
      tags: ['Patients'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await useCases.getPatient(id);
    if (result.isErr()) {
      const e = result.error;
      if (e instanceof AppError) return reply.status(e.statusCode).send({ error: e.code, message: e.message });
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
    return result.value;
  });

  // Criar paciente
  app.post('/patients', {
    preHandler: [authenticate],
    schema: {
      description: 'Criar novo paciente',
      tags: ['Patients'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1 },
          species: { type: 'string' },
          breed: { type: 'string' },
          tutorId: { type: 'string', format: 'uuid' },
          externalId: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const result = await useCases.createPatient(request.body as any);
    if (result.isErr()) {
      const e = result.error;
      if (e instanceof AppError) return reply.status(e.statusCode).send({ error: e.code, message: e.message });
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
    return reply.status(201).send(result.value);
  });

  // Atualizar paciente
  app.put('/patients/:id', {
    preHandler: [authenticate],
    schema: {
      description: 'Atualizar paciente',
      tags: ['Patients'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await useCases.updatePatient(id, request.body as any);
    if (result.isErr()) {
      const e = result.error;
      if (e instanceof AppError) return reply.status(e.statusCode).send({ error: e.code, message: e.message });
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
    return result.value;
  });

  // Deletar paciente
  app.delete('/patients/:id', {
    preHandler: [authenticate, requirePermission('admin:write')],
    schema: {
      description: 'Deletar paciente',
      tags: ['Patients'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await useCases.deletePatient(id);
    if (result.isErr()) {
      const e = result.error;
      if (e instanceof AppError) return reply.status(e.statusCode).send({ error: e.code, message: e.message });
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
    return result.value;
  });

  // Estatísticas
  app.get('/patients/stats/overview', {
    preHandler: [authenticate],
    schema: {
      description: 'Estatísticas de pacientes',
      tags: ['Patients'],
      security: [{ bearerAuth: [] }],
    },
  }, async () => {
    return useCases.getPatientStats();
  });
}
