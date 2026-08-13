/**
 * Alerting Integration for Desk API
 * R3: Alerting Operacional - hooks into Fastify error handlers
 */

import type { FastifyInstance, FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import {
  createAlertingService,
  createAlertingHook,
  type AlertingService,
} from '@cvg/shared';

let alertingService: AlertingService | null = null;
let alertingHooks: ReturnType<typeof createAlertingHook> | null = null;

export function initializeAlerting(app: FastifyInstance): void {
  const webhookUrl = process.env.ALERT_WEBHOOK_URL;
  const environment = process.env.NODE_ENV || process.env.DESK_ENV || 'development';

  if (!webhookUrl) {
    app.log.warn('[Alerting] ALERT_WEBHOOK_URL not set — operational alerting disabled');
    return;
  }

  alertingService = createAlertingService({
    serviceName: 'desk-api',
    environment,
    version: process.env.npm_package_version || '1.0.0',
    webhook: { url: webhookUrl },
    enabled: true,
  });

  alertingHooks = createAlertingHook(alertingService);

  app.log.info('[Alerting] Operational alerting initialized');
}

export function getAlertingService(): AlertingService | null {
  return alertingService;
}

export function getAlertingHooks() {
  return alertingHooks;
}

export function getAlertingHooksOrThrow() {
  if (!alertingHooks) {
    throw new Error('Alerting not initialized. Call initializeAlerting first.');
  }
  return alertingHooks;
}

export function registerAlertingErrorHooks(app: FastifyInstance): void {
  if (!alertingHooks) {
    return;
  }

  app.setErrorHandler(async (error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    const errorMessage = error.message || 'Unknown error';
    const errorContext = {
      url: request.url,
      method: request.method,
      correlation_id: request.id,
    };

    const statusCode = error.statusCode ?? 500;

    if (statusCode >= 500) {
      await alertingHooks!.onUnhandledException(
        error instanceof Error ? error : new Error(errorMessage),
        errorContext
      );
    }

    // Let Fastify handle the error response
    reply.status(statusCode).send({
      error: error.code || 'INTERNAL_ERROR',
      message: statusCode >= 500 ? 'Internal server error' : errorMessage,
      statusCode,
      timestamp: new Date().toISOString(),
    });
  });

  app.addHook('onClose', async () => {
    if (alertingService && alertingHooks) {
      await alertingHooks.onUnhandledException(
        new Error('Desk API shutting down'),
        { reason: 'onClose' }
      );
    }
  });
}
