import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  createUser, updateUser, deleteUser, assignRolesToUser,
  createRole, updateRole, deleteRole,
  createPermission, deletePermission,
  createQueue, updateQueue, deleteQueue,
  createTeam, updateTeam, deleteTeam,
} from '../../application/use-cases';
import { adminRepository } from '../../infrastructure/repositories/admin.repository.ts';
import { AppError } from '@cvg/shared';
import { authenticate, requirePermission } from '@cvg/auth';
import type {
  CreateUserInput, UpdateUserInput,
  CreateRoleInput, UpdateRoleInput,
  CreatePermissionInput,
  CreateQueueInput, UpdateQueueInput,
  CreateTeamInput, UpdateTeamInput,
} from '../types';

// User routes
export async function registerAdminRoutes(app: FastifyInstance) {
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
}
