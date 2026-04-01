import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  createUser, updateUser, deleteUser, assignRolesToUser,
  createRole, updateRole, deleteRole,
  createPermission, deletePermission,
  createQueue, updateQueue, deleteQueue,
  createTeam, updateTeam, deleteTeam,
} from '../../application/use-cases';
import { adminRepository } from '../../infrastructure/repositories/admin.repository';
import { AppError } from '@cvg/shared';
import { authenticate, requirePermission } from '@cvg/auth';
import type {
  CreateUserInput, UpdateUserInput,
  CreateRoleInput, UpdateRoleInput,
  CreatePermissionInput,
  CreateQueueInput, UpdateQueueInput,
  CreateTeamInput, UpdateTeamInput,
} from '../../types';

// User routes
export async function registerAdminRoutes(app: FastifyInstance) {
  // Users
  app.get('/admin/users', { preHandler: [authenticate, requirePermission('admin:read')] }, async (req, reply) => {
    try {
      const users = await adminRepository.userRepository.findAll();
      return reply.status(200).send(users);
    } catch (error) {
      req.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to fetch users' });
    }
  });

  app.get('/admin/users/:id', { preHandler: [authenticate, requirePermission('admin:read')] }, async (req, reply) => {
    try {
      const params = req.params as { id: string };
      const user = await adminRepository.userRepository.findById(params.id);
      if (!user) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'User not found' });
      }
      return reply.status(200).send(user);
    } catch (error) {
      req.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to fetch user' });
    }
  });

  app.post('/admin/users', { preHandler: [authenticate, requirePermission('admin:write')] }, async (req, reply) => {
    try {
      const body = req.body as CreateUserInput;
      const result = await createUser(body);
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

  app.put('/admin/users/:id', { preHandler: [authenticate, requirePermission('admin:write')] }, async (req, reply) => {
    try {
      const params = req.params as { id: string };
      const body = req.body as UpdateUserInput;
      const result = await updateUser(params.id, body);
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

  app.delete('/admin/users/:id', { preHandler: [authenticate, requirePermission('admin:write')] }, async (req, reply) => {
    try {
      const params = req.params as { id: string };
      const result = await deleteUser(params.id);
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
  app.get('/admin/roles', { preHandler: [authenticate, requirePermission('admin:read')] }, async (req, reply) => {
    try {
      const roles = await adminRepository.roleRepository.findAll();
      return reply.status(200).send(roles);
    } catch (error) {
      req.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to fetch roles' });
    }
  });

  app.get('/admin/roles/:id', { preHandler: [authenticate, requirePermission('admin:read')] }, async (req, reply) => {
    try {
      const params = req.params as { id: string };
      const role = await adminRepository.roleRepository.findById(params.id);
      if (!role) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Role not found' });
      }
      return reply.status(200).send(role);
    } catch (error) {
      req.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to fetch role' });
    }
  });

  app.post('/admin/roles', { preHandler: [authenticate, requirePermission('admin:write')] }, async (req, reply) => {
    try {
      const body = req.body as CreateRoleInput;
      const result = await createRole(body);
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

  app.put('/admin/roles/:id', { preHandler: [authenticate, requirePermission('admin:write')] }, async (req, reply) => {
    try {
      const params = req.params as { id: string };
      const body = req.body as UpdateRoleInput;
      const result = await updateRole(params.id, body);
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

  app.delete('/admin/roles/:id', { preHandler: [authenticate, requirePermission('admin:write')] }, async (req, reply) => {
    try {
      const params = req.params as { id: string };
      const result = await deleteRole(params.id);
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
  app.get('/admin/permissions', { preHandler: [authenticate, requirePermission('admin:read')] }, async (req, reply) => {
    try {
      const permissions = await adminRepository.permissionRepository.findAll();
      return reply.status(200).send(permissions);
    } catch (error) {
      req.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to fetch permissions' });
    }
  });

  // Queues
  app.get('/admin/queues', { preHandler: [authenticate, requirePermission('admin:read')] }, async (req, reply) => {
    try {
      const queues = await adminRepository.queueRepository.findAll();
      return reply.status(200).send(queues);
    } catch (error) {
      req.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to fetch queues' });
    }
  });

  app.post('/admin/queues', { preHandler: [authenticate, requirePermission('admin:write')] }, async (req, reply) => {
    try {
      const body = req.body as CreateQueueInput;
      const result = await createQueue(body);
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

  app.put('/admin/queues/:id', { preHandler: [authenticate, requirePermission('admin:write')] }, async (req, reply) => {
    try {
      const params = req.params as { id: string };
      const body = req.body as UpdateQueueInput;
      const result = await updateQueue(params.id, body);
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

  app.delete('/admin/queues/:id', { preHandler: [authenticate, requirePermission('admin:write')] }, async (req, reply) => {
    try {
      const params = req.params as { id: string };
      const result = await deleteQueue(params.id);
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
  app.get('/admin/teams', { preHandler: [authenticate, requirePermission('admin:read')] }, async (req, reply) => {
    try {
      const teams = await adminRepository.teamRepository.findAll();
      return reply.status(200).send(teams);
    } catch (error) {
      req.log.error(error);
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Failed to fetch teams' });
    }
  });

  app.post('/admin/teams', { preHandler: [authenticate, requirePermission('admin:write')] }, async (req, reply) => {
    try {
      const body = req.body as CreateTeamInput;
      const result = await createTeam(body);
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

  app.put('/admin/teams/:id', { preHandler: [authenticate, requirePermission('admin:write')] }, async (req, reply) => {
    try {
      const params = req.params as { id: string };
      const body = req.body as UpdateTeamInput;
      const result = await updateTeam(params.id, body);
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

  app.delete('/admin/teams/:id', { preHandler: [authenticate, requirePermission('admin:write')] }, async (req, reply) => {
    try {
      const params = req.params as { id: string };
      const result = await deleteTeam(params.id);
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

  // ============================================
  // PERMISSÕES POR SETOR (User Sectors)
  // ============================================

  // Listar setores de um usuário
  app.get('/admin/users/:id/sectors', {
    preHandler: [authenticate, requirePermission('admin:read')],
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
