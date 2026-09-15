import { FastifyRequest, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { authRepository } from './infrastructure/repositories/auth.repository';
import { evaluateSession } from './session-policy';
import { resolveUserAccess } from './permission-service';

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: string;
      email: string;
      name: string;
      roles: string[];
      isActive?: boolean;
      createdAt?: string;
      /** Permissões efetivas do banco (D01/PROD-04-AC3). */
      permissions?: string[];
      /** true quando `role_permissions` tem linhas (conjunto autoritativo mesmo vazio). */
      permissionsAuthoritative?: boolean;
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
    const now = new Date();
    const session = await authRepository.findSessionByToken(token);

    if (!session) {
      return reply.status(401).send({
        error: 'UNAUTHORIZED',
        message: 'Invalid token',
      });
    }

    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, session.userId));

    // Uma query resolve papéis + permissões efetivas do banco (D01/AC3) e o
    // flag de provisionamento (role_permissions com linhas = autoritativo).
    const access = user
      ? await resolveUserAccess(user.id)
      : { roles: [] as string[], permissions: [] as string[], permissionsAuthoritative: false };
    const evaluation = evaluateSession(session, user, now, undefined, access.roles);

    if (!evaluation.ok) {
      return reply.status(401).send({
        error: 'UNAUTHORIZED',
        message: evaluation.message,
      });
    }

    const touched = await authRepository.touchSession(session.id, now);
    if (!touched) {
      return reply.status(401).send({
        error: 'UNAUTHORIZED',
        message: 'Invalid token',
      });
    }

    request.user = {
      ...evaluation.principal,
      isActive: user.isActive,
      createdAt: user.createdAt.toISOString(),
      permissions: access.permissions,
      permissionsAuthoritative: access.permissionsAuthoritative,
    };
  } catch (error) {
    request.log.error(error, 'Authentication failed');
    return reply.status(500).send({
      error: 'INTERNAL_ERROR',
      message: 'Authentication failed',
    });
  }
}
