import { FastifyInstance, type FastifyRequest } from 'fastify';
import { eq, inArray } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { createAlert, acknowledgeAlert, resolveAlert } from '../../application/use-cases';
import { alertRepository } from '../../infrastructure/repositories/alert.repository';
import { AppError } from '@cvg/shared';
import { authenticate, authorizeAlertResource, authorizeConversationResource, authorizeTaskResource, requirePermission, sectorPermissionService, type ResourceAuthz } from '@cvg/auth';

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

async function authorizeAlert(
  actor: { id?: string; roles?: string[] } | undefined,
  action: string,
  alert: {
    conversationId?: string | null;
    taskId?: string | null;
    triggeredBy?: string | null;
    acknowledgedBy?: string | null;
    resolvedBy?: string | null;
  } | null | undefined,
): Promise<ResourceAuthz> {
  if (!alert) {
    return { allowed: false, statusCode: 404, error: 'NOT_FOUND', message: 'Alert not found' };
  }

  const task = alert.taskId ? await resolveTask(alert.taskId) : null;
  const conversationId = alert.conversationId ?? task?.conversationId;
  const conversation = conversationId ? await resolveConversation(conversationId) : null;
  const requiredLevel = action.endsWith(':read') ? 'read' : ('write' as const);

  return authorizeAlertResource({
    actor,
    action,
    alert,
    task,
    conversation,
    requiredLevel,
  });
}

async function filterAlertsByAccess(
  actor: { id?: string; roles?: string[] } | undefined,
  alerts: Array<{
    conversationId?: string | null;
    taskId?: string | null;
    triggeredBy?: string | null;
    acknowledgedBy?: string | null;
    resolvedBy?: string | null;
  }>,
) {
  if (!actor?.id) {
    return [];
  }

  if ((actor.roles ?? []).includes('Admin') || (await sectorPermissionService.isGlobalAdmin(actor.id))) {
    return alerts;
  }

  const taskIds = Array.from(new Set(alerts.map((alert) => alert.taskId).filter((id): id is string => Boolean(id))));
  const tasks = taskIds.length > 0
    ? await db
        .select({
          id: schema.tasks.id,
          conversationId: schema.tasks.conversationId,
          createdBy: schema.tasks.createdBy,
          assignedTo: schema.tasks.assignedTo,
        })
        .from(schema.tasks)
        .where(inArray(schema.tasks.id, taskIds))
    : [];
  const taskById = new Map(tasks.map((task) => [task.id, task]));

  const conversationIds = new Set<string>();
  for (const alert of alerts) {
    if (alert.conversationId) {
      conversationIds.add(alert.conversationId);
    }
    const viaTask = alert.taskId ? taskById.get(alert.taskId)?.conversationId : undefined;
    if (viaTask) {
      conversationIds.add(viaTask);
    }
  }

  const conversations = conversationIds.size > 0
    ? await db
        .select({
          id: schema.conversations.id,
          sectorId: schema.conversations.sectorId,
          assignedUserId: schema.conversations.assignedUserId,
        })
        .from(schema.conversations)
        .where(inArray(schema.conversations.id, Array.from(conversationIds)))
    : [];
  const byId = new Map(conversations.map((conversation) => [conversation.id, conversation]));

  const visible: typeof alerts = [];
  for (const alert of alerts) {
    const task = alert.taskId ? taskById.get(alert.taskId) : undefined;
    const conversationId = alert.conversationId ?? task?.conversationId;
    if (conversationId) {
      const access = await authorizeConversationResource({
        actor,
        action: 'alerts:read',
        conversation: byId.get(conversationId) ?? null,
        requiredLevel: 'read',
      });
      if (access.allowed) {
        visible.push(alert);
      }
      continue;
    }
    if (task && (task.createdBy === actor.id || task.assignedTo === actor.id)) {
      visible.push(alert);
      continue;
    }
    if (alert.triggeredBy === actor.id || alert.acknowledgedBy === actor.id || alert.resolvedBy === actor.id) {
      visible.push(alert);
    }
  }

  return visible;
}

interface CreateAlertBody {
  conversationId?: string;
  taskId?: string;
  type: string;
  title: string;
  message?: string;
  severity?: 'info' | 'warning' | 'error' | 'critical';
  triggeredBy?: string;
}

interface AlertActionBody {
  /** CAS opcional sobre o estado lido; divergência ⇒ 409 (SA-017/AC2). */
  expectedStatus?: 'active' | 'acknowledged' | 'resolved';
  acknowledgedBy?: string;
  resolvedBy?: string;
}

interface AlertParams {
  id: string;
}

/** Correlação estável da ação (PROD-18/AC2): header ou request id. */
function requestCorrelationId(request: FastifyRequest): string {
  const header = request.headers['x-correlation-id'];
  return (typeof header === 'string' && header.trim()) || String(request.id);
}

export async function registerAlertRoutes(app: FastifyInstance) {
  app.post(
    '/alerts',
    {
      preHandler: [authenticate, requirePermission('alerts:write')],
      schema: {
        body: {
          type: 'object',
          properties: {
            conversationId: { type: 'string' },
            taskId: { type: 'string' },
            type: { type: 'string' },
            title: { type: 'string' },
            message: { type: 'string' },
            severity: { type: 'string', enum: ['info', 'warning', 'error', 'critical'] },
            triggeredBy: { type: 'string' },
          },
          required: ['type', 'title'],
        },
      },
    },
    async (request, reply) => {
      try {
        const userId = (request as any).user?.id;
        const payload = request.body as CreateAlertBody;

        // Quando o alerta referencia conversa E task, ambos os recursos sao
        // autorizados separadamente: o vinculo so e criado se o ator tiver
        // acesso a cada referencia informada (nao basta uma delas).
        if (payload.conversationId) {
          const access = await authorizeConversationResource({
            actor: request.user,
            action: 'alerts:write',
            conversation: await resolveConversation(payload.conversationId),
            requiredLevel: 'write',
          });
          if (!access.allowed) {
            return reply.status(access.statusCode).send({ error: access.error, message: access.message });
          }
        }

        if (payload.taskId) {
          const task = await resolveTask(payload.taskId);
          if (!task) {
            return reply.status(404).send({ error: 'NOT_FOUND', message: 'Task not found' });
          }
          const access = task.conversationId
            ? await authorizeConversationResource({
                actor: request.user,
                action: 'alerts:write',
                conversation: await resolveConversation(task.conversationId),
                requiredLevel: 'write',
              })
            : await authorizeTaskResource({
                actor: request.user,
                action: 'alerts:write',
                task,
                requiredLevel: 'write',
              });
          if (!access.allowed) {
            return reply.status(access.statusCode).send({ error: access.error, message: access.message });
          }
        }

        const result = await createAlert({
          ...payload,
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
          return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to create alert' });
        }

        return reply.status(201).send(result.value);
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to create alert' });
      }
    }
  );

  app.get(
    '/alerts',
    {
      preHandler: [authenticate, requirePermission('alerts:read')],
      schema: {
        querystring: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['active', 'acknowledged', 'resolved'] },
            severity: { type: 'string', enum: ['info', 'warning', 'error', 'critical'] },
            type: { type: 'string', enum: ['message', 'deadline', 'assignment', 'system', 'handoff'] },
            conversationId: { type: 'string', format: 'uuid' },
            limit: { type: 'integer', minimum: 1, maximum: 200, default: 100 },
            offset: { type: 'integer', minimum: 0, default: 0 },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const { status, severity, type, conversationId, limit, offset } = request.query as {
          status?: string;
          severity?: string;
          type?: string;
          conversationId?: string;
          limit?: number;
          offset?: number;
        };

        // C04: contexto exige autorização por recurso; inacessível ⇒ 404 sem conteúdo.
        if (conversationId) {
          const [conversation] = await db
            .select({
              id: schema.conversations.id,
              sectorId: schema.conversations.sectorId,
              assignedUserId: schema.conversations.assignedUserId,
            })
            .from(schema.conversations)
            .where(eq(schema.conversations.id, conversationId))
            .limit(1);
          if (!conversation) {
            return reply.status(404).send({ error: 'NOT_FOUND', message: 'Conversa não encontrada' });
          }
          const access = await authorizeConversationResource({
            actor: request.user,
            action: 'alerts:read',
            conversation: { id: conversation.id, sectorId: conversation.sectorId ?? null, assignedUserId: conversation.assignedUserId ?? null },
            requiredLevel: 'read',
          });
          if (!access.allowed) {
            return reply.status(404).send({ error: 'NOT_FOUND', message: 'Conversa não encontrada' });
          }
        }

        const alerts = await alertRepository.findAll({ status, severity, type, conversationId, limit, offset });
        const visible = await filterAlertsByAccess(request.user, alerts);
        return reply.status(200).send(visible);
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to fetch alerts' });
      }
    },
  );

  app.get(
    '/alerts/:id',
    { preHandler: [authenticate, requirePermission('alerts:read')] },
    async (request, reply) => {
      try {
        const alert = await alertRepository.findById((request.params as AlertParams).id);
        if (!alert) {
          return reply.status(404).send({ error: 'NOT_FOUND', message: 'Alert not found' });
        }

        const access = await authorizeAlert(request.user, 'alerts:read', alert);
        if (!access.allowed) {
          const notFoundMessage = access.statusCode === 404 ? 'Alert not found' : access.message;
          return reply.status(access.statusCode).send({ error: access.error, message: notFoundMessage });
        }

        return reply.status(200).send(alert);
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to fetch alert' });
      }
    }
  );

  app.post(
    '/alerts/:id/acknowledge',
    {
      preHandler: [authenticate, requirePermission('alerts:write')],
      schema: {
        body: {
          type: 'object',
          properties: {
            acknowledgedBy: { type: 'string', format: 'uuid' },
            expectedStatus: { type: 'string', enum: ['active', 'acknowledged', 'resolved'] },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const userId = (request as any).user?.id;
        if (!userId) {
          return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Authentication required' });
        }
        const params = request.params as AlertParams;
        const body = request.body as AlertActionBody;

        // PROD-18/AC2: o autor deriva da sessão; um `acknowledgedBy` divergente
        // é rejeitado em vez de sobrescrever a trilha.
        if (body.acknowledgedBy !== undefined && body.acknowledgedBy !== userId) {
          return reply.status(400).send({
            error: 'BAD_REQUEST',
            message: 'acknowledgedBy must match the authenticated user',
          });
        }

        const existing = await alertRepository.findById(params.id);
        if (!existing) {
          return reply.status(404).send({ error: 'NOT_FOUND', message: 'Alert not found' });
        }
        const access = await authorizeAlert(request.user, 'alerts:write', existing);
        if (!access.allowed) {
          const notFoundMessage = access.statusCode === 404 ? 'Alert not found' : access.message;
          return reply.status(access.statusCode).send({ error: access.error, message: notFoundMessage });
        }

        const result = await acknowledgeAlert({
          alertId: params.id,
          actorId: userId,
          userId,
          acknowledgedBy: body.acknowledgedBy,
          expectedStatus: body.expectedStatus,
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
          return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to acknowledge alert' });
        }

        return reply.status(200).send(result.value);
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to acknowledge alert' });
      }
    }
  );

  app.post(
    '/alerts/:id/resolve',
    {
      preHandler: [authenticate, requirePermission('alerts:write')],
      schema: {
        body: {
          type: 'object',
          properties: {
            resolvedBy: { type: 'string', format: 'uuid' },
            expectedStatus: { type: 'string', enum: ['active', 'acknowledged'] },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const userId = (request as any).user?.id;
        if (!userId) {
          return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Authentication required' });
        }
        const params = request.params as AlertParams;
        const body = request.body as AlertActionBody;

        if (body.resolvedBy !== undefined && body.resolvedBy !== userId) {
          return reply.status(400).send({
            error: 'BAD_REQUEST',
            message: 'resolvedBy must match the authenticated user',
          });
        }

        const existing = await alertRepository.findById(params.id);
        if (!existing) {
          return reply.status(404).send({ error: 'NOT_FOUND', message: 'Alert not found' });
        }
        const access = await authorizeAlert(request.user, 'alerts:write', existing);
        if (!access.allowed) {
          const notFoundMessage = access.statusCode === 404 ? 'Alert not found' : access.message;
          return reply.status(access.statusCode).send({ error: access.error, message: notFoundMessage });
        }

        const result = await resolveAlert({
          alertId: params.id,
          actorId: userId,
          userId,
          resolvedBy: body.resolvedBy,
          expectedStatus: body.expectedStatus as 'active' | 'acknowledged' | undefined,
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
          return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to resolve alert' });
        }

        return reply.status(200).send(result.value);
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to resolve alert' });
      }
    }
  );
}
