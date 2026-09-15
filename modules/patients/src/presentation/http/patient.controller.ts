import type { FastifyInstance } from 'fastify';
import { authenticate, requirePermission } from '@cvg/auth';
import { AppError } from '@cvg/shared';
import * as useCases from '../../application/use-cases';

function sendError(reply: { status: (code: number) => { send: (body: unknown) => unknown } }, error: unknown) {
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({ error: error.code, message: error.message });
  }
  return reply.status(500).send({ error: 'INTERNAL_ERROR' });
}

const idParams = { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } };
const textField = { type: ['string', 'null'] as const, maxLength: 200 };

export async function registerPatientRoutes(app: FastifyInstance): Promise<void> {
  app.get('/patients/stats/overview', {
    preHandler: [authenticate, requirePermission('chat:read')],
    schema: {},
  }, async () => (await useCases.getPatientStats()).value);

  app.get('/patients', {
    preHandler: [authenticate, requirePermission('chat:read')],
    schema: {
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          search: { type: 'string', maxLength: 120 },
          tutorId: { type: 'string', format: 'uuid' },
          species: { type: 'string', maxLength: 80 },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const query = request.query as { search?: string; tutorId?: string; species?: string };
      return (await useCases.listPatients(query)).value;
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get('/patients/:id', {
    preHandler: [authenticate, requirePermission('chat:read')],
    schema: {
      params: idParams,
    },
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const result = await useCases.getPatient(id);
      if (result.isErr()) return sendError(reply, result.error);
      return result.value;
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/patients', {
    preHandler: [authenticate, requirePermission('chat:write')],
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          species: textField,
          breed: textField,
          tutorId: { type: ['string', 'null'], format: 'uuid' },
          externalId: textField,
        },
      },
    },
  }, async (request, reply) => {
    try {
      const result = await useCases.createPatient(request.body as any);
      if (result.isErr()) return sendError(reply, result.error);
      return reply.status(201).send(result.value);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.put('/patients/:id', {
    preHandler: [authenticate, requirePermission('chat:write')],
    schema: {
      params: idParams,
      body: {
        type: 'object',
        additionalProperties: false,
        minProperties: 1,
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          species: textField,
          breed: textField,
          tutorId: { type: ['string', 'null'], format: 'uuid' },
          externalId: textField,
        },
      },
    },
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const result = await useCases.updatePatient(id, request.body as any);
      if (result.isErr()) return sendError(reply, result.error);
      return result.value;
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.delete('/patients/:id', {
    preHandler: [authenticate, requirePermission('admin:write')],
    schema: {
      params: idParams,
    },
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const result = await useCases.deletePatient(id);
      if (result.isErr()) return sendError(reply, result.error);
      return result.value;
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
