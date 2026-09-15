import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  createUser, updateUser, deleteUser,
  createRole, updateRole, deleteRole,
  createQueue, updateQueue, deleteQueue,
  createTeam, updateTeam, deleteTeam,
} from '../../application/use-cases';
import { adminRepository } from '../../infrastructure/repositories/admin.repository.ts';
import { AppError } from '@cvg/shared';
import { authenticate, requirePermission } from '@cvg/auth';
import { createAuditLog } from '@cvg/audit';
import { deadLetterStore, publishToOutbox } from '@cvg/events';
import { getWebhookSecurityStats } from '@cvg/shared';
import type {
  CreateUserInput, UpdateUserInput,
  CreateRoleInput, UpdateRoleInput,
  CreateQueueInput, UpdateQueueInput,
  CreateTeamInput, UpdateTeamInput,
} from '../../types';
import { toPublicUser } from '../../types';

// User routes
export async function registerAdminRoutes(app: FastifyInstance) {
  /** Correlação estável da ação (PROD-18/AC2): header ou request id. */
  const correlationOf = (request: FastifyRequest): string => {
    const header = request.headers['x-correlation-id'];
    return (typeof header === 'string' && header.trim()) || String(request.id);
  };

  /** Auditoria administrativa sem PII (nunca serializa hash de senha). */
  const auditAdmin = async (
    request: FastifyRequest,
    entry: {
      action: string;
      entityType: string;
      entityId?: string;
      oldValue?: Record<string, unknown>;
      newValue?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    },
  ) => {
    await createAuditLog({
      userId: request.user?.id,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      oldValue: entry.oldValue,
      newValue: entry.newValue,
      metadata: { ...(entry.metadata ?? {}), correlationId: correlationOf(request) },
      correlationId: correlationOf(request),
    });
  };

  /** Contexto de auditoria atômica repassado aos casos de uso de usuário. */
  const adminContext = (request: FastifyRequest) => ({
    actorId: request.user?.id,
    correlationId: correlationOf(request),
    ipAddress: request.ip,
    userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : undefined,
  });

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

  app.get<{ Params: { id: string } }>('/admin/users/:id', { preHandler: [authenticate, requirePermission('admin:read')], schema: { params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } }, required: ['id'] } } }, async (req, reply) => {
    try {
      const user = await adminRepository.userRepository.findById(req.params.id);
      if (!user) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'User not found' });
      }
      return reply.status(200).send(toPublicUser(user));
    } catch (error) {
      req.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to fetch user' });
    }
  });

  app.post<{ Body: CreateUserInput }>('/admin/users', {
    preHandler: [authenticate, requirePermission('admin:write')],
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'email', 'password'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          email: { type: 'string', format: 'email', maxLength: 320 },
          password: { type: 'string', minLength: 8, maxLength: 200 },
          roleIds: { type: 'array', items: { type: 'string', format: 'uuid' }, maxItems: 50 },
          isActive: { type: 'boolean' },
        },
      },
    },
  }, async (req, reply) => {
    try {
      const result = await createUser(req.body, adminContext(req));
      if (result.isErr()) {
        const error = result.error;
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send({ error: error.code, message: error.message });
        }
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to create user' });
      }
      // A auditoria participa do mesmo commit do caso de uso (SA-006/AC2).
      return reply.status(201).send(result.value);
    } catch (error) {
      req.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to create user' });
    }
  });

  app.put<{ Params: { id: string }; Body: UpdateUserInput }>('/admin/users/:id', {
    preHandler: [authenticate, requirePermission('admin:write')],
    schema: {
      params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } }, required: ['id'] },
      body: {
        type: 'object',
        additionalProperties: false,
        minProperties: 1,
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          email: { type: 'string', format: 'email', maxLength: 320 },
          password: { type: 'string', minLength: 8, maxLength: 200 },
          roleIds: { type: 'array', items: { type: 'string', format: 'uuid' }, maxItems: 50 },
          isActive: { type: 'boolean' },
        },
      },
    },
  }, async (req, reply) => {
    try {
      const result = await updateUser(req.params.id, req.body, adminContext(req));
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

  app.delete<{ Params: { id: string } }>('/admin/users/:id', { preHandler: [authenticate, requirePermission('admin:write')], schema: { params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } }, required: ['id'] } } }, async (req, reply) => {
    try {
      const result = await deleteUser(req.params.id, adminContext(req));
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

  app.get<{ Params: { id: string } }>('/admin/roles/:id', { preHandler: [authenticate, requirePermission('admin:read')], schema: { params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } }, required: ['id'] } } }, async (req, reply) => {
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

  app.post<{ Body: CreateRoleInput }>('/admin/roles', {
    preHandler: [authenticate, requirePermission('admin:write')],
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 120 },
          description: { type: 'string', maxLength: 500 },
          permissionIds: { type: 'array', items: { type: 'string', format: 'uuid' }, maxItems: 200 },
        },
      },
    },
  }, async (req, reply) => {
    try {
      const result = await createRole(req.body);
      if (result.isErr()) {
        const error = result.error;
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send({ error: error.code, message: error.message });
        }
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to create role' });
      }
      await auditAdmin(req, {
        action: 'admin.role.created',
        entityType: 'role',
        entityId: result.value.id,
        newValue: { name: result.value.name, description: result.value.description },
      });
      return reply.status(201).send(result.value);
    } catch (error) {
      req.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to create role' });
    }
  });

  app.put<{ Params: { id: string }; Body: UpdateRoleInput }>('/admin/roles/:id', {
    preHandler: [authenticate, requirePermission('admin:write')],
    schema: {
      params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } }, required: ['id'] },
      body: {
        type: 'object',
        additionalProperties: false,
        minProperties: 1,
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 120 },
          description: { type: 'string', maxLength: 500 },
          permissionIds: { type: 'array', items: { type: 'string', format: 'uuid' }, maxItems: 200 },
        },
      },
    },
  }, async (req, reply) => {
    try {
      const before = await adminRepository.roleRepository.findById(req.params.id);
      const result = await updateRole(req.params.id, req.body);
      if (result.isErr()) {
        const error = result.error;
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send({ error: error.code, message: error.message });
        }
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to update role' });
      }
      await auditAdmin(req, {
        action: 'admin.role.updated',
        entityType: 'role',
        entityId: result.value.id,
        oldValue: before ? { name: before.name, description: before.description } : undefined,
        newValue: { name: result.value.name, description: result.value.description },
        metadata: { permissionsChanged: req.body.permissionIds !== undefined },
      });
      return reply.status(200).send(result.value);
    } catch (error) {
      req.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to update role' });
    }
  });

  app.delete<{ Params: { id: string } }>('/admin/roles/:id', { preHandler: [authenticate, requirePermission('admin:write')], schema: { params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } }, required: ['id'] } } }, async (req, reply) => {
    try {
      const before = await adminRepository.roleRepository.findById(req.params.id);
      const result = await deleteRole(req.params.id);
      if (result.isErr()) {
        const error = result.error;
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send({ error: error.code, message: error.message });
        }
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to delete role' });
      }
      await auditAdmin(req, {
        action: 'admin.role.deleted',
        entityType: 'role',
        entityId: req.params.id,
        oldValue: before ? { name: before.name, description: before.description } : undefined,
      });
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

  app.post<{ Body: CreateQueueInput }>('/admin/queues', {
    preHandler: [authenticate, requirePermission('admin:write')],
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 120 },
          description: { type: 'string', maxLength: 500 },
        },
      },
    },
  }, async (req, reply) => {
    try {
      const result = await createQueue(req.body);
      if (result.isErr()) {
        const error = result.error;
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send({ error: error.code, message: error.message });
        }
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to create queue' });
      }
      await auditAdmin(req, {
        action: 'admin.queue.created',
        entityType: 'queue',
        entityId: result.value.id,
        newValue: { name: result.value.name, description: result.value.description },
      });
      return reply.status(201).send(result.value);
    } catch (error) {
      req.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to create queue' });
    }
  });

  app.put<{ Params: { id: string }; Body: UpdateQueueInput }>('/admin/queues/:id', {
    preHandler: [authenticate, requirePermission('admin:write')],
    schema: {
      params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } }, required: ['id'] },
      body: {
        type: 'object',
        additionalProperties: false,
        minProperties: 1,
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 120 },
          description: { type: 'string', maxLength: 500 },
        },
      },
    },
  }, async (req, reply) => {
    try {
      const before = await adminRepository.queueRepository.findById(req.params.id);
      const result = await updateQueue(req.params.id, req.body);
      if (result.isErr()) {
        const error = result.error;
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send({ error: error.code, message: error.message });
        }
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to update queue' });
      }
      await auditAdmin(req, {
        action: 'admin.queue.updated',
        entityType: 'queue',
        entityId: result.value.id,
        oldValue: before ? { name: before.name, description: before.description } : undefined,
        newValue: { name: result.value.name, description: result.value.description },
      });
      return reply.status(200).send(result.value);
    } catch (error) {
      req.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to update queue' });
    }
  });

  app.delete<{ Params: { id: string } }>('/admin/queues/:id', { preHandler: [authenticate, requirePermission('admin:write')] }, async (req, reply) => {
    try {
      const before = await adminRepository.queueRepository.findById(req.params.id);
      const result = await deleteQueue(req.params.id);
      if (result.isErr()) {
        const error = result.error;
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send({ error: error.code, message: error.message });
        }
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to delete queue' });
      }
      await auditAdmin(req, {
        action: 'admin.queue.deleted',
        entityType: 'queue',
        entityId: req.params.id,
        oldValue: before ? { name: before.name, description: before.description } : undefined,
      });
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

  app.post<{ Body: CreateTeamInput }>('/admin/teams', {
    preHandler: [authenticate, requirePermission('admin:write')],
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['name'],
        properties: { name: { type: 'string', minLength: 1, maxLength: 120 } },
      },
    },
  }, async (req, reply) => {
    try {
      const result = await createTeam(req.body);
      if (result.isErr()) {
        const error = result.error;
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send({ error: error.code, message: error.message });
        }
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to create team' });
      }
      await auditAdmin(req, {
        action: 'admin.team.created',
        entityType: 'team',
        entityId: result.value.id,
        newValue: { name: result.value.name },
      });
      return reply.status(201).send(result.value);
    } catch (error) {
      req.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to create team' });
    }
  });

  app.put<{ Params: { id: string }; Body: UpdateTeamInput }>('/admin/teams/:id', {
    preHandler: [authenticate, requirePermission('admin:write')],
    schema: {
      params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } }, required: ['id'] },
      body: {
        type: 'object',
        additionalProperties: false,
        minProperties: 1,
        properties: { name: { type: 'string', minLength: 1, maxLength: 120 } },
      },
    },
  }, async (req, reply) => {
    try {
      const before = await adminRepository.teamRepository.findById(req.params.id);
      const result = await updateTeam(req.params.id, req.body);
      if (result.isErr()) {
        const error = result.error;
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send({ error: error.code, message: error.message });
        }
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to update team' });
      }
      await auditAdmin(req, {
        action: 'admin.team.updated',
        entityType: 'team',
        entityId: result.value.id,
        oldValue: before ? { name: before.name } : undefined,
        newValue: { name: result.value.name },
      });
      return reply.status(200).send(result.value);
    } catch (error) {
      req.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to update team' });
    }
  });

  app.delete<{ Params: { id: string } }>('/admin/teams/:id', { preHandler: [authenticate, requirePermission('admin:write')] }, async (req, reply) => {
    try {
      const before = await adminRepository.teamRepository.findById(req.params.id);
      const result = await deleteTeam(req.params.id);
      if (result.isErr()) {
        const error = result.error;
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send({ error: error.code, message: error.message });
        }
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to delete team' });
      }
      await auditAdmin(req, {
        action: 'admin.team.deleted',
        entityType: 'team',
        entityId: req.params.id,
        oldValue: before ? { name: before.name } : undefined,
      });
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
    const entries = deadLetterStore.getAll({ resolved: query.resolved, limit: query.limit || 50 });
    const stats = deadLetterStore.getStats();
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
    return reply.status(200).send(deadLetterStore.getOperationalStats());
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
    const entry = deadLetterStore.getById(id);

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
      deadLetterStore.resolve(id);
      await auditAdmin(request, {
        action: 'dlq.replay',
        entityType: 'dead-letter',
        entityId: id,
        metadata: { entryId: id },
      });
      return reply.status(200).send({
        success: true,
        replayed: true,
        entry: deadLetterStore.getById(id),
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
    const entry = deadLetterStore.getById(id);

    if (!entry) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Dead-letter entry not found' });
    }

    deadLetterStore.resolve(id);
    await auditAdmin(request, {
      action: 'dlq.resolve',
      entityType: 'dead-letter',
      entityId: id,
      metadata: { entryId: id },
    });
    return reply.status(200).send({
      success: true,
      replayed: false,
      entry: deadLetterStore.getById(id),
    });
  });

  app.get('/admin/webhook-security/stats', {
    preHandler: [authenticate, requirePermission('admin:read')],
    schema: {
      description: 'Resumo operacional dos bloqueios de webhook',
      tags: ['Admin'],
      security: [{ bearerAuth: [] }],
    },
  }, async (_request, reply) => {
    return reply.status(200).send(getWebhookSecurityStats());
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
      await auditAdmin(request, {
        action: 'sector.membership.change',
        entityType: 'user',
        entityId: id,
        newValue: { sectors: sectorPerms },
        metadata: { mode: 'replace' },
      });
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
      await auditAdmin(request, {
        action: 'sector.membership.change',
        entityType: 'user',
        entityId: id,
        newValue: { sectorId, accessLevel: accessLevel || 'read' },
        metadata: { mode: 'grant' },
      });
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
      await auditAdmin(request, {
        action: 'sector.membership.change',
        entityType: 'user',
        entityId: id,
        oldValue: { sectorId },
        metadata: { mode: 'revoke' },
      });
      return { success: true };
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    }
  });
}
