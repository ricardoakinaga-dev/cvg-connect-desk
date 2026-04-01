import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { authRepository } from '../../infrastructure/repositories/auth.repository';
import { createAuditLog } from '@cvg/audit';

interface LoginBody {
  email: string;
  password: string;
}

interface LogoutBody {
  token?: string;
}

export async function registerAuthRoutes(app: FastifyInstance) {
  app.post<{ Body: LoginBody }>(
    '/auth/login',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 1 },
          },
          required: ['email', 'password'],
        },
      },
    },
    async (request: FastifyRequest<{ Body: LoginBody }>, reply: FastifyReply) => {
      try {
        const { email, password } = request.body;

        const user = await authRepository.findUserByEmail(email);

        if (!user) {
          await createAuditLog({
            action: 'auth.login_failed',
            entityType: 'user',
            metadata: { email, reason: 'user_not_found' },
          });
          return reply.status(401).send({
            error: 'UNAUTHORIZED',
            message: 'Invalid credentials',
          });
        }

        if (!user.isActive) {
          await createAuditLog({
            userId: user.id,
            action: 'auth.login_failed',
            entityType: 'user',
            entityId: user.id,
            metadata: { email, reason: 'user_inactive' },
          });
          return reply.status(401).send({
            error: 'UNAUTHORIZED',
            message: 'User account is inactive',
          });
        }

        const isValidPassword = await authRepository.verifyPassword(password, user.passwordHash);

        if (!isValidPassword) {
          await createAuditLog({
            userId: user.id,
            action: 'auth.login_failed',
            entityType: 'user',
            entityId: user.id,
            metadata: { email, reason: 'invalid_password' },
          });
          return reply.status(401).send({
            error: 'UNAUTHORIZED',
            message: 'Invalid credentials',
          });
        }

        const roles = await authRepository.getUserRoles(user.id);
        const token = await authRepository.createSession(user.id);

        await createAuditLog({
          userId: user.id,
          action: 'auth.login',
          entityType: 'user',
          entityId: user.id,
          metadata: { email: user.email },
        });

        request.log.info({
          userId: user.id,
          email: user.email,
          action: 'login',
        }, 'User logged in');

        return reply.status(200).send({
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            roles,
          },
          token,
        });
      } catch (error) {
        request.log.error(error, 'Login failed');
        return reply.status(500).send({
          error: 'INTERNAL_ERROR',
          message: 'Login failed',
        });
      }
    }
  );

  app.post<{ Body: LogoutBody }>(
    '/auth/logout',
    async (request: FastifyRequest<{ Body: LogoutBody }>, reply: FastifyReply) => {
      try {
        const authHeader = request.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return reply.status(401).send({
            error: 'UNAUTHORIZED',
            message: 'Missing token',
          });
        }

        const token = authHeader.substring(7);
        
        await authRepository.invalidateSession(token);

        await createAuditLog({
          action: 'auth.logout',
          entityType: 'session',
          metadata: { tokenPrefix: token.substring(0, 8) + '...' },
        });

        request.log.info({ token: token.substring(0, 8) + '...' }, 'User logged out');

        return reply.status(200).send({
          message: 'Logged out successfully',
        });
      } catch (error) {
        request.log.error(error, 'Logout failed');
        return reply.status(500).send({
          error: 'INTERNAL_ERROR',
          message: 'Logout failed',
        });
      }
    }
  );

  app.get(
    '/auth/me',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const authHeader = request.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return reply.status(401).send({
            error: 'UNAUTHORIZED',
            message: 'Missing token',
          });
        }

        const token = authHeader.substring(7);
        
        const [session] = await db
          .select()
          .from(schema.sessions)
          .where(eq(schema.sessions.token, token));

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

        return reply.status(200).send({
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            roles,
          },
        });
      } catch (error) {
        request.log.error(error, 'Get current user failed');
        return reply.status(500).send({
          error: 'INTERNAL_ERROR',
          message: 'Failed to get current user',
        });
      }
    }
  );
}
