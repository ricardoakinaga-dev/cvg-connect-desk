import { FastifyInstance } from 'fastify';
import { authenticate } from '@cvg/auth';
import { AppError } from '@cvg/shared';
import * as useCases from '../../application/use-cases';

export async function registerTransferRoutes(app: FastifyInstance) {
  // Criar transferência
  app.post('/transfers', {
    preHandler: [authenticate],
    schema: {
      description: 'Transferir contato entre setores',
      tags: ['Transfers'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['contactId', 'toSectorId'],
        properties: {
          contactId: { type: 'string' },
          conversationId: { type: 'string' },
          toSectorId: { type: 'string' },
          fromSectorId: { type: 'string' },
          toUserId: { type: 'string' },
          reason: { type: 'string' },
          autoAccept: { type: 'boolean', default: true },
        },
      },
    },
  }, async (request, reply) => {
    const userId = (request.user as any)?.id;
    const result = await useCases.createTransfer({
      ...(request.body as any),
      fromUserId: userId,
    });
    if (result.isErr()) {
      const e = result.error;
      if (e instanceof AppError) return reply.status(e.statusCode).send({ error: e.code, message: e.message });
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
    return reply.status(201).send(result.value);
  });

  // Listar transferências
  app.get('/transfers', {
    preHandler: [authenticate],
    schema: {
      description: 'Listar transferências',
      tags: ['Transfers'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const result = await useCases.listTransfers();
    if (result.isErr()) return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    return result.value;
  });

  // Histórico de transferências de um contato
  app.get('/contacts/:id/transfers', {
    preHandler: [authenticate],
    schema: {
      description: 'Histórico de transferências de um contato',
      tags: ['Transfers'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await useCases.getContactTransfers(id);
    if (result.isErr()) return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    return result.value;
  });

  // Aceitar transferência
  app.post('/transfers/:id/accept', {
    preHandler: [authenticate],
    schema: {
      description: 'Aceitar transferência pendente',
      tags: ['Transfers'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = (request.user as any)?.id;
    const result = await useCases.acceptTransfer(id, userId);
    if (result.isErr()) {
      const e = result.error;
      if (e instanceof AppError) return reply.status(e.statusCode).send({ error: e.code, message: e.message });
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
    return result.value;
  });

  // Rejeitar transferência
  app.post('/transfers/:id/reject', {
    preHandler: [authenticate],
    schema: {
      description: 'Rejeitar transferência pendente',
      tags: ['Transfers'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await useCases.rejectTransfer(id);
    if (result.isErr()) {
      const e = result.error;
      if (e instanceof AppError) return reply.status(e.statusCode).send({ error: e.code, message: e.message });
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
    return result.value;
  });
}
