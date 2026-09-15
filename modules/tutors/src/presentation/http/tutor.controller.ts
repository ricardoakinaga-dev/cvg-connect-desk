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

export async function registerTutorRoutes(app: FastifyInstance): Promise<void> {
  app.get('/tutors/stats/overview', {
    preHandler: [authenticate, requirePermission('chat:read')],
    schema: {},
  }, async () => (await useCases.getTutorStats()).value);

  app.get('/tutors', {
    preHandler: [authenticate, requirePermission('chat:read')],
    schema: {
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: { search: { type: 'string', maxLength: 120 } },
      },
    },
  }, async (request, reply) => {
    try {
      const { search } = request.query as { search?: string };
      return (await useCases.listTutors(search)).value;
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get('/tutors/:id', {
    preHandler: [authenticate, requirePermission('chat:read')],
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
    },
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const result = await useCases.getTutor(id);
      if (result.isErr()) return sendError(reply, result.error);
      return result.value;
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/tutors', {
    preHandler: [authenticate, requirePermission('chat:write')],
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          phone: { type: ['string', 'null'], minLength: 8, maxLength: 32 },
          email: { type: ['string', 'null'], format: 'email', maxLength: 320 },
          externalId: { type: ['string', 'null'], maxLength: 200 },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const result = await useCases.createTutor(request.body as any);
      if (result.isErr()) return sendError(reply, result.error);
      return reply.status(201).send(result.value);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.put('/tutors/:id', {
    preHandler: [authenticate, requirePermission('chat:write')],
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      body: {
        type: 'object',
        additionalProperties: false,
        minProperties: 1,
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          phone: { type: ['string', 'null'], minLength: 8, maxLength: 32 },
          email: { type: ['string', 'null'], format: 'email', maxLength: 320 },
          externalId: { type: ['string', 'null'], maxLength: 200 },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const result = await useCases.updateTutor(id, request.body as any);
      if (result.isErr()) return sendError(reply, result.error);
      return result.value;
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.delete('/tutors/:id', {
    preHandler: [authenticate, requirePermission('admin:write')],
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
    },
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const result = await useCases.deleteTutor(id);
      if (result.isErr()) return sendError(reply, result.error);
      return result.value;
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
