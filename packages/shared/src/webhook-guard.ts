import { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';

/**
 * Middleware de segurança para webhook inbound.
 * Valida assinatura HMAC-SHA256 quando WEBHOOK_SECRET está configurado.
 * Header esperado: X-Webhook-Signature: sha256=<hex>
 */

export function createWebhookGuard() {
  const secret = process.env.WEBHOOK_SECRET;

  return async function webhookGuard(request: FastifyRequest, reply: FastifyReply) {
    // Se não há secret configurado, pular validação (modo compatibilidade)
    if (!secret) {
      request.log.warn('[WebhookGuard] WEBHOOK_SECRET não configurado — validação desabilitada');
      return;
    }

    const signature = request.headers['x-webhook-signature'] as string;
    if (!signature) {
      request.log.warn('[WebhookGuard] Header X-Webhook-Signature ausente');
      return reply.status(401).send({
        error: 'UNAUTHORIZED',
        message: 'Missing webhook signature',
      });
    }

    // Formato esperado: sha256=<hex>
    const [algorithm, receivedHash] = signature.split('=');
    if (algorithm !== 'sha256' || !receivedHash) {
      request.log.warn('[WebhookGuard] Formato de assinatura inválido');
      return reply.status(401).send({
        error: 'UNAUTHORIZED',
        message: 'Invalid signature format',
      });
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
      return reply.status(401).send({
        error: 'UNAUTHORIZED',
        message: 'Invalid webhook signature',
      });
    }

    request.log.info('[WebhookGuard] Assinatura validada com sucesso');
  };
}
