/**
 * Alerting Types and Interfaces
 * R3: Alerting Operacional for production failure notifications
 */

export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type AlertType =
  | 'db_down'
  | 'db_connection_failed'
  | 'redis_down'
  | 'gateway_unavailable'
  | 'worker_deadlock'
  | 'worker_cascade_failure'
  | 'outbound_queue_overflow'
  | 'authentication_failure'
  | 'rate_limit_exceeded'
  | 'webhook_delivery_failed'
  | 'unhandled_exception';

export interface AlertPayload {
  alert_type: AlertType;
  severity: AlertSeverity;
  service: string;
  timestamp: string;
  correlation_id: string;
  message: string;
  context?: Record<string, unknown>;
  metadata?: {
    host?: string;
    environment?: string;
    version?: string;
    endpoint?: string;
    stack_trace?: string;
  };
}

export interface AlertTemplate {
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  description: string;
  fields: string[];
}

export interface WebhookConfig {
  url: string;
  secret?: string;
  timeout_ms?: number;
  retries?: number;
}

export interface AlertingServiceConfig {
  serviceName: string;
  environment?: string;
  version?: string;
  webhook?: WebhookConfig;
  enabled?: boolean;
}

export const ALERT_SEVERITY_ORDER: Record<AlertSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};
