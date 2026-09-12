import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

export const INTERNAL_SERVICE_KEY_HEADER = 'x-internal-service-key';

function configuredSecret(): string | undefined {
  const value = process.env.INTERNAL_EVENTS_SECRET || process.env.EVENTS_API_KEY;
  return value?.trim() || undefined;
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

/** Protege o polling entre serviços sem reutilizar tokens de usuários. */
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
    const expectedBuffer = Buffer.from(expected);
    const providedBuffer = Buffer.from(provided || '');
    const valid = expectedBuffer.length === providedBuffer.length &&
      crypto.timingSafeEqual(expectedBuffer, providedBuffer);

    if (!valid) {
      request.log.warn('Rejected internal events request');
      await reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Invalid internal service key' });
    }
  };
}
