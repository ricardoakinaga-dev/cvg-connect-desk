import { FastifyRequest, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { authRepository } from './infrastructure/repositories/auth.repository';
import { getRequestSessionToken } from './session-cookies';
import { cacheAuthUser, getCachedAuthUser } from './auth-cache';

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

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  const token = getRequestSessionToken(request);

  if (!token) {
    return reply.status(401).send({
      error: 'UNAUTHORIZED',
      message: 'Missing token',
    });
  }

  const cachedUser = getCachedAuthUser(token);
  if (cachedUser) {
    request.user = cachedUser;
    return;
  }

  try {
    const session = await authRepository.findSessionByToken(token);

    if (!session) {
      return reply.status(401).send({
        error: 'UNAUTHORIZED',
        message: 'Invalid token',
      });
    }

    if (session.expiresAt && new Date(session.expiresAt) < new Date()) {
      return reply.status(401).send({
        error: 'UNAUTHORIZED',
        message: 'Token expired',
      });
    }

    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, session.userId));

    if (!user || !user.isActive) {
      return reply.status(401).send({
        error: 'UNAUTHORIZED',
        message: 'User not found or inactive',
      });
    }

    const roles = await authRepository.getUserRoles(user.id);

    request.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      roles,
    };
    cacheAuthUser(token, request.user, session.expiresAt);
  } catch (error) {
    request.log.error(error, 'Authentication failed');
    return reply.status(500).send({
      error: 'INTERNAL_ERROR',
      message: 'Authentication failed',
    });
  }
}
