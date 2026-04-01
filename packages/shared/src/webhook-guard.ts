// Fastify types are resolved at runtime from consuming packages
// This module provides webhook signature validation middleware
// that works with Fastify but avoids a direct fastify dependency
import crypto from 'crypto';

// Minimal type definitions to avoid direct fastify dependency
interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  log: {
    warn: (msg: string) => void;
    info: (msg: string) => void;
  };
}

interface ReplyLike {
  status: (code: number) => ReplyLike;
  send: (body: unknown) => unknown;
}

type MiddlewareFn = (request: RequestLike, reply: ReplyLike) => Promise<void>;

/**
 * Middleware de segurança para webhook inbound.
 * Valida assinatura HMAC-SHA256 quando WEBHOOK_SECRET está configurado.
 * Header esperado: X-Webhook-Signature: sha256=<hex>
 */

export function createWebhookGuard(): MiddlewareFn {
  const secret = process.env.WEBHOOK_SECRET;

  return async function webhookGuard(request: RequestLike, reply: ReplyLike): Promise<void> {
    // Se não há secret configurado, pular validação (modo compatibilidade)
    if (!secret) {
      request.log.warn('[WebhookGuard] WEBHOOK_SECRET não configurado — validação desabilitada');
      return;
    }

    const signature = request.headers['x-webhook-signature'] as string;
    if (!signature) {
      request.log.warn('[WebhookGuard] Header X-Webhook-Signature ausente');
      reply.status(401).send({
        error: 'UNAUTHORIZED',
        message: 'Missing webhook signature',
      });
      return;
    }

    // Formato esperado: sha256=<hex>
    const [algorithm, receivedHash] = signature.split('=');
    if (algorithm !== 'sha256' || !receivedHash) {
      request.log.warn('[WebhookGuard] Formato de assinatura inválido');
      reply.status(401).send({
        error: 'UNAUTHORIZED',
        message: 'Invalid signature format',
      });
      return;
    }

    // Calcular HMAC do body
    const body = JSON.stringify(request.body);
    const expectedHash = crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('hex');

    // Comparação timing-safe
    const expectedBuffer = Buffer.from(expectedHash, 'hex');
    const receivedBuffer = Buffer.from(receivedHash, 'hex');

    if (expectedBuffer.length !== receivedBuffer.length ||
        !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) {
      request.log.warn('[WebhookGuard] Assinatura inválida');
      reply.status(401).send({
        error: 'UNAUTHORIZED',
        message: 'Invalid webhook signature',
      });
      return;
    }

    request.log.info('[WebhookGuard] Assinatura validada com sucesso');
  };
}
