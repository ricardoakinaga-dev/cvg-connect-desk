import { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { recordWebhookSecurityDecision } from './webhook-security-stats';
import { webhookRequestsTotal, webhookReplayRejectedTotal } from './metrics';
import {
  buildWebhookSignaturePayload,
  extractWebhookEventId,
  getDefaultWebhookReplayStore,
  validateWebhookTimestamp,
} from './webhook-anti-replay';

/**
 * Middleware de segurança para webhook inbound.
 * Valida assinatura HMAC-SHA256 sobre RAW BODY quando WEBHOOK_SECRET configurado.
 * Header esperado: X-Webhook-Signature: sha256=<hex>
 * Anti-replay: X-Webhook-Timestamp (epoch s) + X-Webhook-Event-Id.
 * Mensagem assinada: `${timestamp}.${rawBody}` (modo novo) ou `rawBody` (legado dev).
 *
 * Em produção (NODE_ENV=production ou DESK_ENV=production), a ausência de
 * WEBHOOK_SECRET causa rejeição imediata (fail-secure).
 * Em desenvolvimento, permite bypass com warning.
 */

function isProduction(): boolean {
  const env = (process.env.NODE_ENV || process.env.DESK_ENV || '').toLowerCase();
  return env === 'production' || env === 'prod';
}

function denyWebhook(
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
  recordWebhookSecurityDecision({
    reason: reason as Parameters<typeof recordWebhookSecurityDecision>[0]['reason'],
    allowed: false,
    webhookMode: metadata.webhookMode,
    hasSecret: metadata.hasSecret,
    signaturePresent: metadata.signaturePresent,
    statusCode,
  });
  try {
    webhookRequestsTotal.inc({ decision: reason });
  } catch {
    // Métricas nunca quebram o guard.
  }
  return reply.status(statusCode).send({
    error: statusCode === 500 ? 'CONFIGURATION_ERROR' : 'UNAUTHORIZED',
    reason,
    message,
  });
}

function rawBodyOf(request: FastifyRequest): string {
  const raw = (request as unknown as { rawBody?: unknown }).rawBody;
  if (typeof raw === 'string') return raw;
  if (Buffer.isBuffer(raw)) return raw.toString('utf8');
  return JSON.stringify(request.body);
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
      recordWebhookSecurityDecision({
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

    const body = rawBodyOf(request);
    const timestampCheck = validateWebhookTimestamp(request.headers['x-webhook-timestamp']);
    if (!timestampCheck.ok) {
      request.log.warn({
        reason: timestampCheck.reason,
        webhook_mode: 'hmac',
        has_secret: true,
      }, '[WebhookGuard] Timestamp anti-replay rejeitado');
      recordWebhookSecurityDecision({
        reason: (timestampCheck.reason || 'invalid_timestamp') as Parameters<typeof recordWebhookSecurityDecision>[0]['reason'],
        allowed: false,
        webhookMode: 'hmac',
        hasSecret: true,
        signaturePresent: true,
      });
      try {
        webhookRequestsTotal.inc({ decision: timestampCheck.reason || 'invalid_timestamp' });
        webhookReplayRejectedTotal.inc({ reason: timestampCheck.reason || 'invalid_timestamp' });
      } catch {
        // Métricas nunca quebram o guard.
      }
      return reply.status(401).send({
        error: 'UNAUTHORIZED',
        reason: timestampCheck.reason,
        message: timestampCheck.message,
      });
    }

    const eventId = extractWebhookEventId(request);
    if (!timestampCheck.legacyMode && !eventId) {
      request.log.warn({
        reason: 'missing_event_id',
        webhook_mode: 'hmac',
        has_secret: true,
      }, '[WebhookGuard] Header X-Webhook-Event-Id ausente');
      recordWebhookSecurityDecision({
        reason: 'missing_event_id',
        allowed: false,
        webhookMode: 'hmac',
        hasSecret: true,
        signaturePresent: true,
      });
      try {
        webhookRequestsTotal.inc({ decision: 'missing_event_id' });
        webhookReplayRejectedTotal.inc({ reason: 'missing_event_id' });
      } catch {
        // Métricas nunca quebram o guard.
      }
      return reply.status(401).send({
        error: 'UNAUTHORIZED',
        reason: 'missing_event_id',
        message: 'Missing X-Webhook-Event-Id',
      });
    }

    const signedPayload = buildWebhookSignaturePayload(body, timestampCheck.timestamp);
    const expectedHash = crypto
      .createHmac('sha256', secret)
      .update(signedPayload)
      .digest('hex');

    if (!/^[0-9a-fA-F]+$/.test(receivedHash) || receivedHash.length !== expectedHash.length) {
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

    recordWebhookSecurityDecision({
      reason: 'signature_valid',
      allowed: true,
      webhookMode: 'hmac',
      hasSecret: true,
      signaturePresent: true,
    });
    try {
      webhookRequestsTotal.inc({ decision: 'signature_valid' });
    } catch {
      // Métricas nunca quebram o guard.
    }

    if (eventId) {
      const store = getDefaultWebhookReplayStore();
      const signatureHash = crypto.createHash('sha256').update(receivedHash, 'utf8').digest('hex');
      const firstSeen = await store.add(eventId, signatureHash);
      if (!firstSeen) {
        request.log.warn({
          reason: 'duplicate_event_id',
          webhook_mode: 'hmac',
          has_secret: true,
        }, '[WebhookGuard] Webhook event ID duplicado — replay rejeitado');
        recordWebhookSecurityDecision({
          reason: 'duplicate_event_id',
          allowed: false,
          webhookMode: 'hmac',
          hasSecret: true,
          signaturePresent: true,
        });
        try {
          webhookRequestsTotal.inc({ decision: 'duplicate_event_id' });
          webhookReplayRejectedTotal.inc({ reason: 'duplicate_event_id' });
        } catch {
          // Métricas nunca quebram o guard.
        }
        return reply.status(409).send({
          error: 'CONFLICT',
          reason: 'duplicate_event_id',
          message: 'Duplicate webhook event',
        });
      }
    }

    request.log.info({
      reason: 'signature_valid',
      webhook_mode: 'hmac',
      has_secret: true,
      algorithm: 'sha256',
    }, '[WebhookGuard] Assinatura validada com sucesso');
  };
}
