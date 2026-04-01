import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createNote } from '../../application/use-cases/create-note.use-case';
import { noteRepository } from '../../infrastructure/repositories/note.repository';
import { AppError } from '@cvg/shared';
import { authenticate, requirePermission } from '@cvg/auth';

interface CreateNoteBody {
  conversationId?: string;
  taskId?: string;
  referenceType?: 'conversation' | 'task' | 'tutor' | 'patient';
  referenceId?: string;
  content: string;
  authorId: string;
  type?: 'general' | 'internal' | 'followup';
}

interface NoteParams {
  id: string;
}

export async function registerNoteRoutes(app: FastifyInstance) {
  app.post(
    '/notes',
    {
      preHandler: [authenticate, requirePermission('notes:write')],
      schema: {
        body: {
          type: 'object',
          properties: {
            conversationId: { type: 'string' },
            taskId: { type: 'string' },
            referenceType: { type: 'string', enum: ['conversation', 'task', 'tutor', 'patient'] },
            referenceId: { type: 'string' },
            content: { type: 'string' },
            authorId: { type: 'string' },
            type: { type: 'string', enum: ['general', 'internal', 'followup'] },
          },
          required: ['content', 'authorId'],
        },
      },
    },
    async (request, reply) => {
      try {
        const userId = (request as any).user?.id;
        const body = request.body as CreateNoteBody;
        const result = await createNote({
          ...body,
          userId,
        });

        if (result.isErr()) {
          const error = result.error;
          if (error instanceof AppError) {
            return reply.status(error.statusCode).send({
              error: error.code,
              message: error.message,
            });
          }
          return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to create note' });
        }

        return reply.status(201).send(result.value);
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to create note' });
      }
    }
  );

  app.get('/notes', { preHandler: [authenticate, requirePermission('notes:read')] }, async (request, reply) => {
    try {
      const query = request.query as { conversationId?: string; taskId?: string };
      const { conversationId, taskId } = query;
      
      let notes;
      if (conversationId) {
        notes = await noteRepository.findByConversationId(conversationId);
      } else if (taskId) {
        notes = await noteRepository.findByTaskId(taskId);
      } else {
        return reply.status(400).send({ error: 'BAD_REQUEST', message: 'conversationId or taskId is required' });
      }
      
      return reply.status(200).send(notes);
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to fetch notes' });
    }
  });

  app.get(
    '/notes/:id',
    { preHandler: [authenticate, requirePermission('notes:read')] },
    async (request, reply) => {
      try {
        const params = request.params as NoteParams;
        const note = await noteRepository.findById(params.id);
        if (!note) {
          return reply.status(404).send({ error: 'NOT_FOUND', message: 'Note not found' });
        }
        return reply.status(200).send(note);
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to fetch note' });
      }
    }
  );
}
