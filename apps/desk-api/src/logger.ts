/**
 * Structured Logger Configuration
 * O3: Log Aggregation - ensures consistent JSON format for ELK/Datadog/Loki
 */

import type { FastifyBaseLogger } from 'fastify';

export interface LogMetadata {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  service: 'desk-api' | 'worker' | 'realtime';
  correlation_id?: string;
  message: string;
  [key: string]: unknown;
}

export function createStructuredLogger(service: 'desk-api' | 'worker' | 'realtime' = 'desk-api') {
  return {
    service,
    formatMetadata: (data: Record<string, unknown>, correlationId?: string): LogMetadata => {
      return {
        timestamp: new Date().toISOString(),
        level: 'info',
        service,
        message: typeof data.message === 'string' ? data.message : '',
        ...(correlationId && { correlation_id: correlationId }),
        ...data,
      };
    },
  };
}

export function addCorrelationIdToLog(
  log: FastifyBaseLogger,
  correlationId: string,
  data: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ...data,
    correlation_id: correlationId,
  };
}

export function logWithContext(
  log: FastifyBaseLogger,
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  context?: Record<string, unknown>
) {
  const logData = {
    timestamp: new Date().toISOString(),
    ...context,
  };

  switch (level) {
    case 'debug':
      log.debug(logData, message);
      break;
    case 'info':
      log.info(logData, message);
      break;
    case 'warn':
      log.warn(logData, message);
      break;
    case 'error':
      log.error(logData, message);
      break;
  }
}
