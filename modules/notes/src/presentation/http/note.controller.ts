import { FastifyInstance, type FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { createNote } from '../../application/use-cases/create-note.use-case';
import { noteRepository } from '../../infrastructure/repositories/note.repository';
import { AppError } from '@cvg/shared';
import { authenticate, authorizeConversationResource, authorizeTaskResource, requirePermission, sectorPermissionService, type ResourceActor, type ResourceAuthz } from '@cvg/auth';

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

async function resolveTask(taskId: string) {
  const [task] = await db
    .select({
      id: schema.tasks.id,
      conversationId: schema.tasks.conversationId,
      createdBy: schema.tasks.createdBy,
      assignedTo: schema.tasks.assignedTo,
    })
    .from(schema.tasks)
    .where(eq(schema.tasks.id, taskId));
  return task ?? null;
}

async function authorizeByConversation(
  actor: ResourceActor | undefined,
  action: string,
  conversationId: string | null | undefined,
): Promise<ResourceAuthz> {
  if (!conversationId) {
    return { allowed: true };
  }
  const conversation = await resolveConversation(conversationId);
  const requiredLevel = action.endsWith(':read') ? 'read' : ('write' as const);
  return authorizeConversationResource({ actor, action, conversation, requiredLevel });
}

interface CreateNoteBody {
  conversationId?: string;
  taskId?: string;
  referenceType?: 'conversation' | 'task' | 'tutor' | 'patient';
  referenceId?: string;
  content: string;
  authorId?: string;
  createdBy?: string;
  changedBy?: string;
  metadata?: Record<string, unknown>;
  type?: 'general' | 'internal' | 'followup';
}

interface NoteParams {
  id: string;
}

/**
 * Correlação estável da ação (PROD-18/AC2): header explícito ou o request id
 * do Fastify. A trilha grava o mesmo valor do evento outbox.
 */
function requestCorrelationId(request: FastifyRequest): string {
  const header = request.headers['x-correlation-id'];
  return (typeof header === 'string' && header.trim()) || String(request.id);
}

export async function registerNoteRoutes(app: FastifyInstance) {
  app.post<{ Body: CreateNoteBody }>(
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
          required: ['content'],
        },
      },
    },
    async (request, reply) => {
      try {
        const userId = request.user?.id;
        if (!userId) {
          return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Authentication required' });
        }

        if (request.body.authorId !== undefined && request.body.authorId !== userId) {
          return reply.status(400).send({
            error: 'BAD_REQUEST',
            message: 'authorId must match the authenticated user',
          });
        }

        if (request.body.createdBy !== undefined || request.body.changedBy !== undefined) {
          return reply.status(400).send({
            error: 'BAD_REQUEST',
            message: 'createdBy/changedBy are not accepted for notes; authorship derives from the authenticated session',
          });
        }

        // Resolve a referencia real no servidor. `referenceType:'task'` com
        // `referenceId` e equivalente a `taskId`; a task e resolvida e
        // autorizada SEMPRE, mesmo com `conversationId` no corpo do cliente.
        const taskReferenceId = request.body.taskId
          ?? (request.body.referenceType === 'task' ? request.body.referenceId : undefined);

        // Para `referenceType:'conversation'`, a referencia persistida precisa
        // ser exatamente a resolvida e autorizada no servidor. Divergencia
        // entre `conversationId` e `referenceId` e rejeitada: o guard
        // autorizava um id e o use-case persistia outro (escrita cross-setor).
        if (
          request.body.referenceType === 'conversation'
          && request.body.conversationId
          && request.body.referenceId
          && request.body.conversationId !== request.body.referenceId
        ) {
          return reply.status(400).send({
            error: 'BAD_REQUEST',
            message: 'conversationId and referenceId must match for referenceType conversation',
          });
        }

        const isConversationReference = request.body.referenceType === 'conversation'
          || (request.body.referenceType === undefined && Boolean(request.body.conversationId));
        const conversationReferenceId = request.body.conversationId
          ?? (request.body.referenceType === 'conversation' ? request.body.referenceId : undefined)
          ?? undefined;

        let resolvedTask: Awaited<ReturnType<typeof resolveTask>> | null = null;
        if (taskReferenceId) {
          resolvedTask = await resolveTask(taskReferenceId);
          if (!resolvedTask) {
            return reply.status(404).send({ error: 'NOT_FOUND', message: 'Task not found' });
          }

          if (resolvedTask.conversationId) {
            const access = await authorizeByConversation(request.user, 'notes:write', resolvedTask.conversationId);
            if (!access.allowed) {
              return reply.status(access.statusCode).send({ error: access.error, message: access.message });
            }
          } else {
            const access = await authorizeTaskResource({
              actor: request.user,
              action: 'notes:write',
              task: resolvedTask,
              requiredLevel: 'write',
            });
            if (!access.allowed) {
              return reply.status(access.statusCode).send({ error: access.error, message: access.message });
            }
          }
        } else if (conversationReferenceId) {
          const access = await authorizeByConversation(request.user, 'notes:write', conversationReferenceId);
          if (!access.allowed) {
            return reply.status(access.statusCode).send({ error: access.error, message: access.message });
          }
        }

        const resolvedReference = resolvedTask
          ? {
              conversationId: undefined,
              taskId: resolvedTask.id,
              referenceType: 'task' as const,
              referenceId: resolvedTask.id,
            }
          : isConversationReference && conversationReferenceId
            ? {
                conversationId: conversationReferenceId,
                taskId: undefined,
                referenceType: 'conversation' as const,
                referenceId: conversationReferenceId,
              }
            : {};

        const result = await createNote({
          conversationId: request.body.conversationId,
          taskId: request.body.taskId,
          referenceType: request.body.referenceType,
          referenceId: request.body.referenceId,
          content: request.body.content,
          metadata: request.body.metadata,
          ...resolvedReference,
          authorId: userId,
          userId,
          correlationId: requestCorrelationId(request),
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

  app.get<{ Querystring: { conversationId?: string; taskId?: string; mine?: boolean; limit?: number; offset?: number } }>(
    '/notes',
    {
      preHandler: [authenticate, requirePermission('notes:read')],
      schema: {
        querystring: {
          type: 'object',
          properties: {
            conversationId: { type: 'string', format: 'uuid' },
            taskId: { type: 'string', format: 'uuid' },
            mine: { type: 'boolean', default: false },
            limit: { type: 'integer', minimum: 1, maximum: 200, default: 100 },
            offset: { type: 'integer', minimum: 0, default: 0 },
          },
        },
      },
    },
    async (request, reply) => {
    try {
      const { conversationId, taskId, mine, limit, offset } = request.query;

      if (!conversationId && !taskId && !mine) {
        return reply.status(400).send({ error: 'BAD_REQUEST', message: 'conversationId, taskId or mine=true is required' });
      }

      if (taskId) {
        const task = await resolveTask(taskId);
        if (!task) {
          return reply.status(404).send({ error: 'NOT_FOUND', message: 'Task not found' });
        }
        const access = task.conversationId
          ? await authorizeByConversation(request.user, 'notes:read', task.conversationId)
          : await authorizeTaskResource({
              actor: request.user,
              action: 'notes:read',
              task,
              requiredLevel: 'read',
            });
        if (!access.allowed) {
          return reply.status(access.statusCode).send({ error: access.error, message: access.message });
        }
      }

      if (conversationId) {
        const access = await authorizeByConversation(request.user, 'notes:read', conversationId);
        if (!access.allowed) {
          return reply.status(access.statusCode).send({ error: access.error, message: access.message });
        }
      }

      let notes;
      if (conversationId) {
        notes = await noteRepository.findByConversationId(conversationId, { limit, offset });
      } else if (taskId) {
        notes = await noteRepository.findByTaskId(taskId, { limit, offset });
      } else if (mine && request.user?.id) {
        // A global notes feed cannot be safely inferred from an RBAC grant
        // alone: every row still needs conversation/task scope evaluation.
        // The UI therefore asks for the authenticated operator's own notes,
        // which is explicit, bounded and preserves the existing resource
        // authorization contract for scoped reads.
        notes = await noteRepository.findByAuthorId(request.user.id, { limit, offset });
      } else {
        return reply.status(400).send({ error: 'BAD_REQUEST', message: 'conversationId, taskId or mine=true is required' });
      }
      
      return reply.status(200).send(notes);
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to fetch notes' });
    }
  });

  app.get<{ Params: NoteParams }>(
    '/notes/:id',
    { preHandler: [authenticate, requirePermission('notes:read')] },
    async (request, reply) => {
      try {
        const note = await noteRepository.findById(request.params.id);
        if (!note) {
          return reply.status(404).send({ error: 'NOT_FOUND', message: 'Note not found' });
        }

        if (note.conversationId) {
          const access = await authorizeByConversation(request.user, 'notes:read', note.conversationId);
          if (!access.allowed) {
            const notFoundMessage = access.statusCode === 404 ? 'Note not found' : access.message;
            return reply.status(access.statusCode).send({ error: access.error, message: notFoundMessage });
          }
        } else if (note.taskId) {
          const task = await resolveTask(note.taskId);
          if (!task) {
            return reply.status(404).send({ error: 'NOT_FOUND', message: 'Task not found' });
          }
          const access = task.conversationId
            ? await authorizeByConversation(request.user, 'notes:read', task.conversationId)
            : await authorizeTaskResource({
                actor: request.user,
                action: 'notes:read',
                task,
                requiredLevel: 'read',
              });
          if (!access.allowed) {
            const notFoundMessage = access.statusCode === 404 ? 'Note not found' : access.message;
            return reply.status(access.statusCode).send({ error: access.error, message: notFoundMessage });
          }
        } else {
          // Nota sem conversa nem task vinculada: default-deny, exceto Admin
          // global ou autor da nota (D-C02-3 por analogia). QA17: `authorId`
          // e informado pelo cliente; a identidade usada aqui, porem, e o
          // principal autenticado da sessao.
          const isGlobalAdmin = (request.user?.roles ?? []).includes('Admin')
            || (request.user?.id ? await sectorPermissionService.isGlobalAdmin(request.user.id) : false);
          if (!isGlobalAdmin && note.authorId !== request.user?.id) {
            return reply.status(404).send({ error: 'NOT_FOUND', message: 'Note not found' });
          }
        }

        return reply.status(200).send(note);
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to fetch note' });
      }
    }
  );
}
