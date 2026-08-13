import { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { recordWebhookSecurityDecisionAndPersist } from './webhook-security-stats';

/**
 * Middleware de segurança para webhook inbound.
 * Valida assinatura HMAC-SHA256 quando WEBHOOK_SECRET está configurado.
 * Header esperado: X-Webhook-Signature: sha256=<hex>
 * 
 * Em produção (NODE_ENV=production ou DESK_ENV=production), a ausência de
 * WEBHOOK_SECRET causa rejeição imediata (fail-secure).
 * Em desenvolvimento, permite bypass com warning.
 */

function isProduction(): boolean {
  const env = (process.env.NODE_ENV || process.env.DESK_ENV || '').toLowerCase();
  return env === 'production' || env === 'prod';
}

async function denyWebhook(
  reply: FastifyReply,
  statusCode: number,
  reason: string,
  message: string,
  metadata: {
    webhookMode: 'strict-production' | 'development-bypass' | 'hmac';
    hasSecret: boolean;
    signaturePresent?: boolean;
  },
) {
  await recordWebhookSecurityDecisionAndPersist({
    reason: reason as 'missing_secret' | 'missing_signature' | 'invalid_signature_format' | 'invalid_signature',
    allowed: false,
    webhookMode: metadata.webhookMode,
    hasSecret: metadata.hasSecret,
    signaturePresent: metadata.signaturePresent,
    statusCode,
  });
  return reply.status(statusCode).send({
    error: statusCode === 500 ? 'CONFIGURATION_ERROR' : 'UNAUTHORIZED',
    reason,
    message,
  });
}

export function createWebhookGuard() {
  const secret = process.env.WEBHOOK_SECRET;

  return async function webhookGuard(request: FastifyRequest, reply: FastifyReply) {
    if (!secret) {
      if (isProduction()) {
        request.log.error({
          reason: 'missing_secret',
          webhook_mode: 'strict-production',
          has_secret: false,
        }, '[WebhookGuard] WEBHOOK_SECRET não configurado em produção — rejeitando request');
        return denyWebhook(reply, 500, 'missing_secret', 'Webhook security not properly configured', {
          webhookMode: 'strict-production',
          hasSecret: false,
        });
      }
      request.log.warn({
        reason: 'missing_secret',
        webhook_mode: 'development-bypass',
        has_secret: false,
      }, '[WebhookGuard] WEBHOOK_SECRET não configurado — validação desabilitada (desenvolvimento apenas)');
      await recordWebhookSecurityDecisionAndPersist({
        reason: 'missing_secret',
        allowed: true,
        webhookMode: 'development-bypass',
        hasSecret: false,
      });
      return;
    }

    const signature = request.headers['x-webhook-signature'] as string;
    if (!signature) {
      request.log.warn({
        reason: 'missing_signature',
        webhook_mode: 'hmac',
        has_secret: true,
      }, '[WebhookGuard] Header X-Webhook-Signature ausente');
      return denyWebhook(reply, 401, 'missing_signature', 'Missing webhook signature', {
        webhookMode: 'hmac',
        hasSecret: true,
        signaturePresent: false,
      });
    }

    const [algorithm, receivedHash] = signature.split('=');
    if (algorithm !== 'sha256' || !receivedHash) {
      request.log.warn({
        reason: 'invalid_signature_format',
        webhook_mode: 'hmac',
        has_secret: true,
        signature_present: true,
      }, '[WebhookGuard] Formato de assinatura inválido');
      return denyWebhook(reply, 401, 'invalid_signature_format', 'Invalid signature format', {
        webhookMode: 'hmac',
        hasSecret: true,
        signaturePresent: true,
      });
    }

    const body = JSON.stringify(request.body);
    const expectedHash = crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('hex');

    const expectedBuffer = Buffer.from(expectedHash, 'hex');
    const receivedBuffer = Buffer.from(receivedHash, 'hex');

    if (expectedBuffer.length !== receivedBuffer.length ||
        !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) {
      request.log.warn({
        reason: 'invalid_signature',
        webhook_mode: 'hmac',
        has_secret: true,
        signature_present: true,
      }, '[WebhookGuard] Assinatura inválida');
      return denyWebhook(reply, 401, 'invalid_signature', 'Invalid webhook signature', {
        webhookMode: 'hmac',
        hasSecret: true,
        signaturePresent: true,
      });
    }

    await recordWebhookSecurityDecisionAndPersist({
      reason: 'signature_valid',
      allowed: true,
      webhookMode: 'hmac',
      hasSecret: true,
      signaturePresent: true,
    });
    request.log.info({
      reason: 'signature_valid',
      webhook_mode: 'hmac',
      has_secret: true,
      algorithm: 'sha256',
    }, '[WebhookGuard] Assinatura validada com sucesso');
  };
}
