import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

export const INTERNAL_SERVICE_KEY_HEADER = 'x-internal-service-key';

/**
 * Credencial de serviço do plano interno (C02 D-C02-8). É separada de tokens de
 * usuário: o header `Authorization: Bearer <sessão>` nunca é aceito nestas
 * rotas, e a credencial nunca deve aparecer em URL/log.
 *
 * Ordem de resolução (primeiro configurado vence):
 * `REALTIME_INTERNAL_SECRET` (credencial dedicada realtime) →
 * `INTERNAL_EVENTS_SECRET` → `EVENTS_API_KEY` (compatibilidade).
 */
const SERVICE_SECRET_ENVS = ['REALTIME_INTERNAL_SECRET', 'INTERNAL_EVENTS_SECRET', 'EVENTS_API_KEY'] as const;

function configuredSecret(): string | undefined {
  for (const name of SERVICE_SECRET_ENVS) {
    const value = process.env[name];
    if (value?.trim()) return value.trim();
  }
  return undefined;
}

function headerValue(request: FastifyRequest): string | undefined {
  const value = request.headers[INTERNAL_SERVICE_KEY_HEADER];
  if (Array.isArray(value)) return value[0]?.trim() || undefined;
  return value?.trim() || undefined;
}

function isProduction(): boolean {
  const env = (process.env.NODE_ENV || process.env.DESK_ENV || '').toLowerCase();
  return env === 'production' || env === 'prod';
}

function timingSafeEqualStrings(expected: string, provided: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length && crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

/** Protege o polling/publicação entre serviços sem reutilizar tokens de usuários. */
export function createInternalEventsGuard() {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const expected = configuredSecret();
    if (!expected) {
      request.log.error('Internal events secret is not configured');
      await reply.status(isProduction() ? 500 : 503).send({
        error: 'INTERNAL_AUTH_NOT_CONFIGURED',
        message: 'Internal event polling is not configured',
      });
      return;
    }

    const provided = headerValue(request);
    const valid = Boolean(provided) && timingSafeEqualStrings(expected, provided as string);

    if (!valid) {
      request.log.warn({
        header: INTERNAL_SERVICE_KEY_HEADER,
        has_bearer_token: Boolean(request.headers.authorization),
      }, 'Rejected internal events request');
      await reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Invalid internal service key' });
    }
  };
}
