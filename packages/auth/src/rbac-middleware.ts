import { FastifyRequest, FastifyReply } from 'fastify';
import { hasPermission, Permission, Role } from './rbac';
import { authzDenialsTotal } from '@cvg/shared';
import { sectorPermissionService, type AccessLevel } from './sector-permissions';

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

export function requirePermission(...permissions: Permission[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
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

      try {
        authzDenialsTotal.inc({ reason: 'missing-permission' });
      } catch {
        // Métricas nunca quebram a request.
      }

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

/**
 * Exige membership no setor alvo (Phase 4 — §7.2).
 * Admin global (role Admin) tem override. Sem sectorId resolvido → 400.
 */
export function requireSectorAccess(
  resolveSectorId: (request: FastifyRequest) => string | undefined,
  level: AccessLevel = 'read',
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      return reply.status(401).send({
        error: 'UNAUTHORIZED',
        message: 'Authentication required',
      });
    }

    const sectorId = resolveSectorId(request);
    if (!sectorId) {
      return reply.status(400).send({
        error: 'BAD_REQUEST',
        message: 'Sector scope is required for this resource',
      });
    }

    if (request.user.roles.includes('Admin')) {
      return;
    }

    const allowed = await sectorPermissionService.hasAccess(request.user.id, sectorId, level);
    if (!allowed) {
      request.log.warn({
        userId: request.user.id,
        sectorId,
        requiredLevel: level,
      }, 'Access denied - no sector membership');
      try {
        authzDenialsTotal.inc({ reason: 'sector-denied' });
      } catch {
        // Métricas nunca quebram a request.
      }
      return reply.status(403).send({
        error: 'FORBIDDEN',
        message: 'No access to this sector',
      });
    }
  };
}
