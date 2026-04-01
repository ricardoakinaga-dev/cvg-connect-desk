import type { FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify';
import { hasPermission, Permission, Role } from './rbac';

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: string;
      email: string;
      name: string;
      roles: string[];
    };
  }
}

export function requirePermission(...permissions: Permission[]): preHandlerHookHandler {
  return async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({
        error: 'UNAUTHORIZED',
        message: 'Authentication required',
      });
    }

    const userRoles = request.user.roles as Role[];

    const hasAnyPermission = permissions.some(permission => 
      userRoles.some(role => hasPermission(role, permission))
    );

    if (!hasAnyPermission) {
      request.log.warn({
        userId: request.user.id,
        userRoles: request.user.roles,
        requiredPermissions: permissions,
      }, 'Access denied - insufficient permissions');

      return reply.status(403).send({
        error: 'FORBIDDEN',
        message: 'Insufficient permissions',
      });
    }
  };
}

export function requireRole(...roles: Role[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      return reply.status(401).send({
        error: 'UNAUTHORIZED',
        message: 'Authentication required',
      });
    }

    const hasRole = roles.some(role => request.user!.roles.includes(role));

    if (!hasRole) {
      request.log.warn({
        userId: request.user.id,
        userRoles: request.user.roles,
        requiredRoles: roles,
      }, 'Access denied - role required');

      return reply.status(403).send({
        error: 'FORBIDDEN',
        message: 'Required role not present',
      });
    }
  };
}
