/**
 * Alerting Service
 * R3: Operational alerting for production failures
 *
 * Usage:
 * ```typescript
 * import { createAlertingService } from '@cvg/shared';
 *
 * const alerting = createAlertingService({
 *   serviceName: 'desk-api',
 *   environment: process.env.NODE_ENV,
 *   webhook: { url: process.env.ALERT_WEBHOOK_URL! }
 * });
 *
 * alerting.critical('db_down', 'Database connection lost', { host: 'db-primary' });
 * ```
 */

import { randomUUID } from 'crypto';
import type {
  AlertPayload,
  AlertingServiceConfig,
  AlertSeverity,
  AlertTemplate,
  AlertType,
} from './types';
import { WebhookNotifier } from './webhook-notifier';

const ALERT_TEMPLATES: AlertTemplate[] = [
  {
    type: 'db_down',
    severity: 'critical',
    title: 'Database Down',
    description: 'Database connection has been lost',
    fields: ['alert_type', 'severity', 'service', 'timestamp', 'correlation_id', 'context'],
  },
  {
    type: 'db_connection_failed',
    severity: 'high',
    title: 'Database Connection Failed',
    description: 'Failed to establish database connection',
    fields: ['alert_type', 'severity', 'service', 'timestamp', 'correlation_id', 'context'],
  },
  {
    type: 'redis_down',
    severity: 'high',
    title: 'Redis Down',
    description: 'Redis connection has been lost',
    fields: ['alert_type', 'severity', 'service', 'timestamp', 'correlation_id', 'context'],
  },
  {
    type: 'gateway_unavailable',
    severity: 'high',
    title: 'Gateway Unavailable',
    description: 'External gateway is not responding',
    fields: ['alert_type', 'severity', 'service', 'timestamp', 'correlation_id', 'context'],
  },
  {
    type: 'worker_deadlock',
    severity: 'critical',
    title: 'Worker Deadlock Detected',
    description: 'Worker process has entered a deadlock state',
    fields: ['alert_type', 'severity', 'service', 'timestamp', 'correlation_id', 'context'],
  },
  {
    type: 'worker_cascade_failure',
    severity: 'critical',
    title: 'Worker Cascade Failure',
    description: 'Multiple workers have failed in cascade',
    fields: ['alert_type', 'severity', 'service', 'timestamp', 'correlation_id', 'context'],
  },
  {
    type: 'outbound_queue_overflow',
    severity: 'high',
    title: 'Outbound Queue Overflow',
    description: 'Outbound message queue has exceeded capacity',
    fields: ['alert_type', 'severity', 'service', 'timestamp', 'correlation_id', 'context'],
  },
  {
    type: 'authentication_failure',
    severity: 'medium',
    title: 'Authentication Failure',
    description: 'Multiple failed authentication attempts detected',
    fields: ['alert_type', 'severity', 'service', 'timestamp', 'correlation_id', 'context'],
  },
  {
    type: 'rate_limit_exceeded',
    severity: 'low',
    title: 'Rate Limit Exceeded',
    description: 'Rate limit threshold has been exceeded',
    fields: ['alert_type', 'severity', 'service', 'timestamp', 'correlation_id', 'context'],
  },
  {
    type: 'webhook_delivery_failed',
    severity: 'medium',
    title: 'Webhook Delivery Failed',
    description: 'Failed to deliver webhook after retries',
    fields: ['alert_type', 'severity', 'service', 'timestamp', 'correlation_id', 'context'],
  },
  {
    type: 'unhandled_exception',
    severity: 'critical',
    title: 'Unhandled Exception',
    description: 'An unhandled exception occurred in the service',
    fields: ['alert_type', 'severity', 'service', 'timestamp', 'correlation_id', 'context', 'metadata'],
  },
];

export interface AlertingService {
  critical(type: AlertType, message: string, context?: Record<string, unknown>): Promise<void>;
  high(type: AlertType, message: string, context?: Record<string, unknown>): Promise<void>;
  medium(type: AlertType, message: string, context?: Record<string, unknown>): Promise<void>;
  low(type: AlertType, message: string, context?: Record<string, unknown>): Promise<void>;
  info(type: AlertType, message: string, context?: Record<string, unknown>): Promise<void>;
  alert(type: AlertType, severity: AlertSeverity, message: string, context?: Record<string, unknown>): Promise<void>;
}

interface AlertingServiceInternals {
  config: {
    serviceName: string;
    environment: string;
    version: string;
    enabled: boolean;
    webhook?: {
      url: string;
      secret?: string;
      timeout_ms?: number;
      retries?: number;
    };
  };
  notifier: WebhookNotifier | null;
  listeners: Array<(payload: AlertPayload) => void>;
  isEnabled(): boolean;
}

function createInternals(config: AlertingServiceConfig): AlertingServiceInternals {
  return {
    config: {
      serviceName: config.serviceName,
      environment: config.environment ?? 'development',
      version: config.version ?? '1.0.0',
      enabled: config.enabled ?? true,
      webhook: config.webhook,
    },
    notifier: config.webhook ? new WebhookNotifier(config.webhook) : null,
    listeners: [],
    isEnabled() {
      return this.config.enabled && this.notifier !== null;
    },
  };
}

export function createAlertingService(config: AlertingServiceConfig): AlertingService {
  const internals = createInternals(config);

  async function dispatch(payload: AlertPayload): Promise<void> {
    for (const listener of internals.listeners) {
      try {
        listener(payload);
      } catch {
        // Listener errors should not block alert dispatch
      }
    }

    if (!internals.isEnabled()) {
      return;
    }

    const result = await internals.notifier!.notify(payload);
    if (!result.success) {
      console.error(`[Alerting] Failed to dispatch ${payload.alert_type} after ${result.attempts} attempts: ${result.error}`);
    }
  }

  function buildPayload(
    type: AlertType,
    severity: AlertSeverity,
    message: string,
    context?: Record<string, unknown>
  ): AlertPayload {
    return {
      alert_type: type,
      severity,
      service: internals.config.serviceName,
      timestamp: new Date().toISOString(),
      correlation_id: randomUUID(),
      message,
      context,
      metadata: {
        environment: internals.config.environment,
        version: internals.config.version,
      },
    };
  }

  return {
    async critical(type, message, context) {
      const payload = buildPayload(type, 'critical', message, context);
      payload.metadata!.stack_trace = new Error().stack;
      await dispatch(payload);
    },

    async high(type, message, context) {
      const payload = buildPayload(type, 'high', message, context);
      await dispatch(payload);
    },

    async medium(type, message, context) {
      const payload = buildPayload(type, 'medium', message, context);
      await dispatch(payload);
    },

    async low(type, message, context) {
      const payload = buildPayload(type, 'low', message, context);
      await dispatch(payload);
    },

    async info(type, message, context) {
      const payload = buildPayload(type, 'info', message, context);
      await dispatch(payload);
    },

    async alert(type, severity, message, context) {
      const payload = buildPayload(type, severity, message, context);
      await dispatch(payload);
    },
  };
}

export function createAlertingHook(service: AlertingService) {
  return {
    onDatabaseError: (error: Error, context?: Record<string, unknown>) => {
      return service.critical('db_down', error.message, { ...context, stack: error.stack });
    },
    onRedisError: (error: Error, context?: Record<string, unknown>) => {
      return service.high('redis_down', error.message, { ...context, stack: error.stack });
    },
    onGatewayError: (error: Error, context?: Record<string, unknown>) => {
      return service.high('gateway_unavailable', error.message, context);
    },
    onUnhandledException: (error: Error, context?: Record<string, unknown>) => {
      return service.critical('unhandled_exception', error.message, { ...context, stack: error.stack });
    },
    onWorkerDeadlock: (context?: Record<string, unknown>) => {
      return service.critical('worker_deadlock', 'Worker deadlock detected', context);
    },
    onCascadeFailure: (count: number, context?: Record<string, unknown>) => {
      return service.critical('worker_cascade_failure', `${count} workers failed in cascade`, context);
    },
  };
}

export { ALERT_TEMPLATES };
