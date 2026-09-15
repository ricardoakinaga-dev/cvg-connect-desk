import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authFailuresTotal } from '@cvg/shared';
import { authRepository } from '../../infrastructure/repositories/auth.repository';
import { evaluateSession } from '../../session-policy';
import { authenticate } from '../../middleware';
import { resolveUserAccess } from '../../permission-service';

interface LoginBody {
  email: string;
  password: string;
}

/**
 * SA-012/AC3: login não enumera contas. Usuário inexistente e usuário inativo
 * recebem a MESMA resposta de credencial inválida e o mesmo custo de bcrypt
 * (hash fictício com custo de produção) para não vazar existência/estado.
 */
const DUMMY_PASSWORD_HASH = '$2a$12$kUAoYWSvNXPrCn.3T3fFG.DPTeiIHYH9l0ZJT5QMK4m92NYxB55yC';

function invalidCredentials(reply: FastifyReply) {
  return reply.status(401).send({
    error: 'UNAUTHORIZED',
    message: 'Invalid credentials',
  });
}

function bearerToken(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7);
}

export async function registerAuthRoutes(app: FastifyInstance) {
  app.post<{ Body: LoginBody }>(
    '/auth/login',
    {
      config: {
        rateLimit: {
          max: Number(process.env.RATE_LIMIT_LOGIN_MAX) || 10,
          timeWindow: process.env.RATE_LIMIT_LOGIN_WINDOW || '1 minute',
        },
      },
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
          try {
            authFailuresTotal.inc({ reason: 'invalid_credentials' });
          } catch {
            // Métricas nunca quebram o login.
          }
          // Custo equivalente ao de um usuário real (anti-timing/enumeração).
          await authRepository.verifyPassword(password, DUMMY_PASSWORD_HASH).catch(() => false);
          return invalidCredentials(reply);
        }

        if (!user.isActive) {
          try {
            authFailuresTotal.inc({ reason: 'inactive' });
          } catch {
            // Métricas nunca quebram o login.
          }
          await authRepository.verifyPassword(password, user.passwordHash).catch(() => false);
          return invalidCredentials(reply);
        }

        const isValidPassword = await authRepository.verifyPassword(password, user.passwordHash);

        if (!isValidPassword) {
          try {
            authFailuresTotal.inc({ reason: 'invalid_credentials' });
          } catch {
            // Métricas nunca quebram o login.
          }
          return invalidCredentials(reply);
        }

        const roles = await authRepository.getUserRoles(user.id);
        const access = await resolveUserAccess(user.id);
        const token = await authRepository.createSession(user.id);

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
            isActive: user.isActive,
            createdAt: user.createdAt.toISOString(),
            permissions: access.permissions,
            permissionsAuthoritative: access.permissionsAuthoritative,
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

  app.post(
    '/auth/logout',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = bearerToken(request);

        if (!token) {
          return reply.status(401).send({
            error: 'UNAUTHORIZED',
            message: 'Missing token',
          });
        }

        await authRepository.invalidateSession(token);

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

  app.post(
    '/auth/logout-all',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = bearerToken(request);

        if (!token) {
          return reply.status(401).send({
            error: 'UNAUTHORIZED',
            message: 'Missing token',
          });
        }

        const now = new Date();
        const session = await authRepository.findSessionByToken(token);
        if (!session) {
          return reply.status(401).send({
            error: 'UNAUTHORIZED',
            message: 'Invalid token',
          });
        }

        const user = await authRepository.findUserById(session.userId);
        const evaluation = evaluateSession(session, user, now);
        if (!evaluation.ok) {
          return reply.status(401).send({
            error: 'UNAUTHORIZED',
            message: evaluation.message,
          });
        }

        await authRepository.invalidateAllUserSessions(evaluation.principal.id);
        request.log.info({ userId: evaluation.principal.id }, 'All user sessions revoked');

        return reply.status(200).send({
          message: 'All sessions revoked successfully',
        });
      } catch (error) {
        request.log.error(error, 'Logout-all failed');
        return reply.status(500).send({
          error: 'INTERNAL_ERROR',
          message: 'Logout-all failed',
        });
      }
    }
  );

  app.post(
    '/auth/rotate',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = bearerToken(request);

        if (!token) {
          return reply.status(401).send({
            error: 'UNAUTHORIZED',
            message: 'Missing token',
          });
        }

        const now = new Date();
        const result = await authRepository.rotateSession(token, now);
        if (!result.ok) {
          return reply.status(401).send({
            error: 'UNAUTHORIZED',
            message: result.message,
          });
        }

        request.log.info({ userId: result.userId }, 'Session rotated');

        return reply.status(200).send({ token: result.token });
      } catch (error) {
        request.log.error(error, 'Session rotation failed');
        return reply.status(500).send({
          error: 'INTERNAL_ERROR',
          message: 'Session rotation failed',
        });
      }
    }
  );

  app.get(
    '/auth/me',
    { preHandler: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user;
      if (!user) {
        return reply.status(401).send({
          error: 'UNAUTHORIZED',
          message: 'Invalid token',
        });
      }
      return reply.status(200).send({ user });
    }
  );
}
