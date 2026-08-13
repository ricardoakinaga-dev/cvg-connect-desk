import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  createUser, updateUser, deleteUser,
  createRole, updateRole, deleteRole,
  createQueue, updateQueue, deleteQueue,
  createTeam, updateTeam, deleteTeam,
} from '../../application/use-cases';
import { adminRepository } from '../../infrastructure/repositories/admin.repository.ts';
import { AppError, getWebhookSecurityStats } from '@cvg/shared';
import { authenticate, requirePermission } from '@cvg/auth';
import { getRuntimeDeadLetterStore, publishToOutbox } from '@cvg/events';
import { getPersistentOperationalMetrics, getPersistentWebhookSecurityStats } from '@cvg/database';
import type {
  CreateUserInput, UpdateUserInput,
  CreateRoleInput, UpdateRoleInput,
  CreateQueueInput, UpdateQueueInput,
  CreateTeamInput, UpdateTeamInput,
} from '../../types';

// User routes
export async function registerAdminRoutes(app: FastifyInstance) {
  const deadLetterStore = getRuntimeDeadLetterStore();
  // Users
  app.get('/admin/users', { preHandler: [authenticate, requirePermission('admin:read')] }, async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const users = await adminRepository.userRepository.findAll();
      return reply.status(200).send(users);
    } catch (error) {
      req.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to fetch users' });
    }
  });

  app.get('/admin/users/:id', { preHandler: [authenticate, requirePermission('admin:read')] }, async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const user = await adminRepository.userRepository.findById(req.params.id);
      if (!user) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'User not found' });
      }
      return reply.status(200).send(user);
    } catch (error) {
      req.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to fetch user' });
    }
  });

  app.post('/admin/users', { preHandler: [authenticate, requirePermission('admin:write')] }, async (req: FastifyRequest<{ Body: CreateUserInput }>, reply: FastifyReply) => {
    try {
      const result = await createUser(req.body);
      if (result.isErr()) {
        const error = result.error;
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send({ error: error.code, message: error.message });
        }
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to create user' });
      }
      return reply.status(201).send(result.value);
    } catch (error) {
      req.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to create user' });
    }
  });

  app.put('/admin/users/:id', { preHandler: [authenticate, requirePermission('admin:write')] }, async (req: FastifyRequest<{ Params: { id: string }; Body: UpdateUserInput }>, reply: FastifyReply) => {
    try {
      const result = await updateUser(req.params.id, req.body);
      if (result.isErr()) {
        const error = result.error;
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send({ error: error.code, message: error.message });
        }
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to update user' });
      }
      return reply.status(200).send(result.value);
    } catch (error) {
      req.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to update user' });
    }
  });

  app.delete('/admin/users/:id', { preHandler: [authenticate, requirePermission('admin:write')] }, async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const result = await deleteUser(req.params.id);
      if (result.isErr()) {
        const error = result.error;
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send({ error: error.code, message: error.message });
        }
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to delete user' });
      }
      return reply.status(204).send();
    } catch (error) {
      req.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to delete user' });
    }
  });

  // Roles
  app.get('/admin/roles', { preHandler: [authenticate, requirePermission('admin:read')] }, async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const roles = await adminRepository.roleRepository.findAll();
      return reply.status(200).send(roles);
    } catch (error) {
      req.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to fetch roles' });
    }
  });

  app.get('/admin/roles/:id', { preHandler: [authenticate, requirePermission('admin:read')] }, async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const role = await adminRepository.roleRepository.findById(req.params.id);
      if (!role) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Role not found' });
      }
      return reply.status(200).send(role);
    } catch (error) {
      req.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to fetch role' });
    }
  });

  app.post('/admin/roles', { preHandler: [authenticate, requirePermission('admin:write')] }, async (req: FastifyRequest<{ Body: CreateRoleInput }>, reply: FastifyReply) => {
    try {
      const result = await createRole(req.body);
      if (result.isErr()) {
        const error = result.error;
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send({ error: error.code, message: error.message });
        }
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to create role' });
      }
      return reply.status(201).send(result.value);
    } catch (error) {
      req.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to create role' });
    }
  });

  app.put('/admin/roles/:id', { preHandler: [authenticate, requirePermission('admin:write')] }, async (req: FastifyRequest<{ Params: { id: string }; Body: UpdateRoleInput }>, reply: FastifyReply) => {
    try {
      const result = await updateRole(req.params.id, req.body);
      if (result.isErr()) {
        const error = result.error;
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send({ error: error.code, message: error.message });
        }
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to update role' });
      }
      return reply.status(200).send(result.value);
    } catch (error) {
      req.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to update role' });
    }
  });

  app.delete('/admin/roles/:id', { preHandler: [authenticate, requirePermission('admin:write')] }, async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const result = await deleteRole(req.params.id);
      if (result.isErr()) {
        const error = result.error;
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send({ error: error.code, message: error.message });
        }
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to delete role' });
      }
      return reply.status(204).send();
    } catch (error) {
      req.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to delete role' });
    }
  });

  // Permissions (readonly)
  app.get('/admin/permissions', { preHandler: [authenticate, requirePermission('admin:read')] }, async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const permissions = await adminRepository.permissionRepository.findAll();
      return reply.status(200).send(permissions);
    } catch (error) {
      req.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to fetch permissions' });
    }
  });

  // Queues
  app.get('/admin/queues', { preHandler: [authenticate, requirePermission('admin:read')] }, async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const queues = await adminRepository.queueRepository.findAll();
      return reply.status(200).send(queues);
    } catch (error) {
      req.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to fetch queues' });
    }
  });

  app.post('/admin/queues', { preHandler: [authenticate, requirePermission('admin:write')] }, async (req: FastifyRequest<{ Body: CreateQueueInput }>, reply: FastifyReply) => {
    try {
      const result = await createQueue(req.body);
      if (result.isErr()) {
        const error = result.error;
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send({ error: error.code, message: error.message });
        }
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to create queue' });
      }
      return reply.status(201).send(result.value);
    } catch (error) {
      req.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to create queue' });
    }
  });

  app.put('/admin/queues/:id', { preHandler: [authenticate, requirePermission('admin:write')] }, async (req: FastifyRequest<{ Params: { id: string }; Body: UpdateQueueInput }>, reply: FastifyReply) => {
    try {
      const result = await updateQueue(req.params.id, req.body);
      if (result.isErr()) {
        const error = result.error;
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send({ error: error.code, message: error.message });
        }
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to update queue' });
      }
      return reply.status(200).send(result.value);
    } catch (error) {
      req.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to update queue' });
    }
  });

  app.delete('/admin/queues/:id', { preHandler: [authenticate, requirePermission('admin:write')] }, async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const result = await deleteQueue(req.params.id);
      if (result.isErr()) {
        const error = result.error;
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send({ error: error.code, message: error.message });
        }
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to delete queue' });
      }
      return reply.status(204).send();
    } catch (error) {
      req.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to delete queue' });
    }
  });

  // Teams
  app.get('/admin/teams', { preHandler: [authenticate, requirePermission('admin:read')] }, async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const teams = await adminRepository.teamRepository.findAll();
      return reply.status(200).send(teams);
    } catch (error) {
      req.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to fetch teams' });
    }
  });

  app.post('/admin/teams', { preHandler: [authenticate, requirePermission('admin:write')] }, async (req: FastifyRequest<{ Body: CreateTeamInput }>, reply: FastifyReply) => {
    try {
      const result = await createTeam(req.body);
      if (result.isErr()) {
        const error = result.error;
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send({ error: error.code, message: error.message });
        }
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to create team' });
      }
      return reply.status(201).send(result.value);
    } catch (error) {
      req.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to create team' });
    }
  });

  app.put('/admin/teams/:id', { preHandler: [authenticate, requirePermission('admin:write')] }, async (req: FastifyRequest<{ Params: { id: string }; Body: UpdateTeamInput }>, reply: FastifyReply) => {
    try {
      const result = await updateTeam(req.params.id, req.body);
      if (result.isErr()) {
        const error = result.error;
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send({ error: error.code, message: error.message });
        }
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to update team' });
      }
      return reply.status(200).send(result.value);
    } catch (error) {
      req.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to update team' });
    }
  });

  app.delete('/admin/teams/:id', { preHandler: [authenticate, requirePermission('admin:write')] }, async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const result = await deleteTeam(req.params.id);
      if (result.isErr()) {
        const error = result.error;
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send({ error: error.code, message: error.message });
        }
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to delete team' });
      }
      return reply.status(204).send();
    } catch (error) {
      req.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to delete team' });
    }
  });

  // Dead letters
  app.get('/admin/dead-letters', {
    preHandler: [authenticate, requirePermission('admin:read')],
    schema: {
      description: 'Lista eventos na dead-letter queue',
      tags: ['Admin'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          resolved: { type: 'boolean' },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
        },
      },
    },
  }, async (request, reply) => {
    const query = request.query as { resolved?: boolean; limit?: number };
    const entries = await deadLetterStore.getAll({ resolved: query.resolved, limit: query.limit || 50 });
    const stats = await deadLetterStore.getStats();
    return reply.status(200).send({ data: entries, stats });
  });

  app.get('/admin/dead-letters/stats', {
    preHandler: [authenticate, requirePermission('admin:read')],
    schema: {
      description: 'Resumo operacional da dead-letter queue',
      tags: ['Admin'],
      security: [{ bearerAuth: [] }],
    },
  }, async (_request, reply) => {
    return reply.status(200).send(await deadLetterStore.getOperationalStats());
  });

  app.post('/admin/dead-letters/:id/retry', {
    preHandler: [authenticate, requirePermission('admin:write')],
    schema: {
      description: 'Tenta republicar uma entrada da dead-letter quando houver envelope suficiente',
      tags: ['Admin'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const entry = await deadLetterStore.getById(id);

    if (!entry) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Dead-letter entry not found' });
    }

    if (entry.resolved) {
      return reply.status(409).send({ error: 'ALREADY_RESOLVED', message: 'Dead-letter entry already resolved' });
    }

    if (!entry.sourceEvent) {
      return reply.status(409).send({
        error: 'NOT_REPLAYABLE',
        message: 'This dead-letter entry does not include enough event context to retry automatically',
      });
    }

    try {
      await publishToOutbox(entry.sourceEvent);
      await deadLetterStore.resolve(id);
      return reply.status(200).send({
        success: true,
        replayed: true,
        entry: await deadLetterStore.getById(id),
      });
    } catch (error) {
      request.log.error({ err: error, id }, 'Failed to retry dead-letter entry');
      return reply.status(500).send({
        error: 'INTERNAL_ERROR',
        message: 'Failed to retry dead-letter entry',
      });
    }
  });

  app.post('/admin/dead-letters/:id/resolve', {
    preHandler: [authenticate, requirePermission('admin:write')],
    schema: {
      description: 'Marca uma entrada da dead-letter como resolvida após tratamento manual',
      tags: ['Admin'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const entry = await deadLetterStore.getById(id);

    if (!entry) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Dead-letter entry not found' });
    }

    await deadLetterStore.resolve(id);
    return reply.status(200).send({
      success: true,
      replayed: false,
      entry: await deadLetterStore.getById(id),
    });
  });

  app.get('/admin/webhook-security/stats', {
    preHandler: [authenticate, requirePermission('admin:read')],
    schema: {
      description: 'Resumo operacional dos bloqueios de webhook',
      tags: ['Admin'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    try {
      return reply.status(200).send(await getPersistentWebhookSecurityStats());
    } catch (error) {
      request.log.error({ err: error }, 'Failed to load persistent webhook security stats');
      // Keep the endpoint available during a migration window, while exposing
      // only the process-local counters as a degraded fallback.
      return reply.status(200).send(getWebhookSecurityStats());
    }
  });

  app.get('/admin/operational/metrics', {
    preHandler: [authenticate, requirePermission('admin:read')],
    schema: {
      description: 'Métricas operacionais compartilhadas de outbox e dead-letter',
      tags: ['Admin'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    try {
      const metrics = await getPersistentOperationalMetrics();
      return reply.status(200).send(metrics);
    } catch (error) {
      request.log.error({ err: error }, 'Failed to load persistent operational metrics');
      return reply.status(503).send({
        error: 'OPERATIONAL_METRICS_UNAVAILABLE',
        message: 'Operational metrics are temporarily unavailable',
      });
    }
  });

  // ============================================
  // PERMISSÕES POR SETOR (User Sectors)
  // ============================================

  // Listar setores de um usuário
  app.get('/admin/users/:id/sectors', {
    preHandler: [authenticate, requirePermission('admin:read')],
    schema: {
      description: 'Listar setores com acesso de um usuário',
      tags: ['Admin'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const { sectorPermissionService } = await import('@cvg/auth');
      const userSecs = await sectorPermissionService.getUserSectors(id);
      return userSecs;
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
  });

  // Definir setores de um usuário (substitui todos)
  app.put('/admin/users/:id/sectors', {
    preHandler: [authenticate, requirePermission('admin:write')],
    schema: {
      description: 'Definir permissões de setor de um usuário',
      tags: ['Admin'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['sectors'],
        properties: {
          sectors: {
            type: 'array',
            items: {
              type: 'object',
              required: ['sectorId', 'accessLevel'],
              properties: {
                sectorId: { type: 'string' },
                accessLevel: { type: 'string', enum: ['read', 'write', 'admin'] },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { sectors: sectorPerms } = request.body as { sectors: { sectorId: string; accessLevel: 'read' | 'write' | 'admin' }[] };
    try {
      const { sectorPermissionService } = await import('@cvg/auth');
      await sectorPermissionService.setUserSectors(id, sectorPerms);
      return { success: true, count: sectorPerms.length };
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
  });

  // Adicionar setor a um usuário
  app.post('/admin/users/:id/sectors', {
    preHandler: [authenticate, requirePermission('admin:write')],
    schema: {
      description: 'Adicionar permissão de setor a um usuário',
      tags: ['Admin'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['sectorId'],
        properties: {
          sectorId: { type: 'string' },
          accessLevel: { type: 'string', enum: ['read', 'write', 'admin'], default: 'read' },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { sectorId, accessLevel } = request.body as { sectorId: string; accessLevel?: 'read' | 'write' | 'admin' };
    try {
      const { sectorPermissionService } = await import('@cvg/auth');
      await sectorPermissionService.addSectorPermission(id, sectorId, accessLevel || 'read');
      return { success: true };
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
  });

  // Remover setor de um usuário
  app.delete('/admin/users/:id/sectors/:sectorId', {
    preHandler: [authenticate, requirePermission('admin:write')],
    schema: {
      description: 'Remover permissão de setor de um usuário',
      tags: ['Admin'],
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const { id, sectorId } = request.params as { id: string; sectorId: string };
    try {
      const { sectorPermissionService } = await import('@cvg/auth');
      await sectorPermissionService.removeSectorPermission(id, sectorId);
      return { success: true };
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
  });
}
