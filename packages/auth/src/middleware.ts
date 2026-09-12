import { FastifyRequest, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { authRepository, hashSessionToken } from './infrastructure/repositories/auth.repository';

const SESSION_IDLE_TIMEOUT_MS = Number(process.env.SESSION_IDLE_TIMEOUT_MS) || 24 * 60 * 60 * 1000;

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
  const authHeader = request.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({
      error: 'UNAUTHORIZED',
      message: 'Missing token',
    });
  }

  const token = authHeader.substring(7);
  
  try {
    const tokenHash = hashSessionToken(token);
    const [session] = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.token, tokenHash));

    if (!session || session.revokedAt) {
      return reply.status(401).send({
        error: 'UNAUTHORIZED',
        message: 'Invalid token',
      });
    }

    const now = new Date();
    if (session.expiresAt && new Date(session.expiresAt) < now) {
      return reply.status(401).send({
        error: 'UNAUTHORIZED',
        message: 'Token expired',
      });
    }

    if (session.absoluteExpiresAt && new Date(session.absoluteExpiresAt) < now) {
      return reply.status(401).send({
        error: 'UNAUTHORIZED',
        message: 'Session expired',
      });
    }

    if (session.lastSeenAt && now.getTime() - new Date(session.lastSeenAt).getTime() > SESSION_IDLE_TIMEOUT_MS) {
      return reply.status(401).send({
        error: 'UNAUTHORIZED',
        message: 'Session idle timeout',
      });
    }

    await db
      .update(schema.sessions)
      .set({ lastSeenAt: now })
      .where(eq(schema.sessions.id, session.id));

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
  } catch (error) {
    request.log.error(error, 'Authentication failed');
    return reply.status(500).send({
      error: 'INTERNAL_ERROR',
      message: 'Authentication failed',
    });
  }
}
