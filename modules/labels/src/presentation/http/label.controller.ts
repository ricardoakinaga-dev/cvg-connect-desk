import { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { authenticate, authorizeContactResource, authorizeConversationResource, requirePermission } from '@cvg/auth';
import { AppError } from '@cvg/shared';
import * as useCases from '../../application/use-cases';

async function resolveConversation(conversationId: string) {
  const [conversation] = await db
    .select({
      id: schema.conversations.id,
      sectorId: schema.conversations.sectorId,
      assignedUserId: schema.conversations.assignedUserId,
    })
    .from(schema.conversations)
    .where(eq(schema.conversations.id, conversationId));
  return conversation ?? null;
}

async function contactSectorIds(contactId: string): Promise<string[]> {
  const rows = await db
    .select({ sectorId: schema.contactSectors.sectorId })
    .from(schema.contactSectors)
    .where(eq(schema.contactSectors.contactId, contactId));
  return rows.map((row) => row.sectorId);
}

export async function registerLabelRoutes(app: FastifyInstance) {
  // Listar todas as labels
  app.get('/labels', {
    preHandler: [authenticate, requirePermission('chat:read')],
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
    const result = await useCases.createLabel(request.body as any);
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
    const result = await useCases.updateLabel(id, request.body as any);
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
    const access = await authorizeConversationResource({
      actor: request.user,
      action: 'chat:read',
      conversation: await resolveConversation(id),
      requiredLevel: 'read',
    });
    if (!access.allowed) {
      return reply.status(access.statusCode).send({ error: access.error, message: access.message });
    }

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
    const userId = (request.user as any)?.id;

    const access = await authorizeConversationResource({
      actor: request.user,
      action: 'chat:write',
      conversation: await resolveConversation(id),
      requiredLevel: 'write',
    });
    if (!access.allowed) {
      return reply.status(access.statusCode).send({ error: access.error, message: access.message });
    }

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

    const access = await authorizeConversationResource({
      actor: request.user,
      action: 'chat:write',
      conversation: await resolveConversation(id),
      requiredLevel: 'write',
    });
    if (!access.allowed) {
      return reply.status(access.statusCode).send({ error: access.error, message: access.message });
    }

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
    // SA-013/G02: contato inexistente deve ser 404 idêntico ao negado, não 200 [].
    const [contactRow] = await db.select({ id: schema.contacts.id }).from(schema.contacts).where(eq(schema.contacts.id, id));
    if (!contactRow) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Contact not found' });
    }
    const access = await authorizeContactResource({
      actor: request.user,
      action: 'contacts:read',
      contact: { id, sectorIds: await contactSectorIds(id) },
      requiredLevel: 'read',
    });
    if (!access.allowed) {
      return reply.status(access.statusCode).send({ error: access.error, message: access.message });
    }

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
        additionalProperties: false,
        required: ['labelId'],
        properties: {
          labelId: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { labelId } = request.body as { labelId: string };
    const userId = (request.user as any)?.id;

    // SA-019/AC2 (D2): contato inexistente → 404 igual ao negado, nunca 500 de FK.
    const [contactRow] = await db.select({ id: schema.contacts.id }).from(schema.contacts).where(eq(schema.contacts.id, id));
    if (!contactRow) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Contact not found' });
    }

    const access = await authorizeContactResource({
      actor: request.user,
      action: 'contacts:write',
      contact: { id, sectorIds: await contactSectorIds(id) },
      requiredLevel: 'write',
    });
    if (!access.allowed) {
      return reply.status(access.statusCode).send({ error: access.error, message: access.message });
    }

    const result = await useCases.addContactLabel(id, labelId, userId);
    if (result.isErr()) {
      const e = result.error;
      if (e instanceof AppError) return reply.status(e.statusCode).send({ error: e.code, message: e.message });
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
    return reply.status(201).send(result.value);
  });

  // Remover label de contato (SA-019/D5: rota espelhava a de conversa e faltava)
  app.delete('/contacts/:id/labels/:labelId', {
    preHandler: [authenticate],
    schema: {
      description: 'Remover label de contato',
      tags: ['Labels'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const { id, labelId } = request.params as { id: string; labelId: string };

    const [contactRow] = await db.select({ id: schema.contacts.id }).from(schema.contacts).where(eq(schema.contacts.id, id));
    if (!contactRow) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Contact not found' });
    }

    const access = await authorizeContactResource({
      actor: request.user,
      action: 'contacts:write',
      contact: { id, sectorIds: await contactSectorIds(id) },
      requiredLevel: 'write',
    });
    if (!access.allowed) {
      return reply.status(access.statusCode).send({ error: access.error, message: access.message });
    }

    const result = await useCases.removeContactLabel(id, labelId);
    return result.value;
  });
}
