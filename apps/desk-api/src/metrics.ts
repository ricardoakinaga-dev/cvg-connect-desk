/**
 * Prometheus Metrics for Desk API
 * O1: Métricas Prometheus - exposes /metrics endpoint
 */

import { Registry, Counter, Gauge, collectDefaultMetrics } from 'prom-client';

const registry = new Registry();

// Collect default metrics (CPU, memory, etc.)
collectDefaultMetrics({ register: registry });

// Custom metrics for Desk API
export const deskMetrics = {
  // Inbound messages counter
  inboundMessagesTotal: new Counter({
    name: 'desk_inbound_messages_total',
    help: 'Total number of inbound messages received',
    labelNames: ['channel', 'sector_id'],
    registers: [registry],
  }),

  // Outbound messages counter
  outboundMessagesTotal: new Counter({
    name: 'desk_outbound_messages_total',
    help: 'Total number of outbound messages sent',
    labelNames: ['channel', 'sector_id'],
    registers: [registry],
  }),

  // Handoff counter
  handoffTotal: new Counter({
    name: 'desk_handoff_total',
    help: 'Total number of handoffs from bot to human',
    labelNames: ['sector_id'],
    registers: [registry],
  }),

  // Errors counter
  errorsTotal: new Counter({
    name: 'desk_errors_total',
    help: 'Total number of errors',
    labelNames: ['error_type', 'endpoint'],
    registers: [registry],
  }),

  // Active conversations gauge
  activeConversations: new Gauge({
    name: 'desk_active_conversations',
    help: 'Number of currently active conversations',
    labelNames: ['status', 'sector_id'],
    registers: [registry],
  }),

  // HTTP request duration histogram
  httpRequestDuration: new Counter({
    name: 'desk_http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'path', 'status_code'],
    registers: [registry],
  }),

  // Webhook delivery counter
  webhookDeliveriesTotal: new Counter({
    name: 'desk_webhook_deliveries_total',
    help: 'Total number of webhook delivery attempts',
    labelNames: ['direction', 'status'],
    registers: [registry],
  }),
};

// Helper functions to increment counters
export function recordInboundMessage(channel: string, sectorId?: string) {
  deskMetrics.inboundMessagesTotal.inc({ channel, sector_id: sectorId || 'unknown' });
}

export function recordOutboundMessage(channel: string, sectorId?: string) {
  deskMetrics.outboundMessagesTotal.inc({ channel, sector_id: sectorId || 'unknown' });
}

export function recordHandoff(sectorId?: string) {
  deskMetrics.handoffTotal.inc({ sector_id: sectorId || 'unknown' });
}

export function recordError(errorType: string, endpoint: string) {
  deskMetrics.errorsTotal.inc({ error_type: errorType, endpoint });
}

export function recordWebhookDelivery(direction: 'inbound' | 'outbound', status: 'success' | 'failure') {
  deskMetrics.webhookDeliveriesTotal.inc({ direction, status });
}

export function setActiveConversations(status: string, sectorId: string, count: number) {
  deskMetrics.activeConversations.set({ status, sector_id: sectorId }, count);
}

export function recordHttpRequest(method: string, path: string, statusCode: number) {
  deskMetrics.httpRequestDuration.inc({ method, path, status_code: statusCode.toString() });
}

export { registry };

export async function getMetrics(): Promise<string> {
  return registry.metrics();
}

export function getContentType(): string {
  return registry.contentType;
}
