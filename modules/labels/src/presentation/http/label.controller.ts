import { FastifyInstance, type FastifyRequest } from 'fastify';
import { authenticate, requirePermission } from '@cvg/auth';
import { AppError } from '@cvg/shared';
import * as useCases from '../../application/use-cases';
import type { CreateLabelInput, UpdateLabelInput } from '../../types';

type AuthenticatedRequest = FastifyRequest & { user?: { id?: string } };

function getUserId(request: FastifyRequest): string | undefined {
  return (request as AuthenticatedRequest).user?.id;
}

export async function registerLabelRoutes(app: FastifyInstance) {
  // Listar todas as labels
  app.get('/labels', {
    preHandler: [authenticate],
    schema: {
      description: 'Listar todas as labels/tags',
      tags: ['Labels'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const result = await useCases.listLabels();
    if (result.isErr()) return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    return result.value;
  });

  // Criar label
  app.post('/labels', {
    preHandler: [authenticate, requirePermission('admin:write')],
    schema: {
      description: 'Criar nova label',
      tags: ['Labels'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
          description: { type: 'string' },
          category: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const result = await useCases.createLabel(request.body as CreateLabelInput);
    if (result.isErr()) {
      const e = result.error;
      if (e instanceof AppError) return reply.status(e.statusCode).send({ error: e.code, message: e.message });
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
    return reply.status(201).send(result.value);
  });

  // Atualizar label
  app.put('/labels/:id', {
    preHandler: [authenticate, requirePermission('admin:write')],
    schema: {
      description: 'Atualizar label',
      tags: ['Labels'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await useCases.updateLabel(id, request.body as UpdateLabelInput);
    if (result.isErr()) {
      const e = result.error;
      if (e instanceof AppError) return reply.status(e.statusCode).send({ error: e.code, message: e.message });
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
    return result.value;
  });

  // Deletar label
  app.delete('/labels/:id', {
    preHandler: [authenticate, requirePermission('admin:write')],
    schema: {
      description: 'Deletar label',
      tags: ['Labels'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await useCases.deleteLabel(id);
    if (result.isErr()) {
      const e = result.error;
      if (e instanceof AppError) return reply.status(e.statusCode).send({ error: e.code, message: e.message });
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
    return result.value;
  });

  // Labels de uma conversa
  app.get('/conversations/:id/labels', {
    preHandler: [authenticate],
    schema: {
      description: 'Listar labels de uma conversa',
      tags: ['Labels'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await useCases.getConversationLabels(id);
    if (result.isErr()) return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    return result.value;
  });

  // Adicionar label a conversa
  app.post('/conversations/:id/labels', {
    preHandler: [authenticate],
    schema: {
      description: 'Adicionar label a conversa',
      tags: ['Labels'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['labelId'],
        properties: {
          labelId: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { labelId } = request.body as { labelId: string };
    const userId = getUserId(request);
    const result = await useCases.addConversationLabel(id, labelId, userId);
    if (result.isErr()) {
      const e = result.error;
      if (e instanceof AppError) return reply.status(e.statusCode).send({ error: e.code, message: e.message });
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
    return reply.status(201).send(result.value);
  });

  // Remover label de conversa
  app.delete('/conversations/:id/labels/:labelId', {
    preHandler: [authenticate],
    schema: {
      description: 'Remover label de conversa',
      tags: ['Labels'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const { id, labelId } = request.params as { id: string; labelId: string };
    const result = await useCases.removeConversationLabel(id, labelId);
    if (result.isErr()) return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    return result.value;
  });

  // Labels de um contato
  app.get('/contacts/:id/labels', {
    preHandler: [authenticate],
    schema: {
      description: 'Listar labels de um contato',
      tags: ['Labels'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await useCases.getContactLabels(id);
    if (result.isErr()) return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    return result.value;
  });

  // Adicionar label a contato
  app.post('/contacts/:id/labels', {
    preHandler: [authenticate],
    schema: {
      description: 'Adicionar label a contato',
      tags: ['Labels'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['labelId'],
        properties: {
          labelId: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { labelId } = request.body as { labelId: string };
    const userId = getUserId(request);
    const result = await useCases.addContactLabel(id, labelId, userId);
    if (result.isErr()) {
      const e = result.error;
      if (e instanceof AppError) return reply.status(e.statusCode).send({ error: e.code, message: e.message });
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
    return reply.status(201).send(result.value);
  });
}
