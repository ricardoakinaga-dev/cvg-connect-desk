import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '@cvg/database';
import { authRepository } from '../../infrastructure/repositories/auth.repository';
import { clearSessionCookies, getRequestSessionToken, setSessionCookies } from '../../session-cookies';

interface LoginBody {
  email: string;
  password: string;
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
          return reply.status(401).send({
            error: 'UNAUTHORIZED',
            message: 'Invalid credentials',
          });
        }

        if (!user.isActive) {
          return reply.status(401).send({
            error: 'UNAUTHORIZED',
            message: 'User account is inactive',
          });
        }

        const isValidPassword = await authRepository.verifyPassword(password, user.passwordHash);

        if (!isValidPassword) {
          return reply.status(401).send({
            error: 'UNAUTHORIZED',
            message: 'Invalid credentials',
          });
        }

        const roles = await authRepository.getUserRoles(user.id);
        const token = await authRepository.createSession(user.id);
        setSessionCookies(reply, token);

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

  app.post(
    '/auth/logout',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = getRequestSessionToken(request);

        if (!token) {
          return reply.status(401).send({
            error: 'UNAUTHORIZED',
            message: 'Missing token',
          });
        }

        await authRepository.invalidateSession(token);
        clearSessionCookies(reply);

        request.log.info({ action: 'logout' }, 'User logged out');

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
        const token = getRequestSessionToken(request);

        if (!token) {
          return reply.status(401).send({
            error: 'UNAUTHORIZED',
            message: 'Missing token',
          });
        }

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
