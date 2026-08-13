import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

export const INTERNAL_SERVICE_KEY_HEADER = 'x-internal-service-key';

function configuredSecret(): string | undefined {
  const value = process.env.INTERNAL_EVENTS_SECRET || process.env.EVENTS_API_KEY;
  return value?.trim() || undefined;
}

function headerValue(request: FastifyRequest): string | undefined {
  const value = request.headers[INTERNAL_SERVICE_KEY_HEADER];
  return Array.isArray(value) ? value[0] : value;
}

export function createInternalEventsGuard() {
  return async function internalEventsGuard(request: FastifyRequest, reply: FastifyReply) {
    const secret = configuredSecret();
    if (!secret) {
      request.log.error('[InternalAuth] INTERNAL_EVENTS_SECRET is not configured');
      return reply.status(500).send({
        error: 'CONFIGURATION_ERROR',
        message: 'Internal events security is not configured',
      });
    }

    const provided = headerValue(request);
    if (!provided) {
      return reply.status(401).send({
        error: 'UNAUTHORIZED',
        message: 'Missing internal service credential',
      });
    }

    const expectedBuffer = Buffer.from(secret, 'utf8');
    const providedBuffer = Buffer.from(provided, 'utf8');
    if (expectedBuffer.length !== providedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
      return reply.status(401).send({
        error: 'UNAUTHORIZED',
        message: 'Invalid internal service credential',
      });
    }
  };
}
